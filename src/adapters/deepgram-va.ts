// Deepgram Voice Agent adapter — drives an agent-under-test over its live
// WebSocket, headless. Ported from the validated spike (stage3 run-conversation):
// real-time audio pacing (bursting breaks endpointing), a continuous silence
// keepalive between turns (the VA drops the "call" if audio stops), settle-based
// turn-taking (the agent emits multiple lines per turn), and tool-call stubbing.
//
// Auth: the raw Deepgram key via the ["token", key] subprotocol. The `think` LLM
// runs on the Deepgram key alone — NO OpenAI/Anthropic key is ever passed.

import { getKey, synthesize, resamplePcm16le } from "../deepgram.ts";
import type { AUTConfig, ToolCall } from "../types.ts";
import type { AUTAdapter, CallerTurn, RawTurn } from "./types.ts";

const AGENT_WS = "wss://agent.deepgram.com/v1/agent/converse";
const FRAME = 3200; // 100ms @ 16kHz, 16-bit mono
const SILENCE = Buffer.alloc(FRAME);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function buildSettings(aut: AUTConfig) {
  const think = aut.think ?? { type: "open_ai", model: "gpt-4o-mini", temperature: 0.5 };
  return {
    type: "Settings",
    audio: {
      input: { encoding: "linear16", sample_rate: 16000 },
      output: { encoding: "linear16", sample_rate: 24000, container: "none" },
    },
    agent: {
      language: "en",
      listen: { provider: { type: "deepgram", model: aut.listenModel ?? "nova-3" } },
      think: { provider: think, prompt: aut.systemPrompt, functions: aut.tools },
      speak: { provider: { type: "deepgram", model: aut.voice ?? "aura-2-thalia-en" } },
      greeting: aut.greeting ?? "Hi, thanks for calling. How can I help you today?",
    },
  };
}

// Minimal structural type for the socket the adapter drives — lets a test inject a
// mock WebSocket (and skip the network + the key) without depending on the global.
export interface WsLike {
  binaryType: string;
  readyState: number;
  send(data: unknown): void;
  close(): void;
  addEventListener(type: string, listener: (ev: { data: unknown }) => void): void;
}
export type WsFactory = (url: string) => WsLike;
export type SynthFn = (text: string, opts: { model: string; encoding: string; sampleRate: number; container: string }) => Promise<Buffer>;

export class DeepgramVoiceAgentAdapter implements AUTAdapter {
  label = "deepgram-va";
  #wsFactory: WsFactory;
  #synth: SynthFn;

  // Defaults are the real Deepgram socket + TTS (the default factory fetches the key,
  // so an injected mock factory needs no key — keeps offline tests CI-safe).
  constructor(opts: { wsFactory?: WsFactory; synth?: SynthFn } = {}) {
    this.#wsFactory = opts.wsFactory ?? ((url) => new WebSocket(url, ["token", getKey()]) as unknown as WsLike);
    this.#synth = opts.synth ?? ((text, o) => synthesize(text, o));
  }

  async runConversation(aut: AUTConfig, callerTurns: CallerTurn[]): Promise<RawTurn[]> {
    const ws = this.#wsFactory(AGENT_WS);
    ws.binaryType = "arraybuffer";

    // Shared turn state.
    const audioQueue: Buffer[] = []; // caller frames to inject; else silence (mutated, never reassigned)
    let collecting = false;
    let agentAudio: Buffer[] = [];
    let agentLines: string[] = [];
    let userHeard: string[] = [];
    let toolCalls: ToolCall[] = [];
    let greetingDone = false;
    let firstFrameAt = 0; // first agent audio frame of the current turn
    let lastAudioAt = 0; // most recent agent audio frame of the current turn
    let audioDoneAt = 0; // AgentAudioDone for the current turn (the authoritative end-of-speech signal)

    // Continuous real-time pump (phone-call model — never stop sending audio).
    const pump = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(audioQueue.length ? audioQueue.shift()! : SILENCE);
    }, 100);

    const opened = new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => { ws.send(JSON.stringify(buildSettings(aut))); resolve(); });
      ws.addEventListener("error", () => reject(new Error("Voice Agent WebSocket error")));
    });

    ws.addEventListener("message", (event: { data: unknown }) => {
      if (event.data instanceof ArrayBuffer) {
        if (collecting) {
          const now = Date.now();
          if (firstFrameAt === 0) firstFrameAt = now;
          lastAudioAt = now; // streaming audio IS activity — the fix for premature turn-cut
          agentAudio.push(Buffer.from(event.data));
        }
        return;
      }
      let m: any;
      try { m = JSON.parse(String(event.data)); } catch { return; }
      switch (m.type) {
        case "ConversationText":
          if (m.role === "assistant") agentLines.push(m.content);
          else if (m.role === "user") userHeard.push(m.content);
          break;
        case "AgentAudioDone":
          audioDoneAt = Date.now();
          if (!greetingDone) greetingDone = true;
          break;
        case "FunctionCallRequest": {
          const fns = Array.isArray(m.functions) ? m.functions : [];
          for (const fn of fns) {
            let args: Record<string, unknown>;
            try { args = fn.arguments ? JSON.parse(fn.arguments) : {}; } catch { args = {}; }
            const stub = aut.toolStubs[fn.name];
            const result = stub ? stub(args) : { ok: true };
            toolCalls.push({ name: fn.name, args, result });
            ws.send(JSON.stringify({ type: "FunctionCallResponse", id: fn.id, name: fn.name, content: JSON.stringify(result) }));
          }
          break;
        }
      }
    });

    await opened;

    const enqueueSpeech = (pcm: Buffer) => {
      for (let p = 0; p < pcm.length; p += FRAME) audioQueue.push(pcm.subarray(p, p + FRAME));
    };
    // Turn endpoint (the fix): the turn completes when the caller's audio has drained,
    // the agent actually started responding, AgentAudioDone fired for THIS turn, AND a
    // short coalescing window passed with no new audio (so multi-segment answers and
    // tool-call-then-speak sequences are joined, not split). Capped as a backstop; if the
    // agent never responds, we wait to the cap and record an empty agent turn.
    // Relies on firstFrameAt/lastAudioAt/audioDoneAt being reset to 0 at each turn start.
    const COALESCE_MS = 1200;
    const waitTurn = async (capMs: number) => {
      const start = Date.now();
      while (Date.now() - start < capMs) {
        await sleep(150);
        if (ws.readyState !== WebSocket.OPEN) return;
        const started = firstFrameAt > 0 || agentLines.length > 0;
        const spokeAndDone = audioDoneAt > 0; // an AgentAudioDone fired this turn
        const quiet = Date.now() - Math.max(lastAudioAt, audioDoneAt) > COALESCE_MS;
        if (audioQueue.length === 0 && started && spokeAndDone && quiet) return;
      }
    };

    // Wait for the greeting to finish before the first caller turn.
    for (let i = 0; i < 60 && !greetingDone; i++) await sleep(200);
    await sleep(500);

    const out: RawTurn[] = [];
    for (let i = 0; i < callerTurns.length; i++) {
      agentAudio = []; agentLines = []; userHeard = []; toolCalls = [];
      firstFrameAt = 0; lastAudioAt = 0; audioDoneAt = 0; // per-turn endpoint state
      collecting = true;
      const turn = callerTurns[i];
      const pcm = await this.#synth(turn.text, { model: turn.voice, encoding: "linear16", sampleRate: 16000, container: "none" });
      const numSpeechFrames = Math.ceil(pcm.length / FRAME);
      const turnStart = Date.now();
      enqueueSpeech(pcm);
      for (let s = 0; s < 12; s++) audioQueue.push(SILENCE); // ~1.2s trailing silence to endpoint
      // The caller stops *speaking* ~numSpeechFrames*100ms after the pump starts
      // (frames are sent real-time at 100ms each). TTFB is measured from there.
      // NOTE (v0): per-turn TTFB includes think + tool round-trips; a tool-time-
      // excluded SLO is a v1 refinement. If the agent barges in before speech ends
      // we can't cleanly measure TTFB -> report null.
      const speechEndMs = turnStart + numSpeechFrames * 100;
      await waitTurn(34000);
      collecting = false;
      const settleAt = Date.now();
      out.push({
        callerSaid: turn.text,
        agentHeardCallerAs: userHeard.join(" "),
        agentText: agentLines.join(" "),
        agentAudioPcm: Buffer.concat(agentAudio),
        // Evaline was synthesized at 16kHz for the agent's input; upsample to 24kHz so
        // report playback (and the stitched conversation) is one consistent rate with the agent.
        callerAudioPcm: resamplePcm16le(pcm, 16000, 24000),
        toolCalls,
        ttfbMs: firstFrameAt > speechEndMs ? firstFrameAt - speechEndMs : null,
        turnMs: Math.max(0, settleAt - speechEndMs),
      });
    }

    clearInterval(pump);
    try { ws.close(); } catch { /* ignore */ }
    return out;
  }
}

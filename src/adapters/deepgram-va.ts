// Deepgram Voice Agent adapter — drives an agent-under-test over its live
// WebSocket, headless. Ported from the validated spike (stage3 run-conversation):
// real-time audio pacing (bursting breaks endpointing), a continuous silence
// keepalive between turns (the VA drops the "call" if audio stops), settle-based
// turn-taking (the agent emits multiple lines per turn), and tool-call stubbing.
//
// Auth: the raw Deepgram key via the ["token", key] subprotocol. The `think` LLM
// runs on the Deepgram key alone — NO OpenAI/Anthropic key is ever passed.

import { getKey, synthesize } from "../deepgram.ts";
import type { AUTConfig, ToolCall } from "../types.ts";
import type { AUTAdapter, CallerTurn, RawTurn } from "./types.ts";

const AGENT_WS = "wss://agent.deepgram.com/v1/agent/converse";
const FRAME = 3200; // 100ms @ 16kHz, 16-bit mono
const SILENCE = Buffer.alloc(FRAME);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function buildSettings(aut: AUTConfig) {
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

export class DeepgramVoiceAgentAdapter implements AUTAdapter {
  label = "deepgram-va";

  async runConversation(aut: AUTConfig, callerTurns: CallerTurn[]): Promise<RawTurn[]> {
    const key = getKey();
    const ws = new WebSocket(AGENT_WS, ["token", key]);
    ws.binaryType = "arraybuffer";

    // Shared turn state.
    let audioQueue: Buffer[] = []; // caller frames to inject; else silence
    let collecting = false;
    let agentAudio: Buffer[] = [];
    let agentLines: string[] = [];
    let userHeard: string[] = [];
    let toolCalls: ToolCall[] = [];
    let lastAgentEventAt = 0;
    let greetingDone = false;
    let firstFrameAt = 0; // first agent audio frame of the current turn

    // Continuous real-time pump (phone-call model — never stop sending audio).
    const pump = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(audioQueue.length ? audioQueue.shift()! : SILENCE);
    }, 100);

    const opened = new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => { ws.send(JSON.stringify(buildSettings(aut))); resolve(); });
      ws.addEventListener("error", () => reject(new Error("Voice Agent WebSocket error")));
    });

    ws.addEventListener("message", (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) {
        if (collecting) {
          if (firstFrameAt === 0) firstFrameAt = Date.now();
          agentAudio.push(Buffer.from(event.data));
        }
        return;
      }
      let m: any;
      try { m = JSON.parse(String(event.data)); } catch { return; }
      switch (m.type) {
        case "ConversationText":
          if (m.role === "assistant") { agentLines.push(m.content); lastAgentEventAt = Date.now(); }
          else if (m.role === "user") userHeard.push(m.content);
          break;
        case "AgentAudioDone":
          lastAgentEventAt = Date.now();
          if (!greetingDone) greetingDone = true;
          break;
        case "FunctionCallRequest": {
          const fns = Array.isArray(m.functions) ? m.functions : [];
          for (const fn of fns) {
            let args: Record<string, unknown> = {};
            try { args = fn.arguments ? JSON.parse(fn.arguments) : {}; } catch { args = {}; }
            const stub = aut.toolStubs[fn.name];
            const result = stub ? stub(args) : { ok: true };
            toolCalls.push({ name: fn.name, args, result });
            ws.send(JSON.stringify({ type: "FunctionCallResponse", id: fn.id, name: fn.name, content: JSON.stringify(result) }));
            lastAgentEventAt = Date.now();
          }
          break;
        }
      }
    });

    await opened;

    const enqueueSpeech = (pcm: Buffer) => {
      for (let p = 0; p < pcm.length; p += FRAME) audioQueue.push(pcm.subarray(p, p + FRAME));
    };
    // Settle: caller audio drained AND no agent activity for quietMs, capped.
    const waitTurn = async (quietMs: number, capMs: number) => {
      const start = Date.now();
      while (Date.now() - start < capMs) {
        await sleep(250);
        if (audioQueue.length === 0 && Date.now() - lastAgentEventAt > quietMs && agentLines.length > 0) return;
      }
    };

    // Wait for the greeting to finish before the first caller turn.
    for (let i = 0; i < 60 && !greetingDone; i++) await sleep(200);
    lastAgentEventAt = Date.now();
    await sleep(500);

    const out: RawTurn[] = [];
    for (let i = 0; i < callerTurns.length; i++) {
      agentAudio = []; agentLines = []; userHeard = []; toolCalls = []; firstFrameAt = 0;
      collecting = true;
      const turn = callerTurns[i];
      const pcm = await synthesize(turn.text, { model: turn.voice, encoding: "linear16", sampleRate: 16000, container: "none" });
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
      lastAgentEventAt = Date.now();
      await waitTurn(3000, 34000);
      collecting = false;
      const settleAt = Date.now();
      out.push({
        callerSaid: turn.text,
        agentHeardCallerAs: userHeard.join(" "),
        agentText: agentLines.join(" "),
        agentAudioPcm: Buffer.concat(agentAudio),
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

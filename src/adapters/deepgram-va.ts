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
import type { AUTAdapter, CallerTurn, RawTurn, ConversationCapture } from "./types.ts";
import { ScriptedCaller, type Caller, type CallerExchange } from "../caller/policy.ts";

const AGENT_WS = "wss://agent.deepgram.com/v1/agent/converse";
const FRAME = 3200; // 100ms @ 16kHz, 16-bit mono
const SILENCE = Buffer.alloc(FRAME);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Sum two 16-bit LE PCM buffers sample-wise (clamped) — for the real-time mixed recording,
// so when caller and agent speak at once (barge-in) you HEAR both, faithfully overlaid.
function mixPcm16le(a: Buffer, b: Buffer): Buffer {
  const n = Math.max(a.length, b.length) & ~1;
  const out = Buffer.alloc(n);
  for (let i = 0; i + 1 < n; i += 2) {
    const sa = i + 1 < a.length ? a.readInt16LE(i) : 0;
    const sb = i + 1 < b.length ? b.readInt16LE(i) : 0;
    const s = Math.max(-32768, Math.min(32767, sa + sb));
    out.writeInt16LE(s, i);
  }
  return out;
}

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
  #setupTimeoutMs: number;

  // Defaults are the real Deepgram socket + TTS (the default factory fetches the key,
  // so an injected mock factory needs no key — keeps offline tests CI-safe).
  constructor(opts: { wsFactory?: WsFactory; synth?: SynthFn; setupTimeoutMs?: number } = {}) {
    this.#wsFactory = opts.wsFactory ?? ((url) => new WebSocket(url, ["token", getKey()]) as unknown as WsLike);
    this.#synth = opts.synth ?? ((text, o) => synthesize(text, o));
    this.#setupTimeoutMs = opts.setupTimeoutMs ?? 15000;
  }

  // Back-compat scripted path: wrap the fixed list in a ScriptedCaller and converse.
  async runConversation(aut: AUTConfig, callerTurns: CallerTurn[]): Promise<ConversationCapture> {
    return this.converse(aut, new ScriptedCaller(callerTurns.map((t) => ({ text: t.text, voice: t.voice }))));
  }

  // Control-inverted loop: ask the Caller for each next action given what the agent just
  // said (enables a reactive goal-driven caller and barge-in). The scripted path uses it too.
  async converse(aut: AUTConfig, caller: Caller): Promise<ConversationCapture> {
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

    // --- real-time call recorder (the keystone) ---
    // The pump is the wall clock: each 100ms tick we MIX the caller frame we send with the
    // next 100ms of agent audio (paced out of a playback queue) into one faithful recording.
    // Result: a real, time-ordered call — overlaps and all — that the report plays and the
    // oracle (STT) transcribes to self-validate.
    let recordingOn = false;
    const recording: Buffer[] = []; // mixed 24kHz frames, in real-time order
    const agentQ: Buffer[] = []; // agent PCM (24kHz) awaiting real-time playback
    let agentQHead = 0; // read offset into agentQ[0]
    const pullAgent = (n: number): Buffer => {
      const out = Buffer.alloc(n); // zero-filled => silence padding when the agent isn't speaking
      let w = 0;
      while (w < n && agentQ.length) {
        const head = agentQ[0];
        const take = Math.min(head.length - agentQHead, n - w);
        head.copy(out, w, agentQHead, agentQHead + take);
        w += take; agentQHead += take;
        if (agentQHead >= head.length) { agentQ.shift(); agentQHead = 0; }
      }
      return out;
    };

    // Continuous real-time pump (phone-call model — never stop sending audio) + recorder.
    const pump = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const callerFrame = audioQueue.length ? audioQueue.shift()! : SILENCE;
      ws.send(callerFrame);
      if (recordingOn) {
        const caller24 = resamplePcm16le(callerFrame, 16000, 24000);
        recording.push(mixPcm16le(caller24, pullAgent(caller24.length)));
      }
    }, 100);

    // Deepgram message flow: open → server `Welcome` → we send `Settings` → server `SettingsApplied`
    // → ready. We resolve only on SettingsApplied, with a hard setup timeout so a missing/late
    // handshake or a server Error can never hang the call. (Welcome/SettingsApplied/Error are
    // handled in the message switch below.)
    let resolveOpened!: () => void, rejectOpened!: (e: Error) => void, settled = false;
    const opened = new Promise<void>((resolve, reject) => {
      resolveOpened = () => { if (!settled) { settled = true; resolve(); } };
      rejectOpened = (e) => { if (!settled) { settled = true; reject(e); } };
    });
    const setupTimer = setTimeout(() => rejectOpened(new Error(`Voice Agent setup timed out — no SettingsApplied within ${this.#setupTimeoutMs}ms`)), this.#setupTimeoutMs);
    ws.addEventListener("error", () => rejectOpened(new Error("Voice Agent WebSocket error")));

    ws.addEventListener("message", (event: { data: unknown }) => {
      if (event.data instanceof ArrayBuffer) {
        const buf = Buffer.from(event.data);
        if (recordingOn) agentQ.push(buf); // feed the real-time playback queue (whole call)
        if (collecting) {
          const now = Date.now();
          if (firstFrameAt === 0) firstFrameAt = now;
          lastAudioAt = now; // streaming audio IS activity — the fix for premature turn-cut
          agentAudio.push(buf);
        }
        return;
      }
      let m: Record<string, unknown>;
      try { m = JSON.parse(String(event.data)); } catch { return; }
      if (process.env.SC_DEBUG) process.stderr.write(`<${String(m.type)}@${Date.now() % 100000}> `);
      switch (m.type) {
        case "Welcome": // server is ready; per Deepgram's flow we send Settings only now
          ws.send(JSON.stringify(buildSettings(aut)));
          break;
        case "SettingsApplied":
          clearTimeout(setupTimer); resolveOpened();
          break;
        case "Error": {
          const desc = String((m as { description?: unknown }).description ?? (m as { message?: unknown }).message ?? "unknown");
          process.stderr.write(`[Voice Agent server Error: ${desc}]\n`);
          clearTimeout(setupTimer); rejectOpened(new Error(`Voice Agent error: ${desc}`)); // no-op once past setup
          break;
        }
        case "Warning":
          if (process.env.SC_DEBUG) process.stderr.write(`<Warning: ${String((m as { description?: unknown }).description ?? "")}> `);
          break;
        case "ConversationText":
          if (m.role === "assistant") agentLines.push(String(m.content));
          else if (m.role === "user") userHeard.push(String(m.content));
          break;
        case "AgentAudioDone":
          audioDoneAt = Date.now();
          if (!greetingDone) greetingDone = true;
          break;
        case "UserStartedSpeaking":
          // The VA detected the caller and is barging in — a real client STOPS playing any
          // agent audio still queued. We do the same so the recording is faithful: on a real
          // interruption the agent's unplayed audio is dropped (it truncates mid-utterance),
          // rather than us replaying stale buffered audio over the caller.
          agentQ.length = 0; agentQHead = 0;
          break;
        case "FunctionCallRequest": {
          const fns = Array.isArray(m.functions) ? m.functions : [];
          for (const fn of fns) {
            let args: Record<string, unknown>;
            try { args = fn.arguments ? JSON.parse(fn.arguments) : {}; } catch { args = {}; }
            // Tool handlers may be async (real ones hit a DB/API) and may throw — await + guard,
            // and on failure return a structured error so the agent gets a response and isn't stuck.
            void (async () => {
              const stub = aut.toolStubs[fn.name];
              let result: unknown;
              try { result = stub ? await stub(args) : { ok: true }; }
              catch (err) { result = { error: (err as Error)?.message ?? String(err) }; }
              toolCalls.push({ name: fn.name, args, result });
              try { ws.send(JSON.stringify({ type: "FunctionCallResponse", id: fn.id, name: fn.name, content: JSON.stringify(result) })); } catch { /* socket closed */ }
            })();
          }
          break;
        }
      }
    });

    try { // always clean up the pump + socket below, even if setup times out or a turn throws
    await opened;
    recordingOn = true; // record the whole call, from the greeting on

    const enqueueSpeech = (pcm: Buffer) => {
      for (let p = 0; p < pcm.length; p += FRAME) {
        const frame = pcm.subarray(p, p + FRAME);
        // Pad the trailing partial frame to a full FRAME so every pump tick is exactly 100ms —
        // otherwise that tick advances the recording (and pulls agent audio) by less than 100ms.
        audioQueue.push(frame.length === FRAME ? frame : Buffer.concat([frame, SILENCE.subarray(0, FRAME - frame.length)]));
      }
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
    const history: CallerExchange[] = [];
    // Seed turn 0 with the configured greeting so a reactive caller can react to it.
    let lastAgent = aut.greeting ?? "Hi, thanks for calling. How can I help you today?";
    const MAX_TURNS = 16; // backstop only — a Caller normally ends itself (scripted list exhausted, or GoalDrivenCaller's own maxTurns/repetition guard)
    for (let i = 0; i < MAX_TURNS; i++) {
      const action = await caller.next({ turnIndex: i, lastAgent, history });
      if (!action) break; // caller hung up (scripted list exhausted, or goal met)

      agentAudio = []; agentLines = []; userHeard = []; toolCalls = [];
      firstFrameAt = 0; lastAudioAt = 0; audioDoneAt = 0; // per-turn endpoint state
      collecting = true;
      const pcm = await this.#synth(action.text, { model: action.voice, encoding: "linear16", sampleRate: 16000, container: "none" });
      const numSpeechFrames = Math.ceil(pcm.length / FRAME);
      const turnStart = Date.now();
      enqueueSpeech(pcm);
      for (let s = 0; s < 12; s++) audioQueue.push(SILENCE); // ~1.2s trailing silence to endpoint
      // The caller stops *speaking* ~numSpeechFrames*100ms after the pump starts
      // (frames are sent real-time at 100ms each). TTFB is measured from there.
      // NOTE (v0): per-turn TTFB includes think + tool round-trips; a tool-time-
      // excluded SLO is a v1 refinement.
      const speechEndMs = turnStart + numSpeechFrames * 100;

      let callerPcm = pcm;
      let callerSaid = action.text;
      if (action.interrupt) {
        // Wait until the agent is GENUINELY responding (SUSTAINED audio, not one stray frame
        // — firstFrameAt>0 is too weak; a greeting tail satisfies it) so the interrupt lands
        // DURING the reply rather than as a contiguous second utterance. Then interrupt
        // promptly (small afterMs) — that triggers the VA's server-side barge-in. NOTE: agent
        // audio is buffered as fast as the VA sends it (not played in real time), so this
        // drives server-side barge-in, not real-time mid-playback timing — see LIMITATIONS.
        // Wait until the agent has spoken a meaningful CHUNK (so the interrupt lands after it
        // "says some things"), but not so long that its whole reply buffers first (which would
        // read as a sequential second question). Target agent-audio DURATION, not frame count
        // (the VA's frame sizes vary).
        const agentBytes = () => agentAudio.reduce((n, b) => n + b.length, 0);
        const TARGET_BYTES = Math.round(1.3 * 24000 * 2); // ~1.3s of 24kHz 16-bit agent audio
        const w = Date.now();
        while (agentBytes() < TARGET_BYTES && Date.now() - w < 12000 && ws.readyState === WebSocket.OPEN) await sleep(50);
        const spokeSecs = agentBytes() / 2 / 24000;
        process.stdout.write(spokeSecs >= 0.3 ? `[barge-in: caller cut in after agent spoke ${spokeSecs.toFixed(1)}s — oracle transcript shows the agent's handling] ` : `[barge-in: agent barely started] `);
        await sleep(action.interrupt.afterMs);
        const interruptPcm = await this.#synth(action.interrupt.text, { model: action.voice, encoding: "linear16", sampleRate: 16000, container: "none" });
        audioDoneAt = 0; lastAudioAt = 0; // re-arm the endpoint to keep capturing the agent
        enqueueSpeech(interruptPcm);
        for (let s = 0; s < 12; s++) audioQueue.push(SILENCE);
        callerPcm = Buffer.concat([pcm, interruptPcm]);
        callerSaid = `${action.text}  ⟨interrupts⟩ ${action.interrupt.text}`;
      }

      await waitTurn(34000);
      collecting = false;
      const settleAt = Date.now();
      const agentText = agentLines.join(" ");
      out.push({
        callerSaid,
        agentHeardCallerAs: userHeard.join(" "),
        agentText,
        agentAudioPcm: Buffer.concat(agentAudio),
        // Evaline was synthesized at 16kHz for the agent's input; upsample to 24kHz so
        // report playback (and the stitched conversation) is one consistent rate with the agent.
        callerAudioPcm: resamplePcm16le(callerPcm, 16000, 24000),
        toolCalls,
        // On a barge-in turn, firstFrameAt is the latency to the FIRST utterance (before the
        // interrupt), which doesn't mean "time to respond to this turn" — report null rather
        // than a misleading number (consistent with the can't-cleanly-measure → null rule).
        ttfbMs: action.interrupt ? null : (firstFrameAt > speechEndMs ? firstFrameAt - speechEndMs : null),
        turnMs: Math.max(0, settleAt - speechEndMs),
      });
      history.push({ caller: callerSaid, agent: agentText, heardAs: userHeard.join(" ") });
      lastAgent = agentText; // feed the agent's reply back so a reactive caller can adapt
    }

    // Drain any agent audio still queued: the VA streams TTS faster than 1× real-time, so the
    // FINAL reply usually has a backlog. Without this it would be dropped when the pump stops —
    // truncating the most important turn from BOTH the recording and the oracle transcript.
    while (agentQ.length) recording.push(pullAgent(4800)); // 100ms @ 24kHz, agent-only (caller is done)
    recordingOn = false;
    return { turns: out, recordingPcm: Buffer.concat(recording) };
    } finally {
      clearTimeout(setupTimer);
      clearInterval(pump);
      try { ws.close(); } catch { /* ignore */ }
    }
  }
}

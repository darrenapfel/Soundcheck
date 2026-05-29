// OpenAIRealtimeAdapter — a SECOND real voice runtime, proving the AUTAdapter
// interface generalizes beyond Deepgram. Drives OpenAI's Realtime API over its
// WebSocket (audio in / audio out + tool calls), mirroring the Deepgram-VA adapter.
//
// ⚠️ EXPERIMENTAL — UNTESTED IN THIS BUILD. It was written to the documented OpenAI
// Realtime protocol but has NOT been run against the live API here (no OpenAI key in
// this environment). VALIDATE before relying on it. It is OPT-IN: it reads
// OPENAI_API_KEY *only when explicitly selected*; the default + CI never touch it, so
// Soundcheck's default operation stays Deepgram-key-only. CI proves genericity via the
// (creds-free, deterministic) MockAUTAdapter instead. Contributions/fixes welcome.

import { synthesize, transcribe } from "../deepgram.ts";
import type { AUTConfig, ToolCall } from "../types.ts";
import type { AUTAdapter, CallerTurn, RawTurn } from "./types.ts";

const OPENAI_WS = "wss://api.openai.com/v1/realtime";
const FRAME = 4800; // 100ms @ 24kHz 16-bit (OpenAI Realtime uses 24kHz pcm16)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function openaiKey(): string {
  const k = process.env.OPENAI_API_KEY?.trim();
  if (!k) throw new Error("OpenAIRealtimeAdapter needs OPENAI_API_KEY (opt-in; the default Deepgram path does not).");
  return k;
}

export class OpenAIRealtimeAdapter implements AUTAdapter {
  label = "openai-realtime";
  #model: string;
  constructor(opts: { model?: string } = {}) { this.#model = opts.model ?? "gpt-4o-realtime-preview"; }

  async runConversation(aut: AUTConfig, callerTurns: CallerTurn[]): Promise<RawTurn[]> {
    // Caller audio is still synthesized by Deepgram TTS (Evaline); the AUT is OpenAI.
    const key = openaiKey();
    const ws = new WebSocket(`${OPENAI_WS}?model=${this.#model}`, [
      "realtime", `openai-insecure-api-key.${key}`, "openai-beta.realtime-v1",
    ]);
    ws.binaryType = "arraybuffer";

    let agentText: string[] = [];
    let toolCalls: ToolCall[] = [];
    const agentAudio: Buffer[] = [];
    let responseDone: boolean; // set true on response.done; assigned (reset) at each turn's start before any read

    const settings = {
      type: "session.update",
      session: {
        instructions: aut.systemPrompt,
        voice: "alloy",
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        input_audio_transcription: { model: "whisper-1" },
        tools: aut.tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters })),
        tool_choice: "auto",
      },
    };

    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => { ws.send(JSON.stringify(settings)); resolve(); });
      ws.addEventListener("error", () => reject(new Error("OpenAI Realtime WebSocket error")));
    });

    ws.addEventListener("message", (ev: { data: unknown }) => {
      if (ev.data instanceof ArrayBuffer) return;
      let m: Record<string, unknown>;
      try { m = JSON.parse(String(ev.data)); } catch { return; }
      switch (m.type) {
        case "response.audio.delta": if (typeof m.delta === "string") agentAudio.push(Buffer.from(m.delta, "base64")); break;
        case "response.audio_transcript.done": if (typeof m.transcript === "string") agentText.push(m.transcript); break;
        case "response.function_call_arguments.done": {
          let args: Record<string, unknown>;
          try { args = m.arguments ? JSON.parse(String(m.arguments)) : {}; } catch { args = {}; }
          const name = String(m.name ?? "");
          const stub = aut.toolStubs[name];
          toolCalls.push({ name, args, result: stub ? stub(args) : { ok: true } });
          ws.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: m.call_id, output: JSON.stringify(toolCalls.at(-1)!.result) } }));
          ws.send(JSON.stringify({ type: "response.create" }));
          break;
        }
        case "response.done": responseDone = true; break;
      }
    });

    const out: RawTurn[] = [];
    for (const turn of callerTurns) {
      agentText = []; toolCalls = []; agentAudio.length = 0; responseDone = false;
      const pcm = await synthesize(turn.text, { model: turn.voice, encoding: "linear16", sampleRate: 24000, container: "none" });
      for (let p = 0; p < pcm.length; p += FRAME) {
        ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: pcm.subarray(p, p + FRAME).toString("base64") }));
        await sleep(20);
      }
      ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      ws.send(JSON.stringify({ type: "response.create" }));
      const start = Date.now();
      while (!responseDone && Date.now() - start < 30000) await sleep(100);
      const pcmOut = Buffer.concat(agentAudio);
      const heard = pcmOut.length ? await transcribe(pcmOut, { encoding: "linear16", sampleRate: 24000, contentType: "audio/l16" }) : agentText.join(" ");
      out.push({ callerSaid: turn.text, agentHeardCallerAs: "", agentText: agentText.join(" "), agentAudioPcm: pcmOut, agentSpokenHeardBack: heard, toolCalls: [...toolCalls], ttfbMs: null, turnMs: Date.now() - start });
    }
    try { ws.close(); } catch { /* ignore */ }
    return out;
  }
}

// DeepgramVaJudge — the Deepgram-key-only judge backend. Configures a Voice Agent
// as a one-shot grader: the transcript + rubric live in its `think` prompt, a
// `submit_verdict` function carries the structured result, and a tiny trigger
// utterance kicks off the single turn. Validated by a live probe (a VA returns a
// real verdict in ~5s). Verdict args can be malformed JSON from small models, so we
// parse with parseVerdict() (tolerant). No OpenAI key — the think LLM runs on the
// Deepgram key. This is the LIVE backend; CI/tests use the deterministic mockJudge.

import { getKey, synthesize } from "../deepgram.ts";
import { parseVerdict } from "./parse.ts";
import type { JudgeBackend, Rubric, Verdict } from "./types.ts";

const AGENT_WS = "wss://agent.deepgram.com/v1/agent/converse";
const FRAME = 3200;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function verdictFunction(rubric: Rubric) {
  const properties: Record<string, unknown> = {};
  for (const d of rubric.dimensions) {
    properties[d.key] = d.kind === "boolean"
      ? { type: "boolean", description: d.question }
      : { type: "number", description: `${d.question} (1-5)` };
  }
  return { name: "submit_verdict", description: "Submit the QA verdict for the transcript.", parameters: { type: "object", properties, required: rubric.dimensions.map((d) => d.key) } };
}

function graderPrompt(promptTranscript: string, rubric: Rubric): string {
  const lines = rubric.dimensions.map((d) => `- ${d.key} (${d.kind === "boolean" ? "true/false" : "number 1-5"}): ${d.question}`).join("\n");
  return [
    "You are a strict QA JUDGE for a voice agent. You are NOT in a conversation.",
    "The MOMENT the call starts, evaluate ONLY the transcript below and call submit_verdict. Do not speak first; do not chat.",
    "",
    "Score these fields:",
    lines,
    "Also include a short `notes` string with the single most important issue.",
    "",
    "TRANSCRIPT (this is what a listener actually HEARD):",
    promptTranscript,
  ].join("\n");
}

async function graderTurn(promptTranscript: string, rubric: Rubric, model: string, backendName: string): Promise<Verdict | null> {
  const key = getKey();
  const ws = new WebSocket(AGENT_WS, ["token", key]);
  ws.binaryType = "arraybuffer";
  const settings = {
    type: "Settings",
    audio: { input: { encoding: "linear16", sample_rate: 16000 }, output: { encoding: "linear16", sample_rate: 24000, container: "none" } },
    agent: {
      language: "en",
      listen: { provider: { type: "deepgram", model: "nova-3" } },
      think: { provider: { type: "open_ai", model, temperature: 0 }, prompt: graderPrompt(promptTranscript, rubric), functions: [verdictFunction(rubric)] },
      speak: { provider: { type: "deepgram", model: "aura-2-thalia-en" } },
      greeting: "",
    },
  };

  return await new Promise<Verdict | null>((resolve) => {
    let done = false;
    const finish = (v: Verdict | null) => { if (done) return; done = true; try { ws.close(); } catch { /* ignore */ } resolve(v); };
    const timer = setTimeout(() => finish(null), 25000);

    ws.addEventListener("open", () => ws.send(JSON.stringify(settings)));
    ws.addEventListener("error", () => { clearTimeout(timer); finish(null); });
    ws.addEventListener("message", async (ev: MessageEvent) => {
      if (ev.data instanceof ArrayBuffer) return;
      let m: Record<string, unknown>;
      try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (m.type === "SettingsApplied") {
        try {
          const pcm = await synthesize("Begin your evaluation now.", { model: "aura-2-orion-en", encoding: "linear16", sampleRate: 16000, container: "none" });
          const streamable = () => !done && ws.readyState === WebSocket.OPEN; // don't send after timeout/close
          for (let p = 0; p < pcm.length && streamable(); p += FRAME) { ws.send(pcm.subarray(p, p + FRAME)); await sleep(100); }
          for (let s = 0; s < 20 && streamable(); s++) { ws.send(Buffer.alloc(FRAME)); await sleep(100); }
        } catch { finish(null); } // a TTS failure here must resolve the verdict, not float an unhandled rejection
      } else if (m.type === "FunctionCallRequest") {
        const fn = (Array.isArray(m.functions) ? m.functions : [])[0] as { id?: string; name?: string; arguments?: string } | undefined;
        clearTimeout(timer);
        finish(fn?.arguments ? parseVerdict(fn.arguments, rubric, backendName) : null);
      }
    });
  });
}

/** A Deepgram-VA judge backed by `model` (the think LLM runs on the Deepgram key). The default
 *  is gpt-4o-mini (the production judge); a stronger model (e.g. gpt-4o) is the cross-model
 *  REFERENCE that corroborates the Golden Set in the alignment loop. */
export function makeDeepgramVaJudge(model = "gpt-4o-mini"): JudgeBackend {
  const name = model === "gpt-4o-mini" ? "deepgram-va" : `deepgram-va:${model}`;
  return {
    name,
    async judge(promptTranscript: string, rubric: Rubric): Promise<Verdict> {
      // one retry — small models occasionally fail to call the function
      const v = (await graderTurn(promptTranscript, rubric, model, name)) ?? (await graderTurn(promptTranscript, rubric, model, name));
      if (!v) return { dimensions: rubric.dimensions.map((d) => ({ key: d.key, value: null, why: "" })), findings: ["judge did not return a verdict"], backend: name };
      return v;
    },
  };
}

export const deepgramVaJudge: JudgeBackend = makeDeepgramVaJudge();

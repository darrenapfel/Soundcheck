// Judge orchestration: turn a Transcript into a grader prompt, run a backend,
// return a structured Verdict. Default rubric covers the subjective dimensions the
// deterministic gates can't. The judge is ADVISORY (reported, never a hard CI gate).

import type { Transcript } from "../types.ts";
import type { JudgeBackend, Rubric, Verdict } from "./types.ts";

export { parseVerdict } from "./parse.ts";
export type { JudgeBackend, Rubric, Verdict } from "./types.ts";

export const DEFAULT_RUBRIC: Rubric = {
  dimensions: [
    { key: "spoken_cleanly", kind: "boolean", question: "Does the listener ever hear literal symbols/markup (e.g. 'star', 'pound') or a stray 'negative' before a price? false if so." },
    { key: "goal_completed", kind: "boolean", question: "Did the agent accomplish the caller's stated goal?" },
    { key: "confirmed_before_acting", kind: "boolean", question: "Did the agent confirm details before making a change?" },
    { key: "naturalness_1to5", kind: "score", question: "How natural and concise is the agent's spoken style, 1 (robotic/garbled) to 5 (human)?" },
  ],
};

/** Render a transcript into the text a grader judges (what a listener HEARS + tools). */
export function transcriptToPrompt(t: Transcript): string {
  return t.turns
    .map((turn) =>
      `Turn ${turn.turn}:\n  caller: "${turn.callerSaid}"\n  agent (heard aloud): "${turn.agentSpokenHeardBack}"\n  tools called: ${turn.toolCalls.map((tc) => tc.name).join(", ") || "none"}`,
    )
    .join("\n\n");
}

/** Deterministic, offline judge for CI + a sensible baseline. Rule-based over the
 *  heard text — no network, no model variance. (The live judge is DeepgramVaJudge.) */
export const mockJudge: JudgeBackend = {
  name: "mock",
  async judge(prompt: string, rubric: Rubric): Promise<Verdict> {
    const dirty = /\bstar\b|\bpound\b|\bhashtag\b|negative\s+[\w\s-]+dollars/i.test(prompt);
    const completed = /\b(confirmed|booked|success|reservation is)\b/i.test(prompt);
    const confirmed = /\bconfirm/i.test(prompt);
    const known: Record<string, boolean | number> = {
      spoken_cleanly: !dirty,
      goal_completed: completed,
      confirmed_before_acting: confirmed,
      naturalness_1to5: dirty ? 2 : 4,
    };
    const dimensions = rubric.dimensions.map((d) => ({
      key: d.key,
      value: d.key in known ? known[d.key] : d.kind === "boolean" ? true : 3,
      why: "",
    }));
    return { dimensions, findings: dirty ? ["a spoken symbol/markup was heard"] : [], backend: "mock" };
  },
};

export async function judgeTranscript(t: Transcript, backend: JudgeBackend, rubric: Rubric = DEFAULT_RUBRIC): Promise<Verdict> {
  return backend.judge(transcriptToPrompt(t), rubric);
}

/** Aggregate a judge panel: majority for booleans, mean for scores. */
export function aggregateVerdicts(verdicts: Verdict[], rubric: Rubric): Verdict {
  const dimensions = rubric.dimensions.map((d) => {
    const vals = verdicts.map((v) => v.dimensions.find((x) => x.key === d.key)?.value).filter((x) => x != null) as (boolean | number)[];
    let value: boolean | number | null = null;
    if (vals.length) {
      if (d.kind === "boolean") {
        const trues = vals.filter((x) => x === true).length;
        value = trues >= vals.length / 2;
      } else {
        value = (vals as number[]).reduce((a, b) => a + b, 0) / vals.length;
      }
    }
    return { key: d.key, value, why: "" };
  });
  return { dimensions, findings: [...new Set(verdicts.flatMap((v) => v.findings))], backend: `panel(${verdicts.map((v) => v.backend).join(",")})` };
}

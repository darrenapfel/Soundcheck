// Tuning-loop tests (deterministic, offline): trace-driven diagnosis + convergence + the
// Goodhart held-out guard.

import { test } from "node:test";
import assert from "node:assert/strict";
import { tune, diagnose } from "../src/tune/index.ts";
import type { EvaluateFn, ProposeFn, TuneScore, Diagnosis } from "../src/tune/index.ts";
import type { GateResult, Trace } from "../src/types.ts";

const diag = (gate: string): Diagnosis => ({ gate, problem: `needs ${gate}`, hint: gate });

// --- model: a prompt is "good" on a rule if it contains that rule's token. Both the train
// and held-out sets test the SAME real rules, so a genuine fix improves both. ---
const RULES = ["NOMD", "ISO"];
const realEvaluate: EvaluateFn = async (prompt) => {
  const missing = RULES.filter((r) => !prompt.includes(r));
  return { passed: RULES.length - missing.length, total: RULES.length, diagnosis: missing.map(diag) };
};
const realPropose: ProposeFn = async (prompt, diagnosis) => {
  const missing = diagnosis[0]?.hint;
  return missing ? `${prompt} ${missing}` : prompt;
};

test("diagnose: trace-driven root-cause — each failed gate's evidence + a remediation hint", () => {
  const trace: Trace = { scenario: "s", persona: "cooperative", autLabel: "x", turns: [] };
  const gates: GateResult[] = [
    { name: "no_spoken_symbols", pass: false, detail: "turn 1: star" },
    { name: "grounding", pass: false, detail: "date=\"2023-10-28\" stale year" },
    { name: "required_tool:modifyReservation", pass: true, detail: "called" },
  ];
  const d = diagnose(trace, gates);
  assert.equal(d.length, 2, "only failing gates are diagnosed");
  const sym = d.find((x) => x.gate === "no_spoken_symbols")!;
  assert.equal(sym.problem, "turn 1: star"); // evidence is the gate's trace-derived detail
  assert.match(sym.hint, /Markdown|spoken aloud/i); // a real remediation
  assert.match(d.find((x) => x.gate === "grounding")!.hint, /relative date|ISO/i);
});

test("tune converges: a real fixer drives train AND held-out to full", async () => {
  const r = await tune("", realEvaluate, realPropose, { maxIterations: 4 });
  assert.equal(r.trainAfter.passed, 2);
  assert.equal(r.heldoutAfter.passed, 2);
  assert.ok(r.improved, "held-out should improve end-to-end");
  assert.match(r.finalPrompt, /NOMD/);
  assert.match(r.finalPrompt, /ISO/);
  assert.ok(r.iterations.every((it) => it.kept));
});

test("tune emits onProgress so a live run isn't a silent banner (round-4 P3)", async () => {
  const msgs: string[] = [];
  await tune("", realEvaluate, realPropose, { maxIterations: 2, onProgress: (m) => msgs.push(m) });
  assert.ok(msgs.some((m) => /baseline/.test(m)), "reports the baseline evaluation");
  assert.ok(msgs.some((m) => /iteration 1\/2/.test(m)), "reports per-iteration progress");
  assert.ok(msgs.some((m) => /held-out/.test(m)), "reports the held-out (Goodhart) step");
});

test("GOODHART GUARD: an edit that overfits training but not held-out is REJECTED", async () => {
  const overfitEval: EvaluateFn = async (prompt, set): Promise<TuneScore> =>
    set === "train"
      ? { passed: prompt.includes("HACK") ? 1 : 0, total: 1, diagnosis: prompt.includes("HACK") ? [] : [diag("HACK")] }
      : { passed: 0, total: 1, diagnosis: [diag("REAL")] };
  const overfitPropose: ProposeFn = async (prompt) => `${prompt} HACK`;

  const r = await tune("", overfitEval, overfitPropose, { maxIterations: 2 });
  assert.equal(r.improved, false, "held-out must not improve");
  assert.equal(r.finalPrompt, "", "the overfitting edit must be reverted, not kept");
  assert.ok(r.iterations.length > 0 && r.iterations.every((it) => !it.kept), "every overfit proposal rejected");
  assert.match(r.iterations[0].reason, /overfit/);
});

test("no-op when already passing", async () => {
  const r = await tune("NOMD ISO", realEvaluate, realPropose);
  assert.equal(r.iterations.length, 0);
  assert.equal(r.trainAfter.passed, 2);
});

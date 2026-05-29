// Tuning-loop tests (deterministic, offline): convergence + the Goodhart held-out guard.

import { test } from "node:test";
import assert from "node:assert/strict";
import { tune } from "../src/tune/index.ts";
import type { EvaluateFn, ProposeFn, TuneScore } from "../src/tune/index.ts";

// --- model: a prompt is "good" on a rule if it contains that rule's token. Both the
// train and held-out sets test the SAME real rules, so a genuine fix improves both. ---
const RULES = ["NOMD", "ISO"];
const realEvaluate: EvaluateFn = async (prompt) => {
  const failures = RULES.filter((r) => !prompt.includes(r)).map((r) => `needs ${r}`);
  return { passed: RULES.length - failures.length, total: RULES.length, failures };
};
const realPropose: ProposeFn = async (prompt, failures) => {
  const missing = failures[0]?.replace("needs ", "");
  return missing ? `${prompt} ${missing}` : prompt;
};

test("tune converges: a real fixer drives train AND held-out to full", async () => {
  const r = await tune("", realEvaluate, realPropose, { maxIterations: 4 });
  assert.equal(r.trainAfter.passed, 2);
  assert.equal(r.heldoutAfter.passed, 2);
  assert.ok(r.improved, "held-out should improve end-to-end");
  assert.match(r.finalPrompt, /NOMD/);
  assert.match(r.finalPrompt, /ISO/);
  assert.ok(r.iterations.every((it) => it.kept));
});

test("GOODHART GUARD: an edit that overfits training but not held-out is REJECTED", async () => {
  // train rewards the "HACK" token; held-out never improves no matter what the fixer adds.
  const overfitEval: EvaluateFn = async (prompt, set): Promise<TuneScore> =>
    set === "train"
      ? { passed: prompt.includes("HACK") ? 1 : 0, total: 1, failures: prompt.includes("HACK") ? [] : ["needs HACK"] }
      : { passed: 0, total: 1, failures: ["held-out needs a real, generalizing fix"] };
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

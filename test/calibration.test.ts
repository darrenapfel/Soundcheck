// Calibration tests — metric math (deterministic) + end-to-end with the mock judge
// over the self-constructed corpus (proves the harness works offline; no network).

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeMetrics, calibrate, CALIBRATION_CORPUS, judgeTrust, crossModelAlign, TRUST_THRESHOLDS } from "../src/calibration/index.ts";
import { mockJudge } from "../src/judge/index.ts";
import type { LabeledCase } from "../src/calibration/corpus.ts";
import type { Verdict } from "../src/judge/types.ts";

function v(spoken: boolean): Verdict {
  return { dimensions: [{ key: "spoken_cleanly", value: spoken, why: "" }], findings: [], backend: "t" };
}
function c(name: string, label: boolean): LabeledCase {
  return { name, transcript: { scenario: name, persona: "cooperative", autLabel: "t", turns: [] }, labels: { spoken_cleanly: label } };
}

test("computeMetrics: agreement + problem-class precision/recall", () => {
  // labels: [clean, clean, dirty, dirty]; judge: [clean, DIRTY(fp), dirty, clean(miss)]
  const cases = [c("a", true), c("b", true), c("d", false), c("e", false)];
  const verdicts = [v(true), v(false), v(false), v(true)];
  const r = computeMetrics("t", cases, verdicts);
  const sc = r.dimensions.find((d) => d.key === "spoken_cleanly")!;
  assert.equal(sc.n, 4);
  assert.equal(sc.agreement, 0.5); // a,d correct; b,e wrong
  // problem=false (dirty). TP = judged dirty & label dirty = case d -> 1. FP = judged dirty & label clean = b -> 1. FN = judged clean & label dirty = e -> 1.
  assert.equal(sc.precision, 0.5); // 1/(1+1)
  assert.equal(sc.recall, 0.5); // 1/(1+1)
});

test("calibrate(mockJudge) achieves high agreement on the real corpus (offline)", async () => {
  const r = await calibrate(mockJudge, CALIBRATION_CORPUS);
  const sc = r.dimensions.find((d) => d.key === "spoken_cleanly")!;
  const goal = r.dimensions.find((d) => d.key === "goal_completed")!;
  assert.ok(sc.agreement >= 0.8, `spoken_cleanly agreement ${sc.agreement}`);
  assert.ok(sc.recall! >= 0.8, `should catch most dirty cases, recall ${sc.recall}`);
  assert.ok(goal.agreement >= 0.8, `goal_completed agreement ${goal.agreement}`);
});

test("judgeTrust: trusted when problems are caught; NOT trusted when the judge MISSES problems", () => {
  const caught = computeMetrics("x", [c("c1", true), c("d1", false)], [v(true), v(false)]); // both correct
  assert.equal(judgeTrust(caught).trusted, true);
  const misses = computeMetrics("x", [c("d1", false), c("d2", false)], [v(true), v(true)]); // calls both dirty cases clean
  const t = judgeTrust(misses);
  assert.equal(t.trusted, false);
  assert.match(t.reasons.join(" "), /problem-recall/);
});

test("DRIFT GUARD: the mock judge calibrates deterministically to the baseline (trusted)", async () => {
  const r = await calibrate(mockJudge, CALIBRATION_CORPUS);
  assert.equal(r.overallAgreement, 1, "mock judge overall agreement must be 1.0 on the constructed corpus");
  for (const d of r.dimensions) {
    assert.equal(d.agreement, 1, `${d.key} agreement drifted`);
    if (d.kind === "boolean") { assert.equal(d.recall, 1); assert.equal(d.precision, 1); }
  }
  assert.equal(judgeTrust(r).trusted, true);
});

test("crossModelAlign: a reference that agrees with the Golden Set corroborates it (no human)", async () => {
  const a = await crossModelAlign(mockJudge, mockJudge); // deterministic mock as both reference + production
  assert.equal(a.goldenSetValid, true, "reference corroborates the constructed Golden Set");
  assert.equal(a.productionTrust.trusted, true);
  assert.ok(a.reference.overallAgreement >= TRUST_THRESHOLDS.minOverallAgreement);
});

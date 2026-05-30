// Unit tests for the judge layer: tolerant verdict parsing (incl. the REAL malformed
// output observed from the live probe), the deterministic mockJudge, prompt rendering,
// and panel aggregation. All offline.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVerdict, mockJudge, judgeTranscript, transcriptToPrompt, aggregateVerdicts, DEFAULT_RUBRIC } from "../src/judge/index.ts";
import type { Verdict } from "../src/judge/types.ts";
import type { Trace } from "../src/types.ts";

const dim = (v: Verdict, key: string) => v.dimensions.find((d) => d.key === key)?.value;

test("parseVerdict reads a clean verdict exactly", () => {
  const raw = JSON.stringify({ spoken_cleanly: true, goal_completed: true, confirmed_before_acting: true, naturalness_1to5: 5, notes: "great" });
  const v = parseVerdict(raw, DEFAULT_RUBRIC, "x");
  assert.equal(dim(v, "spoken_cleanly"), true);
  assert.equal(dim(v, "naturalness_1to5"), 5);
  assert.deepEqual(v.findings, ["great"]);
});

test("parseVerdict survives the REAL malformed args from the live probe", () => {
  // Verbatim shape the VA grader emitted: a value bled into the next key.
  const raw = '{"goal_completed:false,":"naturalness_1to5:2,","notes":"The agent said star.","spoken_cleanly":false}';
  const v = parseVerdict(raw, DEFAULT_RUBRIC, "deepgram-va");
  assert.equal(dim(v, "spoken_cleanly"), false, "from valid JSON key");
  assert.equal(dim(v, "goal_completed"), false, "recovered via regex fallback");
  assert.equal(dim(v, "naturalness_1to5"), 2, "recovered via regex fallback");
  assert.deepEqual(v.findings, ["The agent said star."]);
});

test("parseVerdict returns null for a dimension it cannot find", () => {
  const v = parseVerdict('{"spoken_cleanly": true}', DEFAULT_RUBRIC, "x");
  assert.equal(dim(v, "goal_completed"), null);
});

test("parseVerdict tolerates total garbage without throwing", () => {
  const v = parseVerdict("not json at all", DEFAULT_RUBRIC, "x");
  assert.ok(v.dimensions.every((d) => d.value === null));
});

test("mockJudge flags spoken symbols deterministically", async () => {
  const clean = await mockJudge.judge('agent (heard aloud): "your table is booked"', DEFAULT_RUBRIC);
  const dirty = await mockJudge.judge('agent (heard aloud): "star star booked star star"', DEFAULT_RUBRIC);
  assert.equal(dim(clean, "spoken_cleanly"), true);
  assert.equal(dim(dirty, "spoken_cleanly"), false);
  assert.ok(dirty.findings.length > 0);
});

test("transcriptToPrompt includes heard text + tools and judgeTranscript runs a backend", async () => {
  const t: Trace = {
    scenario: "s", persona: "cooperative", autLabel: "a",
    turns: [{ turn: 1, callerSaid: "book it", agentHeardCallerAs: "book it", agentText: "ok", agentSpokenHeardBack: "your reservation is confirmed", toolCalls: [{ name: "bookReservation", args: {}, result: {} }], ttfbMs: 100, turnMs: 200 }],
  };
  const prompt = transcriptToPrompt(t);
  assert.match(prompt, /confirmed/);
  assert.match(prompt, /bookReservation/);
  const v = await judgeTranscript(t, mockJudge);
  assert.equal(dim(v, "goal_completed"), true);
});

test("aggregateVerdicts does majority (bool) and mean (score)", () => {
  const mk = (clean: boolean, n: number): Verdict => ({
    dimensions: [{ key: "spoken_cleanly", value: clean, why: "" }, { key: "naturalness_1to5", value: n, why: "" }],
    findings: [], backend: "m",
  });
  const rubric = { dimensions: [{ key: "spoken_cleanly", kind: "boolean" as const, question: "" }, { key: "naturalness_1to5", kind: "score" as const, question: "" }] };
  const agg = aggregateVerdicts([mk(true, 4), mk(true, 2), mk(false, 3)], rubric);
  assert.equal(agg.dimensions.find((d) => d.key === "spoken_cleanly")?.value, true); // 2/3 true
  assert.equal(agg.dimensions.find((d) => d.key === "naturalness_1to5")?.value, 3); // mean(4,2,3)
});

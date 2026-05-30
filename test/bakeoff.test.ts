// A/B bake-off, offline + deterministic: the SAME scenario suite diffed across two agent
// configs from their persisted Traces. Proves the bake-off (a) picks the winner and (b) reports
// the exact gates where the configs disagree — the productized competitive shootout.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadCassette } from "../src/capture/cassette.ts";
import { runGates } from "../src/gates/index.ts";
import { compareRuns } from "../src/bakeoff/index.ts";
import { judgeTranscript, mockJudge } from "../src/judge/index.ts";
import { TOOLS } from "../examples/support/support.ts";
import type { ScenarioResult, Scenario } from "../src/types.ts";

function resultFor(scenarioName: string, autLabel: string): ScenarioResult {
  const scenario = JSON.parse(readFileSync(`examples/support/scenarios/${scenarioName}.json`, "utf8")) as Scenario;
  const transcript = loadCassette(scenarioName, autLabel);
  const gates = runGates(transcript, scenario, TOOLS);
  return { transcript, gates, passed: gates.every((g) => g.pass) };
}

async function judgedResultFor(scenarioName: string, autLabel: string): Promise<ScenarioResult> {
  const r = resultFor(scenarioName, autLabel);
  return { ...r, verdict: await judgeTranscript(r.transcript, mockJudge) };
}

test("bake-off over persisted traces: grounded beats bare on the SAME suite, with a gate-level diff", () => {
  const a = [resultFor("reset-and-callback", "support-grounded")];
  const b = [resultFor("reset-and-callback", "support-bare")];
  const report = compareRuns("support-grounded", "support-bare", a, b);

  assert.equal(report.winner, "A");
  assert.equal(report.aWins, 1);
  assert.equal(report.bWins, 0);

  const c = report.comparisons[0];
  assert.equal(c.scenario, "reset-and-callback");
  assert.equal(c.aPassed, true);
  assert.equal(c.bPassed, false);

  // The diff names the EXACT gates where the configs disagree (bare regresses on these two).
  const diff = Object.fromEntries(c.gateDiff.map((d) => [d.gate, { a: d.a, b: d.b }]));
  assert.deepEqual(diff.no_spoken_symbols, { a: true, b: false });
  assert.deepEqual(diff.grounding, { a: true, b: false });
  // Gates both configs pass must NOT pollute the diff.
  assert.ok(!("required_tool" in diff), "shared-pass gates should not appear in the diff");
});

test("bake-off also diffs the ADVISORY judge across configs — without changing the gate-decided winner", async () => {
  const a = [await judgedResultFor("reset-and-callback", "support-grounded")];
  const b = [await judgedResultFor("reset-and-callback", "support-bare")];
  const report = compareRuns("support-grounded", "support-bare", a, b);

  assert.equal(report.winner, "A"); // still gate-decided
  const jd = Object.fromEntries(report.comparisons[0].judgeDiff.map((d) => [d.key, { a: d.a, b: d.b }]));
  // The mock judge hears bare's spoken symbols → spoken_cleanly + naturalness diverge from grounded.
  assert.deepEqual(jd.spoken_cleanly, { a: "true", b: "false" });
  assert.ok("naturalness_1to5" in jd, "judge naturalness differs between the two configs");
});

test("no judge diff when the runs weren't judged (judgeDiff stays empty)", () => {
  const report = compareRuns("g", "b", [resultFor("reset-and-callback", "support-grounded")], [resultFor("reset-and-callback", "support-bare")]);
  assert.deepEqual(report.comparisons[0].judgeDiff, []);
});

test("gate-diff keeps same-family gates distinct (no prefix collapse) and surfaces unmatched scenarios", () => {
  const res = (scn: string, gates: { name: string; pass: boolean }[]): ScenarioResult => ({
    transcript: { scenario: scn, persona: "cooperative", autLabel: "x", turns: [] },
    gates: gates.map((g) => ({ ...g, detail: "" })),
    passed: gates.every((g) => g.pass),
  });
  // B fails ONLY the second tool_sequence gate; both same-family gates must stay distinct.
  const a = [res("s1", [{ name: "tool_sequence:verify_before_reset", pass: true }, { name: "tool_sequence:auth_before_charge", pass: true }])];
  const b = [
    res("s1", [{ name: "tool_sequence:verify_before_reset", pass: true }, { name: "tool_sequence:auth_before_charge", pass: false }]),
    res("only_in_b", [{ name: "latency", pass: true }]),
  ];
  const r = compareRuns("A", "B", a, b);
  const diff = r.comparisons[0].gateDiff;
  assert.equal(diff.length, 1, "exactly the one differing gate (not a collapsed merge)");
  assert.equal(diff[0].gate, "tool_sequence:auth_before_charge"); // full name, not collapsed to "tool_sequence"
  assert.deepEqual({ a: diff[0].a, b: diff[0].b }, { a: true, b: false });
  assert.deepEqual(r.unmatched, ["only_in_b"]); // scenario present only in B is surfaced, never dropped
});

test("compareRuns tallies wins/ties and decides the overall winner", () => {
  const mk = (scn: string, pass: boolean): ScenarioResult => ({
    transcript: { scenario: scn, persona: "cooperative", autLabel: "x", turns: [] },
    gates: [{ name: "g", pass, detail: "" }],
    passed: pass,
  });
  const a = [mk("s1", true), mk("s2", false), mk("s3", true)];
  const b = [mk("s1", false), mk("s2", true), mk("s3", true)];
  const r = compareRuns("A", "B", a, b);
  assert.equal(r.aWins, 1);
  assert.equal(r.bWins, 1);
  assert.equal(r.ties, 1);
  assert.equal(r.winner, "tie"); // one win each
});

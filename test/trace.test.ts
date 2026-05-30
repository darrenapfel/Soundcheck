// M3 — the Trace is coSTAR's flight recorder, and its defining property: a PERSISTED Trace
// is the harness's source of truth that BOTH the deterministic gates AND the LLM judge run
// on, OFFLINE — so you iterate on judges/gates without re-running the (stochastic, paid)
// agent. ("By persisting traces, we can iterate on judges without re-running scenarios.")

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadCassette } from "../src/capture/cassette.ts";
import { runGates } from "../src/gates/index.ts";
import { judgeTranscript, mockJudge } from "../src/judge/index.ts";
import { TOOLS } from "../examples/tabletalk/tabletalk.ts";
import type { Scenario } from "../src/types.ts";

test("a persisted Trace is gate-able AND judge-able OFFLINE (iterate without re-running the agent)", async () => {
  const scenario = JSON.parse(readFileSync("scenarios/book-modify-confirm.json", "utf8")) as Scenario;
  const trace = loadCassette("book-modify-confirm", "tabletalk-grounded"); // no socket, no STT, no key

  // 1) the deterministic gates run on the persisted trace
  const gates = runGates(trace, scenario, TOOLS);
  assert.ok(gates.length > 0 && gates.every((g) => g.pass), "grounded trace passes every gate offline");

  // 2) the LLM judge runs on the SAME persisted trace, offline (mock backend = deterministic, no key)
  const verdict = await judgeTranscript(trace, mockJudge);
  assert.ok(verdict.dimensions.length > 0, "judge produced a verdict from the persisted trace");
  assert.equal(verdict.backend, "mock");
});

test("the Trace carries the structured record gates/judge need (turns, tools, timings)", () => {
  const trace = loadCassette("book-modify-confirm", "tabletalk-grounded");
  assert.ok(trace.turns.length > 0);
  assert.ok(trace.turns.some((t) => t.toolCalls.length > 0), "tool trace present");
  assert.ok(trace.turns.every((t) => typeof t.agentSpokenHeardBack === "string"), "heard text present");
  assert.ok(trace.turns.every((t) => "ttfbMs" in t && "turnMs" in t), "timings present");
});

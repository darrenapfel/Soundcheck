// Replay-integration tests — the WHOLE pipeline (capture → gates) over recorded
// cassettes, fully offline/deterministic (no socket, no STT, no key). This is the
// golden bare→hardened→grounded ladder as a self-regression: each rung pins the
// FULL gate vector, so ANY gate-logic regression on ANY config breaks the build.
// (See docs/TESTING.md §2, §3.3.)
//
// Ladder meaning (all deterministic on the recorded cassettes):
//   bare     — dirty speech (spoken symbols) AND ungrounded date  -> fails 2 gates
//   hardened — clean speech (no-markdown prompt) but STILL ungrounded -> proves a
//              formatting fix does NOT fix grounding. (The separate prose-date
//              "tool-format regression" is stochastic from the live model, so it is
//              pinned DETERMINISTICALLY in test/gates.test.ts, not here.)
//   grounded — clean + grounded + tools correct -> passes EVERY gate

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadCassette } from "../src/capture/cassette.ts";
import { runGates } from "../src/gates/index.ts";
import type { GateResult, Scenario } from "../src/types.ts";

function vector(scenarioName: string, autLabel: string): Record<string, boolean> {
  const scenario = JSON.parse(readFileSync(`scenarios/${scenarioName}.json`, "utf8")) as Scenario;
  const transcript = loadCassette(scenarioName, autLabel);
  // guard against a cassette drifting from the scenario it's gated against
  assert.equal(transcript.scenario, scenario.name, "cassette scenario name mismatch");
  assert.equal(transcript.persona, scenario.persona, "cassette persona mismatch");
  const gates: GateResult[] = runGates(transcript, scenario);
  return Object.fromEntries(gates.map((g) => [g.name.split(":")[0], g.pass]));
}

test("ladder TOP — grounded book-modify-confirm: every gate passes", () => {
  assert.deepEqual(vector("book-modify-confirm", "tabletalk-grounded"), {
    no_spoken_symbols: true, tool_arg_iso: true, grounding: true, required_tool: true, value_consistency: true, latency: true,
  });
});

test("ladder BOTTOM — bare book-modify-confirm: dirty speech + ungrounded", () => {
  assert.deepEqual(vector("book-modify-confirm", "tabletalk-bare"), {
    no_spoken_symbols: false, tool_arg_iso: true, grounding: false, required_tool: true, value_consistency: true, latency: true,
  });
});

test("ladder MIDDLE — hardened book-modify-confirm: clean speech, still ungrounded", () => {
  // value_consistency=true: the agent is internally consistent (it speaks the same date
  // it booked) but ungrounded (wrong year) — grounding is the gate that catches the real
  // problem. (Before the turn-taking fix, smeared turns made value_consistency spuriously
  // fail; clean segmentation now reflects the agent's true self-consistency.)
  assert.deepEqual(vector("book-modify-confirm", "tabletalk-hardened"), {
    no_spoken_symbols: true, tool_arg_iso: true, grounding: false, required_tool: true, value_consistency: true, latency: true,
  });
});

test("grounded menu-price: every gate passes", () => {
  assert.deepEqual(vector("menu-price", "tabletalk-grounded"), { no_spoken_symbols: true, required_tool: true, latency: true });
});

test("grounded restaurant-info: every gate passes", () => {
  assert.deepEqual(vector("restaurant-info", "tabletalk-grounded"), { no_spoken_symbols: true, required_tool: true, latency: true });
});

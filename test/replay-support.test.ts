// Genericity proof, offline + deterministic: the SAME registry gates that test the
// restaurant agent also test a different domain — an IT support agent — over recorded
// cassettes. Across two scenarios, the gates are shown both PASSING when correct and
// CATCHING when violated:
//   reset-and-callback: grounded passes all; bare fails no_spoken_symbols + grounding.
//   frustrated-reset:   grounded honors verify-before-reset & never deletes; INSECURE
//                       resets before verifying AND deletes -> tool_sequence + forbidden_tool CATCH.
// This is M2's standing CI proof that the gates are domain-agnostic. (See README — Scope.)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadCassette } from "../src/capture/cassette.ts";
import { runGates } from "../src/gates/index.ts";
import { TOOLS } from "../examples/support/support.ts";
import type { GateResult, Scenario } from "../src/types.ts";

function vector(scenarioName: string, autLabel: string): Record<string, boolean> {
  const scenario = JSON.parse(readFileSync(`examples/support/scenarios/${scenarioName}.json`, "utf8")) as Scenario;
  const transcript = loadCassette(scenarioName, autLabel);
  assert.equal(transcript.scenario, scenario.name, "cassette scenario name mismatch");
  const gates: GateResult[] = runGates(transcript, scenario, TOOLS);
  return Object.fromEntries(gates.map((g) => [g.name.split(":")[0], g.pass]));
}

test("support GROUNDED reset-and-callback — every generic gate passes on a non-restaurant agent", () => {
  assert.deepEqual(vector("reset-and-callback", "support-grounded"), {
    no_spoken_symbols: true, tool_sequence: true, required_tool: true, tool_args_match_schema: true,
    grounding: true, spoken_matches_tool: true, forbidden_tool: true, latency: true,
  });
});

test("support BARE reset-and-callback — the gates catch spoken Markdown + ungrounded date", () => {
  assert.deepEqual(vector("reset-and-callback", "support-bare"), {
    no_spoken_symbols: false, tool_sequence: true, required_tool: true, tool_args_match_schema: true,
    grounding: false, spoken_matches_tool: true, forbidden_tool: true, latency: true,
  });
});

test("support GROUNDED frustrated-reset — verify-before-reset honored, never deletes", () => {
  assert.deepEqual(vector("frustrated-reset", "support-grounded"), {
    no_spoken_symbols: true, tool_sequence: true, forbidden_tool: true, latency: true,
  });
});

test("support INSECURE frustrated-reset — tool_sequence + forbidden_tool CATCH the security violations", () => {
  assert.deepEqual(vector("frustrated-reset", "support-insecure"), {
    no_spoken_symbols: true, tool_sequence: false, forbidden_tool: false, latency: true,
  });
});

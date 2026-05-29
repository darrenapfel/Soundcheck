// Replay-integration tests — the WHOLE pipeline (capture → gates) over recorded
// cassettes, fully offline/deterministic (no socket, no STT, no key). This is the
// golden bare→hardened→grounded ladder as a self-regression: if a change makes
// grounded fail or bare pass, the build breaks. (See docs/TESTING.md §2, §3.3.)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadCassette } from "../src/capture/cassette.ts";
import { runGates } from "../src/gates/index.ts";
import type { GateResult, Scenario } from "../src/types.ts";

function evalCassette(scenarioName: string, autLabel: string): GateResult[] {
  const scenario = JSON.parse(readFileSync(`scenarios/${scenarioName}.json`, "utf8")) as Scenario;
  const transcript = loadCassette(scenarioName, autLabel);
  return runGates(transcript, scenario);
}
const find = (gs: GateResult[], name: string) => {
  const g = gs.find((x) => x.name.startsWith(name));
  if (!g) throw new Error(`gate ${name} not found in ${gs.map((x) => x.name).join(", ")}`);
  return g;
};

test("ladder TOP: grounded book-modify-confirm passes EVERY gate", () => {
  const gs = evalCassette("book-modify-confirm", "tabletalk-grounded");
  assert.ok(gs.every((g) => g.pass), "expected all pass:\n" + JSON.stringify(gs, null, 2));
});

test("ladder BOTTOM: bare book-modify-confirm fails spoken-symbols AND grounding", () => {
  const gs = evalCassette("book-modify-confirm", "tabletalk-bare");
  assert.equal(find(gs, "no_spoken_symbols").pass, false, "bare must speak symbols");
  assert.equal(find(gs, "grounding").pass, false, "bare must be ungrounded");
});

test("ladder MIDDLE: hardened speaks cleanly but still fails grounding", () => {
  const gs = evalCassette("book-modify-confirm", "tabletalk-hardened");
  assert.equal(find(gs, "no_spoken_symbols").pass, true, "hardened (no-markdown prompt) speaks cleanly");
  assert.equal(find(gs, "grounding").pass, false, "hardened still hallucinates the date");
});

test("grounded menu-price passes every gate", () => {
  assert.ok(evalCassette("menu-price", "tabletalk-grounded").every((g) => g.pass));
});

test("grounded restaurant-info passes every gate", () => {
  assert.ok(evalCassette("restaurant-info", "tabletalk-grounded").every((g) => g.pass));
});

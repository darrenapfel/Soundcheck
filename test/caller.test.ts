// Unit tests for Evaline (the synthetic caller) — persona voice + phrasing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { evalineTurns } from "../src/caller/evaline.ts";
import type { Scenario } from "../src/types.ts";

function scenario(persona: "cooperative" | "impatient", turns: string[]): Scenario {
  return { name: "t", persona, turns, assert: [] };
}

test("cooperative caller leaves turns verbatim and uses a known voice", () => {
  const out = evalineTurns(scenario("cooperative", ["one", "two", "three"]));
  assert.deepEqual(out.map((t) => t.text), ["one", "two", "three"]);
  assert.ok(out.every((t) => t.voice.startsWith("aura-")));
});

test("impatient caller injects impatience on the second turn only", () => {
  const out = evalineTurns(scenario("impatient", ["one", "two", "three"]));
  assert.equal(out[0].text, "one");
  assert.match(out[1].text, /two.*hurry/i);
  assert.equal(out[2].text, "three");
});

test("one turn per scenario turn", () => {
  assert.equal(evalineTurns(scenario("cooperative", ["a", "b"])).length, 2);
});

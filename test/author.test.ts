// Unit tests for domain-agnostic autonomous eval authoring.

import { test } from "node:test";
import assert from "node:assert/strict";
import { authorSuite, extractBusinessRules, nextSaturday } from "../src/author/index.ts";
import { TOOLS } from "../examples/tabletalk/tabletalk.ts";
import { loadCassette } from "../src/capture/cassette.ts";
import { runGates } from "../src/gates/index.ts";
import type { ToolSchema } from "../src/types.ts";

// A synthetic, NON-restaurant agent exercising the generic paths.
const SPEC = {
  systemPrompt: "Verify identity before any action. We are closed Mondays. Parties up to 8 only.",
  tools: [
    { name: "verifyAccount", description: "Verify identity by email.", parameters: { type: "object", properties: { email: { type: "string" } }, required: ["email"] } },
    { name: "bookSlot", description: "Book a slot at a date and time.", parameters: { type: "object", properties: { date: { type: "string", format: "date" }, time: { type: "string", format: "time" } }, required: ["date", "time"] } },
    { name: "getInfo", description: "Get general info.", parameters: { type: "object", properties: {} } },
    { name: "deleteEverything", description: "PERMANENTLY delete all data. Destructive.", parameters: { type: "object", properties: {} } },
  ] as ToolSchema[],
};
const names = (s: ReturnType<typeof authorSuite>) => s.scenarios.map((x) => x.name);
const keys = (s: ReturnType<typeof authorSuite>, name: string) => (s.scenarios.find((x) => x.name === name)?.assert ?? []).map((a) => (typeof a === "string" ? a : Object.keys(a)[0]));

test("authors one scenario per NON-destructive tool (skips destructive)", () => {
  const suite = authorSuite(SPEC);
  assert.deepEqual(names(suite).sort(), ["authored-bookSlot", "authored-getInfo", "authored-verifyAccount"]); // deleteEverything skipped
});

test("a tool with a date field gets grounding + spoken_matches + schema; a getter gets neither", () => {
  const suite = authorSuite(SPEC, "2026-05-28");
  assert.deepEqual(keys(suite, "authored-bookSlot"), ["no_spoken_symbols", "required_tool", "tool_args_match_schema", "grounding", "spoken_matches_tool", "latency"]);
  assert.deepEqual(keys(suite, "authored-getInfo"), ["no_spoken_symbols", "required_tool", "latency"]); // no params -> no schema/grounding
});

test("grounding resolves the date relative to `now`", () => {
  const suite = authorSuite(SPEC, "2026-05-28");
  const g = suite.scenarios.find((s) => s.name === "authored-bookSlot")!.assert.find((a) => typeof a === "object" && "grounding" in a) as { grounding: { expected: string } };
  assert.equal(g.grounding.expected, nextSaturday("2026-05-28"));
});

test("identity is provided proactively when the agent gates on verification", () => {
  const suite = authorSuite(SPEC);
  assert.match(suite.scenarios.find((s) => s.name === "authored-bookSlot")!.turns[0], /my email is/);
});

test("a spec with no identity tools does not inject identity", () => {
  const suite = authorSuite({ systemPrompt: "info only", tools: [{ name: "lookup", description: "Look something up.", parameters: { type: "object", properties: { q: { type: "string" } } } }] as ToolSchema[] });
  assert.doesNotMatch(suite.scenarios[0].turns[0], /my email is/);
});

test("extractBusinessRules picks up closed-days, party-size, and verify rules", () => {
  const rules = extractBusinessRules("We are closed Mondays. Parties up to 8 only. Always verify before reset.");
  assert.ok(rules.some((r) => /closed mondays/i.test(r)), JSON.stringify(rules));
  assert.ok(rules.some((r) => /up to 8/i.test(r)), JSON.stringify(rules));
});

test("EXECUTING proof: authored booking gates CATCH the bare restaurant agent's bugs", () => {
  const suite = authorSuite({ systemPrompt: "restaurant receptionist", tools: TOOLS }, "2026-05-28");
  const book = suite.scenarios.find((s) => s.name === "authored-bookReservation")!;
  const bare = loadCassette("book-modify-confirm", "tabletalk-bare");
  const gates = runGates(bare, book, TOOLS);
  const g = (n: string) => gates.find((x) => x.name.startsWith(n))!;
  assert.equal(g("no_spoken_symbols").pass, false, "authored suite must catch spoken symbols");
  assert.equal(g("grounding").pass, false, "authored suite must catch the stale/hallucinated date");
});

test("every authored scenario is gate-dispatchable (no unknown gate)", () => {
  const suite = authorSuite({ systemPrompt: "restaurant receptionist", tools: TOOLS });
  const bare = loadCassette("book-modify-confirm", "tabletalk-bare");
  for (const s of suite.scenarios) {
    const gates = runGates(bare, s, TOOLS);
    assert.ok(!gates.some((g) => g.detail.includes("unknown gate")), `${s.name} has an unknown gate`);
  }
});

test("nextSaturday resolves the upcoming Saturday", () => {
  const s = nextSaturday("2026-05-28");
  assert.equal(new Date(s + "T00:00:00Z").getUTCDay(), 6);
  assert.ok(s > "2026-05-28");
});

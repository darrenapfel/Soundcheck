// Unit tests for autonomous eval authoring.

import { test } from "node:test";
import assert from "node:assert/strict";
import { authorSuite, extractBusinessRules, nextSaturday } from "../src/author/index.ts";
import { TOOLS } from "../examples/tabletalk/tabletalk.ts";
import { loadCassette } from "../src/capture/cassette.ts";
import { runGates } from "../src/gates/index.ts";

const spec = { name: "tabletalk", systemPrompt: "You are a receptionist. We are closed Mondays. Parties up to 8 only.", tools: TOOLS };
const names = (suite: ReturnType<typeof authorSuite>) => suite.scenarios.map((s) => s.name);
const asserts = (suite: ReturnType<typeof authorSuite>, name: string) =>
  JSON.stringify(suite.scenarios.find((s) => s.name === name)?.assert ?? []);

test("authors a scenario per capability the tools imply", () => {
  const suite = authorSuite(spec);
  assert.deepEqual(names(suite).sort(), ["authored-book-confirm", "authored-cancel", "authored-info", "authored-menu"]);
});

test("the authored booking scenario contains the gates that catch the known bug classes", () => {
  const suite = authorSuite(spec, "2026-05-28");
  const a = asserts(suite, "authored-book-confirm");
  // these are exactly the gates that catch bare's STAR STAR + stale-date + prose-date bugs
  assert.match(a, /no_spoken_symbols/);
  assert.match(a, /grounding/);
  assert.match(a, /tool_arg_iso/);
  assert.match(a, /modifyReservation/); // modify present -> required_tool added
  const book = suite.scenarios.find((s) => s.name === "authored-book-confirm")!;
  assert.equal(book.grounding?.expectedDate, nextSaturday("2026-05-28"));
});

test("a spec without booking tools authors no booking scenario", () => {
  const suite = authorSuite({ systemPrompt: "info only", tools: [{ name: "getRestaurantInfo", description: "", parameters: {} }] });
  assert.deepEqual(names(suite), ["authored-info"]);
});

test("extractBusinessRules picks up closed-days and party-size rules", () => {
  const rules = extractBusinessRules("We are closed Mondays. Parties up to 8 only. No refunds.");
  assert.ok(rules.some((r) => /closed mondays/i.test(r)), JSON.stringify(rules));
  assert.ok(rules.some((r) => /up to 8/i.test(r)), JSON.stringify(rules));
});

test("EXECUTING proof: the authored booking gates actually CATCH the bare agent's bugs", () => {
  const suite = authorSuite(spec, "2026-05-28");
  const book = suite.scenarios.find((s) => s.name === "authored-book-confirm")!;
  // Run the AUTHORED gates against the recorded bare (buggy) conversation.
  const bare = loadCassette("book-modify-confirm", "tabletalk-bare");
  const gates = runGates(bare, book);
  const g = (n: string) => gates.find((x) => x.name.startsWith(n))!;
  assert.equal(g("no_spoken_symbols").pass, false, "authored suite must catch spoken symbols");
  assert.equal(g("grounding").pass, false, "authored suite must catch the stale/hallucinated date");
});

test("every authored scenario is gate-dispatchable (no 'unknown assertion')", () => {
  const suite = authorSuite(spec);
  const bare = loadCassette("book-modify-confirm", "tabletalk-bare");
  for (const s of suite.scenarios) {
    const gates = runGates(bare, s);
    assert.ok(!gates.some((g) => g.detail === "unknown assertion"), `${s.name} has an unknown assertion`);
  }
});

test("nextSaturday resolves the upcoming Saturday", () => {
  const s = nextSaturday("2026-05-28");
  assert.match(s, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(new Date(s + "T00:00:00Z").getUTCDay(), 6); // Saturday
  assert.ok(s > "2026-05-28");
});

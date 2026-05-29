// Deterministic gate unit-tests over fixture transcripts. Proves every gate —
// including tool_arg_iso, whose LIVE trigger (a model emitting a prose date) is
// stochastic — without any network/credits. Run: `npm test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runGates } from "../src/gates/index.ts";
import type { CapturedTurn, Scenario, Transcript, ToolCall } from "../src/types.ts";

function turn(n: number, heard: string, toolCalls: ToolCall[] = [], ttfbMs: number | null = 1200): CapturedTurn {
  return { turn: n, callerSaid: "", agentHeardCallerAs: "", agentText: "", agentSpokenHeardBack: heard, toolCalls, ttfbMs, turnMs: 3000 };
}
function book(date: unknown): ToolCall {
  return { name: "bookReservation", args: { guestName: "Garcia", partySize: 4, date, time: "19:30" }, result: { success: true } };
}
function modify(): ToolCall {
  return { name: "modifyReservation", args: { changes: { time: "18:30" } }, result: { success: true } };
}
function tx(turns: CapturedTurn[]): Transcript {
  return { scenario: "book-modify-confirm", persona: "cooperative", autLabel: "fixture", turns };
}
const SCENARIO: Scenario = {
  name: "book-modify-confirm",
  persona: "cooperative",
  turns: [],
  assert: [
    "no_spoken_symbols",
    { tool_arg_iso: "bookReservation" },
    { grounding: { tool: "bookReservation" } },
    { required_tool: "modifyReservation" },
    { latency: { ttfb_ms: { max: 12000 } } },
  ],
  grounding: { today: "2026-05-28", expectedDate: "2026-05-30" },
};
const gate = (gs: ReturnType<typeof runGates>, name: string) => gs.find((g) => g.name.startsWith(name))!;

test("clean grounded transcript passes every gate", () => {
  const g = runGates(tx([
    turn(1, "Your reservation for four is confirmed for Saturday May thirtieth at seven thirty PM.", [book("2026-05-30")]),
    turn(2, "Changed to six thirty PM.", [modify()]),
  ]), SCENARIO);
  assert.ok(g.every((x) => x.pass), JSON.stringify(g, null, 2));
});

test("no_spoken_symbols catches spoken markdown ('star')", () => {
  const g = runGates(tx([turn(1, "star star confirmed star star", [book("2026-05-30")]), turn(2, "ok", [modify()])]), SCENARIO);
  assert.equal(gate(g, "no_spoken_symbols").pass, false);
});

test("no_spoken_symbols catches dash-as-negative price", () => {
  const g = runGates(tx([turn(1, "the special is grilled salmon negative thirty two dollars", [book("2026-05-30")]), turn(2, "ok", [modify()])]), SCENARIO);
  assert.equal(gate(g, "no_spoken_symbols").pass, false);
});

test("tool_arg_iso catches a prose date passed to a tool", () => {
  const g = runGates(tx([turn(1, "confirmed", [book("October seventh")]), turn(2, "ok", [modify()])]), SCENARIO);
  assert.equal(gate(g, "tool_arg_iso").pass, false);
});

test("grounding catches a stale/wrong year", () => {
  const g = runGates(tx([turn(1, "confirmed", [book("2023-10-28")]), turn(2, "ok", [modify()])]), SCENARIO);
  assert.equal(gate(g, "grounding").pass, false);
});

test("required_tool catches a missing tool call", () => {
  const g = runGates(tx([turn(1, "confirmed", [book("2026-05-30")])]), SCENARIO); // no modifyReservation
  assert.equal(gate(g, "required_tool").pass, false);
});

test("latency catches a slow turn", () => {
  const g = runGates(tx([turn(1, "confirmed", [book("2026-05-30")], 99999), turn(2, "ok", [modify()])]), SCENARIO);
  assert.equal(gate(g, "latency").pass, false);
});

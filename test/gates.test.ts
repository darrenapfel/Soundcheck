// Deterministic gate unit-tests over fixture transcripts — every gate in the registry,
// proven (fails on bad, passes on good) without any network/credits. Run: `npm test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runGates } from "../src/gates/index.ts";
import type { CapturedTurn, Scenario, Transcript, ToolCall, ToolSchema } from "../src/types.ts";

const TOOLS: ToolSchema[] = [
  { name: "bookReservation", description: "", parameters: { type: "object", properties: { guestName: { type: "string" }, partySize: { type: "number" }, date: { type: "string", format: "date" }, time: { type: "string", format: "time" } }, required: ["guestName", "partySize", "date", "time"] } },
  { name: "verifyIdentity", description: "", parameters: { type: "object", properties: {} } },
];

function turn(n: number, heard: string, toolCalls: ToolCall[] = [], ttfbMs: number | null = 1200): CapturedTurn {
  return { turn: n, callerSaid: "", agentHeardCallerAs: "", agentText: "", agentSpokenHeardBack: heard, toolCalls, ttfbMs, turnMs: 3000 };
}
function book(date: unknown, extra: Record<string, unknown> = {}): ToolCall {
  return { name: "bookReservation", args: { guestName: "Garcia", partySize: 4, date, time: "19:30", ...extra }, result: { success: true } };
}
const call = (name: string, args: Record<string, unknown> = {}): ToolCall => ({ name, args, result: {} });
const modify = (): ToolCall => ({ name: "modifyReservation", args: { changes: { time: "18:30" } }, result: {} });
function tx(turns: CapturedTurn[]): Transcript {
  return { scenario: "s", persona: "cooperative", autLabel: "fixture", turns };
}
const scen = (assertSpecs: Scenario["assert"]): Scenario => ({ name: "s", persona: "cooperative", turns: [], assert: assertSpecs });
const run = (turns: CapturedTurn[], assertSpecs: Scenario["assert"]) => runGates(tx(turns), scen(assertSpecs), TOOLS);
const gate = (gs: ReturnType<typeof runGates>, name: string) => gs.find((g) => g.name.startsWith(name))!;

const FULL: Scenario["assert"] = [
  "no_spoken_symbols",
  { tool_args_match_schema: "bookReservation" },
  { grounding: { tool: "bookReservation", field: "date", now: "2026-05-28", expected: "2026-05-30" } },
  { required_tool: "modifyReservation" },
  { spoken_matches_tool: { tool: "bookReservation", field: "date" } },
  { latency: { ttfb_ms: { max: 12000 } } },
];

test("clean grounded transcript passes every gate", () => {
  const g = run([turn(1, "Your reservation for four is confirmed for May thirtieth at seven thirty PM.", [book("2026-05-30")]), turn(2, "Changed to six thirty PM.", [modify()])], FULL);
  assert.ok(g.every((x) => x.pass), JSON.stringify(g, null, 2));
});

test("no_spoken_symbols catches spoken markdown + dash-as-negative", () => {
  assert.equal(gate(run([turn(1, "star star confirmed star star")], ["no_spoken_symbols"]), "no_spoken_symbols").pass, false);
  assert.equal(gate(run([turn(1, "grilled salmon negative thirty two dollars")], ["no_spoken_symbols"]), "no_spoken_symbols").pass, false);
  assert.equal(gate(run([turn(1, "your table is confirmed")], ["no_spoken_symbols"]), "no_spoken_symbols").pass, true);
});

test("required_tool — missing fails, present passes", () => {
  assert.equal(gate(run([turn(1, "ok", [book("2026-05-30")])], [{ required_tool: "modifyReservation" }]), "required_tool").pass, false);
  assert.equal(gate(run([turn(1, "ok", [modify()])], [{ required_tool: "modifyReservation" }]), "required_tool").pass, true);
});

test("forbidden_tool — called fails, absent passes", () => {
  assert.equal(gate(run([turn(1, "ok", [call("chargeCard")])], [{ forbidden_tool: "chargeCard" }]), "forbidden_tool").pass, false);
  assert.equal(gate(run([turn(1, "ok", [book("2026-05-30")])], [{ forbidden_tool: "chargeCard" }]), "forbidden_tool").pass, true);
});

test("tool_sequence — a-before-b passes, b-before-a fails, b-never-called passes", () => {
  const spec: Scenario["assert"] = [{ tool_sequence: ["verifyIdentity", "before", "bookReservation"] }];
  assert.equal(gate(run([turn(1, "", [call("verifyIdentity"), book("2026-05-30")])], spec), "tool_sequence").pass, true);
  assert.equal(gate(run([turn(1, "", [book("2026-05-30"), call("verifyIdentity")])], spec), "tool_sequence").pass, false);
  assert.equal(gate(run([turn(1, "", [call("verifyIdentity")])], spec), "tool_sequence").pass, true); // b never called -> no violation
});

test("tool_args_match_schema — conforming passes; bad date, missing required, no-call, no-schema fail", () => {
  const spec: Scenario["assert"] = [{ tool_args_match_schema: "bookReservation" }];
  assert.equal(gate(run([turn(1, "", [book("2026-05-30")])], spec), "tool_args_match_schema").pass, true);
  assert.equal(gate(run([turn(1, "", [book("October seventh")])], spec), "tool_args_match_schema").pass, false); // format:date violated
  assert.equal(gate(run([turn(1, "", [{ name: "bookReservation", args: { date: "2026-05-30", time: "19:30" }, result: {} }])], spec), "tool_args_match_schema").pass, false); // missing required guestName/partySize
  assert.equal(gate(run([turn(1, "", [])], spec), "tool_args_match_schema").pass, false); // never called
  assert.equal(gate(runGates(tx([turn(1, "", [book("2026-05-30")])]), scen([{ tool_args_match_schema: "unknownTool" }]), []), "tool_args_match_schema").pass, false); // no schema
});

test("spoken_matches_tool — spoken value passes; unspoken fails; works for a string field", () => {
  const dateSpec: Scenario["assert"] = [{ spoken_matches_tool: { tool: "bookReservation", field: "date" } }];
  assert.equal(gate(run([turn(1, "booked for May thirtieth", [book("2026-05-30")])], dateSpec), "spoken_matches_tool").pass, true);
  assert.equal(gate(run([turn(1, "star star booked star star", [book("2026-05-30")])], dateSpec), "spoken_matches_tool").pass, false); // never spoke the month
  const nameSpec: Scenario["assert"] = [{ spoken_matches_tool: { tool: "bookReservation", field: "guestName" } }];
  assert.equal(gate(run([turn(1, "confirmed for garcia", [book("2026-05-30")])], nameSpec), "spoken_matches_tool").pass, true);
});

test("grounding — correct passes; stale year + wrong date fail; missing params fail closed", () => {
  const spec: Scenario["assert"] = [{ grounding: { tool: "bookReservation", field: "date", now: "2026-05-28", expected: "2026-05-30" } }];
  assert.equal(gate(run([turn(1, "", [book("2026-05-30")])], spec), "grounding").pass, true);
  assert.equal(gate(run([turn(1, "", [book("2023-10-28")])], spec), "grounding").pass, false); // stale year + != expected
  assert.equal(gate(run([turn(1, "", [book("2026-06-01")])], spec), "grounding").pass, false); // != expected
  assert.equal(gate(runGates(tx([turn(1, "", [book("2026-05-30")])]), scen([{ grounding: {} as never }]), TOOLS), "grounding").pass, false); // missing now/expected
});

test("latency — slow ttfb and slow turn fail; ok passes", () => {
  assert.equal(gate(run([turn(1, "ok", [], 99999)], [{ latency: { ttfb_ms: { max: 12000 } } }]), "latency").pass, false);
  assert.equal(gate(run([{ turn: 1, callerSaid: "", agentHeardCallerAs: "", agentText: "", agentSpokenHeardBack: "ok", toolCalls: [], ttfbMs: 50, turnMs: 9999 }], [{ latency: { turn_ms: { max: 100 } } }]), "latency").pass, false);
  assert.equal(gate(run([turn(1, "ok", [], 1200)], [{ latency: { ttfb_ms: { max: 12000 } } }]), "latency").pass, true);
});

test("unknown gate fails closed", () => {
  const g = runGates(tx([turn(1, "hi")]), scen(["bogus" as never, { nope: 1 } as never]), TOOLS);
  assert.ok(g.every((x) => x.pass === false && x.detail.includes("unknown gate")));
});

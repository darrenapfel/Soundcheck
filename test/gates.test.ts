// Deterministic gate unit-tests over fixture transcripts — every gate in the registry,
// proven (fails on bad, passes on good) without any network/credits. Run: `npm test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runGates } from "../src/gates/index.ts";
import type { CapturedTurn, Scenario, Trace, ToolCall, ToolSchema } from "../src/types.ts";

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
function tx(turns: CapturedTurn[]): Trace {
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

test("spoken_matches_tool — alphanumeric read-back: garbled digits fail; intelligible digits pass even when STT mishears letters", () => {
  const spec: Scenario["assert"] = [{ spoken_matches_tool: { tool: "rebookFlight", field: "flightNumber" } }];
  const reb = (flightNumber: string): ToolCall => ({ name: "rebookFlight", args: { flightNumber, date: "2026-06-02" }, result: {} });
  // PASS: "SM218" read back grouped as "s m two eighteen".
  assert.equal(gate(run([turn(1, "You're rebooked on flight s m two eighteen.", [reb("SM218")])], spec), "spoken_matches_tool").pass, true);
  // FAIL: the number is garbled/dropped — heard only "two" (the real defect in the travel sample).
  assert.equal(gate(run([turn(1, "You're rebooked on flight s m two.", [reb("SM218")])], spec), "spoken_matches_tool").pass, false);
  // PASS despite STT mishearing the LETTERS ("M"→"n"): the digits "640" ("six forty") are intact.
  assert.equal(gate(run([turn(1, "You're on flight s n six forty now.", [reb("SM640")])], spec), "spoken_matches_tool").pass, true);
});

test("spoken_consistent_with_tool — catches the impatient-caller cave-in (spoke a date it never booked + bad weekday); passes clean + legit reschedule", () => {
  const spec: Scenario["assert"] = [{ spoken_consistent_with_tool: { tool: "scheduleAppointment", field: "date", now: "2026-06-01" } }];
  const appt = (date: string): ToolCall => ({ name: "scheduleAppointment", args: { date, time: "15:00", provider: "Doctor Patel" }, result: {} });

  // Booked June 4 (the real "this Thursday"), then VERBALLY caved to "June second" (a Tuesday) —
  // the booking never changed. spoken_matches_tool + grounding both pass; THIS must catch it.
  const caved = run([
    turn(1, "Your follow-up is booked for Thursday, June fourth at three PM.", [appt("2026-06-04")]),
    turn(2, "This Thursday is June second. It is actually booked for June second. Confirmed for Thursday, June second at three PM."),
  ], spec);
  const g = gate(caved, "spoken_consistent_with_tool");
  assert.equal(g.pass, false, JSON.stringify(g));
  assert.match(g.detail, /June 2/);   // final spoken date matches no booked value
  assert.match(g.detail, /Tuesday/);  // "Thursday, June 2nd" is internally incoherent

  // Clean: booked + spoke June 4, correctly a Thursday → passes.
  assert.equal(gate(run([turn(1, "Your follow-up is booked for Thursday, June fourth at three PM.", [appt("2026-06-04")])], spec), "spoken_consistent_with_tool").pass, true);

  // Isolated weekday incoherence: booking IS June 2, but "Thursday, June second" is still wrong (Tuesday).
  const gw = gate(run([turn(1, "You're set for Thursday, June second.", [appt("2026-06-02")])], spec), "spoken_consistent_with_tool");
  assert.equal(gw.pass, false);
  assert.match(gw.detail, /Tuesday/);

  // Legit reschedule "moved X→Y": two bookings, agent ends on the new date (no weekday claim) → passes.
  assert.equal(gate(run([turn(1, "I booked June fourth, then moved you to June sixth.", [appt("2026-06-04"), appt("2026-06-06")])], spec), "spoken_consistent_with_tool").pass, true);

  // Silent (passes) when the agent spoke no date — existence is spoken_matches_tool's job, not this gate's.
  assert.equal(gate(run([turn(1, "Your appointment is all set.", [appt("2026-06-04")])], spec), "spoken_consistent_with_tool").pass, true);
});

test("spoken_matches_text — canonical formatting equivalence passes; a real content error fails with a diff", () => {
  // The oracle heard the smart-formatted surface of the same content -> PASS, tier named.
  const pass = gate(run([turn(1, "The meeting starts at 7:30 tomorrow morning.")],
    [{ spoken_matches_text: { text: "The meeting starts at seven thirty tomorrow morning." } }]), "spoken_matches_text");
  assert.equal(pass.pass, true, pass.detail);
  assert.match(pass.detail, /canonical/);
  // A real misheard time (7:13 for seven thirty) -> FAIL, with the token-level diff surfaced.
  const fail = gate(run([turn(1, "The meeting starts at 7:13 tomorrow morning.")],
    [{ spoken_matches_text: { text: "The meeting starts at seven thirty tomorrow morning." } }]), "spoken_matches_text");
  assert.equal(fail.pass, false);
  assert.match(fail.detail, /FAIL/);
  assert.match(fail.detail, /time:7:30.*heard as.*time:7:13/);
});

test("spoken_matches_text — turn targeting: the numbered turn must match; unknown turn numbers fail closed; no turn = any turn", () => {
  const turns = [turn(1, "Let me check that for you."), turn(2, "Your total comes to $12.50.")];
  const text = "Your total comes to twelve dollars and fifty cents.";
  // `turn` is the 1-BASED CapturedTurn.turn number, exactly as report lines print it:
  // turn 2 is the matching turn.
  assert.equal(gate(run(turns, [{ spoken_matches_text: { text, turn: 2 } }]), "spoken_matches_text").pass, true);
  // turn 1 says something else entirely -> fail (and the detail names the same 1-based number).
  const wrongTurn = gate(run(turns, [{ spoken_matches_text: { text, turn: 1 } }]), "spoken_matches_text");
  assert.equal(wrongTurn.pass, false);
  assert.match(wrongTurn.detail, /turn 1:/);
  // an unknown turn number fails CLOSED (never a vacuous pass) — too high, and the
  // 0 that a 0-based reading would suggest.
  const oob = gate(run(turns, [{ spoken_matches_text: { text, turn: 5 } }]), "spoken_matches_text");
  assert.equal(oob.pass, false);
  assert.match(oob.detail, /no captured turn numbered 5/);
  assert.equal(gate(run(turns, [{ spoken_matches_text: { text, turn: 0 } }]), "spoken_matches_text").pass, false);
  // without `turn`, ANY matching turn passes (detail names the 1-based turn that matched).
  const any = gate(run(turns, [{ spoken_matches_text: { text } }]), "spoken_matches_text");
  assert.equal(any.pass, true);
  assert.match(any.detail, /turn 2 matched/);
  // and with no matching turn anywhere, it fails.
  assert.equal(gate(run(turns, [{ spoken_matches_text: { text: "Your total comes to fifteen dollars." } }]), "spoken_matches_text").pass, false);
  // a malformed spec (no text) fails closed.
  assert.equal(gate(run(turns, [{ spoken_matches_text: {} as never }]), "spoken_matches_text").pass, false);
});

test("spoken_matches_text — an expected text with no comparable tokens fails closed (no vacuous canonical pass)", () => {
  // "?!" canonicalizes to ZERO tokens; so does a silent turn — without the guard the two
  // empty key streams would match at the canonical tier and gate green.
  const g = gate(run([turn(1, "")], [{ spoken_matches_text: { text: "?!" } }]), "spoken_matches_text");
  assert.equal(g.pass, false);
  assert.match(g.detail, /no comparable tokens/);
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
  // round-3 P3: when every TTFB is null the detail reads "n/a", not "n/ams".
  const noTtfb = gate(run([turn(1, "ok", [], null)], [{ latency: { ttfb_ms: { max: 12000 } } }]), "latency");
  assert.equal(noTtfb.pass, true);
  assert.match(noTtfb.detail, /avg TTFB n\/a\)/);
  assert.doesNotMatch(noTtfb.detail, /n\/ams/);
});

test("no_spoken_cardinal_ids — catches an identifier read as a cardinal; passes digit-by-digit, silent, or money", () => {
  const ssn = (): ToolCall => ({ name: "verifyIdentity", args: { lastFourSsn: "4417", zipCode: "98109" }, result: { accountId: "PINN-3390" } });
  // FAIL: agent reads the SSN back as a big cardinal number (the un-human rendering).
  const bad = run([turn(1, "Thanks, I have your social as four thousand four hundred and seventeen.", [ssn()])], ["no_spoken_cardinal_ids"]);
  assert.equal(gate(bad, "no_spoken_cardinal_ids").pass, false);
  // PASS: digit-by-digit is how a person says it.
  const good = run([turn(1, "Thanks, I have your social as four four one seven.", [ssn()])], ["no_spoken_cardinal_ids"]);
  assert.equal(gate(good, "no_spoken_cardinal_ids").pass, true);
  // PASS: the agent never reads the identifier back at all.
  const silent = run([turn(1, "Thank you, your identity is verified.", [ssn()])], ["no_spoken_cardinal_ids"]);
  assert.equal(gate(silent, "no_spoken_cardinal_ids").pass, true);
  // PASS: a dollar amount is NOT an identifier field — cardinals are correct for money.
  const money = run([turn(1, "Your balance is one thousand two hundred forty dollars.", [call("checkBalance", { availableDollars: 1240 })])], ["no_spoken_cardinal_ids"]);
  assert.equal(gate(money, "no_spoken_cardinal_ids").pass, true);
});

test("unknown gate fails closed", () => {
  const g = runGates(tx([turn(1, "hi")]), scen(["bogus" as never, { nope: 1 } as never]), TOOLS);
  assert.ok(g.every((x) => x.pass === false && x.detail.includes("unknown gate")));
});

test("malformed assert elements (null/undefined/number) fail CLOSED, never crash the run", () => {
  // A hand-authored assert with a null/undefined/number element must not abort runGates.
  const g = runGates(tx([turn(1, "hi")]), scen([null as never, undefined as never, 42 as never]), TOOLS);
  assert.equal(g.length, 3);
  assert.ok(g.every((x) => x.pass === false), "every malformed spec must fail closed");
});

test("goal_reached keys on goalDriven: guards forced --caller goal, spares a scripted run of a goal scenario (Phase 1 + round-3 P2)", () => {
  const goalScen: Scenario = { name: "g", persona: "cooperative", turns: [], goal: "book a table", assert: ["no_spoken_symbols"] };
  const noGoalScen: Scenario = { name: "g", persona: "cooperative", turns: ["hi"], assert: ["no_spoken_symbols"] }; // NO goal field
  const trace = (reason: Trace["terminationReason"] | undefined, goalDriven?: boolean): Trace =>
    ({ scenario: "g", persona: "cooperative", autLabel: "fixture", terminationReason: reason, goalDriven, turns: [turn(1, "your table is booked")] });

  // goal-driven + goal_met -> a passing goal_reached row.
  assert.equal(gate(runGates(trace("goal_met", true), goalScen, TOOLS), "goal_reached").pass, true);
  // goal-driven + a forced/aborted end -> a FAILING row (even though no_spoken_symbols passes).
  for (const bad of ["turn_cap", "planner_error", "repeat_guard"] as const) {
    assert.equal(gate(runGates(trace(bad, true), goalScen, TOOLS), "goal_reached").pass, false, bad);
  }
  // round-3 P2: a FORCED `--caller goal` run on a scenario with NO `goal` field is still guarded.
  assert.equal(gate(runGates(trace("turn_cap", true), noGoalScen, TOOLS), "goal_reached").pass, false, "forced --caller goal, no goal field");
  // a goal scenario run with the SCRIPTED caller (goalDriven false) -> NO row, even though it ended
  // script_exhausted and the scenario HAS a goal (the prior scenario.goal keying would false-fail here).
  assert.equal(runGates(trace("script_exhausted", false), goalScen, TOOLS).find((x) => x.name === "goal_reached"), undefined, "scripted run of a goal scenario");
  // not goal-driven (scripted, no goal) -> no row regardless of reason.
  assert.equal(runGates(trace("script_exhausted", false), noGoalScen, TOOLS).find((x) => x.name === "goal_reached"), undefined);
  // goal-driven but reason unknown (legacy cassette) -> no row (back-compat).
  assert.equal(runGates(trace(undefined, true), goalScen, TOOLS).find((x) => x.name === "goal_reached"), undefined);
});

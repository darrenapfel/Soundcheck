// Tests for the control-inversion caller layer (B): ScriptedCaller, GoalDrivenCaller,
// declarative barge-in, and the planner's tolerant arg parsing — all pure/offline.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ScriptedCaller, GoalDrivenCaller, PERSONA_VOICE as PV_POLICY, type PlanFn, type CallerContext, type CallerExchange } from "../src/caller/policy.ts";
import { PERSONA_VOICE as PV_EVALINE } from "../src/caller/evaline.ts";
import { parseCallerTurn, plannerPrompt } from "../src/caller/planner.ts";
import type { Scenario } from "../src/types.ts";

const ctx = (turnIndex: number, lastAgent = "", history: CallerExchange[] = []): CallerContext => ({ turnIndex, lastAgent, history });

test("PERSONA_VOICE has ONE source of truth: policy re-exports evaline's (L2)", () => {
  // policy.ts imports + re-exports the canonical map from the lower module (evaline.ts).
  // Same reference => no second definition that can drift.
  assert.strictEqual(PV_POLICY, PV_EVALINE, "policy must re-export evaline's PERSONA_VOICE, not redefine it");
});

test("each persona gets a DISTINCT caller voice (L1)", () => {
  const voices = Object.values(PV_POLICY);
  assert.equal(voices.length, 3);
  assert.equal(new Set(voices).size, 3, `expected 3 distinct persona voices, got ${voices.join(", ")}`);
  // and none collides with the AUT's default speaking voice (thalia) — Evaline stays audibly separate.
  assert.ok(!voices.includes("aura-2-thalia-en"), "caller voices must differ from the AUT default (thalia)");
});

test("ScriptedCaller plays actions in order, then hangs up", async () => {
  const c = new ScriptedCaller([{ text: "one", voice: "v" }, { text: "two", voice: "v" }]);
  assert.equal((await c.next(ctx(0)))?.text, "one");
  assert.equal((await c.next(ctx(1)))?.text, "two");
  assert.equal(await c.next(ctx(2)), null);
});

test("ScriptedCaller.fromScenario attaches declarative barge-in to the right turn", async () => {
  const scenario: Scenario = { name: "s", persona: "cooperative", turns: ["hi", "more"], assert: [], bargeIn: { afterTurn: 1, text: "wait, actually", afterMs: 1500 } };
  const c = ScriptedCaller.fromScenario(scenario);
  assert.equal((await c.next(ctx(0)))?.interrupt, undefined);
  assert.deepEqual((await c.next(ctx(1)))?.interrupt, { text: "wait, actually", afterMs: 1500 });
});

test("GoalDrivenCaller reacts to the agent's last reply and stops on hangup", async () => {
  const seen: string[] = [];
  const plan: PlanFn = async (input) => {
    seen.push(input.lastAgent);
    return input.turnIndex === 0 ? { action: "say", utterance: "what are the specials?" } : { action: "hangup", utterance: "" };
  };
  const c = new GoalDrivenCaller({ goal: "learn the specials", persona: "cooperative", plan });
  assert.equal((await c.next(ctx(0, "Hi, how can I help?")))?.text, "what are the specials?");
  assert.equal(await c.next(ctx(1, "Tonight: salmon and risotto.")), null);
  assert.deepEqual(seen, ["Hi, how can I help?", "Tonight: salmon and risotto."]); // the brain SAW the agent's replies
});

test("GoalDrivenCaller gives ONE wrap-up turn at the cap, then ends tagged turn_cap (H4)", async () => {
  const finals: boolean[] = [];
  const plan: PlanFn = async (input) => { finals.push(!!input.final); return { action: "say", utterance: `unique line ${input.turnIndex}` }; };
  const c = new GoalDrivenCaller({ goal: "loop", persona: "cooperative", plan, maxTurns: 3 });
  assert.ok(await c.next(ctx(0)));
  assert.ok(await c.next(ctx(2)));
  assert.ok(await c.next(ctx(3))); // turnIndex===maxTurns: one wrap-up turn is allowed (not a silent cut-off)
  assert.equal(await c.next(ctx(4)), null); // beyond the budget -> end
  assert.equal(c.terminationReason, "turn_cap"); // and the forced end is TAGGED (can't read as goal_met)
  assert.deepEqual(finals, [false, false, true]); // the brain was told "final" only on the wrap-up turn
});

test("GoalDrivenCaller tags goal_met when the brain hangs up", async () => {
  const plan: PlanFn = async (input) => (input.turnIndex === 0 ? { action: "say", utterance: "hi" } : { action: "hangup", utterance: "" });
  const c = new GoalDrivenCaller({ goal: "g", persona: "cooperative", plan });
  await c.next(ctx(0));
  assert.equal(await c.next(ctx(1, "done")), null);
  assert.equal(c.terminationReason, "goal_met");
});

test("GoalDrivenCaller tags repeat_guard on a true loop", async () => {
  const plan: PlanFn = async () => ({ action: "say", utterance: "What are the specials?" });
  const c = new GoalDrivenCaller({ goal: "g", persona: "cooperative", plan });
  await c.next(ctx(0)); await c.next(ctx(1)); // 1st, 2nd (legit re-ask)
  assert.equal(await c.next(ctx(2)), null); // 3rd identical -> loop
  assert.equal(c.terminationReason, "repeat_guard");
});

test("GoalDrivenCaller survives a transient planner failure with a holding line, ends planner_error if it persists (M4)", async () => {
  // A planner that errors twice in a row: first error -> a neutral holding line keeps the call
  // alive; second consecutive error -> end, tagged planner_error (NOT goal_met).
  const plan: PlanFn = async () => ({ action: "error", utterance: "" });
  const c = new GoalDrivenCaller({ goal: "g", persona: "cooperative", plan });
  const first = await c.next(ctx(0));
  assert.match(first?.text ?? "", /could you say that again/i); // holding line, not a hangup
  assert.equal(c.terminationReason, undefined); // still going after one blip
  assert.equal(await c.next(ctx(1)), null); // second consecutive failure -> end
  assert.equal(c.terminationReason, "planner_error");
});

test("GoalDrivenCaller: a transient failure then recovery does NOT end the call", async () => {
  let calls = 0;
  const plan: PlanFn = async () => (++calls === 1 ? { action: "error", utterance: "" } : { action: "say", utterance: "ok here is my real question" });
  const c = new GoalDrivenCaller({ goal: "g", persona: "cooperative", plan });
  assert.match((await c.next(ctx(0)))?.text ?? "", /could you say that again/i); // 1 failure -> holding line
  assert.equal((await c.next(ctx(1)))?.text, "ok here is my real question"); // recovered -> failure counter reset
  assert.equal(c.terminationReason, undefined);
});

test("ScriptedCaller tags script_exhausted when the tape runs out", async () => {
  const c = new ScriptedCaller([{ text: "one", voice: "v" }]);
  await c.next(ctx(0));
  assert.equal(await c.next(ctx(1)), null);
  assert.equal(c.terminationReason, "script_exhausted");
});

test("GoalDrivenCaller allows ONE legitimate re-ask but ends on a true loop", async () => {
  // A real caller re-asks after the agent stalls/mishears; only an actual loop should end the call.
  const plan: PlanFn = async () => ({ action: "say", utterance: "What are the specials?" });
  const c = new GoalDrivenCaller({ goal: "specials", persona: "cooperative", plan });
  assert.equal((await c.next(ctx(0)))?.text, "What are the specials?"); // 1st
  assert.equal((await c.next(ctx(1, "Sorry, didn't catch that.")))?.text, "What are the specials?"); // 2nd: legit re-ask, NOT a hangup
  assert.equal(await c.next(ctx(2, "Sorry, didn't catch that.")), null); // 3rd identical -> looping -> hang up
});

test("GoalDrivenCaller never trips the loop guard on short acks", async () => {
  const ackPlan: PlanFn = async () => ({ action: "say", utterance: "Yes." });
  const a = new GoalDrivenCaller({ goal: "confirm", persona: "cooperative", plan: ackPlan });
  assert.ok(await a.next(ctx(0)));
  assert.ok(await a.next(ctx(1, "Is that right?")));
  assert.ok(await a.next(ctx(2, "And this?"))); // 3rd "Yes." still allowed — acks are exempt
});

test("parseCallerTurn tolerates valid, malformed, and hangup args", () => {
  assert.deepEqual(parseCallerTurn('{"action":"say","utterance":"hello"}'), { action: "say", utterance: "hello" });
  assert.deepEqual(parseCallerTurn('{"action":"hangup","utterance":""}'), { action: "hangup", utterance: "" });
  assert.deepEqual(parseCallerTurn('{"action":"say","utterance":"hi there"} oops'), { action: "say", utterance: "hi there" }); // trailing junk -> regex fallback
  assert.equal(parseCallerTurn("not json at all").utterance, "");
});

test("plannerPrompt carries the goal, persona, and the agent's last line", () => {
  const p = plannerPrompt({ goal: "book a table", persona: "impatient", history: [], lastAgent: "We open at five.", turnIndex: 0 });
  assert.match(p, /book a table/);
  assert.match(p, /We open at five\./);
  assert.match(p, /impatient/);
});

test("plannerPrompt: impatient persona gets impatient tactics; IDs digit-by-digit but dates/money natural", () => {
  const imp = plannerPrompt({ goal: "g", persona: "impatient", history: [], lastAgent: "hi", turnIndex: 0 });
  assert.match(imp, /IMPATIENT STYLE/);
  assert.match(imp, /one digit at a time/); // identifiers digit-by-digit
  assert.match(imp, /eighty-nine dollars/); // but money/dates spoken naturally (counter-rule)
  // cooperative gets neither the impatient nor the red-team block
  assert.doesNotMatch(plannerPrompt({ goal: "g", persona: "cooperative", history: [], lastAgent: "hi", turnIndex: 0 }), /IMPATIENT STYLE/);
});

test("plannerPrompt requires an agent read-back before the caller hangs up done (M1)", () => {
  const p = plannerPrompt({ goal: "book a table", persona: "cooperative", history: [], lastAgent: "I'll take care of that.", turnIndex: 1 });
  assert.match(p, /CONFIRMED the action back to you/);
  assert.match(p, /do NOT hang up yet/i);
});

test("plannerPrompt adds a wrap-up instruction only on the final turn (H4)", () => {
  const base = { goal: "g", persona: "cooperative" as const, history: [], lastAgent: "hi", turnIndex: 7 };
  assert.doesNotMatch(plannerPrompt({ ...base }), /THIS IS YOUR LAST TURN/);
  assert.match(plannerPrompt({ ...base, final: true }), /THIS IS YOUR LAST TURN/);
});

test("plannerPrompt surfaces an agent mishearing so the caller can correct it", () => {
  const history: CallerExchange[] = [{ caller: "It's SUM4K9", agent: "Let me check.", heardAs: "It's some four cane" }];
  const p = plannerPrompt({ goal: "g", persona: "cooperative", history, lastAgent: "Let me check.", turnIndex: 1 });
  assert.match(p, /HEARD you say/);
  assert.match(p, /some four cane/);
  assert.match(p, /correct it/i);
});

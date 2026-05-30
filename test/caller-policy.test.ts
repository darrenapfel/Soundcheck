// Tests for the control-inversion caller layer (B): ScriptedCaller, GoalDrivenCaller,
// declarative barge-in, and the planner's tolerant arg parsing — all pure/offline.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ScriptedCaller, GoalDrivenCaller, type PlanFn, type CallerContext, type CallerExchange } from "../src/caller/policy.ts";
import { parseCallerTurn, plannerPrompt } from "../src/caller/planner.ts";
import type { Scenario } from "../src/types.ts";

const ctx = (turnIndex: number, lastAgent = "", history: CallerExchange[] = []): CallerContext => ({ turnIndex, lastAgent, history });

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

test("GoalDrivenCaller caps at maxTurns even if the brain never hangs up", async () => {
  const plan: PlanFn = async (input) => ({ action: "say", utterance: `unique line ${input.turnIndex}` });
  const c = new GoalDrivenCaller({ goal: "loop", persona: "cooperative", plan, maxTurns: 3 });
  assert.ok(await c.next(ctx(0)));
  assert.ok(await c.next(ctx(2)));
  assert.equal(await c.next(ctx(3)), null); // capped
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

test("plannerPrompt surfaces an agent mishearing so the caller can correct it", () => {
  const history: CallerExchange[] = [{ caller: "It's SUM4K9", agent: "Let me check.", heardAs: "It's some four cane" }];
  const p = plannerPrompt({ goal: "g", persona: "cooperative", history, lastAgent: "Let me check.", turnIndex: 1 });
  assert.match(p, /HEARD you say/);
  assert.match(p, /some four cane/);
  assert.match(p, /correct it/i);
});

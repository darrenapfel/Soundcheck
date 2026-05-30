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

test("GoalDrivenCaller hangs up when the brain repeats itself (no progress)", async () => {
  const plan: PlanFn = async () => ({ action: "say", utterance: "What are the specials?" });
  const c = new GoalDrivenCaller({ goal: "specials", persona: "cooperative", plan });
  assert.equal((await c.next(ctx(0)))?.text, "What are the specials?");
  assert.equal(await c.next(ctx(1, "We have salmon.")), null); // same line again -> stuck -> hang up
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

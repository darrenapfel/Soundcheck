// Regression-from-production (promoteTrace), offline + deterministic. Proves the self-improving
// loop CLOSES: a discovered failing call is frozen into a scripted regression that (a) reproduces
// the failure on the broken agent and (b) goes green on the fixed agent — so the suite grows with
// a real, durable test. (The discovery + tune steps are live; this pins the closure mechanics.)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadCassette } from "../src/capture/cassette.ts";
import { runGates } from "../src/gates/index.ts";
import { promoteTrace } from "../src/regress/index.ts";
import { TOOLS as SUPPORT_TOOLS } from "../examples/support/support.ts";
import { TOOLS as TABLETALK_TOOLS } from "../examples/tabletalk/tabletalk.ts";
import type { CapturedTurn, Scenario, Trace } from "../src/types.ts";

const turn = (callerSaid: string): CapturedTurn => ({ turn: 1, callerSaid, agentHeardCallerAs: "", agentText: "", agentSpokenHeardBack: "", toolCalls: [], ttfbMs: null, turnMs: 0 });
const traceWith = (turns: CapturedTurn[]): Trace => ({ scenario: "x", persona: "cooperative", autLabel: "a", turns });

const source = JSON.parse(readFileSync("examples/support/scenarios/reset-and-callback.json", "utf8")) as Scenario;
const failing = loadCassette("reset-and-callback", "support-bare"); // bare fails no_spoken_symbols + grounding
const fixed = loadCassette("reset-and-callback", "support-grounded"); // grounded passes every gate

test("promoteTrace freezes a failing call into a scripted regression carrying the same invariants", () => {
  const reg = promoteTrace(failing, source);
  assert.equal(reg.name, "reset-and-callback-regression");
  assert.ok(reg.turns.length > 0, "the caller's actual lines are frozen as scripted turns");
  assert.ok(reg.turns.every((t) => typeof t === "string" && t.length > 0));
  assert.equal((reg as { goal?: string }).goal, undefined, "no goal → deterministic scripted replay");
  assert.deepEqual(reg.assert, source.assert, "same invariants the failing call violated");
  assert.ok(["cooperative", "impatient", "adversarial"].includes(reg.persona)); // loadScenarios-valid
  assert.equal(promoteTrace(failing, reg).name, "reset-and-callback-regression", "idempotent on the name");
});

test("the promoted regression REPRODUCES the failure, and PASSES once the agent is fixed", () => {
  const reg = promoteTrace(failing, source);
  const broken = runGates(failing, reg, SUPPORT_TOOLS);
  assert.ok(broken.some((g) => !g.pass), "must reproduce the discovered failure on the broken agent");

  const green = runGates(fixed, reg, SUPPORT_TOOLS);
  assert.ok(green.every((g) => g.pass), "once the agent is fixed, the promoted regression goes green");
});

test("promoteTrace refuses a trace with no usable caller turns (no vacuous-green regression)", () => {
  assert.throws(() => promoteTrace(traceWith([]), source), /no usable caller turns/);
  assert.throws(() => promoteTrace(traceWith([turn("   ")]), source), /no usable caller turns/);
});

test("promoteTrace strips the barge-in marker so a scripted turn stays a sane utterance", () => {
  const reg = promoteTrace(traceWith([turn("book a table  ⟨interrupts⟩ actually make it Friday")]), source);
  assert.equal(reg.turns[0], "book a table");
});

test("self-improving-loop example: the live-promoted regression replays + reproduces the discovered failure", () => {
  // The committed artifact from the example's Phase 1 (discover → promote): a scripted regression
  // + cassette frozen from a real goal-driven run where the bare agent hallucinated a 2023 date.
  const reg = JSON.parse(readFileSync("examples/self-improving-loop/scenarios/book-this-saturday-regression.json", "utf8")) as Scenario;
  const t = loadCassette("book-this-saturday-regression", "tabletalk-bare");
  const grounding = runGates(t, reg, TABLETALK_TOOLS).find((g) => g.name === "grounding");
  assert.equal(grounding?.pass, false, "the discovered stale-date failure reproduces offline");
});

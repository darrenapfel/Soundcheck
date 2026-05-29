// Self-evaluation tests — Soundcheck checks its own caller, and the meta-suite has
// teeth (a deliberately broken Evaline must fail it). Offline, deterministic.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkCaller, brokenEvalineTurns } from "../src/selfeval/index.ts";
import type { Scenario } from "../src/types.ts";

const load = (name: string) => JSON.parse(readFileSync(`scenarios/${name}.json`, "utf8")) as Scenario;
const failed = (cs: ReturnType<typeof checkCaller>, name: string) => cs.find((c) => c.name === name && !c.pass);

test("the real cooperative caller passes every self-check", () => {
  const cs = checkCaller(load("book-modify-confirm"));
  assert.ok(cs.every((c) => c.pass), JSON.stringify(cs, null, 2));
});

test("the real impatient caller passes every self-check (persona applied)", () => {
  const cs = checkCaller(load("restaurant-info"));
  assert.ok(cs.every((c) => c.pass), JSON.stringify(cs, null, 2));
  assert.ok(cs.find((c) => c.name === "caller_in_persona")?.pass);
});

test("TEETH: a deliberately broken Evaline FAILS the self-suite", () => {
  const scenario = load("book-modify-confirm");
  const cs = checkCaller(scenario, brokenEvalineTurns(scenario));
  assert.ok(failed(cs, "caller_speaks_cleanly"), "must catch a caller that speaks markdown/symbols");
  assert.ok(failed(cs, "caller_preserves_goal"), "must catch a caller that drops the goal");
});

test("TEETH: persona check fails when an impatient caller shows no urgency", () => {
  const scenario = load("restaurant-info"); // persona: impatient
  const noUrgency = scenario.turns.map((t) => ({ text: t, voice: "aura-2-orion-en" })); // unstyled = no 'hurry'
  const cs = checkCaller(scenario, noUrgency);
  assert.ok(failed(cs, "caller_in_persona"), "impatient persona with no urgency markers must fail");
});

test("legitimate words like 'five-star' do NOT trip the voice-clean check", () => {
  const scenario = load("book-modify-confirm");
  const ok = scenario.turns.map((t, i) => ({ text: i === 0 ? "I heard you have a five-star patio" : t, voice: "aura-2-orion-en" }));
  const cs = checkCaller(scenario, ok);
  assert.ok(!failed(cs, "caller_speaks_cleanly"), "'five-star' is legitimate, not spoken markup");
});

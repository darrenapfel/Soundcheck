// SOUNDCHECK TESTS SOUNDCHECK — the standing CI proof that the harness catches what it claims.
// The generic gates are turned on deliberately-regressed builds and on correct ones:
//   - a buggy MockAUT build (restaurant domain, fully offline): must trip no_spoken_symbols + grounding
//   - the INSECURE support build (recorded cassette): must trip tool_sequence + forbidden_tool
//   - the BARE support build (recorded cassette): must trip no_spoken_symbols + grounding
//   - the matching CORRECT builds must pass EVERY gate (no false alarms)
// Plus a COVERAGE CONTRACT: across the regressed builds, every core safety/correctness gate family
// is shown CATCHING at least one real regression. If a gate ever silently stops catching — a band-aid,
// a broken refactor, a re-recorded cassette that lost the fault — CI goes red here. Deterministic,
// no key, no network. (The schema/spoken-value/latency gates have their own teeth in gates.test.ts.)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MockAUTAdapter } from "../src/adapters/mock-aut.ts";
import { evalineTurns } from "../src/caller/evaline.ts";
import { buildTranscript } from "../src/capture/transcript.ts";
import { loadCassette } from "../src/capture/cassette.ts";
import { runGates } from "../src/gates/index.ts";
import { makeConfig } from "../examples/tabletalk/tabletalk.ts";
import { TOOLS as SUPPORT_TOOLS } from "../examples/support/support.ts";
import type { GateResult, Scenario } from "../src/types.ts";

const caughtFamilies = (gates: GateResult[]) => new Set(gates.filter((g) => !g.pass).map((g) => g.name.split(":")[0]));

// --- Regressed build #1: a buggy NON-Deepgram (Mock) agent, fully offline ---
const bookScenario = JSON.parse(readFileSync("scenarios/book-modify-confirm.json", "utf8")) as Scenario;
const mockAut = makeConfig("self-test", "be nice");
const noNetwork = async () => { throw new Error("STT must not be called for the mock adapter"); };
async function mockGates(buggy: boolean): Promise<GateResult[]> {
  const raw = await new MockAUTAdapter({ buggy }).runConversation(mockAut, evalineTurns(bookScenario));
  const t = await buildTranscript(bookScenario, buggy ? "self-test-buggy" : "self-test-clean", raw, noNetwork);
  return runGates(t, bookScenario, mockAut.tools);
}

// --- Regressed builds #2/#3: recorded support builds (the gates run on the persisted Trace) ---
function supportGates(scenarioName: string, autLabel: string): GateResult[] {
  const scenario = JSON.parse(readFileSync(`examples/support/scenarios/${scenarioName}.json`, "utf8")) as Scenario;
  return runGates(loadCassette(scenarioName, autLabel), scenario, SUPPORT_TOOLS);
}

test("SELF-TEST: a CORRECT build passes every gate (no false alarms)", async () => {
  assert.ok((await mockGates(false)).every((g) => g.pass), "clean mock build must pass all gates");
  assert.ok(supportGates("reset-and-callback", "support-grounded").every((g) => g.pass), "grounded support build must pass all gates");
});

test("SELF-TEST: the generic gates CATCH a deliberately-regressed build", async () => {
  const buggyMock = caughtFamilies(await mockGates(true));
  assert.ok(buggyMock.has("no_spoken_symbols"), "buggy mock: spoken markdown must be caught");
  assert.ok(buggyMock.has("grounding"), "buggy mock: stale/hallucinated date must be caught");

  const insecure = caughtFamilies(supportGates("frustrated-reset", "support-insecure"));
  assert.ok(insecure.has("tool_sequence"), "insecure support: reset-before-verify must be caught");
  assert.ok(insecure.has("forbidden_tool"), "insecure support: account deletion must be caught");

  const bare = caughtFamilies(supportGates("reset-and-callback", "support-bare"));
  assert.ok(bare.has("no_spoken_symbols"), "bare support: spoken markdown must be caught");
  assert.ok(bare.has("grounding"), "bare support: ungrounded date must be caught");
});

test("SELF-TEST coverage contract: every core safety gate family is shown CATCHING a real regression", async () => {
  const caughtAcross = new Set<string>([
    ...caughtFamilies(await mockGates(true)),
    ...caughtFamilies(supportGates("frustrated-reset", "support-insecure")),
    ...caughtFamilies(supportGates("reset-and-callback", "support-bare")),
    ...caughtFamilies(supportGates("adversarial-discovery", "support-insecure")), // the M7 red-team discovery
  ]);
  const CORE_SAFETY = ["no_spoken_symbols", "grounding", "tool_sequence", "forbidden_tool"];
  for (const family of CORE_SAFETY) {
    assert.ok(caughtAcross.has(family), `the self-test has LOST TEETH for '${family}' — no regressed build trips it anymore`);
  }
});

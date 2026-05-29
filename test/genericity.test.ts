// Genericity proof — the SAME scenario + gates run against a NON-Deepgram adapter
// (MockAUTAdapter), fully offline (no key, no network). A throwing transcriber proves
// the mock path skips the STT round-trip. clean -> all gates pass; buggy -> gates catch it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MockAUTAdapter } from "../src/adapters/mock-aut.ts";
import { evalineTurns } from "../src/caller/evaline.ts";
import { buildTranscript } from "../src/capture/transcript.ts";
import { runGates } from "../src/gates/index.ts";
import { makeConfig } from "../examples/tabletalk/tabletalk.ts";
import type { Scenario } from "../src/types.ts";

const scenario = JSON.parse(readFileSync("scenarios/book-modify-confirm.json", "utf8")) as Scenario;
const aut = makeConfig("mock-target", "be nice");
const noNetwork = async () => { throw new Error("STT must not be called for a mock adapter"); };

async function gatesFor(buggy: boolean) {
  const turns = evalineTurns(scenario);
  const raw = await new MockAUTAdapter({ buggy }).runConversation(aut, turns);
  const transcript = await buildTranscript(scenario, buggy ? "mock-buggy" : "mock", raw, noNetwork);
  return runGates(transcript, scenario);
}
const find = (gs: Awaited<ReturnType<typeof gatesFor>>, n: string) => gs.find((g) => g.name.startsWith(n))!;

test("the full pipeline runs against a non-Deepgram adapter — clean mock passes every gate", async () => {
  const gates = await gatesFor(false);
  assert.ok(gates.every((g) => g.pass), "clean mock should pass all gates:\n" + JSON.stringify(gates, null, 2));
});

test("the SAME gates catch a buggy non-Deepgram agent (symbols + grounding)", async () => {
  const gates = await gatesFor(true);
  assert.equal(find(gates, "no_spoken_symbols").pass, false);
  assert.equal(find(gates, "grounding").pass, false);
});

// Unit tests for capture (buildTranscript with an injected transcriber) + pcmToWav.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTranscript } from "../src/capture/transcript.ts";
import { pcmToWav } from "../src/deepgram.ts";
import type { Scenario } from "../src/types.ts";
import type { RawTurn } from "../src/adapters/types.ts";

const scenario: Scenario = { name: "s", persona: "cooperative", turns: [], assert: [] };

function raw(audio: Buffer): RawTurn {
  return { callerSaid: "hi", agentHeardCallerAs: "hi", agentText: "TEXT", agentAudioPcm: audio, toolCalls: [], ttfbMs: 100, turnMs: 200 };
}

test("buildTranscript maps raw turns and round-trips audio via the injected transcriber", async () => {
  const calls: number[] = [];
  const fakeTranscribe = async (pcm: Buffer) => { calls.push(pcm.length); return `heard-${pcm.length}`; };
  const t = await buildTranscript(scenario, "aut-x", [raw(Buffer.alloc(10)), raw(Buffer.alloc(20))], fakeTranscribe);

  assert.equal(t.scenario, "s");
  assert.equal(t.autLabel, "aut-x");
  assert.equal(t.turns.length, 2);
  assert.deepEqual(t.turns.map((x) => x.turn), [1, 2]);
  assert.equal(t.turns[0].agentSpokenHeardBack, "heard-10");
  assert.equal(t.turns[1].agentSpokenHeardBack, "heard-20");
  assert.deepEqual(calls, [10, 20]); // transcriber called once per turn, in order
  assert.ok(t.turns[0].audioWav instanceof Buffer); // non-empty pcm -> wav attached
});

test("buildTranscript omits audioWav for an empty audio buffer", async () => {
  const t = await buildTranscript(scenario, "aut-x", [raw(Buffer.alloc(0))], async () => "");
  assert.equal(t.turns[0].audioWav, undefined);
});

test("pcmToWav wraps PCM in a valid RIFF/WAVE header", () => {
  const pcm = Buffer.alloc(160); // 80 samples @16-bit
  const wav = pcmToWav(pcm, 24000);
  assert.equal(wav.length, 44 + pcm.length);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.readUInt32LE(24), 24000); // sample rate in header
});

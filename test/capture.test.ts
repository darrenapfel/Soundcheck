// Unit tests for capture (buildTranscript with an injected transcriber) + pcmToWav.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTranscript } from "../src/capture/transcript.ts";
import { pcmToWav, resamplePcm16le } from "../src/deepgram.ts";
import type { Scenario } from "../src/types.ts";
import type { RawTurn } from "../src/adapters/types.ts";

const scenario: Scenario = { name: "s", persona: "cooperative", turns: [], assert: [] };

function raw(audio: Buffer, callerAudio?: Buffer): RawTurn {
  return { callerSaid: "hi", agentHeardCallerAs: "hi", agentText: "TEXT", agentAudioPcm: audio, callerAudioPcm: callerAudio, toolCalls: [], ttfbMs: 100, turnMs: 200 };
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

test("buildTranscript attaches caller audio + stitches a full-conversation WAV in order", async () => {
  const caller1 = Buffer.alloc(40, 1), agent1 = Buffer.alloc(60, 2);
  const caller2 = Buffer.alloc(20, 3), agent2 = Buffer.alloc(80, 4);
  const t = await buildTranscript(
    scenario, "aut-x",
    [raw(agent1, caller1), raw(agent2, caller2)],
    async (pcm) => `heard-${pcm.length}`,
  );
  // per-turn: both caller and agent WAVs attached
  assert.ok(t.turns[0].callerAudioWav instanceof Buffer);
  assert.ok(t.turns[0].audioWav instanceof Buffer);
  // stitched = caller1+agent1+caller2+agent2 PCM + one 44-byte WAV header
  const stitchedPcm = 40 + 60 + 20 + 80;
  assert.ok(t.fullConversationWav instanceof Buffer);
  assert.equal(t.fullConversationWav!.length, 44 + stitchedPcm);
  assert.equal(t.fullConversationWav!.toString("ascii", 0, 4), "RIFF");
});

test("buildTranscript yields no stitched audio when there is none (e.g. mock/replay)", async () => {
  const t = await buildTranscript(scenario, "aut-x", [raw(Buffer.alloc(0))], async () => "x");
  assert.equal(t.fullConversationWav, undefined);
  assert.equal(t.turns[0].callerAudioWav, undefined);
});

test("resamplePcm16le scales sample count by the rate ratio and is identity at equal rates", () => {
  const pcm = Buffer.alloc(320); // 160 samples @ 16-bit
  const up = resamplePcm16le(pcm, 16000, 24000);
  assert.equal(up.length / 2, Math.round((160 * 24000) / 16000)); // 240 samples
  const same = resamplePcm16le(pcm, 24000, 24000);
  assert.equal(same, pcm); // no-op at equal rates
});

test("pcmToWav wraps PCM in a valid RIFF/WAVE header", () => {
  const pcm = Buffer.alloc(160); // 80 samples @16-bit
  const wav = pcmToWav(pcm, 24000);
  assert.equal(wav.length, 44 + pcm.length);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.readUInt32LE(24), 24000); // sample rate in header
});

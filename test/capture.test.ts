// Unit tests for capture (buildTranscript with an injected transcriber), the oracle
// self-check over the recording, the resampler, and pcmToWav.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTranscript } from "../src/capture/transcript.ts";
import { pcmToWav, resamplePcm16le } from "../src/deepgram.ts";
import type { Scenario } from "../src/types.ts";
import type { RawTurn, ConversationCapture } from "../src/adapters/types.ts";

const scenario: Scenario = { name: "s", persona: "cooperative", turns: [], assert: [] };

function raw(audio: Buffer, callerAudio?: Buffer): RawTurn {
  return { callerSaid: "hi", agentHeardCallerAs: "hi", agentText: "TEXT", agentAudioPcm: audio, callerAudioPcm: callerAudio, toolCalls: [], ttfbMs: 100, turnMs: 200 };
}
const cap = (turns: RawTurn[], recordingPcm?: Buffer): ConversationCapture => ({ turns, recordingPcm });

test("buildTranscript maps turns and round-trips agent audio via the injected transcriber", async () => {
  const calls: number[] = [];
  const fakeTranscribe = async (pcm: Buffer) => { calls.push(pcm.length); return `heard-${pcm.length}`; };
  const t = await buildTranscript(scenario, "aut-x", cap([raw(Buffer.alloc(10)), raw(Buffer.alloc(20))]), fakeTranscribe);

  assert.equal(t.scenario, "s");
  assert.equal(t.autLabel, "aut-x");
  assert.equal(t.turns.length, 2);
  assert.deepEqual(t.turns.map((x) => x.turn), [1, 2]);
  assert.equal(t.turns[0].agentSpokenHeardBack, "heard-10");
  assert.equal(t.turns[1].agentSpokenHeardBack, "heard-20");
  assert.deepEqual(calls, [10, 20]); // transcriber called once per turn, in order (no recording => no extra call)
  assert.ok(t.turns[0].audioWav instanceof Buffer); // non-empty pcm -> wav attached
  assert.equal(t.recordingWav, undefined);
  assert.equal(t.oracleTranscript, undefined);
});

test("buildTranscript omits audioWav for an empty audio buffer", async () => {
  const t = await buildTranscript(scenario, "aut-x", cap([raw(Buffer.alloc(0))]), async () => "");
  assert.equal(t.turns[0].audioWav, undefined);
});

test("buildTranscript attaches per-turn caller + agent WAVs", async () => {
  const t = await buildTranscript(scenario, "aut-x", cap([raw(Buffer.alloc(60, 2), Buffer.alloc(40, 1))]), async (pcm) => `heard-${pcm.length}`);
  assert.ok(t.turns[0].callerAudioWav instanceof Buffer);
  assert.ok(t.turns[0].audioWav instanceof Buffer);
});

test("buildTranscript runs the ORACLE (STT) over the recording — the self-validation signal", async () => {
  const recording = Buffer.alloc(4800, 7); // 0.1s of 24kHz audio
  const seen: number[] = [];
  const fake = async (pcm: Buffer) => { seen.push(pcm.length); return `stt-${pcm.length}`; };
  const t = await buildTranscript(scenario, "aut-x", cap([raw(Buffer.alloc(20))], recording), fake);
  assert.ok(t.recordingWav instanceof Buffer);
  assert.equal(t.recordingWav!.toString("ascii", 0, 4), "RIFF");
  assert.equal(t.oracleTranscript, `stt-${recording.length}`); // the recording was transcribed
  assert.ok(seen.includes(recording.length));
});

test("buildTranscript yields no recording/oracle when the capture has none (mock/replay)", async () => {
  const t = await buildTranscript(scenario, "aut-x", cap([raw(Buffer.alloc(0))]), async () => "x");
  assert.equal(t.recordingWav, undefined);
  assert.equal(t.oracleTranscript, undefined);
  assert.equal(t.turns[0].callerAudioWav, undefined);
});

test("buildTranscript carries terminationReason + goalDriven from the capture onto the Trace (round-4 P2)", async () => {
  // the goal_reached gate depends on these surviving capture -> Trace, so pin it.
  const driven: ConversationCapture = { turns: [raw(Buffer.alloc(10))], terminationReason: "turn_cap", goalDriven: true };
  const t = await buildTranscript(scenario, "aut-x", driven, async () => "x");
  assert.equal(t.terminationReason, "turn_cap");
  assert.equal(t.goalDriven, true);
  // absent when the capture omits them (the scripted/mock fixed-list path)
  const t2 = await buildTranscript(scenario, "aut-x", cap([raw(Buffer.alloc(10))]), async () => "x");
  assert.equal(t2.terminationReason, undefined);
  assert.equal(t2.goalDriven, undefined);
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

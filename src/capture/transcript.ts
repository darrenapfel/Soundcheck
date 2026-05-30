// Capture: round-trip the AUT's spoken audio back through STT so gates/judge see
// what a listener actually HEARS (not the model's text), assemble the Transcript, and
// — for a live recording — run the oracle (STT) over the WHOLE call so Soundcheck
// self-validates what really happened, in order, overlaps and all.

import { transcribe, pcmToWav } from "../deepgram.ts";
import type { CapturedTurn, Scenario, Transcript } from "../types.ts";
import type { ConversationCapture } from "../adapters/types.ts";

const PLAYBACK_RATE = 24000; // caller (upsampled) + agent + the mixed recording all live here

/** STT a chunk of audio. `transcribeFn` is injectable so capture is unit-testable offline. */
export type TranscribeFn = (pcm: Buffer) => Promise<string>;
const defaultTranscribe: TranscribeFn = (pcm) =>
  transcribe(pcm, { encoding: "linear16", sampleRate: PLAYBACK_RATE, contentType: "audio/l16" });

export async function buildTranscript(
  scenario: Scenario,
  autLabel: string,
  cap: ConversationCapture,
  transcribeFn: TranscribeFn = defaultTranscribe,
): Promise<Transcript> {
  const turns: CapturedTurn[] = [];
  for (let i = 0; i < cap.turns.length; i++) {
    const r = cap.turns[i];
    // Audio adapters round-trip through STT; text/mock adapters supply heard text directly.
    const heard = r.agentSpokenHeardBack ?? (await transcribeFn(r.agentAudioPcm));
    const callerPcm = r.callerAudioPcm;
    turns.push({
      turn: i + 1,
      callerSaid: r.callerSaid,
      agentHeardCallerAs: r.agentHeardCallerAs,
      agentText: r.agentText,
      agentSpokenHeardBack: heard,
      toolCalls: r.toolCalls,
      ttfbMs: r.ttfbMs,
      turnMs: r.turnMs,
      audioWav: r.agentAudioPcm.length ? pcmToWav(r.agentAudioPcm, PLAYBACK_RATE) : undefined,
      callerAudioWav: callerPcm?.length ? pcmToWav(callerPcm, PLAYBACK_RATE) : undefined,
    });
  }
  // The real-time mixed recording is the ground truth: play it in the report, and run the
  // oracle over it so the report shows "what Soundcheck actually heard, in order."
  const rec = cap.recordingPcm;
  const recordingWav = rec?.length ? pcmToWav(rec, PLAYBACK_RATE) : undefined;
  const oracleTranscript = rec?.length ? await transcribeFn(rec) : undefined;
  return { scenario: scenario.name, persona: scenario.persona, autLabel, turns, recordingWav, oracleTranscript };
}

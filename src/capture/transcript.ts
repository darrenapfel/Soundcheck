// Capture: round-trip the AUT's spoken audio back through STT so gates/judge see
// what a listener actually HEARS (not the model's text), and assemble the Transcript.

import { transcribe, pcmToWav } from "../deepgram.ts";
import type { CapturedTurn, Scenario, Transcript } from "../types.ts";
import type { RawTurn } from "../adapters/types.ts";

const PLAYBACK_RATE = 24000; // caller (upsampled) + agent both land here, so stitching is pure concat

/** Round-trips the AUT's spoken audio back through STT to get the "heard" text.
 *  `transcribeFn` is injectable so capture is unit-testable without the network. */
export type TranscribeFn = (pcm: Buffer) => Promise<string>;
const defaultTranscribe: TranscribeFn = (pcm) =>
  transcribe(pcm, { encoding: "linear16", sampleRate: 24000, contentType: "audio/l16" });

export async function buildTranscript(
  scenario: Scenario,
  autLabel: string,
  raw: RawTurn[],
  transcribeFn: TranscribeFn = defaultTranscribe,
): Promise<Transcript> {
  const turns: CapturedTurn[] = [];
  const stitched: Buffer[] = []; // caller→agent PCM in order, for one full-conversation WAV
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    // Audio adapters round-trip through STT; text/mock adapters supply heard text directly.
    const heard = r.agentSpokenHeardBack ?? (await transcribeFn(r.agentAudioPcm));
    const callerPcm = r.callerAudioPcm;
    if (callerPcm?.length) stitched.push(callerPcm);
    if (r.agentAudioPcm.length) stitched.push(r.agentAudioPcm);
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
  const fullConversationWav = stitched.length ? pcmToWav(Buffer.concat(stitched), PLAYBACK_RATE) : undefined;
  return { scenario: scenario.name, persona: scenario.persona, autLabel, turns, fullConversationWav };
}

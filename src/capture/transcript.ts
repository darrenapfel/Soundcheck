// Capture: round-trip the AUT's spoken audio back through STT so gates/judge see
// what a listener actually HEARS (not the model's text), and assemble the Transcript.

import { transcribe, pcmToWav } from "../deepgram.ts";
import type { CapturedTurn, Scenario, Transcript } from "../types.ts";
import type { RawTurn } from "../adapters/types.ts";

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
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    const heard = await transcribeFn(r.agentAudioPcm);
    turns.push({
      turn: i + 1,
      callerSaid: r.callerSaid,
      agentHeardCallerAs: r.agentHeardCallerAs,
      agentText: r.agentText,
      agentSpokenHeardBack: heard,
      toolCalls: r.toolCalls,
      ttfbMs: r.ttfbMs,
      turnMs: r.turnMs,
      audioWav: r.agentAudioPcm.length ? pcmToWav(r.agentAudioPcm, 24000) : undefined,
    });
  }
  return { scenario: scenario.name, persona: scenario.persona, autLabel, turns };
}

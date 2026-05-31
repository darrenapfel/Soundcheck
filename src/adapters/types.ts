import type { AUTConfig, ToolCall, TerminationReason } from "../types.ts";

/** One caller utterance Evaline will speak (text + the voice that conveys the persona). */
export interface CallerTurn {
  text: string;
  voice: string;
}

/** Raw per-turn capture from a conversation, before the round-trip STT step. */
export interface RawTurn {
  callerSaid: string;
  agentHeardCallerAs: string;
  agentText: string;
  agentAudioPcm: Buffer; // the AUT's spoken output, linear16 @ 24kHz (empty for text/mock adapters)
  /** Evaline's spoken audio for this turn, linear16 @ 24kHz (for report playback).
   *  Optional: text/mock adapters don't produce caller audio. */
  callerAudioPcm?: Buffer;
  toolCalls: ToolCall[];
  ttfbMs: number | null;
  turnMs: number | null;
  /** If an adapter already knows what was "heard" (text/mock adapters, or a runtime
   *  that returns its own transcript), it sets this and capture SKIPS the STT round-trip. */
  agentSpokenHeardBack?: string;
}

/**
 * The full result of driving one conversation: the per-turn captures plus — for LIVE
 * adapters — a faithful, MIXED recording of the whole call (caller + agent overlaid at
 * playback-paced timing — the pump plays agent audio out at 1× real time, phone-call
 * style — 24kHz mono). Within a turn the timing is true (caller speech, the agent's real
 * response, barge-in overlaps); the INTER-turn gap while a goal-driven caller's brain decides
 * its next line is excluded (that is harness latency, not the call — a real caller answers
 * promptly). This recording is the ground truth: the report plays it and Soundcheck's own
 * oracle (STT) transcribes it to self-validate. Mock adapters omit it.
 */
export interface ConversationCapture {
  turns: RawTurn[];
  recordingPcm?: Buffer; // real-time mixed call audio @ 24kHz linear16 (live adapters only)
  /** Why the driving Caller ended the call (Phase 1). Set by adapters that drive a Caller
   *  (the reactive `converse` loop); omitted by the fixed-list `runConversation` path. */
  terminationReason?: TerminationReason;
  /** True iff a goal-driven Caller drove this call (vs. scripted) — threaded onto the Trace so
   *  the `goal_reached` gate can guard forced `--caller goal` runs. Set by the `converse` loop. */
  goalDriven?: boolean;
}

/**
 * An adapter knows how to stand up + drive one agent-under-test. v0 ships the
 * Deepgram Voice Agent adapter; the interface is what lets Vapi/Retell/OpenAI
 * Realtime/SIP be added later without touching the gates, judge, or report.
 */
export interface AUTAdapter {
  label: string;
  runConversation(aut: AUTConfig, callerTurns: CallerTurn[]): Promise<ConversationCapture>;
}

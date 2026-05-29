import type { AUTConfig, ToolCall } from "../types.ts";

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
  toolCalls: ToolCall[];
  ttfbMs: number | null;
  turnMs: number | null;
  /** If an adapter already knows what was "heard" (text/mock adapters, or a runtime
   *  that returns its own transcript), it sets this and capture SKIPS the STT round-trip. */
  agentSpokenHeardBack?: string;
}

/**
 * An adapter knows how to stand up + drive one agent-under-test. v0 ships the
 * Deepgram Voice Agent adapter; the interface is what lets Vapi/Retell/OpenAI
 * Realtime/SIP be added later without touching the gates, judge, or report.
 */
export interface AUTAdapter {
  label: string;
  runConversation(aut: AUTConfig, callerTurns: CallerTurn[]): Promise<RawTurn[]>;
}

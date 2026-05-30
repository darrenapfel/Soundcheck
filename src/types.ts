// Core Soundcheck types.

export type Persona = "cooperative" | "impatient" | "adversarial";

/** A declarative test case: how Evaline calls, and how we judge the result. */
export interface Scenario {
  name: string;
  persona: Persona;
  /** Caller utterances, in order (v0 is scripted; goal-driven is v1). */
  turns: string[];
  /** Deterministic gate specs (strings or {gate: params}) — domain-agnostic invariants. */
  assert: AssertSpec[];
  /** Goal-driven caller (B): when set and selected, Evaline improvises toward this goal
   *  instead of replaying `turns`. Live-only (a brain decides each line); not for cassettes. */
  goal?: string;
  /** Declarative barge-in (B): after `afterTurn`, the scripted caller speaks `text` OVER
   *  the agent `afterMs` after it starts replying — to test interruption handling. */
  bargeIn?: { afterTurn: number; text: string; afterMs: number };
}

/** A declarative gate spec — a domain-agnostic invariant the registry enforces.
 *  Bare strings are param-less gates; objects carry the gate's params. */
export type AssertSpec =
  | "no_spoken_symbols"
  | "no_spoken_cardinal_ids"
  | { required_tool: string }
  | { forbidden_tool: string }
  | { tool_sequence: [string, "before", string] }
  | { tool_args_match_schema: string }
  | { spoken_matches_tool: { tool: string; field: string } }
  | { grounding: { tool?: string; field?: string; now: string; expected: string } }
  | { latency: { ttfb_ms?: { max: number }; turn_ms?: { max: number } } };

/** A tool the agent-under-test exposes (Deepgram VA function schema). */
export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** Everything needed to stand up + drive an agent-under-test. */
export interface AUTConfig {
  label: string;
  systemPrompt: string;
  tools: ToolSchema[];
  /** Deterministic stubs so tool calls return plausible data (no real DB in v0). */
  toolStubs: Record<string, (args: Record<string, unknown>) => unknown>;
  voice?: string; // aura model for the AUT's speech
  listenModel?: string; // nova model
  think?: { type: string; model: string; temperature?: number };
  greeting?: string;
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
}

export interface CapturedTurn {
  turn: number;
  callerSaid: string;
  agentHeardCallerAs: string; // the AUT's STT of Evaline
  agentText: string; // the AUT model's text reply
  agentSpokenHeardBack: string; // AUT spoken audio -> STT (what a listener hears)
  toolCalls: ToolCall[];
  ttfbMs: number | null; // caller-stop -> first agent audio frame
  turnMs: number | null; // caller-stop -> turn settle
  audioWav?: Buffer; // agent audio for this turn, WAV-wrapped (for the report)
  callerAudioWav?: Buffer; // Evaline's audio for this turn, WAV-wrapped (for the report)
}

export interface Trace {
  scenario: string;
  persona: Persona;
  autLabel: string;
  turns: CapturedTurn[];
  /** The real-time MIXED recording of the whole call (caller + agent overlaid at true
   *  timing), 24kHz WAV — the ground-truth audio the report plays. Live runs only. */
  recordingWav?: Buffer;
  /** Soundcheck's own oracle (STT) over the recording: what was actually heard, in order.
   *  The self-validation signal — present whenever recordingWav is. */
  oracleTranscript?: string;
}

export interface GateResult {
  name: string;
  pass: boolean;
  detail: string;
}

export interface ScenarioResult {
  transcript: Trace;
  gates: GateResult[];
  passed: boolean; // all deterministic gates passed (gates are the hard gate)
  verdict?: import("./judge/types.ts").Verdict; // advisory LLM-judge scores (optional)
}

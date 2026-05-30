// Core Soundcheck types.

export type Persona = "cooperative" | "impatient" | "adversarial";

/** Why a driven call ended (caller termination integrity, CALLER_GAPS Phase 1).
 *  `goal_met` is the ONLY clean end for a goal-driven scenario; the others are surfaced on
 *  the Trace so a forced/aborted end can't be read as a satisfied caller:
 *   - goal_met        : the brain ended because the goal was accomplished.
 *   - turn_cap        : the goal-driven turn budget was reached (one wrap-up turn was given).
 *   - planner_error   : Evaline's brain failed (timeout / WS / empty plan) repeatedly — an
 *                       infra blip on the caller's side, NOT a satisfied caller.
 *   - repeat_guard    : the caller looped (same line 3×) and was stopped.
 *   - script_exhausted: a scripted caller played its whole tape (the normal scripted end). */
export type TerminationReason = "goal_met" | "turn_cap" | "planner_error" | "repeat_guard" | "script_exhausted";

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
  /** Live-only (no replay cassette): a goal-driven scenario whose lines an LLM improvises, so
   *  it can't be replayed deterministically. `run --replay` skips it (and says so); a live run
   *  exercises it. Set on goal-driven demo scenarios. */
  liveOnly?: boolean;
  /** Fixture-only: an authoring/tuning input or generated demo (e.g. `author`/`tune` examples)
   *  that intentionally ships WITHOUT a cassette — it is not part of the offline replay demo
   *  set. `run --replay` skips it (and says so); a live run exercises it. The example-contract
   *  test treats `liveOnly | fixtureOnly | has-a-cassette` as the three valid states. */
  fixtureOnly?: boolean;
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
  /** Stubs that return tool results. Real agents back these with DB/API calls, so a handler
   *  may be async; the adapter awaits it and records a structured error if it throws. */
  toolStubs: Record<string, (args: Record<string, unknown>) => unknown | Promise<unknown>>;
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
  /** Why the caller ended the call (Phase 1). For a goal-driven scenario, only `goal_met` is a
   *  clean end; a non-`goal_met` reason fails the synthetic `goal_reached` gate (see runGates).
   *  Undefined for legacy cassettes / paths that don't drive a Caller. */
  terminationReason?: TerminationReason;
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

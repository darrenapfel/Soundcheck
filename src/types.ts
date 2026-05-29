// Core Soundcheck types.

export type Persona = "cooperative" | "impatient";

/** A declarative test case: how Evaline calls, and how we judge the result. */
export interface Scenario {
  name: string;
  persona: Persona;
  /** Caller utterances, in order (v0 is scripted; goal-driven is v1). */
  turns: string[];
  /** Deterministic gate specs (strings or {gate: params}). */
  assert: AssertSpec[];
  /** Grounding parameters a developer/agent supplies (today + the resolved target date). */
  grounding?: { today: string; expectedDate: string };
}

export type AssertSpec =
  | string
  | { required_tool: string }
  | { value_consistency: { spoken: "date"; equalsTool: string } }
  | { latency: { ttfb_ms?: { max: number }; turn_ms?: { max: number } } }
  | { tool_arg_iso: string }
  | { grounding: { tool: string } };

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
}

export interface Transcript {
  scenario: string;
  persona: Persona;
  autLabel: string;
  turns: CapturedTurn[];
}

export interface GateResult {
  name: string;
  pass: boolean;
  detail: string;
}

export interface ScenarioResult {
  transcript: Transcript;
  gates: GateResult[];
  passed: boolean; // all deterministic gates passed
}

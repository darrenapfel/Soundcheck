// Soundcheck — public API surface.
//
// One front door for consumers (and Deepgram) who extend the harness: import from
// "soundcheck" rather than reaching into deep src/ paths. Everything re-exported here is a
// supported extension point — a custom gate, adapter, judge backend, fixer, or caller.
// (Internal helpers — e.g. src/selfeval/ — are intentionally NOT re-exported.)

// Core data model — Scenario, Trace, AUTConfig, AssertSpec, ToolSchema, ScenarioResult, …
export * from "./types.ts";

// Assess — declarative gate registry. Add a gate: write a GateFn, register it, done.
export { runGates, GATE_NAMES, type GateFn, type GateContext } from "./gates/index.ts";

// Adapters — drive any voice agent. Implement AUTAdapter to add a runtime.
export type { AUTAdapter, CallerTurn, RawTurn, ConversationCapture } from "./adapters/types.ts";
export { DeepgramVoiceAgentAdapter } from "./adapters/deepgram-va.ts";
export { MockAUTAdapter } from "./adapters/mock-aut.ts";

// Caller (Evaline) — scripted or goal-driven. Plug a PlanFn to swap the brain.
export {
  PERSONA_VOICE, ScriptedCaller, GoalDrivenCaller,
  type Caller, type CallerAction, type CallerContext, type CallerExchange,
  type PlanFn, type PlanInput, type PlanDecision,
} from "./caller/policy.ts";
export { deepgramVaPlanner, plannerPrompt } from "./caller/planner.ts";
export { evalineTurns } from "./caller/evaline.ts";

// Capture — build a Trace from a conversation; persist/replay it as a cassette.
export { buildTranscript, type TranscribeFn } from "./capture/transcript.ts";
export { saveCassette, loadCassette, hasCassette, cassettePath, TRACE_VERSION } from "./capture/cassette.ts";

// Judge — advisory LLM scoring. Implement JudgeBackend to add a grader.
export { judgeTranscript, mockJudge, DEFAULT_RUBRIC, aggregateVerdicts } from "./judge/index.ts";
export { makeDeepgramVaJudge, deepgramVaJudge } from "./judge/deepgram-va-judge.ts";

// Calibration — judge-alignment loop (trust verdict, cross-model corroboration, drift guard).
export { calibrate, crossModelAlign, formatReport, formatAlignment } from "./calibration/index.ts";

// Refine — trace-driven tuning (Goodhart held-out guard). Plug a ProposeFn fixer.
export { tune, diagnose, formatTuneResult, type ProposeFn, type EvaluateFn } from "./tune/index.ts";

// Author — generate a scenario suite from an agent's spec.
export { authorSuite } from "./author/index.ts";

// Bake-off — diff one suite across two configs.
export { compareRuns, formatBakeoff } from "./bakeoff/index.ts";

// Regression-from-production — freeze a discovered failure into a permanent regression scenario.
export { promoteTrace } from "./regress/index.ts";

// Report — self-contained HTML scorecard with embedded audio.
export { generateReport } from "./report/html.ts";

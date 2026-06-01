// Machine-readable failure contract for `soundcheck run --json`.
//
// A coding agent (or a CI step) consumes THIS — a stable, `schema`-versioned shape — instead of
// scraping the HTML report or parsing stdout. It is the "ears for coding agents" payload: what the
// oracle heard, which invariants failed, the trace-driven evidence + a remediation hint per failure
// (reused from the same `diagnose()` the tune loop feeds its fixer), and a `reproduce` command that
// re-runs just that scenario so the agent can iterate cheaply. Pure and I/O-free, so it is unit-
// testable without a live call.

import type { ScenarioResult, Persona, TerminationReason } from "../types.ts";
import { diagnose, type Diagnosis } from "../tune/diagnose.ts";

/** Bump on a breaking change to the shape below; additive fields don't bump it. */
export const CONTRACT_SCHEMA = 1;

export interface JsonScenarioReport {
  name: string;
  persona: Persona;
  passed: boolean;
  /** Why the caller ended (goal-driven runs); absent for scripted/replay paths that don't tag it. */
  terminationReason?: TerminationReason;
  /** What Soundcheck's oracle (STT over the real recording) heard — the sensory evidence. Absent
   *  when there is no recording to transcribe (e.g. some replay cassettes). */
  oracleHeard?: string;
  gates: { name: string; pass: boolean; detail: string }[];
  /** Empty when passed. Otherwise, per failing gate: the trace evidence (`problem`) + a `hint` —
   *  the same root-cause the `tune` fixer reads, so an agent can patch from evidence, not gate names. */
  diagnosis: Diagnosis[];
  /** Advisory LLM-judge scores, present only when the run used `--judge`. Never gating. */
  judge?: { backend: string; dimensions: { key: string; value: boolean | number | null; why: string }[]; findings: string[] };
  /** A targeted re-run of just this scenario, in the same mode — the agent's iteration loop. */
  reproduce: string;
}

export interface JsonReport {
  soundcheck: string; // package version
  schema: number; // CONTRACT_SCHEMA
  generatedAt: string; // ISO timestamp
  aut: string; // agent-under-test label
  mode: string; // live | replay (offline) | mock (offline) | …
  summary: {
    total: number;
    passed: number;
    failed: number;
    ok: boolean; // every scenario passed (matches the process exit code: 0 iff ok)
    /** Deduped failing gate classes across the run (e.g. ["grounding","forbidden_tool"]) — a quick
     *  failure taxonomy for an agent to triage what kind of fix is needed. */
    failingGates: string[];
  };
  reportPath?: string; // the companion HTML report
  scenarios: JsonScenarioReport[];
}

export interface JsonReportMeta {
  version: string;
  generatedAt: string;
  aut: string;
  mode: string;
  scenariosDir: string;
  autPath: string;
  reportPath?: string;
}

function reproduceCmd(meta: JsonReportMeta, name: string): string {
  const flags = [`--aut ${meta.autPath}`, `--only ${name}`];
  if (meta.mode.startsWith("replay")) flags.push("--replay");
  else if (meta.mode.startsWith("mock")) flags.push("--adapter mock");
  return `soundcheck run ${meta.scenariosDir} ${flags.join(" ")}`;
}

/** Build the machine-readable report from the same `ScenarioResult[]` the human report uses. */
export function buildJsonReport(results: ScenarioResult[], meta: JsonReportMeta): JsonReport {
  const scenarios: JsonScenarioReport[] = results.map((r) => {
    const t = r.transcript;
    return {
      name: t.scenario,
      persona: t.persona,
      passed: r.passed,
      ...(t.terminationReason ? { terminationReason: t.terminationReason } : {}),
      ...(t.oracleTranscript ? { oracleHeard: t.oracleTranscript } : {}),
      gates: r.gates.map((g) => ({ name: g.name, pass: g.pass, detail: g.detail })),
      diagnosis: r.passed ? [] : diagnose(t, r.gates),
      ...(r.verdict
        ? { judge: { backend: r.verdict.backend, dimensions: r.verdict.dimensions.map((d) => ({ key: d.key, value: d.value, why: d.why })), findings: r.verdict.findings } }
        : {}),
      reproduce: reproduceCmd(meta, t.scenario),
    };
  });
  const passed = scenarios.filter((s) => s.passed).length;
  const failingGates = [
    ...new Set(results.flatMap((r) => r.gates.filter((g) => !g.pass).map((g) => g.name.split(":")[0]))),
  ];
  return {
    soundcheck: meta.version,
    schema: CONTRACT_SCHEMA,
    generatedAt: meta.generatedAt,
    aut: meta.aut,
    mode: meta.mode,
    summary: { total: scenarios.length, passed, failed: scenarios.length - passed, ok: passed === scenarios.length, failingGates },
    ...(meta.reportPath ? { reportPath: meta.reportPath } : {}),
    scenarios,
  };
}

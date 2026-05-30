// A CASSETTE is the persisted form of a Trace — coSTAR's "flight recorder" for a voice
// call: the structured per-turn record (heard text + tool calls + timings) PLUS the
// oracle's ground-truth STT of the whole recording. Audio (binary) is dropped to keep it
// small, reviewable, and binary-free. Gates AND the judge run on a loaded cassette OFFLINE
// (no socket, no model, no STT, no credits) — so you can iterate on judges/gates WITHOUT
// re-running the agent, and CI replays deterministically. (See docs/TESTING.md.)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { CapturedTurn, Persona, Trace } from "../types.ts";

export const CASSETTE_DIR = "fixtures/cassettes";
export const TRACE_VERSION = 2; // 2 adds oracleTranscript; v1 (without it) still loads
const SUPPORTED_VERSIONS = new Set([1, 2]);

interface CassetteFile {
  version: number;
  scenario: string;
  persona: Persona;
  autLabel: string;
  recordedAtNote: string; // human note; NOT a real timestamp (kept out for reproducible diffs)
  oracleTranscript?: string; // v2+: Soundcheck's own STT of the full recording (ground truth)
  turns: CapturedTurn[];
}

/** Scenario names + AUT labels become path segments, so a malicious one (e.g. from a PR-provided
 *  scenario) could escape the cassette dir. Allow only a conservative slug; reject separators + "..". */
export function safeSegment(value: string, kind = "name"): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value) || value.includes("..")) {
    throw new Error(`unsafe ${kind} "${value}" — use only letters, digits, dot, dash, underscore (no path separators or "..")`);
  }
  return value;
}

export function cassettePath(scenario: string, autLabel: string): string {
  const file = `${safeSegment(scenario, "scenario name")}.${safeSegment(autLabel, "AUT label")}.json`;
  const root = resolve(process.cwd(), CASSETTE_DIR);
  const p = resolve(root, file);
  if (p !== root && !p.startsWith(root + "/")) throw new Error(`cassette path escapes ${CASSETTE_DIR}: ${p}`); // defense in depth
  return p;
}

export function hasCassette(scenario: string, autLabel: string): boolean {
  return existsSync(cassettePath(scenario, autLabel));
}

/** Persist a Trace as a cassette. Audio is dropped; the oracle transcript (ground truth)
 *  and the per-turn heard text + tool trace + timings are kept — everything gates + the
 *  judge need, offline. */
export function saveCassette(t: Trace): void {
  mkdirSync(resolve(process.cwd(), CASSETTE_DIR), { recursive: true });
  const turns: CapturedTurn[] = t.turns.map((tn) => ({
    turn: tn.turn,
    callerSaid: tn.callerSaid,
    agentHeardCallerAs: tn.agentHeardCallerAs,
    agentText: tn.agentText,
    agentSpokenHeardBack: tn.agentSpokenHeardBack,
    toolCalls: tn.toolCalls,
    ttfbMs: tn.ttfbMs,
    turnMs: tn.turnMs,
    // audioWav / callerAudioWav omitted on purpose (small, reviewable, binary-free)
  }));
  const data: CassetteFile = {
    version: TRACE_VERSION,
    scenario: t.scenario,
    persona: t.persona,
    autLabel: t.autLabel,
    recordedAtNote: "recorded via `soundcheck run --record` (re-record only via reviewed PR)",
    ...(t.oracleTranscript ? { oracleTranscript: t.oracleTranscript } : {}),
    turns,
  };
  writeFileSync(cassettePath(t.scenario, t.autLabel), JSON.stringify(data, null, 2) + "\n");
}

export function loadCassette(scenario: string, autLabel: string): Trace {
  const path = cassettePath(scenario, autLabel);
  if (!existsSync(path)) {
    throw new Error(`no cassette for "${scenario}" (aut "${autLabel}") at ${path} — record one with: soundcheck run <dir> --aut <cfg> --record`);
  }
  const data = JSON.parse(readFileSync(path, "utf8")) as CassetteFile;
  if (!SUPPORTED_VERSIONS.has(data.version)) throw new Error(`cassette ${path} is version ${data.version}, supported: ${[...SUPPORTED_VERSIONS].join(", ")}`);
  return { scenario: data.scenario, persona: data.persona, autLabel: data.autLabel, turns: data.turns, oracleTranscript: data.oracleTranscript };
}

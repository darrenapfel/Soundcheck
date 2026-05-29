// Cassettes — record a captured Transcript so CI can REPLAY it deterministically
// (no socket, no model, no STT, no credits). A live `--record` run writes one; a
// `--replay` run loads it. This is what makes a stochastic tool trustworthy in CI
// and what makes "Soundcheck evaluates Soundcheck" reproducible. (See docs/TESTING.md.)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { CapturedTurn, Persona, Transcript } from "../types.ts";

export const CASSETTE_DIR = "fixtures/cassettes";
const CASSETTE_VERSION = 1;

interface CassetteFile {
  version: number;
  scenario: string;
  persona: Persona;
  autLabel: string;
  recordedAtNote: string; // human note; NOT a real timestamp (kept out for reproducible diffs)
  turns: CapturedTurn[];
}

export function cassettePath(scenario: string, autLabel: string): string {
  return resolve(process.cwd(), CASSETTE_DIR, `${scenario}.${autLabel}.json`);
}

export function hasCassette(scenario: string, autLabel: string): boolean {
  return existsSync(cassettePath(scenario, autLabel));
}

/** Persist a Transcript as a cassette. Audio (binary) is intentionally dropped —
 *  gates + judge operate on the heard text + tool trace + timings, never raw audio. */
export function saveCassette(t: Transcript): void {
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
    // audioWav omitted on purpose (keeps cassettes small, reviewable, binary-free)
  }));
  const data: CassetteFile = {
    version: CASSETTE_VERSION,
    scenario: t.scenario,
    persona: t.persona,
    autLabel: t.autLabel,
    recordedAtNote: "recorded via `soundcheck run --record` (re-record only via reviewed PR)",
    turns,
  };
  writeFileSync(cassettePath(t.scenario, t.autLabel), JSON.stringify(data, null, 2) + "\n");
}

export function loadCassette(scenario: string, autLabel: string): Transcript {
  const path = cassettePath(scenario, autLabel);
  if (!existsSync(path)) {
    throw new Error(`no cassette for "${scenario}" (aut "${autLabel}") at ${path} — record one with: soundcheck run <dir> --aut <cfg> --record`);
  }
  const data = JSON.parse(readFileSync(path, "utf8")) as CassetteFile;
  if (data.version !== CASSETTE_VERSION) throw new Error(`cassette ${path} is version ${data.version}, expected ${CASSETTE_VERSION}`);
  return { scenario: data.scenario, persona: data.persona, autLabel: data.autLabel, turns: data.turns };
}

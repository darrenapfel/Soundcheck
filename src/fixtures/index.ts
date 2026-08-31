// The committed audio round-trip corpus (fixtures/audio/) — manifest loading +
// the check / roundtrip / generate flows as library functions. The CLI
// `fixtures` command is a thin shell over these, matching the repo pattern.
//
// The corpus exists to verify the audio loop the oracle itself rides on:
// each fixture is a canonical sentence covering a known smart-formatting trap
// class (times, currency, dates, ordinals, digit identifiers, …). `check`
// transcribes the committed audio (smart-formatted) and gates it against the
// manifest text with the normalization-aware compare(); `roundtrip` does a
// fresh TTS→STT pass per fixture; `generate` (maintainers) re-records the
// audio and the observed transcripts. All three call the Deepgram API — the
// network layer stays in src/deepgram.ts (getKey/synthesize/transcribe).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { synthesize, transcribe } from "../deepgram.ts";
import { compare, type CompareResult } from "../compare/index.ts";

/** The package root (…/soundcheck), resolved module-relative so the corpus is
 *  found from any working directory — dev checkout and installed copy alike. */
const PACKAGE_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

export interface FixtureDefaults {
  tts_model: string;
  stt_model: string;
  encoding: string;
  sample_rate: number;
  container: string;
  smart_format: boolean;
}

export interface Fixture {
  id: string;
  traps: string[];
  text: string;
  /** Audio filename relative to fixtures/audio/ (e.g. "time-morning.wav"). */
  audio: string;
  notes?: string;
}

export interface FixtureManifest {
  defaults: FixtureDefaults;
  fixtures: Fixture[];
  root: string;
}

/**
 * Load fixtures/audio/manifest.json (relative to `rootDir`, default: the Soundcheck
 * package root; overridable for tests) and validate its shape.
 */
export function loadManifest(rootDir: string = PACKAGE_ROOT): FixtureManifest {
  const manifestPath = join(rootDir, "fixtures", "audio", "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    version?: unknown; defaults?: unknown; fixtures?: unknown;
  };

  if (manifest.version !== 1) {
    throw new Error(`unsupported fixture manifest version: ${String(manifest.version)}`);
  }
  if (!manifest.defaults || typeof manifest.defaults !== "object") {
    throw new Error("fixture manifest is missing the defaults object");
  }
  if (!Array.isArray(manifest.fixtures) || manifest.fixtures.length === 0) {
    throw new Error("fixture manifest has no fixtures");
  }

  const ids = new Set<string>();
  for (const f of manifest.fixtures as Record<string, unknown>[]) {
    for (const field of ["id", "text", "audio"] as const) {
      if (typeof f[field] !== "string" || !f[field]) {
        throw new Error(`fixture ${String(f.id ?? "(missing id)")} is missing the "${field}" field`);
      }
    }
    if (!Array.isArray(f.traps) || f.traps.length === 0) {
      throw new Error(`fixture ${String(f.id)} must declare at least one trap class`);
    }
    if (ids.has(f.id as string)) throw new Error(`duplicate fixture id: ${String(f.id)}`);
    ids.add(f.id as string);
  }

  return {
    defaults: manifest.defaults as FixtureDefaults,
    fixtures: manifest.fixtures as unknown as Fixture[],
    root: rootDir,
  };
}

/** Absolute path of a fixture's audio file. */
export function audioPath(manifest: FixtureManifest, fixture: Fixture): string {
  return join(manifest.root, "fixtures", "audio", fixture.audio);
}

/** True when the fixture's audio file exists on disk. */
export function audioExists(manifest: FixtureManifest, fixture: Fixture): boolean {
  return existsSync(audioPath(manifest, fixture));
}

/** One fixture's gate outcome: the compare() result plus what STT returned. A fixture whose
 *  audio file is missing carries `error` instead of a transcript (and counts as a failure). */
export type FixtureRow = CompareResult & {
  id: string;
  traps: string[];
  transcript: string;
  error?: string;
};

export interface FixtureRunSummary {
  rows: FixtureRow[];
  passed: number;
  total: number;
}

function gateRow(f: Fixture, transcript: string): FixtureRow {
  return { id: f.id, traps: f.traps, transcript, ...compare(f.text, transcript) };
}

/**
 * `fixtures check` — transcribe each COMMITTED audio file (smart-formatted) and gate it
 * against the manifest text. The cheap drift detector: a recognition-model formatting
 * change fires here first. Needs the key (network); use `onRow` for progress output.
 */
export async function checkFixtures(
  manifest: FixtureManifest,
  onRow?: (row: FixtureRow) => void,
): Promise<FixtureRunSummary> {
  const rows: FixtureRow[] = [];
  for (const f of manifest.fixtures) {
    let row: FixtureRow;
    if (!audioExists(manifest, f)) {
      row = {
        id: f.id, traps: f.traps, transcript: "",
        ...compare(f.text, ""), pass: false,
        error: `audio file missing (${f.audio}) — run "soundcheck fixtures generate" first`,
      };
    } else {
      const audio = readFileSync(audioPath(manifest, f));
      const transcript = await transcribe(audio, {
        model: manifest.defaults.stt_model,
        contentType: "audio/wav",
        smartFormat: manifest.defaults.smart_format,
      });
      row = gateRow(f, transcript);
    }
    rows.push(row);
    onRow?.(row);
  }
  return { rows, passed: rows.filter((r) => r.pass).length, total: rows.length };
}

/**
 * `fixtures roundtrip` — a FRESH text→TTS→STT round trip per fixture (nothing read from
 * disk), gated the same way. Verifies the live loop end to end, not just recognition
 * of the committed audio. Needs the key (network).
 */
export async function roundtripFixtures(
  manifest: FixtureManifest,
  onRow?: (row: FixtureRow) => void,
): Promise<FixtureRunSummary> {
  const d = manifest.defaults;
  const rows: FixtureRow[] = [];
  for (const f of manifest.fixtures) {
    const audio = await synthesize(f.text, {
      model: d.tts_model, encoding: d.encoding, sampleRate: d.sample_rate, container: d.container,
    });
    const transcript = await transcribe(audio, {
      model: d.stt_model, contentType: "audio/wav", smartFormat: d.smart_format,
    });
    const row = gateRow(f, transcript);
    rows.push(row);
    onRow?.(row);
  }
  return { rows, passed: rows.filter((r) => r.pass).length, total: rows.length };
}

export interface GeneratedFixture {
  id: string;
  bytes: number;
  observed: string;
}

/**
 * `fixtures generate` — maintainers only: (re)synthesize every fixture's audio into
 * fixtures/audio/ and record what smart formatting actually returned at generation time
 * in fixtures/audio/observed.json (documentation — never read by code). Needs the key.
 */
export async function generateFixtures(
  manifest: FixtureManifest,
  onGenerated?: (g: GeneratedFixture) => void,
): Promise<GeneratedFixture[]> {
  const d = manifest.defaults;
  mkdirSync(join(manifest.root, "fixtures", "audio"), { recursive: true });
  const generated: GeneratedFixture[] = [];
  for (const f of manifest.fixtures) {
    const audio = await synthesize(f.text, {
      model: d.tts_model, encoding: d.encoding, sampleRate: d.sample_rate, container: d.container,
    });
    writeFileSync(audioPath(manifest, f), audio);
    const observed = await transcribe(audio, {
      model: d.stt_model, contentType: "audio/wav", smartFormat: d.smart_format,
    });
    const g = { id: f.id, bytes: audio.length, observed };
    generated.push(g);
    onGenerated?.(g);
  }
  writeFileSync(
    join(manifest.root, "fixtures", "audio", "observed.json"),
    JSON.stringify({
      generated_at: new Date().toISOString(),
      tts_model: d.tts_model,
      stt_model: d.stt_model,
      observations: generated.map((g) => ({ id: g.id, observed: g.observed })),
    }, null, 2) + "\n",
  );
  return generated;
}

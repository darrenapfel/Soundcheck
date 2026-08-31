// The committed audio round-trip corpus — the manifest loads and validates, every
// fixture text tokenizes, every declared trap class is covered, and all 16 WAV
// files are present, committed, and really RIFF/WAVE audio. Offline, keyless.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadManifest, audioPath, audioExists } from "../src/fixtures/index.ts";
import { canonicalTokens } from "../src/compare/normalize.ts";

/** Write a manifest object into a scratch root under the OS temp dir (never inside the
 *  repo) and return the root for loadManifest(rootDir). Caller cleans up with rmSync. */
function scratchRoot(manifest: unknown): string {
  const root = mkdtempSync(join(tmpdir(), "soundcheck-manifest-test-"));
  mkdirSync(join(root, "fixtures", "audio"), { recursive: true });
  writeFileSync(join(root, "fixtures", "audio", "manifest.json"), JSON.stringify(manifest));
  return root;
}

const VALID_DEFAULTS = { tts_model: "aura-2-thalia-en", stt_model: "nova-3", encoding: "linear16", sample_rate: 24000, container: "wav", smart_format: true };
const VALID_FIXTURE = { id: "x", traps: ["time"], text: "at seven thirty", audio: "x.wav" };

test("the manifest loads and validates", () => {
  const manifest = loadManifest();
  assert.ok(manifest.fixtures.length >= 10);
  assert.equal(typeof manifest.defaults.tts_model, "string");
  assert.equal(typeof manifest.defaults.stt_model, "string");
  assert.equal(manifest.defaults.smart_format, true); // the corpus is gated smart-formatted
});

test("every fixture text produces a non-empty canonical token stream", () => {
  const manifest = loadManifest();
  for (const f of manifest.fixtures) {
    const tokens = canonicalTokens(f.text);
    assert.ok(tokens.length > 0, `fixture ${f.id} produced no tokens`);
  }
});

test("every declared trap class appears in at least one fixture", () => {
  const manifest = loadManifest();
  const covered = new Set(manifest.fixtures.flatMap((f) => f.traps));
  for (const trap of ["time", "currency", "number", "digits", "date", "ordinal",
    "year", "percent", "decimal", "punctuation", "control"]) {
    assert.ok(covered.has(trap), `no fixture covers the "${trap}" trap class`);
  }
});

test("a fixture audio value that is not a safe bare filename is rejected (no path traversal)", () => {
  for (const audio of ["../secret.wav", "..", "audio/x.wav", "/etc/passwd", "x .wav"]) {
    const root = scratchRoot({ version: 1, defaults: VALID_DEFAULTS, fixtures: [{ ...VALID_FIXTURE, audio }] });
    try {
      assert.throws(() => loadManifest(root), /not a safe bare filename/, `audio "${audio}" must be rejected`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("malformed defaults are rejected with the offending field named", () => {
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ ...VALID_DEFAULTS, stt_model: undefined }, /defaults\.stt_model/],
    [{ ...VALID_DEFAULTS, tts_model: "" }, /defaults\.tts_model/],
    [{ ...VALID_DEFAULTS, sample_rate: "24000" }, /sample_rate must be a positive number/],
    [{ ...VALID_DEFAULTS, sample_rate: -1 }, /sample_rate must be a positive number/],
    [{ ...VALID_DEFAULTS, smart_format: "true" }, /smart_format must be a boolean/],
  ];
  for (const [defaults, expected] of cases) {
    const root = scratchRoot({ version: 1, defaults, fixtures: [VALID_FIXTURE] });
    try {
      assert.throws(() => loadManifest(root), expected);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("all 16 fixture audio files are committed and are RIFF/WAVE audio", () => {
  const manifest = loadManifest();
  assert.equal(manifest.fixtures.length, 16);
  for (const f of manifest.fixtures) {
    assert.ok(audioExists(manifest, f), `fixture ${f.id} audio missing (${f.audio})`);
    const head = readFileSync(audioPath(manifest, f)).subarray(0, 12);
    assert.equal(head.subarray(0, 4).toString("ascii"), "RIFF", `${f.id}: not a RIFF file`);
    assert.equal(head.subarray(8, 12).toString("ascii"), "WAVE", `${f.id}: not a WAVE container`);
  }
});

// The committed audio round-trip corpus — the manifest loads and validates, every
// fixture text tokenizes, every declared trap class is covered, and all 16 WAV
// files are present, committed, and really RIFF/WAVE audio. Offline, keyless.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadManifest, audioPath, audioExists } from "../src/fixtures/index.ts";
import { canonicalTokens } from "../src/compare/normalize.ts";

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

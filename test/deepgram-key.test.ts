// getKey() hermeticity — an EXPLICITLY EMPTY DEEPGRAM_API_KEY (set but "", whitespace
// included) must short-circuit the whole resolution chain and throw immediately, never
// falling through to a CWD/.env, user-global, or package .env. CI systems set empty
// secrets to mean absent (the nightly workflow's guard treats an empty secret as "no
// key"), and the keyless CLI tests depend on this being deterministic even on a dev
// checkout that has a real repo-root .env. Offline, keyless.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getKey } from "../src/deepgram.ts";

test("an explicitly EMPTY DEEPGRAM_API_KEY short-circuits: throws immediately, ignoring a CWD .env", () => {
  // A scratch cwd whose .env DOES carry a (dummy, non-key-shaped) value: the short-circuit
  // must throw before any .env is consulted, so this value must never win.
  const dir = mkdtempSync(join(tmpdir(), "soundcheck-key-test-"));
  writeFileSync(join(dir, ".env"), "DEEPGRAM_API_KEY=dummy-value-for-the-short-circuit-test\n");
  const prevCwd = process.cwd();
  const prevEnv = process.env.DEEPGRAM_API_KEY;
  try {
    process.chdir(dir);
    process.env.DEEPGRAM_API_KEY = "";
    assert.throws(() => getKey(), /DEEPGRAM_API_KEY not set/, "empty string must mean absent");
    process.env.DEEPGRAM_API_KEY = "   ";
    assert.throws(() => getKey(), /DEEPGRAM_API_KEY not set/, "whitespace-only must mean absent");
  } finally {
    process.chdir(prevCwd);
    if (prevEnv === undefined) delete process.env.DEEPGRAM_API_KEY;
    else process.env.DEEPGRAM_API_KEY = prevEnv;
    rmSync(dir, { recursive: true, force: true });
  }
});

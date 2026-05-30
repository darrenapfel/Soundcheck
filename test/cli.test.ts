// CLI fail-closed behavior — a testing tool must never report green when it ran nothing.
// Spawns the real CLI offline (no key, no network) and asserts exit codes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const cli = (args: string[]) =>
  spawnSync("node", ["--experimental-strip-types", "src/cli.ts", ...args], { encoding: "utf8", cwd: process.cwd() });

test("run --only with no match FAILS CLOSED (exit 2), never green", () => {
  const r = cli(["run", "scenarios", "--aut", "examples/tabletalk/grounded.ts", "--replay", "--only", "zzz-no-such-scenario"]);
  assert.equal(r.status, 2, `expected exit 2, got ${r.status}\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /matched no scenarios/);
  assert.doesNotMatch(r.stdout, /all gates passed/);
});

test("bakeoff --only with no match FAILS CLOSED (exit 2), never a vacuous tie", () => {
  const r = cli(["bakeoff", "scenarios", "--a", "examples/tabletalk/grounded.ts", "--b", "examples/tabletalk/bare.ts", "--replay", "--only", "zzz-no-such-scenario"]);
  assert.equal(r.status, 2, `expected exit 2, got ${r.status}\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /matched no scenarios/);
});

test("a real replay run still works (exit 0 on a passing grounded suite)", () => {
  const r = cli(["run", "scenarios", "--aut", "examples/tabletalk/grounded.ts", "--replay", "--only", "book-modify-confirm", "--out", "/tmp/sc-cli-test.html"]);
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /all gates passed/);
});

test("replay SKIPS live-only (goal-driven) scenarios and still gates the scripted ones", () => {
  const r = cli(["run", "examples/support/scenarios", "--aut", "examples/support/grounded.ts", "--replay", "--out", "/tmp/sc-liveonly.html"]);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /adversarial-discovery: live-only/); // the goal-driven scenario was skipped
  assert.match(r.stdout, /all gates passed/);                 // the 2 scripted grounded scenarios still ran + passed
});

test("replay of an all-live-only suite FAILS CLOSED (exit 2), never a vacuous green", () => {
  const r = cli(["run", "examples/healthcare/scenarios", "--aut", "examples/healthcare/grounded.ts", "--replay"]);
  assert.equal(r.status, 2, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /0 scenarios replayed/);
  assert.doesNotMatch(r.stdout, /all gates passed/);
});

test("the GitHub Action's run shape works: SOUNDCHECK_CASSETTE_DIR override + run --aut --replay", () => {
  // Mirrors action.yml: `run <scenarios> --aut <aut> --replay` with the cassette dir from an env var.
  const r = spawnSync("node", ["--experimental-strip-types", "src/cli.ts", "run", "scenarios", "--aut", "examples/tabletalk/grounded.ts", "--replay", "--only", "book-modify-confirm", "--out", "/tmp/sc-action.html"],
    { encoding: "utf8", cwd: process.cwd(), env: { ...process.env, SOUNDCHECK_CASSETTE_DIR: "fixtures/cassettes" } });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /all gates passed/);
});

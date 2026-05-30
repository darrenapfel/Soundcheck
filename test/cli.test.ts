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

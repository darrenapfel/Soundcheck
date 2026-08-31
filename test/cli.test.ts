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

test("run --persona with an invalid value FAILS CLOSED (exit 2)", () => {
  const r = cli(["run", "scenarios", "--aut", "examples/tabletalk/grounded.ts", "--replay", "--persona", "grumpy"]);
  assert.equal(r.status, 2, `expected exit 2, got ${r.status}\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /not one of: cooperative, impatient, adversarial/);
});

test("compare passes a formatting-equivalent pair with exit 0 and names the tier", () => {
  const r = cli(["compare", "--expected", "at seven thirty", "--heard", "at 7:30"]);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /PASS \(canonical\)/);
});

test("compare fails a real content mismatch with exit 1 and a token-level diff", () => {
  const r = cli(["compare", "--expected", "at seven thirty", "--heard", "at 7:13"]);
  assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /FAIL/);
  assert.match(r.stdout, /"time:7:30" heard as "time:7:13"/);
});

test("compare --json emits ONE parseable JSON document alone on stdout (human output on stderr)", () => {
  const r = cli(["compare", "--expected", "fifteen percent", "--heard", "15%", "--json"]);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  const parsed = JSON.parse(r.stdout) as { schema: number; pass: boolean; tier: string }; // throws if stdout is not pure JSON
  assert.equal(parsed.schema, 1);
  assert.equal(parsed.pass, true);
  assert.equal(parsed.tier, "canonical");
  assert.match(r.stderr, /PASS/); // the human line moved to stderr
});

test("compare without --expected is a usage error (exit 2); an empty --heard is a legitimate failing input", () => {
  assert.equal(cli(["compare", "--heard", "at 7:30"]).status, 2);
  const empty = cli(["compare", "--expected", "at seven thirty", "--heard", ""]);
  assert.equal(empty.status, 1, "an empty transcript must GATE (fail), not be a usage error");
  assert.match(empty.stdout, /FAIL/);
});

test("an unknown fixtures subcommand exits 2 with usage", () => {
  const r = cli(["fixtures", "frobnicate"]);
  assert.equal(r.status, 2, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /fixtures <check\|roundtrip\|generate>/);
});

test("fixtures check with no resolvable key fails exit 2 with the key error, instantly (no network attempt)", () => {
  const started = Date.now();
  const r = spawnSync("node", ["--experimental-strip-types", "src/cli.ts", "fixtures", "check"], {
    encoding: "utf8", cwd: process.cwd(),
    // An explicitly EMPTY env key short-circuits getKey() entirely (pinned in
    // test/deepgram-key.test.ts), so this is deterministic even on a dev checkout whose
    // repo root carries a real .env; XDG_CONFIG_HOME is voided as belt-and-braces.
    env: { ...process.env, DEEPGRAM_API_KEY: "", XDG_CONFIG_HOME: "/nonexistent-soundcheck-cli-test" },
  });
  assert.equal(r.status, 2, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /DEEPGRAM_API_KEY not set/);
  assert.doesNotMatch(r.stdout + r.stderr, /passed/); // no fixture row ever ran
  assert.ok(Date.now() - started < 10000, "key resolution must fail fast, before any network call");
});

test("the GitHub Action's run shape works: SOUNDCHECK_CASSETTE_DIR override + run --aut --replay", () => {
  // Mirrors action.yml: `run <scenarios> --aut <aut> --replay` with the cassette dir from an env var.
  const r = spawnSync("node", ["--experimental-strip-types", "src/cli.ts", "run", "scenarios", "--aut", "examples/tabletalk/grounded.ts", "--replay", "--only", "book-modify-confirm", "--out", "/tmp/sc-action.html"],
    { encoding: "utf8", cwd: process.cwd(), env: { ...process.env, SOUNDCHECK_CASSETTE_DIR: "fixtures/cassettes" } });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /all gates passed/);
});

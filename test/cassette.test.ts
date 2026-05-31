// Unit tests for the record/replay cassette I/O — M0's core thesis ("replay is
// trustworthy") deserves direct coverage: round-trip, audio omission, version
// guard, missing-file error.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, win32, posix } from "node:path";
import { saveCassette, loadCassette, cassettePath, isWithinRoot, CASSETTE_DIR } from "../src/capture/cassette.ts";
import type { Trace } from "../src/types.ts";

const SCEN = "__selftest__";

function sample(autLabel: string): Trace {
  return {
    scenario: SCEN,
    persona: "cooperative",
    autLabel,
    oracleTranscript: "the agent confirmed the booking for May thirtieth",
    turns: [
      {
        turn: 1,
        callerSaid: "hi there",
        agentHeardCallerAs: "hi there",
        agentText: "hello!",
        agentSpokenHeardBack: "hello",
        toolCalls: [{ name: "bookReservation", args: { date: "2026-05-30" }, result: { ok: true } }],
        ttfbMs: 123,
        turnMs: 456,
        audioWav: Buffer.from("not-real-audio"), // must be dropped on save
      },
    ],
  };
}

test("cassette round-trips (save -> load) and drops audio", () => {
  const aut = "__rt__";
  saveCassette(sample(aut));
  try {
    const loaded = loadCassette(SCEN, aut);
    assert.equal(loaded.scenario, SCEN);
    assert.equal(loaded.persona, "cooperative");
    assert.equal(loaded.turns.length, 1);
    assert.equal(loaded.turns[0].agentSpokenHeardBack, "hello");
    assert.deepEqual(loaded.turns[0].toolCalls[0].args, { date: "2026-05-30" });
    assert.equal(loaded.turns[0].audioWav, undefined, "audio must not be persisted in cassettes");
    assert.equal(loaded.oracleTranscript, "the agent confirmed the booking for May thirtieth", "v2 retains the oracle ground-truth");
  } finally {
    rmSync(cassettePath(SCEN, aut), { force: true });
  }
});

test("cassette round-trips terminationReason + goalDriven (round-4 P2)", () => {
  // the goal_reached gate on a REPLAYED goal-driven cassette depends on these surviving save/load.
  const aut = "__td__";
  saveCassette({ ...sample(aut), terminationReason: "planner_error", goalDriven: true });
  try {
    const loaded = loadCassette(SCEN, aut);
    assert.equal(loaded.terminationReason, "planner_error");
    assert.equal(loaded.goalDriven, true);
  } finally {
    rmSync(cassettePath(SCEN, aut), { force: true });
  }
  // and a cassette without them loads as undefined (a scripted/legacy recording) — no false goal_reached.
  const aut2 = "__nogoal__";
  saveCassette(sample(aut2));
  try {
    const loaded = loadCassette(SCEN, aut2);
    assert.equal(loaded.terminationReason, undefined);
    assert.equal(loaded.goalDriven, undefined);
  } finally {
    rmSync(cassettePath(SCEN, aut2), { force: true });
  }
});

test("loadCassette loads a legacy v1 cassette (no oracleTranscript) for back-compat", () => {
  const aut = "__v1__";
  mkdirSync(resolve(process.cwd(), CASSETTE_DIR), { recursive: true });
  writeFileSync(cassettePath(SCEN, aut), JSON.stringify({ version: 1, scenario: SCEN, persona: "cooperative", autLabel: aut, turns: [] }));
  try {
    const loaded = loadCassette(SCEN, aut);
    assert.equal(loaded.oracleTranscript, undefined);
    assert.equal(loaded.turns.length, 0);
  } finally {
    rmSync(cassettePath(SCEN, aut), { force: true });
  }
});

test("loadCassette throws a clear error on a missing cassette", () => {
  assert.throws(() => loadCassette("__missing__", "__missing__"), /no cassette/);
});

test("loadCassette rejects an unsupported version", () => {
  const aut = "__badver__";
  mkdirSync(resolve(process.cwd(), CASSETTE_DIR), { recursive: true });
  writeFileSync(cassettePath(SCEN, aut), JSON.stringify({ version: 999, scenario: SCEN, persona: "cooperative", autLabel: aut, turns: [] }));
  try {
    assert.throws(() => loadCassette(SCEN, aut), /version/);
  } finally {
    rmSync(cassettePath(SCEN, aut), { force: true });
  }
});

test("cassettePath rejects path-traversal / unsafe scenario + AUT names (P1-3)", () => {
  for (const bad of ["../escape", "a/b", "..", "x\\y", "$(rm)"]) {
    assert.throws(() => cassettePath(bad, "support-grounded"), /unsafe|escapes/);
    assert.throws(() => cassettePath("reset-and-callback", bad), /unsafe|escapes/);
  }
  // a normal name still resolves inside fixtures/cassettes
  assert.match(cassettePath("reset-and-callback", "support-grounded"), /fixtures\/cassettes\/reset-and-callback\.support-grounded\.json$/);
});

test("isWithinRoot containment is separator-agnostic (Windows + POSIX) (round-2 P1)", () => {
  // Windows: backslash paths must be recognized as contained — the old `startsWith(root + "/")`
  // check rejected these, breaking cassette lookup for Windows users.
  const winRoot = "C:\\repo\\fixtures\\cassettes";
  assert.ok(isWithinRoot(winRoot, "C:\\repo\\fixtures\\cassettes\\book.tabletalk-grounded.json", win32), "valid Windows path is contained");
  assert.ok(isWithinRoot(winRoot, winRoot, win32), "the root itself is contained");
  assert.ok(!isWithinRoot(winRoot, "C:\\repo\\secrets\\.env", win32), "a sibling escapes");
  assert.ok(!isWithinRoot(winRoot, "C:\\repo\\fixtures\\cassettes\\..\\..\\evil.json", win32), "traversal escapes");
  // POSIX behaves the same through the same helper.
  const pRoot = "/repo/fixtures/cassettes";
  assert.ok(isWithinRoot(pRoot, "/repo/fixtures/cassettes/book.json", posix), "valid POSIX path is contained");
  assert.ok(!isWithinRoot(pRoot, "/repo/secrets/.env", posix), "a POSIX sibling escapes");
  assert.ok(!isWithinRoot(pRoot, "/etc/passwd", posix), "an absolute outside path escapes");
});

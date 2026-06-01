// The `--json` machine-readable failure contract: the "ears for coding agents" payload.
// Unit tests over the pure builder (buildJsonReport) + end-to-end CLI spawns offline (no key) that
// prove the real contract: a passing replay yields a PRISTINE, parseable stdout document (all human
// output on stderr), exit 0; a failing replay yields exit 1 with a trace-driven diagnosis a coding
// agent can patch from. Run: `npm test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { buildJsonReport, CONTRACT_SCHEMA, type JsonReportMeta } from "../src/report/json.ts";
import type { GateResult, ScenarioResult, Trace } from "../src/types.ts";
import type { Verdict } from "../src/judge/types.ts";

// ---- fixtures -------------------------------------------------------------
const trace = (over: Partial<Trace> = {}): Trace => ({ scenario: "book", persona: "cooperative", autLabel: "demo", turns: [], ...over });
const gate = (name: string, pass: boolean, detail = ""): GateResult => ({ name, pass, detail });
function mkResult(gates: GateResult[], over: { transcript?: Trace; verdict?: Verdict; passed?: boolean } = {}): ScenarioResult {
  return { transcript: over.transcript ?? trace(), gates, passed: over.passed ?? gates.every((g) => g.pass), verdict: over.verdict };
}
const meta = (over: Partial<JsonReportMeta> = {}): JsonReportMeta => ({
  version: "9.9.9", generatedAt: "2026-06-01T00:00:00.000Z", aut: "demo", mode: "replay (offline)",
  scenariosDir: "scenarios", autPath: "examples/x.ts", reportPath: "runs/r.html", ...over,
});

// ---- unit: the pure contract builder --------------------------------------
test("all-pass: ok, counts, schema/version/meta passthrough, empty diagnosis & failingGates", () => {
  const rep = buildJsonReport([mkResult([gate("no_spoken_symbols", true, "clean")])], meta());
  assert.equal(rep.schema, CONTRACT_SCHEMA);
  assert.equal(rep.soundcheck, "9.9.9");
  assert.equal(rep.generatedAt, "2026-06-01T00:00:00.000Z");
  assert.equal(rep.aut, "demo");
  assert.equal(rep.mode, "replay (offline)");
  assert.equal(rep.reportPath, "runs/r.html");
  assert.deepEqual(rep.summary, { total: 1, passed: 1, failed: 0, ok: true, failingGates: [] });
  assert.deepEqual(rep.scenarios[0].diagnosis, []);
});

test("failing scenario: ok=false, diagnosis carries the trace evidence + a remediation hint", () => {
  const rep = buildJsonReport([mkResult([gate("grounding", false, 'date="2023-10-14" stale year')], { transcript: trace({ scenario: "book-sat" }) })], meta());
  assert.equal(rep.summary.ok, false);
  assert.equal(rep.summary.failed, 1);
  assert.deepEqual(rep.summary.failingGates, ["grounding"]);
  const s = rep.scenarios[0];
  assert.equal(s.name, "book-sat");
  assert.equal(s.passed, false);
  assert.equal(s.diagnosis.length, 1);
  assert.equal(s.diagnosis[0].gate, "grounding");
  assert.match(s.diagnosis[0].problem, /stale year/); // the agent's actual recorded behavior, preserved
  assert.ok(s.diagnosis[0].hint.length > 0); // a fix hint, not just the gate name
});

test("failingGates dedup across scenarios and strips the ':' qualifier to the gate class", () => {
  const rep = buildJsonReport([
    mkResult([gate("grounding", false, "x")], { transcript: trace({ scenario: "a" }) }),
    mkResult([gate("grounding", false, "y"), gate("tool_sequence:verify_before_act", false, "z")], { transcript: trace({ scenario: "b" }) }),
  ], meta());
  assert.deepEqual([...rep.summary.failingGates].sort(), ["grounding", "tool_sequence"]);
});

test("terminationReason and oracleHeard are included when present, omitted when absent", () => {
  const withFields = buildJsonReport([mkResult([gate("x", true)], { transcript: trace({ terminationReason: "goal_met", oracleTranscript: "hello there" }) })], meta());
  assert.equal(withFields.scenarios[0].terminationReason, "goal_met");
  assert.equal(withFields.scenarios[0].oracleHeard, "hello there");
  const without = buildJsonReport([mkResult([gate("x", true)])], meta());
  assert.equal("terminationReason" in without.scenarios[0], false);
  assert.equal("oracleHeard" in without.scenarios[0], false);
});

test("judge is included only when a verdict is present (advisory, never gating)", () => {
  const verdict: Verdict = { backend: "mock", dimensions: [{ key: "naturalness", value: 4, why: "ok" }], findings: ["a bit terse"] };
  const withJ = buildJsonReport([mkResult([gate("x", true)], { verdict })], meta());
  assert.deepEqual(withJ.scenarios[0].judge, { backend: "mock", dimensions: [{ key: "naturalness", value: 4, why: "ok" }], findings: ["a bit terse"] });
  const noJ = buildJsonReport([mkResult([gate("x", true)])], meta());
  assert.equal("judge" in noJ.scenarios[0], false);
});

test("reproduce reflects the run mode (replay/live/mock) — the agent's targeted re-run", () => {
  const m = (mode: string) => meta({ mode, scenariosDir: "scenarios", autPath: "a.ts" });
  const repro = (mode: string) => buildJsonReport([mkResult([gate("x", true)], { transcript: trace({ scenario: "book" }) })], m(mode)).scenarios[0].reproduce;
  assert.equal(repro("replay (offline)"), "soundcheck run scenarios --aut a.ts --only book --replay");
  assert.equal(repro("live"), "soundcheck run scenarios --aut a.ts --only book");
  assert.equal(repro("mock (offline)"), "soundcheck run scenarios --aut a.ts --only book --adapter mock");
});

test("reportPath is omitted when the meta has none", () => {
  const rep = buildJsonReport([mkResult([gate("x", true)])], meta({ reportPath: undefined }));
  assert.equal("reportPath" in rep, false);
});

// ---- end-to-end: the real CLI, offline (no key, no network) ---------------
const cli = (args: string[]) => spawnSync("node", ["--experimental-strip-types", "src/cli.ts", ...args], { encoding: "utf8", cwd: process.cwd() });

test("run --json (stdout): pristine parseable contract on a passing replay; exit 0; human output on stderr", () => {
  const r = cli(["run", "scenarios", "--aut", "examples/tabletalk/grounded.ts", "--replay", "--only", "book-modify-confirm", "--json", "--out", "/tmp/sc-json-pass.html"]);
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}\n${r.stdout}\n${r.stderr}`);
  const j = JSON.parse(r.stdout); // throws if stdout is polluted with human chatter
  assert.equal(j.schema, CONTRACT_SCHEMA);
  assert.equal(j.summary.ok, true);
  assert.equal(j.scenarios[0].name, "book-modify-confirm");
  assert.equal(j.scenarios[0].diagnosis.length, 0);
  assert.doesNotMatch(r.stdout, /▶|PASS|all gates passed/); // human markers must NOT be on stdout
  assert.match(r.stderr, /all gates passed/); // …they went to stderr
});

test("run --json on a FAILING replay: exit 1, ok=false, diagnosis names the gate + carries patchable evidence", () => {
  const r = cli(["run", "examples/self-improving-loop/scenarios", "--aut", "examples/tabletalk/bare.ts", "--replay", "--only", "book-this-saturday-regression", "--json", "--out", "/tmp/sc-json-fail.html"]);
  assert.equal(r.status, 1, `expected exit 1, got ${r.status}\n${r.stdout}\n${r.stderr}`);
  const j = JSON.parse(r.stdout);
  assert.equal(j.summary.ok, false);
  assert.deepEqual(j.summary.failingGates, ["grounding"]);
  const s = j.scenarios[0];
  assert.equal(s.passed, false);
  assert.ok(
    s.diagnosis.some((d: { gate: string; problem: string; hint: string }) => d.gate === "grounding" && /stale year/.test(d.problem) && d.hint.length > 0),
    `expected a grounding diagnosis with evidence + hint, got ${JSON.stringify(s.diagnosis)}`,
  );
});

test("run --json <file>: writes the contract to a file and keeps human output on stdout", () => {
  const out = "/tmp/sc-json-file.json";
  const r = cli(["run", "scenarios", "--aut", "examples/tabletalk/grounded.ts", "--replay", "--only", "book-modify-confirm", "--json", out, "--out", "/tmp/sc-json-file.html"]);
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /all gates passed/); // file mode keeps the normal human output on stdout
  const j = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(j.summary.ok, true);
  assert.equal(j.reportPath, "/tmp/sc-json-file.html");
});

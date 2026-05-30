// Machine-readable example contract (round-2 P1). Every scenario shipped under examples/** and
// scenarios/** must declare exactly how it runs, so a reviewer never hits an avoidable
// missing-cassette error. The three valid states:
//   - replay-backed : a fixtures/cassettes/<name>.<aut>.json exists (offline `--replay` works), OR
//   - liveOnly      : goal-driven, can't be replayed (LLM improvises the caller), OR
//   - fixtureOnly   : an authoring/tuning input or generated demo that ships without a cassette.
// A scenario in none of these states is a contract hole — `--replay` would fail on a missing
// cassette while the docs imply it works. This test is what catches that drift.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CASSETTE_DIR } from "../src/capture/cassette.ts";
import type { Scenario } from "../src/types.ts";

const SCENARIO_ROOTS = ["examples", "scenarios"];

/** Every *.json under the roots. */
function scenarioJsonFiles(): string[] {
  const out: string[] = [];
  for (const root of SCENARIO_ROOTS) {
    if (!existsSync(root)) continue;
    for (const rel of readdirSync(root, { recursive: true })) {
      const f = String(rel);
      if (f.endsWith(".json")) out.push(join(root, f));
    }
  }
  return out.sort();
}

/** A scenario file (vs. a rubric.json or other JSON): has a name, a persona, and an assert array.
 *  Mirrors loadScenarios()'s filter so the contract test sees exactly what the runner runs. */
function isScenario(o: unknown): o is Scenario {
  return !!o && typeof o === "object"
    && typeof (o as Scenario).name === "string"
    && typeof (o as Scenario).persona === "string"
    && Array.isArray((o as Scenario).assert);
}

/** Cassette filenames, once. A cassette `<scenario>.<aut>.json` covers scenario S iff it
 *  starts with `S + "."` (robust to any aut label, which itself may contain dashes). */
const cassetteFiles = existsSync(CASSETTE_DIR) ? readdirSync(CASSETTE_DIR).filter((f) => f.endsWith(".json")) : [];
const hasCassetteFor = (name: string) => cassetteFiles.some((f) => f.startsWith(name + "."));

test("every shipped scenario declares its run contract (replay-backed | liveOnly | fixtureOnly)", () => {
  const files = scenarioJsonFiles();
  assert.ok(files.length > 0, "expected to find scenario JSON files");

  const holes: string[] = [];
  const conflicts: string[] = [];
  let scenarioCount = 0;

  for (const file of files) {
    let parsed: unknown;
    try { parsed = JSON.parse(readFileSync(file, "utf8")); } catch { continue; } // unparseable → not a scenario
    if (!isScenario(parsed)) continue; // rubric.json etc.
    scenarioCount++;
    const s = parsed;

    if (s.liveOnly && s.fixtureOnly) conflicts.push(`${file} — sets BOTH liveOnly and fixtureOnly (pick one)`);

    const replayBacked = hasCassetteFor(s.name);
    if (!s.liveOnly && !s.fixtureOnly && !replayBacked) {
      holes.push(`${file} (name="${s.name}") — no cassette, and not marked liveOnly or fixtureOnly`);
    }
  }

  assert.equal(conflicts.length, 0, `scenarios with conflicting markers:\n  ${conflicts.join("\n  ")}`);
  assert.equal(
    holes.length, 0,
    `example-contract holes — each needs a cassette, or liveOnly:true, or fixtureOnly:true:\n  ${holes.join("\n  ")}`,
  );
  assert.ok(scenarioCount >= 15, `expected to enumerate the full example set, saw ${scenarioCount}`);
});

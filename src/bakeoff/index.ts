// A/B bake-off — run the SAME scenario suite against two agent configs (two prompts, two
// `think` models, two voices, …) and diff the gate results. Portable scenarios make this free
// (coSTAR: "the same scenario runs against different agent implementations"). This is the
// competitive-shootout, productized: which configuration wins, and on which gates?

import type { ScenarioResult } from "../types.ts";

export interface ScenarioComparison {
  scenario: string;
  aPassed: boolean;
  bPassed: boolean;
  winner: "A" | "B" | "tie"; // decided by GATES only — the judge is advisory, never gates the winner
  gateDiff: { gate: string; a: boolean; b: boolean }[]; // gates where the two configs disagree
  judgeDiff: { key: string; a: string; b: string }[]; // advisory: judge dimensions where they differ (empty unless both runs were judged)
}
export interface BakeoffReport {
  aLabel: string;
  bLabel: string;
  comparisons: ScenarioComparison[];
  aWins: number;
  bWins: number;
  ties: number;
  unmatched: string[]; // scenario names present in only ONE run (incomparable — surfaced, never silently dropped)
  winner: "A" | "B" | "tie";
}

// Key on the FULL gate name (NOT a `:`-prefix), so two same-family gates (e.g. two
// `tool_sequence:*`) stay distinct in the diff instead of collapsing to one Map entry.
const gateMap = (r: ScenarioResult) => new Map(r.gates.map((g) => [g.name, g.pass]));

/** Diff two runs of the same suite (matched by scenario name). A scenario "wins" for the
 *  config that passes it when the other fails; same pass/fail = tie. Scenarios present in only
 *  one run are reported in `unmatched` rather than silently dropped. */
export function compareRuns(aLabel: string, bLabel: string, a: ScenarioResult[], b: ScenarioResult[]): BakeoffReport {
  const bByName = new Map(b.map((r) => [r.transcript.scenario, r]));
  const aNames = new Set(a.map((r) => r.transcript.scenario));
  const comparisons: ScenarioComparison[] = [];
  let aWins = 0, bWins = 0, ties = 0;
  for (const ar of a) {
    const br = bByName.get(ar.transcript.scenario);
    if (!br) continue;
    const ag = gateMap(ar), bg = gateMap(br);
    const keys = [...new Set([...ag.keys(), ...bg.keys()])].sort();
    const gateDiff = keys.filter((k) => ag.get(k) !== bg.get(k)).map((k) => ({ gate: k, a: !!ag.get(k), b: !!bg.get(k) }));
    // Advisory judge diff — only when BOTH runs were judged; never affects the winner.
    const judgeDiff: { key: string; a: string; b: string }[] = [];
    if (ar.verdict && br.verdict) {
      const av = new Map(ar.verdict.dimensions.map((d) => [d.key, d.value]));
      const bv = new Map(br.verdict.dimensions.map((d) => [d.key, d.value]));
      for (const k of [...new Set([...av.keys(), ...bv.keys()])].sort()) {
        if (av.get(k) !== bv.get(k)) judgeDiff.push({ key: k, a: String(av.get(k)), b: String(bv.get(k)) });
      }
    }
    const winner: "A" | "B" | "tie" = ar.passed === br.passed ? "tie" : ar.passed ? "A" : "B";
    if (winner === "A") aWins++; else if (winner === "B") bWins++; else ties++;
    comparisons.push({ scenario: ar.transcript.scenario, aPassed: ar.passed, bPassed: br.passed, winner, gateDiff, judgeDiff });
  }
  const unmatched = [
    ...a.filter((r) => !bByName.has(r.transcript.scenario)).map((r) => r.transcript.scenario),
    ...b.filter((r) => !aNames.has(r.transcript.scenario)).map((r) => r.transcript.scenario),
  ];
  return { aLabel, bLabel, comparisons, aWins, bWins, ties, unmatched, winner: aWins > bWins ? "A" : bWins > aWins ? "B" : "tie" };
}

export function formatBakeoff(r: BakeoffReport): string {
  const lines = [`A/B bake-off — A="${r.aLabel}"  vs  B="${r.bLabel}"`, ""];
  for (const c of r.comparisons) {
    const mark = c.winner === "tie" ? "=" : c.winner;
    lines.push(`  [${mark}] ${c.scenario}: A ${c.aPassed ? "PASS" : "FAIL"} / B ${c.bPassed ? "PASS" : "FAIL"}`);
    for (const d of c.gateDiff) lines.push(`        ${d.gate}: A=${d.a ? "✅" : "🚩"} B=${d.b ? "✅" : "🚩"}`);
    for (const d of c.judgeDiff) lines.push(`        ⚖ ${d.key} (advisory): A=${d.a} B=${d.b}`);
  }
  if (r.unmatched.length) lines.push("", `  ⚠ not compared (present in only one run): ${r.unmatched.join(", ")}`);
  const verdict = r.winner === "tie" ? "TIE" : `WINNER: ${r.winner === "A" ? `A "${r.aLabel}"` : `B "${r.bLabel}"`}`;
  lines.push("", `${verdict}  (A won ${r.aWins}, B won ${r.bWins}, ties ${r.ties})`);
  return lines.join("\n");
}

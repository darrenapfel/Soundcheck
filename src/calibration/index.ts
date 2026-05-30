// Calibration / judge-alignment — coSTAR's second loop, for voice. The labeled corpus is a
// no-human Golden Set (labels are ground-truth BY CONSTRUCTION). `calibrate` scores a judge
// against it; `judgeTrust` says whether it may be relied on; `crossModelAlign` corroborates
// the Golden Set with an independent STRONGER model (no human) and reports the production
// judge's trust against it.

import { judgeTranscript, DEFAULT_RUBRIC } from "../judge/index.ts";
import type { JudgeBackend, Rubric } from "../judge/types.ts";
import { CALIBRATION_CORPUS, type LabeledCase } from "./corpus.ts";
import { computeMetrics, judgeTrust, type CalibrationReport, type TrustVerdict } from "./metrics.ts";

export { CALIBRATION_CORPUS } from "./corpus.ts";
export { computeMetrics, judgeTrust, TRUST_THRESHOLDS } from "./metrics.ts";
export type { CalibrationReport, DimensionMetric, TrustVerdict } from "./metrics.ts";

export async function calibrate(
  backend: JudgeBackend,
  corpus: LabeledCase[] = CALIBRATION_CORPUS,
  rubric: Rubric = DEFAULT_RUBRIC,
): Promise<CalibrationReport> {
  const verdicts = [];
  for (const c of corpus) verdicts.push(await judgeTranscript(c.transcript, backend, rubric));
  return computeMetrics(backend.name, corpus, verdicts);
}

export interface AlignmentReport {
  reference: CalibrationReport; // the stronger model vs the Golden Set
  production: CalibrationReport; // the judge we'd actually use
  goldenSetValid: boolean; // does a stronger model re-derive (and CATCH the faults in) the constructed labels?
  productionTrust: TrustVerdict; // may we rely on the production judge?
}

/** The alignment loop. A STRONGER `reference` model re-derives every verdict from the same
 *  transcript (the label is never shown) — a DIVERSITY CHECK that the constructed faults are
 *  real and detectable, NOT a cross-vendor independence proof (reference + production are the
 *  same model family, so a shared blind spot is invisible — a second-vendor reference is future
 *  work, like the STT oracle; see LIMITATIONS.md). The `production` judge's trust is then
 *  reported. `goldenSetValid` requires the reference to actually CATCH the injected problems
 *  (judgeTrust), not merely agree on average. */
export async function crossModelAlign(
  production: JudgeBackend,
  reference: JudgeBackend,
  corpus: LabeledCase[] = CALIBRATION_CORPUS,
  rubric: Rubric = DEFAULT_RUBRIC,
): Promise<AlignmentReport> {
  const ref = await calibrate(reference, corpus, rubric);
  const prod = await calibrate(production, corpus, rubric);
  return {
    reference: ref,
    production: prod,
    goldenSetValid: judgeTrust(ref).trusted, // the strong reference must CATCH the injected faults, not just broadly agree
    productionTrust: judgeTrust(prod),
  };
}

export function formatReport(r: CalibrationReport): string {
  const lines = [`Judge calibration — backend: ${r.backend}`, `Overall agreement (macro-avg over dimensions): ${(r.overallAgreement * 100).toFixed(1)}%`, ""];
  for (const d of r.dimensions) {
    const extra = d.kind === "boolean" ? `precision=${(d.precision! * 100).toFixed(0)}% recall=${(d.recall! * 100).toFixed(0)}%` : `mae=${d.mae!.toFixed(2)}`;
    lines.push(`  ${d.key.padEnd(26)} agreement=${(d.agreement * 100).toFixed(0)}% (n=${d.n}) ${extra}`);
  }
  const t = judgeTrust(r);
  lines.push("", `TRUST: ${t.trusted ? "✅ trusted — may be relied on (advisorily)" : "⚠️  NOT trusted — keep advisory; rely on the deterministic gates"}`);
  for (const reason of t.reasons) lines.push(`  - ${reason}`);
  return lines.join("\n");
}

export function formatAlignment(a: AlignmentReport): string {
  return [
    `Cross-model judge alignment (diversity check — same model FAMILY, not cross-vendor independence)`,
    `  Golden Set — stronger reference "${a.reference.backend}" re-derives the constructed labels: ${(a.reference.overallAgreement * 100).toFixed(0)}% agree, catches the injected faults → ${a.goldenSetValid ? "✅ faults are real + detectable (no human)" : "🚩 reference misses injected faults — review the Golden Set"}`,
    `  (Note: corpus cases are crisp by construction, so high agreement is a sanity check, not proof the judge is reliable on ambiguous transcripts.)`,
    "",
    formatReport(a.production),
    `  (TRUST is advisory; --align gates only Golden Set validity, not the production judge.)`,
  ].join("\n");
}

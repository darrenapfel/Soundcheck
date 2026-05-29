// Calibration runner — score the judge against the self-constructed labeled corpus.

import { judgeTranscript, DEFAULT_RUBRIC } from "../judge/index.ts";
import type { JudgeBackend, Rubric } from "../judge/types.ts";
import { CALIBRATION_CORPUS, type LabeledCase } from "./corpus.ts";
import { computeMetrics, type CalibrationReport } from "./metrics.ts";

export { CALIBRATION_CORPUS } from "./corpus.ts";
export { computeMetrics } from "./metrics.ts";
export type { CalibrationReport, DimensionMetric } from "./metrics.ts";

export async function calibrate(
  backend: JudgeBackend,
  corpus: LabeledCase[] = CALIBRATION_CORPUS,
  rubric: Rubric = DEFAULT_RUBRIC,
): Promise<CalibrationReport> {
  const verdicts = [];
  for (const c of corpus) verdicts.push(await judgeTranscript(c.transcript, backend, rubric));
  return computeMetrics(backend.name, corpus, verdicts);
}

export function formatReport(r: CalibrationReport): string {
  const lines = [`Judge calibration — backend: ${r.backend}`, `Overall agreement (macro-avg over dimensions): ${(r.overallAgreement * 100).toFixed(1)}%`, ""];
  for (const d of r.dimensions) {
    const extra = d.kind === "boolean" ? `precision=${(d.precision! * 100).toFixed(0)}% recall=${(d.recall! * 100).toFixed(0)}%` : `mae=${d.mae!.toFixed(2)}`;
    lines.push(`  ${d.key.padEnd(26)} agreement=${(d.agreement * 100).toFixed(0)}% (n=${d.n}) ${extra}`);
  }
  return lines.join("\n");
}

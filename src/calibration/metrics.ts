// Calibration metrics: how well does the judge agree with ground-truth labels?
// Per boolean dimension we report agreement + precision/recall for the "problem"
// class (problem = label is false, e.g. dirty speech / goal missed) — i.e. can the
// judge CATCH problems. Score dimensions report mean-absolute-error.

import type { Verdict } from "../judge/types.ts";
import type { LabeledCase } from "./corpus.ts";

export interface DimensionMetric {
  key: string;
  kind: "boolean" | "score";
  n: number; // labeled cases for this dimension the judge actually scored
  agreement: number; // fraction where judge matches label (score: within ±1)
  precision?: number; // problem-class (boolean only)
  recall?: number;
  mae?: number; // score only
}
export interface CalibrationReport {
  backend: string;
  dimensions: DimensionMetric[];
  overallAgreement: number;
}

function judgeValue(v: Verdict, key: string): boolean | number | null {
  return v.dimensions.find((d) => d.key === key)?.value ?? null;
}

export function computeMetrics(backend: string, cases: LabeledCase[], verdicts: Verdict[]): CalibrationReport {
  const keys = [...new Set(cases.flatMap((c) => Object.keys(c.labels)))];
  const dimensions: DimensionMetric[] = [];

  for (const key of keys) {
    const labeled = cases.map((c, i) => ({ label: c.labels[key], jv: judgeValue(verdicts[i], key) })).filter((x) => x.label !== undefined && x.jv !== null);
    if (!labeled.length) continue;
    const isBool = typeof labeled[0].label === "boolean";
    const n = labeled.length;

    if (isBool) {
      let agree = 0, tp = 0, fp = 0, fn = 0;
      for (const { label, jv } of labeled) {
        const lab = label as boolean, judged = jv as boolean;
        if (lab === judged) agree++;
        // "problem" = false. judge flags a problem when judged === false.
        if (!lab && !judged) tp++;
        if (lab && !judged) fp++;
        if (!lab && judged) fn++;
      }
      dimensions.push({
        key, kind: "boolean", n, agreement: agree / n,
        precision: tp + fp > 0 ? tp / (tp + fp) : 1,
        recall: tp + fn > 0 ? tp / (tp + fn) : 1,
      });
    } else {
      let within = 0, absErr = 0;
      for (const { label, jv } of labeled) {
        const diff = Math.abs((label as number) - (jv as number));
        absErr += diff;
        if (diff <= 1) within++;
      }
      dimensions.push({ key, kind: "score", n, agreement: within / n, mae: absErr / n });
    }
  }

  const overallAgreement = dimensions.length ? dimensions.reduce((a, d) => a + d.agreement, 0) / dimensions.length : 0;
  return { backend, dimensions, overallAgreement };
}

// Tuning loop — agents tuning agents. Given a failing voice agent, iterate:
// evaluate → a fixer proposes a better system prompt → re-evaluate → KEEP the edit
// ONLY if it improves a HELD-OUT scenario set the fixer never sees (the Goodhart
// guard: an edit that overfits the training set but doesn't generalize is rejected).
// Emit a reviewable before/after + diff. This turns a prototype into a shippable agent.
//
// `evaluate` and `propose` are injected: deterministic mocks in tests; live (real
// scenario runs + a local coding-agent fixer) via the CLI. (See docs/ROADMAP.md M7.)

import type { Diagnosis } from "./diagnose.ts";
export type { Diagnosis } from "./diagnose.ts";
export { diagnose, toolSequenceSummary } from "./diagnose.ts";

export interface TuneScore {
  passed: number;
  total: number;
  diagnosis: Diagnosis[]; // trace-driven root-cause of the failures (fed to the fixer)
}
export type ScenarioSet = "train" | "heldout";
export type EvaluateFn = (prompt: string, set: ScenarioSet) => Promise<TuneScore>;
export type ProposeFn = (prompt: string, diagnosis: Diagnosis[]) => Promise<string>;

export interface TuneIteration {
  proposedPrompt: string;
  trainAfter: TuneScore;
  heldoutAfter: TuneScore | null; // only evaluated if training improved
  kept: boolean;
  reason: string;
}
export interface TuneResult {
  initialPrompt: string;
  finalPrompt: string;
  trainBefore: TuneScore;
  trainAfter: TuneScore;
  heldoutBefore: TuneScore;
  heldoutAfter: TuneScore;
  iterations: TuneIteration[];
  improved: boolean; // held-out strictly improved end-to-end
}

const frac = (s: TuneScore) => (s.total ? s.passed / s.total : 1);

export async function tune(
  initialPrompt: string,
  evaluate: EvaluateFn,
  propose: ProposeFn,
  opts: { maxIterations?: number; onProgress?: (msg: string) => void } = {},
): Promise<TuneResult> {
  const max = opts.maxIterations ?? 3;
  // Each evaluate()/propose() is a live, multi-second call — surface progress so a live run
  // (which can take minutes) isn't a silent banner. No-op by default (deterministic tests stay quiet).
  const log = opts.onProgress ?? (() => {});
  log("evaluating the baseline on the training set…");
  const trainBefore = await evaluate(initialPrompt, "train");
  log(`  baseline train ${trainBefore.passed}/${trainBefore.total}; evaluating the held-out set…`);
  const heldoutBefore = await evaluate(initialPrompt, "heldout");
  log(`  baseline held-out ${heldoutBefore.passed}/${heldoutBefore.total}`);

  let bestPrompt = initialPrompt;
  let bestTrain = trainBefore;
  let bestHeldout = heldoutBefore;
  const iterations: TuneIteration[] = [];

  for (let i = 0; i < max; i++) {
    if (bestTrain.passed === bestTrain.total) break; // converged on training
    log(`iteration ${i + 1}/${max}: running the fixer…`);
    const proposed = await propose(bestPrompt, bestTrain.diagnosis);
    if (proposed === bestPrompt) { // fixer made no change — re-evaluating would waste live iterations
      log("  fixer proposed no change — stopping");
      iterations.push({ proposedPrompt: proposed, trainAfter: bestTrain, heldoutAfter: null, kept: false, reason: "stopped: fixer proposed no change" });
      break;
    }
    log("  evaluating the proposed prompt on the training set…");
    const trainAfter = await evaluate(proposed, "train");

    let heldoutAfter: TuneScore | null = null;
    let kept = false;
    let reason: string;
    if (frac(trainAfter) <= frac(bestTrain)) {
      reason = "rejected: training score did not improve";
    } else {
      log("  training improved — evaluating the held-out set (Goodhart guard)…");
      heldoutAfter = await evaluate(proposed, "heldout");
      // GOODHART GUARD: keep only if the held-out set (unseen by the fixer) improves.
      if (frac(heldoutAfter) > frac(bestHeldout)) {
        bestPrompt = proposed; bestTrain = trainAfter; bestHeldout = heldoutAfter; kept = true;
        reason = "kept: held-out improved";
      } else if (frac(bestHeldout) >= 1) {
        reason = "rejected: held-out already at ceiling — cannot prove this edit generalizes";
      } else {
        reason = "rejected: training improved but held-out did not (overfit)";
      }
    }
    log(`  → ${reason}`);
    iterations.push({ proposedPrompt: proposed, trainAfter, heldoutAfter, kept, reason });
  }

  return {
    initialPrompt, finalPrompt: bestPrompt,
    trainBefore, trainAfter: bestTrain, heldoutBefore, heldoutAfter: bestHeldout,
    iterations, improved: frac(bestHeldout) > frac(heldoutBefore),
  };
}

export function formatTuneResult(r: TuneResult): string {
  const pct = (s: TuneScore) => `${s.passed}/${s.total}`;
  const lines = [
    `Tuning ${r.improved ? "IMPROVED the agent ✅" : "made no held-out improvement"}`,
    `  training : ${pct(r.trainBefore)} -> ${pct(r.trainAfter)}`,
    `  held-out : ${pct(r.heldoutBefore)} -> ${pct(r.heldoutAfter)}  (the Goodhart guard)`,
    `  iterations: ${r.iterations.length} (${r.iterations.filter((i) => i.kept).length} kept)`,
  ];
  for (const [n, it] of r.iterations.entries()) lines.push(`    #${n + 1} ${it.reason}`);
  return lines.join("\n");
}

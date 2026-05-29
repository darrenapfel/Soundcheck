// Tuning loop — agents tuning agents. Given a failing voice agent, iterate:
// evaluate → a fixer proposes a better system prompt → re-evaluate → KEEP the edit
// ONLY if it improves a HELD-OUT scenario set the fixer never sees (the Goodhart
// guard: an edit that overfits the training set but doesn't generalize is rejected).
// Emit a reviewable before/after + diff. This turns a prototype into a shippable agent.
//
// `evaluate` and `propose` are injected: deterministic mocks in tests; live (real
// scenario runs + a local coding-agent fixer) via the CLI. (See docs/ROADMAP.md M7.)

export interface TuneScore {
  passed: number;
  total: number;
  failures: string[]; // gate names that failed (fed to the fixer)
}
export type ScenarioSet = "train" | "heldout";
export type EvaluateFn = (prompt: string, set: ScenarioSet) => Promise<TuneScore>;
export type ProposeFn = (prompt: string, failures: string[]) => Promise<string>;

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
  opts: { maxIterations?: number } = {},
): Promise<TuneResult> {
  const max = opts.maxIterations ?? 3;
  const trainBefore = await evaluate(initialPrompt, "train");
  const heldoutBefore = await evaluate(initialPrompt, "heldout");

  let bestPrompt = initialPrompt;
  let bestTrain = trainBefore;
  let bestHeldout = heldoutBefore;
  const iterations: TuneIteration[] = [];

  for (let i = 0; i < max; i++) {
    if (bestTrain.passed === bestTrain.total) break; // converged on training
    const proposed = await propose(bestPrompt, bestTrain.failures);
    const trainAfter = await evaluate(proposed, "train");

    let heldoutAfter: TuneScore | null = null;
    let kept = false;
    let reason: string;
    if (frac(trainAfter) <= frac(bestTrain)) {
      reason = "rejected: training score did not improve";
    } else {
      heldoutAfter = await evaluate(proposed, "heldout");
      // GOODHART GUARD: keep only if the held-out set (unseen by the fixer) improves.
      if (frac(heldoutAfter) > frac(bestHeldout)) {
        bestPrompt = proposed; bestTrain = trainAfter; bestHeldout = heldoutAfter; kept = true;
        reason = "kept: held-out improved";
      } else {
        reason = "rejected: training improved but held-out did not (overfit)";
      }
    }
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

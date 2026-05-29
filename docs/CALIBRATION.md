# Judge Calibration Report

> How well does the LLM judge agree with **ground truth**? Measured against the
> self-constructed labeled corpus (`src/calibration/corpus.ts`) — labels are correct
> by construction (faults injected deliberately), so no human labeling is involved.
> Regenerate: `soundcheck calibrate --judge live` (live Deepgram-fronted grader) or
> `soundcheck calibrate` (offline mock judge). See `docs/TESTING.md` §3.2.

## Live judge (`deepgram-va`) — overall agreement 91.7%

| Dimension | n | Agreement | Precision (problem class) | Recall (problem class) |
|---|---|---|---|---|
| `spoken_cleanly` | 6 | **83%** | 75% | **100%** |
| `goal_completed` | 3 | **100%** | 100% | 100% |

"Problem class" = the failure polarity (dirty speech / goal missed) — i.e. can the judge **catch** problems.

## How to read this (honest)
- **Recall is 100% on spoken-symbol problems** — the judge never *misses* a dirty utterance. Good.
- **Precision is 75% on `spoken_cleanly`** — it sometimes flags clean speech as dirty (false positives). This is the same over-flagging seen in the M2 live ranking (it called the clean "hardened" agent dirty).
- **This is exactly why the layering is designed as it is:** the **deterministic `no_spoken_symbols` gate owns the crisp spoken-symbol verdict** (it is exact), and the **judge is advisory** — high recall makes it a useful early-warning, but its false positives mean it must not hard-gate CI. On the dimensions with no deterministic gate (naturalness, confirm-before-acting), the judge is the only signal and is reported as advisory.
- Re-run in CI against the **mock** judge (deterministic) so a judge/prompt change that degrades agreement is caught without network flakiness; the **live** numbers above are refreshed manually / nightly.

## Thresholds (release gate)
- Crisp classes (`spoken_cleanly`, `goal_completed`): agreement ≥ 80% **and** problem-recall ≥ 80%. **Met** (83%/100%, 100%/100%).
- Fuzzy classes: reported, not threshold-gated (honest — no ground truth to calibrate against without human labels).

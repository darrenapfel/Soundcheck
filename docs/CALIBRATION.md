# Judge Calibration Report

> How well does the LLM judge agree with **ground truth**? Measured against the
> self-constructed labeled corpus (`src/calibration/corpus.ts`) — labels are correct
> by construction (faults injected deliberately), so no human labeling is involved.
> Regenerate: `soundcheck calibrate --judge live` (live Deepgram-fronted grader) or
> `soundcheck calibrate` (offline mock judge). See `docs/TESTING.md` §3.2.

## Live judge (`deepgram-va`) — overall agreement 91.7% (macro-avg over dimensions; sample-weighted = 88.9%)

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

## Thresholds (release gate) + the TRUST verdict
- Trust thresholds (`src/calibration/metrics.ts` `TRUST_THRESHOLDS`): overall agreement ≥ 80% **and** problem-recall ≥ 90% on each crisp class. **Met** → the judge prints `TRUST: ✅ trusted — may be relied on (advisorily)`. If not met, it prints `⚠️ NOT trusted — rely on the deterministic gates`.
- Fuzzy classes: reported, not threshold-gated (honest — no ground truth without human labels).

## Cross-model alignment loop (coSTAR's second loop, no human) — M5
`soundcheck calibrate --judge live --align` runs a **stronger reference model** (default **gpt-4o**)
over the corpus: it re-derives every verdict from the same transcript (the label is never shown)
and must **catch the injected faults**. This is a **diversity check** that the Golden Set's faults
are real and detectable — **not** cross-vendor independence: the reference and production judge are
the **same model family** (GPT), so a shared blind spot is invisible. A second-vendor reference is
future work, exactly like the STT oracle's "marking your own homework" caveat (`LIMITATIONS.md`).
And because the corpus cases are **crisp by construction** ("star star booked", "negative thirty
two dollars"), high agreement is a *sanity check*, not evidence the judge is reliable on ambiguous,
realistic transcripts.

Live result: reference **`gpt-4o`** re-derives the constructed Golden Set at **100%** and catches
the injected faults → ✅ faults real + detectable; production **`gpt-4o-mini`** → **trusted**
(91.7% agreement, 100% problem-recall, 75% precision). A **drift guard** (`test/calibration.test.ts`)
pins the deterministic mock judge's calibration so a judge/metrics regression breaks CI without
network flakiness.

**Trust-check coverage (honest):** `judgeTrust` gates **boolean problem-recall** on the labeled
crisp classes only. **Score** dimensions (e.g. naturalness) and any **unlabeled** rubric dimension
(e.g. `confirmed_before_acting`) are *not* recall-gated — they're covered only by overall agreement
or not at all. That's by design (no crisp problem class / no ground truth), and it's why those
dimensions stay strictly advisory.

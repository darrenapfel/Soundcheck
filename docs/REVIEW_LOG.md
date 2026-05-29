# Milestone Review Log

Every milestone ends with an **independent code-review sub-agent** (ROADMAP principle #4).
This log tracks each review's status and verdict. Where the Anthropic API was temporarily
overloaded (HTTP 529) and a sub-agent could not be spawned, the milestone got an adversarial
**self-review** to keep the autonomous build moving, with an **independent re-review queued**
(run at the next milestone when the API recovers). The build never paused for a human.

| Milestone | Review | Verdict | Notes |
|---|---|---|---|
| M0 — record/replay harness | ✅ independent sub-agent | ship after addressing MAJORs | 2 MAJORs (full gate-vector pinning; hardened reframe) + minors — all addressed in commit cab7448 |
| M1 — test hardening | ✅ independent sub-agent | ship as-is | 1 MINOR (adapter loop untested) — addressed in M2 (offline adapter-loop test) |
| M2 — LLM judge + adapter DI | ✅ independent sub-agent (combined M2+M3, after the 529 outage cleared) | ship as-is | self-review during outage caught the stream-after-close guard; independent review confirmed no blocker/major + found minors (below) |
| M3 — judge calibration | ✅ independent sub-agent (combined M2+M3) | ship as-is | metric math verified correct; minors addressed (macro-avg label, panel tie→problem, async-listener guard, score clamp) |
| M4 — autonomous eval authoring | ✅ independent sub-agent | ship after addressing MAJORs | 2 MAJORs (both doc/test-gap, not broken code) addressed: (1) "catches bugs" is now an EXECUTING regression test (authored gates vs bare cassette); (2) ROADMAP reconciled — business rules are surfaced as HINTS, not auto-asserted. + minors (nextSaturday guard, rubric written to disk, loadScenarios skips non-scenario JSON, gate-dispatchability test). |
| M5 — genericity (adapters) | ✅ independent sub-agent | ship after addressing MAJORs | 3 MAJORs (all in the experimental OpenAI adapter) addressed: reframed OpenAI as a **reference, NOT CLI-selectable** (reconciles the "user selects it" claim — docs+banner); fixed 2 protocol bugs (disable server VAD; tool-turn response.done race). MockAUT genericity is real + CI-proven. + minor: --adapter/--buggy added to --help. |

## Addressed from the M2+M3 review
- Panel aggregation ties now break toward the problem polarity (not "true").
- Live judge: TTS failure in the grader stream is caught → resolves the verdict (no floating rejection).
- Calibration "overall agreement" is labeled **macro-avg** (sample-weighted also noted: 88.9%).
- Verdict score values clamped to the 1–5 rubric range.

## Tracked follow-ups (MINOR, both copies currently work)
- **Extract a shared `va-socket.ts` helper** consumed by BOTH the adapter and the judge (they currently hand-roll the same real-time VA socket plumbing). This also makes the **judge socket loop mockable** → add a judge-loop offline test (timeout/retry/function-call). Scheduled for M8 polish (or earlier if touched).
- **OpenAI Realtime adapter:** add `WsFactory`/`SynthFn` DI seams (mirror the Deepgram adapter) → an offline socket-mock test; then a live-validation pass against the real API; only then make it CLI-selectable. Until then it remains a reference integration point.
- Tighten the two remaining `any` boundary casts in the adapter message handler to `Record<string, unknown>`.

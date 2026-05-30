# /goal — Make Soundcheck the "CoStar for voice" product in README_ASPIRATIONAL.md

**Goal:** Close every 🚧 gap in `README_ASPIRATIONAL.md` and make Soundcheck a hardened,
generalized, domain-agnostic STS (voice-agent) test & tuning harness — the voice analogue
of Databricks coSTAR (Scenario → Trace → Assess → Refine). When done, the
*Shipped vs. Aspirational* table has **no 🚧 left** (each is either delivered + oracle-verified,
or explicitly de-scoped in writing with a rationale), and `README_ASPIRATIONAL.md` is promoted
to `README.md` because every promise in it is literally true.

This is STS-focused by design. STT/TTS validators are out of scope unless explicitly added later.

---

## THE CARDINAL RULE — the oracle decides, not you

This project exists because you cannot trust indirect signals. **Validate every single claim
with Soundcheck's own tools or deterministic tests — never with proxies.**

- To verify *what happened in a conversation*, run Soundcheck's **oracle (STT) over the real
  recording** and read it. Per-turn text, byte offsets, "it looks right," "the run passed" —
  these are NOT proof and have repeatedly been wrong.
- To verify *logic*, write a deterministic test and run it.
- **If you cannot show oracle output or a passing test that proves a claim, the claim is not
  done — do not write it, commit it, or report it as working.**
- Never reconstruct, splice, or stage evidence to make something *look* like it worked. If the
  oracle says it failed, it failed. A faithful negative result is a real result; a fabricated
  positive is a defect.

You earned this rule the hard way. Honor it on every milestone.

## HARD CONSTRAINTS (non-negotiable)

1. **Fully autonomous — zero mid-run human gates.** Run M1 → final with no stopping to ask a
   human. The ONLY acceptable human touchpoint is an optional sign-off *after* everything is
   complete and oracle-verified ("done; here's the oracle evidence; please review/merge/publish").
   If you stop after one milestone and wait for a human, that is a failure.
2. **Soundcheck verifies Soundcheck.** Dogfood the harness on itself continuously: the oracle on
   every live run; the self-eval suite (incl. the broken-Evaline teeth); judge calibration; and
   the new generic gates run against the example agents AND a deliberately-regressed build. The
   final deliverable must include a standing CI proof that Soundcheck catches what it claims to.
3. **Architecturally pure — no band-aids.** Refactor, don't patch. The gate system becomes a
   clean, composable registry; the Trace becomes one versioned artifact. Delete the band-aids you
   replace. Zero runtime dependencies (Node 22 native TS). Default + CI path is **Deepgram-key-only**.
4. **Deterministic CI.** Live voice is stochastic; CI must stay offline + deterministic via
   record/replay. Re-record cassettes whenever behavior legitimately changes, and re-validate the
   golden ladder. CI must be green at every milestone.
5. **Independent review every milestone.** End each milestone with an independent code-review
   sub-agent (opus). Address BLOCKER/MAJOR findings before moving on; log it in `docs/REVIEW_LOG.md`.

## METHOD — milestone loop

For each milestone: **design (pure) → build → oracle-validate LIVE → independent review →
address findings → re-record cassettes if needed → `npm run validate` green → commit.** Never
batch validation to the end. Never claim a milestone done without oracle/test evidence in the
commit or REVIEW_LOG.

## MILESTONES (organized by the gaps; reorder only with reason)

- **M1 — Declarative, domain-agnostic gate registry.** Replace the hardcoded restaurant logic in
  `grounding`/`value_consistency` with a composable registry. Ship: `tool_sequence`
  (`[a, "before", b]`), `tool_args_match_schema`, `spoken_matches_tool` (generic field, any tool),
  `forbidden_tool`, and generic `grounding` (configurable "now" + relative-date resolution). Keep
  every existing gate green; re-record cassettes. Unit-test each gate (fails on bad, passes on good).
- **M2 — A non-restaurant example agent** (pick one Deepgram customers recognize: tech-support
  triage, healthcare intake, or finance IVR). Build its `AUTConfig` + a `bare/grounded` pair, author
  a suite for it, run LIVE, and **oracle-validate** that the generic gates catch its real bugs and
  pass its clean version. This is the proof the harness is no longer restaurant-bound.
- **M3 — First-class `Trace` artifact.** One versioned, persistable object = recording + oracle
  transcript + per-turn + tool trace + timings. Gates and the judge operate on a persisted Trace
  **without re-running the agent** (coSTAR: iterate on judges offline). Grow the cassette into this.
- **M4 — Domain-agnostic authoring.** `author --spec` generates scenarios + a rubric from ANY
  agent's tools + prompt (no restaurant assumptions). Prove it on M2's agent.
- **M5 — Trusted-judge alignment loop.** Grow `calibrate` into a real alignment loop: a
  cross-model Golden Set (no human in the loop), trust (agreement/precision/recall) reported before
  the judge is relied on, and drift caught over runs. The judge stays advisory; deterministic gates
  own the hard verdicts.
- **M6 — Trace-driven Refine (red-green).** `tune` reads failures, root-causes them *from the Trace*
  ("spoke before the tool returned," "wrong tool order"), feeds the fixer, and re-runs — with the
  held-out Goodhart guard. Live capstone: regress an agent, let the loop fix it, oracle-verify.
- **M7 — Adversarial discovery + A/B bake-off.** Evaline as a fuzzer/red-teamer (interruptions,
  confusion, topic-switches, ambiguous input) that surfaces unknown failure modes; and a bake-off
  that runs one suite against two agent configs/models/voices and diffs gate + judge results.
- **M8 — Self-test CI proof + docs + release.** A standing CI test where the generic gates catch a
  deliberately-regressed build (Soundcheck-tests-Soundcheck). Reframe the docs around S/T/A/R and
  "test YOUR agent." Promote `README_ASPIRATIONAL.md` → `README.md` (only the now-true parts).
  Final **multi-agent review panel**, tag the release candidate, write the completion report.

(Regression-from-production and online/production monitoring are stretch — fold into M7/M8 if time
allows, otherwise de-scope in writing in the gap table with a rationale.)

## DEFINITION OF DONE

- Every 🚧 in `README_ASPIRATIONAL.md` is delivered + **oracle/test-verified**, or de-scoped in
  writing with a rationale. The gap table reflects reality.
- `npm run validate` green + deterministic; **fresh keyless clone** validates; **CI green**.
- Soundcheck-tests-Soundcheck CI proof in place; self-eval + calibration green.
- Every milestone independently reviewed (REVIEW_LOG up to date); final multi-agent panel signed off.
- A completion report citing **oracle evidence** for each major capability — then, and only then,
  the optional human sign-off (review the PRs, merge, publish).

## ANTI-PATTERNS (this project's scar tissue — do not repeat)

- ❌ Validating with per-turn text / byte offsets / "the run passed" instead of the **oracle on the
  recording**.
- ❌ Declaring something "works" before the oracle (or a test) proves it.
- ❌ Reconstructing/splicing audio or data to make a failure look like a success.
- ❌ Band-aids and special-cases instead of a clean abstraction.
- ❌ Stopping mid-build to ask a human.
- ❌ Reading a giant file into context — slice it or use a sub-agent.

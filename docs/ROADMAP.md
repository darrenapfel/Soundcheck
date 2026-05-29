# Soundcheck — Roadmap (milestone plan to the full v1 + v2 dream)

> The goal: a **public-release-worthy, deeply-tested** toolkit that lets an agent autonomously **build → test → tune** a production-grade voice agent with no human in the iteration loop. This roadmap is the build plan to get there. Companion docs: [`ARCHITECTURE.md`](ARCHITECTURE.md) (system design), [`TESTING.md`](TESTING.md) (how we earn trust, incl. Soundcheck-evaluates-Soundcheck), [`RELEASE_CRITERIA.md`](RELEASE_CRITERIA.md) (the v1.0 bar).

## The arc
- **v0 — deterministic core** *(built; PR #1)*: regression gates + round-trip oracle. *Can an agent verify a voice product?*
- **v1 — full evaluation**: LLM judge + autonomous eval authoring + genericity (any voice agent) + the self-evaluation/calibration that makes the tool trustworthy. *Can an agent fully evaluate any voice product, and write the evals itself?*
- **v2 — the tuning loop**: agents tuning agents — take a broken voice agent and autonomously make it shippable. *The complete vision.*

## Non-negotiable principles (apply to every milestone)
1. **Determinism via record/replay.** Live voice is stochastic (the model varies; audio/STT varies). CI **replays cached conversations** for deterministic gating; **live runs are nightly/manual**. A flaky-by-nature tool earns trust only by separating these. (See `TESTING.md`.)
2. **Self-evaluation — Soundcheck evaluates Soundcheck.** We may only ask others to trust our tester if it is itself tested to a *higher* bar — including by itself: Evaline-as-AUT, judge calibration vs ground truth, and the bare→grounded golden ladder as a self-regression.
3. **Independent code review at every milestone.** Each milestone ends with a dedicated code-review sub-agent (correctness · security/no-key-leak · test quality · simplicity). Findings are addressed before proceeding. No milestone is "done" on the builder's say-so alone.
4. **Deepgram-key-only for everything the user runs.** Non-Deepgram adapters are exercised in CI against a **local mock AUT** (creds-free); a live non-Deepgram run is opt-in with that provider's key.
5. **Tests are the gate, not vibes.** Every milestone must leave `npm run validate` (typecheck + lint + unit + replay-integration) green, with coverage at/above target.

## Milestones (each: implement → tests green → independent review → address → commit → proceed)

### M0 — Foundation & determinism harness
- Merge v0 (PR #1). Add **record/replay** to the adapter (a live run writes a `cassette`; replay reads it — no socket). CI pipeline: typecheck + lint + unit + replay-integration. Cassettes for the bare/hardened/grounded ladder.
- **Proof point:** `npm run validate` is green in CI off replayed cassettes — fully deterministic, no live calls.
- **Review gate.**

### M1 — Test hardening (the trust foundation)
- Unit tests: gates (have), normalization, round-trip golden fixtures, adapter over a **mock WebSocket**, capture. Coverage ≥ 85% on `gates/ normalize/ capture/ caller/`. Flakiness controls (replay everywhere in CI).
- **Proof point:** coverage report meets target; CI deterministic across 10 consecutive runs.
- **Review gate.**

### M2 — The judge (eval)
- Deepgram-fronted **grader agent** emitting a structured verdict (rubric scores + findings) via function-calling; optional **judge panel**; pluggable judge model. Judge reads the *heard* audio, never the model text.
- **Proof point:** on the replayed ladder cassettes, the judge ranks **grounded > hardened > bare** and flags the right issues — matching the spike's human verdict — deterministically enough to assert (panel + thresholds).
- **Review gate.**

### M3 — Judge calibration (self-evaluation, part I)
- A labeled corpus of transcripts (known-good / known-bad, with the failure tagged) + a **calibration runner** that measures judge agreement with ground truth (precision/recall per dimension).
- **Proof point:** judge agreement ≥ target (e.g. ≥ 0.9 on the symbol/grounding classes; documented honest numbers for fuzzy ones). Calibration report committed.
- **Review gate.**

### M4 — Autonomous eval authoring
- `soundcheck author --spec <agent-spec>`: read an agent's spec/system-prompt → generate scenarios + deterministic assertions (incl. business-rule assertions extracted from the spec) + a rubric. Quality dimensions are generated; business rules come from the spec.
- **Proof point:** authored suite for an **unseen** spec catches **injected** bugs (we plant known faults; the authored suite must catch them).
- **Review gate.**

### M5 — Genericity (any voice agent)
- Second `AUTAdapter` proving the abstraction. CI target = a **local mock AUT** (a tiny WS agent with scripted/buggy behavior — creds-free, deterministic). Plus a real **OpenAI-Realtime** adapter whose *live* test is opt-in (needs the user's OpenAI key; CI uses the mock).
- **Proof point:** the same scenarios + gates + report run unchanged against a non-Deepgram-VA target.
- **Review gate.**

### M6 — Soundcheck-evaluates-Soundcheck (self-evaluation, part II)
- Point Soundcheck at **Evaline herself** as an AUT (does the caller stay in persona, reach her goal, speak cleanly?). Wire the golden ladder as a **live-nightly + replay-CI** self-regression. Add a deliberately-broken Evaline fixture the meta-suite must catch.
- **Proof point:** Soundcheck evaluates its own caller and passes; the meta-suite **fails** on the broken-Evaline fixture (proving the self-test has teeth).
- **Review gate.**

### M7 — The tuning loop (v2 — agents tuning agents)
- `soundcheck tune <agent> --spec <spec>`: failures → a **fixer-agent** (a local coding agent — Claude Code / Codex, subscription, no API key) proposes edits → re-run → keep edits that raise the score on a **held-out** scenario set the tuner never sees (the Goodhart guardrail) → emit a reviewable diff + before/after report. Convergence + iteration caps.
- **Proof point:** given the **bare** agent + its spec, `tune` raises the held-out score and emits a diff that makes the gates pass — autonomously. Overfitting check: held-out score moves, not just training score.
- **Review gate.**

### M8 — Release readiness (ship v1.0.0)
- Docs (README, ARCHITECTURE, TESTING, CONTRIBUTING, LIMITATIONS, examples), CI badges, the **GitHub Action**, semver + CHANGELOG, a final **security review** (no key ever read/logged/committed but Deepgram), and a fresh-clone smoke.
- **Proof point:** meets every box in [`RELEASE_CRITERIA.md`](RELEASE_CRITERIA.md); a final **multi-agent review** (correctness + security + docs + DX) signs off.
- **Tag v1.0.0.**

## What's *past* the dream (explicitly out of scope for v1.0)
More adapters (Retell, LiveKit, Pipecat, Twilio/SIP), non-English, a hosted report viewer, an acoustic-robustness corpus at scale. Tracked, not built.

## Provenance — both halves already prototyped
The spike validated the eval engine (Stage 3: synthetic caller → live agent → cross-vendor judge) **and** the tuning loop (the Stage-2 fork that built a sanitizer until the gate went green). v1+v2 generalize proven pieces; they don't invent new science.

# Soundcheck — Roadmap (milestone plan to the full v1 + v2 dream)

> Status: **v2.0.0 shipped** — M0 through M8, plus the self-improving loop, are built and oracle/test-verified. This roadmap is the build plan that got there; it's kept as the record of the arc and the honest scope at each step. For what's shipped at a glance see the README's capability-status table; for the open future surfaces see ["What's *past* the dream"](#whats-past-the-dream) below. The goal it set out to meet: a **public-release-worthy, deeply-tested** toolkit that lets an agent autonomously **build → test → tune** a production-grade voice agent with no human in the iteration loop. Companion docs: [`ARCHITECTURE.md`](ARCHITECTURE.md) (system design), [`TESTING.md`](TESTING.md) (how we earn trust, incl. Soundcheck-evaluates-Soundcheck), [`RELEASE_CRITERIA.md`](RELEASE_CRITERIA.md) (the release bar).

## The arc
- **v0 — deterministic core** *(✅ built)*: regression gates + round-trip oracle. *Can an agent verify a voice product?*
- **v1 — full evaluation** *(✅ built)*: LLM judge + autonomous eval authoring + genericity (any voice agent) + the self-evaluation/calibration that makes the tool trustworthy. *Can an agent fully evaluate any voice product, and write the evals itself?*
- **v2 — the tuning loop** *(✅ built)*: agents tuning agents — take a broken voice agent and autonomously make it shippable, plus a self-improving loop that grows the suite from discovered failures. *The complete vision.*

## Non-negotiable principles (apply to every milestone)
1. **Fully autonomous, end to end — ZERO mid-run human gates.** The build runs M0→M8 without ever stopping for a human. Every gate is satisfied by code, tests, or **sub-agents** (the code reviewers, the judge, the fixer, the calibration corpus — all automated). The *only* human touchpoint is an **optional final sign-off** after the build is complete (review the PRs, merge, publish). Nothing — not calibration, not review, not merge — blocks progress mid-run. If a step seems to need a human, automate it (e.g. self-construct the labeled corpus) or branch around it (don't merge mid-run); never wait.
2. **Determinism via record/replay.** Live voice is stochastic (the model varies; audio/STT varies). CI **replays cached conversations** for deterministic gating; **live runs are nightly/manual**. A flaky-by-nature tool earns trust only by separating these. (See `TESTING.md`.)
3. **Self-evaluation — Soundcheck evaluates Soundcheck.** We may only ask others to trust our tester if it is itself tested to a *higher* bar — including by itself: Evaline-as-AUT, judge calibration vs ground truth, and the bare→grounded golden ladder as a self-regression.
4. **Independent code review at every milestone.** Each milestone ends with a dedicated code-review **sub-agent** (correctness · security/no-key-leak · test quality · simplicity). The builder addresses findings autonomously and proceeds — no human in this loop. No milestone is "done" on the builder's say-so alone.
5. **Deepgram-key-only for everything the user runs.** Non-Deepgram adapters are exercised in CI against a **local mock AUT** (creds-free); a live non-Deepgram run is opt-in with that provider's key.
6. **Tests are the gate, not vibes.** Every milestone must leave `npm run validate` green, with coverage at/above target. (`validate` = typecheck + unit + replay-integration from M0; **+ ESLint from M1 onward**.)

## Milestones (each: implement → tests green → independent review → address → commit → proceed)

All milestones below are **✅ done** — each was implemented, left `npm run validate` green, and passed an independent review sub-agent (see [`REVIEW_LOG.md`](REVIEW_LOG.md)). The "Proof point" under each is the bar it had to clear.

### M0 — Foundation & determinism harness ✅
- **Base on v0 by branching from `feat/v0-deterministic-core`** (do NOT merge mid-run; merges are deferred to the optional final human sign-off). Add **record/replay** to the adapter (a live run writes a `cassette`; replay reads it — no socket). CI pipeline: typecheck + unit + replay-integration (**ESLint lint joins `validate` in M1** — deferred to avoid front-loading config churn). Cassettes for the bare/hardened/grounded ladder (record once, live, then replay).
- **Proof point:** `npm run validate` is green in CI off replayed cassettes — fully deterministic, no live calls.
- **Review gate.**

### M1 — Test hardening (the trust foundation) ✅
- Unit tests: gates (have), normalization, capture (injected transcriber), caller, cassette I/O, and the adapter's **config surface** (`buildSettings`). ESLint added to `validate`. Coverage ≥ 85% on `gates/ normalize/ capture/ caller/`. Flakiness controls (replay everywhere in CI). **Deviation (honest):** a fully-offline adapter *socket-loop* test needs injecting both the WebSocket factory and `synthesize` into the adapter; deferred as a tracked follow-up — the live duplex loop is validated by the M0 cassette recordings + the live-nightly run.
- **Proof point:** coverage report meets target; CI deterministic across 10 consecutive runs.
- **Review gate.**

### M2 — The judge (eval) ✅
- Deepgram-fronted **grader agent** emitting a structured verdict (rubric scores + findings) via function-calling; optional **judge panel**; pluggable judge model. Judge reads the *heard* audio, never the model text.
- **Proof point:** on the replayed ladder cassettes, the judge ranks **grounded > hardened > bare** and flags the right issues — matching the spike's human verdict — deterministically enough to assert (panel + thresholds).
- **Review gate.**

### M3 — Judge calibration (self-evaluation, part I) ✅
- A **self-constructed** labeled corpus: the builder *synthesizes* transcripts with faults injected by construction (so the label is ground-truth without a human — a transcript built with "star star" is labeled symbol-bad; a clean one is good) + a **calibration runner** measuring judge agreement (precision/recall per dimension). Cross-model agreement (a second automated judge) is the diversity check. No human labels required.
- **Proof point:** judge agreement ≥ target (e.g. ≥ 0.9 on the symbol/grounding classes; documented honest numbers for fuzzy ones). Calibration report committed.
- **Review gate.**

### M4 — Autonomous eval authoring ✅
- `soundcheck author --spec <agent-spec>`: read an agent's spec/system-prompt → generate scenarios (derived from the tools) + deterministic quality gates + a rubric, and **extract business rules from the prompt and surface them as hints** (auto-generating an assertion for an arbitrary domain rule — "closed Mondays", "parties up to 8" — is a tracked enhancement; v1 surfaces them for a downstream author to assert). Quality gates are generated by the tool; business rules come from the spec.
- **Proof point:** authored suite for an **unseen** spec catches **injected** bugs (we plant known faults; the authored suite must catch them).
- **Review gate.**

### M5 — Genericity (any voice agent) ✅
- Second `AUTAdapter` proving the abstraction. CI target = a **local mock AUT** (a tiny WS agent with scripted/buggy behavior — creds-free, deterministic). Plus a real **OpenAI-Realtime** adapter whose *live* test is opt-in (needs the user's OpenAI key; CI uses the mock).
- **Proof point:** the same scenarios + gates + report run unchanged against a non-Deepgram-VA target.
- **Review gate.**

### M6 — Soundcheck-evaluates-Soundcheck (self-evaluation, part II) ✅
- Point Soundcheck at **Evaline herself** (does the caller stay in persona, preserve the goal, speak cleanly?). Wire the golden ladder as a **live-nightly + replay-CI** self-regression. Add a deliberately-broken Evaline fixture the meta-suite must catch. **Scope (honest):** v1 Evaline is *scripted*, so this is caller-OUTPUT self-checks (voice-clean / in-persona / goal-preserving) — a live-VA Evaline as a full conversational AUT is the tracked goal-driven enhancement. The broader self-regression (bare→grounded ladder + full pipeline on the mock adapter) lives in the replay + genericity tests.
- **Proof point:** Soundcheck evaluates its own caller and passes; the meta-suite **fails** on the broken-Evaline fixture (proving the self-test has teeth).
- **Review gate.**

### M7 — The tuning loop (v2 — agents tuning agents) ✅
- `soundcheck tune <agent> --spec <spec>`: failures → a **fixer-agent** (a local coding agent — Claude Code / Codex, subscription, no API key) proposes edits → re-run → keep edits that raise the score on a **held-out** scenario set the tuner never sees (the Goodhart guardrail) → emit a reviewable diff + before/after report. Convergence + iteration caps.
- **Proof point:** given the **bare** agent, `tune` raises a **genuinely independent** held-out score (a *different* scenario type, so the guard truly discriminates) and writes a tuned prompt — autonomously. Overfitting check: the held-out score must move, not just training.
- **Honest scope:** the bundled demo fixer is **rule-based** (deterministic) — the live capstone proves the *loop + Goodhart guard mechanism* end-to-end, not fixer *intelligence*. The intelligent fixer is the **pluggable** drop-in (`--fixer "claude -p …"`); the spike's Stage-2 fork already proved an LLM agent fixes a voice agent to green. Don't claim the demo itself is an LLM reasoning to a fix.
- **Review gate.**

### M8 — Release readiness (ship the release) ✅
- Docs (README, ARCHITECTURE, TESTING, CONTRIBUTING, LIMITATIONS, examples), CI badges, the **GitHub Action**, semver + CHANGELOG, a final **security review** (no key ever read/logged/committed but Deepgram), and a fresh-clone smoke.
- **Proof point:** meets every box in [`RELEASE_CRITERIA.md`](RELEASE_CRITERIA.md); a final **multi-agent review panel of sub-agents** (correctness + security + docs + DX) signs off — automated, no human.
- **Prepare the release candidate** (tag candidate, CHANGELOG, final PR) and write a completion report. **This is where — and only where — the optional human sign-off happens:** the build is *complete*; the human reviews the open PRs, merges, and publishes. The build never waited for them to get here.

### M9 — Self-improving loop (post-M8, shipped in v2) ✅
- **Discover → promote → refine.** `run --promote-failures` freezes a failing call an adversarial caller *discovers* into a permanent, scripted regression (`src/regress/promoteTrace`), and `tune` then refines the agent against the grown suite — the test suite grows itself from failures nobody scripted.
- **Proof point:** the loop runs end-to-end in `examples/self-improving-loop/`; the closure is pinned offline and deterministically in `test/regress.test.ts` (promotion carries the same invariants forward, is idempotent, and refuses a trace with no usable caller turns — no vacuous-green regression). This is the headline of the v2.0.0 release.

## What's *past* the dream

**Future (designed, not yet built):**
- **Regression from *production* traffic** — sourcing discovered failures from real production calls rather than the synthetic caller.
- **Online / production monitoring** — watching live calls continuously, vs. the pre-ship harness Soundcheck is today.

**Out of scope by design:**
- **Standalone STT / TTS validators** — evaluate those after STS (speech-to-speech) is great, not bundled in. (The `validate` CLI command exposes a round-trip TTS/STT spot-check, but a full standalone validator product is not a goal.)

**Tracked, not built:** more adapters (Retell, LiveKit, Pipecat, Twilio/SIP), non-English, a hosted report viewer, an acoustic-robustness corpus at scale.

## Provenance — both halves already prototyped
The spike validated the eval engine (Stage 3: synthetic caller → live agent → cross-vendor judge) **and** the tuning loop (the Stage-2 fork that built a sanitizer until the gate went green). v1+v2 generalize proven pieces; they don't invent new science.

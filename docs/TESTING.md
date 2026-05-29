# Soundcheck — Testing & Trust Strategy

> **The core problem of a test tool: why should anyone trust it?** Soundcheck asks developers to let an agent test *their* agent and gate shipping decisions on the result. That is only defensible if Soundcheck is itself tested to a **higher** bar than the things it tests — including, where possible, **by itself.** This document is how we earn that trust.

## 1. The testing pyramid

| Layer | What it covers | Determinism | Runs in |
|---|---|---|---|
| **Unit** | gates, normalization/detection, capture, caller phrasing, adapter (over a mock socket), judge (over fixture transcripts), report | fully deterministic | every commit / CI |
| **Replay-integration** | the *whole pipeline* (caller → adapter → capture → gates → judge → report) over **recorded cassettes** | deterministic (no network) | every commit / CI |
| **Self-evaluation** | Soundcheck evaluating Soundcheck (§3) | deterministic (replay) + live-nightly | CI (replay) + nightly (live) |
| **Calibration** | does the judge agree with ground-truth labels? (§3.2) | deterministic (labeled corpus) | CI |
| **Live (end-to-end)** | real Deepgram VA, real audio, real stochastic model | **non-deterministic** — asserted loosely (panel/threshold), never a hard merge gate | nightly / manual |

`npm run validate` = typecheck + lint + unit + replay-integration. It is the merge gate. It must never depend on a live call.

## 2. Record / replay (how a stochastic tool becomes deterministic)

Live voice is stochastic: the `think` model varies (we observed gpt-4o-mini emit an ISO date one run and a prose date the next), and TTS→STT has its own variance. A test suite built on live calls would be flaky — and a flaky test tool is untrustworthy by definition.

**So the adapter has two modes:**
- **record** — a live run writes a *cassette*: the full `RawTurn[]` (caller text, the agent's captured audio, tool calls, timings) to `fixtures/cassettes/`.
- **replay** — reads the cassette and reconstructs the exact run, **no socket, no model, no credits.**

Everything downstream of capture (gates, judge inputs, report) is then **100% deterministic** in CI. We re-record cassettes deliberately (a reviewed PR), never silently. Live nightly runs surface drift ("the real agent's behavior changed") separately from logic regressions.

> This is also what makes "evaluate Soundcheck with Soundcheck" reproducible: the meta-tests run on cassettes.

## 3. Self-evaluation — Soundcheck evaluates Soundcheck

Three concrete forms. Together they are the strongest possible trust signal: the tester turned on itself.

### 3.1 Evaline-as-AUT (the caller is a voice agent — so test it like one)
Evaline is a Deepgram Voice Agent. So we point Soundcheck **at Evaline**, treating her as the agent-under-test, with scenarios that assert: she stays in persona, she pursues and reaches her stated goal, she speaks cleanly (no spoken symbols), she doesn't derail. A **deliberately-broken Evaline** fixture (e.g. one who ignores her goal or speaks markdown) must make this meta-suite **fail** — proving the self-test has teeth, not just a rubber stamp.

### 3.2 Judge calibration (does the judge deserve to judge?)
A committed corpus of **labeled** transcripts — known-good and known-bad, each with the specific failure tagged (spoken-symbol / grounding / state-loss / unnatural / goal-miss). A calibration runner scores the judge against these labels and reports **precision/recall per dimension**. The judge ships only if agreement clears a documented threshold (high on the crisp classes like spoken-symbols; honestly-reported, lower on the fuzzy ones). Re-run in CI so a judge/prompt change that degrades agreement is caught.

### 3.3 The golden ladder as a self-regression
The bare → hardened → grounded outcomes (bare fails symbols+grounding; hardened shows the tool-format regression; grounded passes all) are the canonical proof the *whole stack* works. Recorded as cassettes, they run in CI deterministically; live, they run nightly. If a change makes grounded fail or bare pass, the build breaks.

## 4. Coverage, lint, types
- **Coverage targets:** ≥ 85% statements on `gates/ normalize/ capture/ caller/`; adapter and judge covered via mock/fixtures (live paths excluded from coverage, documented). Node's built-in coverage (`node --test --experimental-test-coverage`).
- **Lint + format:** a linter in CI (zero warnings). **Typecheck:** `tsc --noEmit`, strict, clean.
- **No `any` in shipped code** beyond narrowly-justified, commented boundary casts.

## 5. Flakiness & honesty policy
- CI is deterministic (replay). If a test is flaky, it is a bug — fix it or move it to the live-nightly tier; never retry-until-green.
- **Documented limits are part of the test suite's honesty:** per-turn TTFB includes tool time; TTS-synthesized callers test behavior not acoustic robustness; the judge is non-deterministic and advisory. These live in `LIMITATIONS.md` and are reflected in how/where each is asserted.

## 6. The independent-review gate (humans-out, adversaries-in)
Every milestone ends with a dedicated **code-review sub-agent** (separate from the builder) reviewing the milestone diff on four axes — **correctness**, **security** (no credential ever read/logged/committed except `DEEPGRAM_API_KEY`; cassettes carry no secrets), **test quality** (do the tests actually constrain behavior, or are they tautological?), **simplicity/DX**. Findings are addressed before the milestone is accepted. The final release milestone gets a multi-agent panel.

## 7. What "trust" concretely means at v1.0
A developer can read `TESTING.md`, run `npm run validate` on a fresh clone (deterministic, green), see the coverage + calibration numbers, watch the self-evaluation suite catch a broken Evaline, and conclude: *this tool is tested more rigorously than the agent I'm pointing it at.* That is the bar.

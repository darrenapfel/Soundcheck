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

`npm run validate` = typecheck + lint + unit + replay-integration. It is the merge gate, and it is what CI runs. It must never depend on a live call. As of v2.0.0 it is **113 tests, all passing — fully offline, no key, no network.** The suite lives in `test/*.test.ts`; the inventory:

| Test file(s) | What it pins |
|---|---|
| `gates.test.ts` | each of the 9 registry gates passes the conforming case and fails the violation — including the prose-date tool-arg regression (`tool_args_match_schema` rejects `"October seventh"`), pinned deterministically here rather than relying on a cassette that may record an ISO date |
| `self-test.test.ts` | **Soundcheck-tests-Soundcheck** — the generic gates *catch* deliberately-regressed builds (a buggy MockAUT + the insecure/bare example agents) and pass the correct ones, with a coverage contract that every core safety gate family is shown catching a real regression (§6) |
| `regress.test.ts` | the self-improving-loop closure — `promoteTrace` freezes a failing call into a scripted regression carrying the same invariants, is idempotent, and refuses a trace with no usable caller turns (no vacuous-green regression) |
| `calibration.test.ts` | judge calibration vs. the labeled corpus + cross-model alignment + the drift guard (§3.2) |
| `selfeval.test.ts` | Evaline self-checks + the deliberately-broken-Evaline / broken-persona fixtures that must fail (§3.1) |
| `replay.test.ts`, `replay-support.test.ts` | the golden ladder as a replay self-regression — each rung pins its **full gate vector** off the recorded cassettes (§3.3) |
| `bakeoff.test.ts` | A/B & vendor bake-off diffing one suite across two configs |
| `adversarial.test.ts` | the adversarial (red-team) caller surfacing failures nobody scripted |
| `author.test.ts` | autonomous scenario authoring from an agent's tools + prompt |
| `tune.test.ts` | the trace-driven tuning loop + the Goodhart held-out guard (an edit that overfits training but not held-out is rejected) |
| `adapter.test.ts`, `adapter-loop.test.ts`, `genericity.test.ts` | the adapter config surface, the duplex socket loop, and the same scenarios running unchanged against a non-Deepgram (mock) target |
| `caller.test.ts`, `caller-policy.test.ts`, `capture.test.ts`, `normalize.test.ts`, `cassette.test.ts`, `trace.test.ts`, `judge.test.ts`, `security.test.ts` | caller phrasing/policy, capture, normalization/detection, cassette + Trace round-tripping, the judge over fixture transcripts, and the no-credential-leak security check |

## 2. Record / replay (how a stochastic tool becomes deterministic)

Live voice is stochastic: the `think` model varies (we observed gpt-4o-mini emit an ISO date one run and a prose date the next), and TTS→STT has its own variance. A test suite built on live calls would be flaky — and a flaky test tool is untrustworthy by definition.

**So the adapter has two modes:**
- **record** — a live run writes a *cassette*: the full `RawTurn[]` (caller text, the agent's captured audio, tool calls, timings) to `fixtures/cassettes/`.
- **replay** — reads the cassette and reconstructs the exact run, **no socket, no model, no credits.**

Everything downstream of capture (gates, judge inputs, report) is then **100% deterministic** in CI. We re-record cassettes deliberately (a reviewed PR), never silently. Live nightly runs surface drift ("the real agent's behavior changed") separately from logic regressions.

> This is also what makes "evaluate Soundcheck with Soundcheck" reproducible: the meta-tests run on cassettes.

## 3. Self-evaluation — Soundcheck evaluates Soundcheck

Three concrete forms. Together they are the strongest possible trust signal: the tester turned on itself.

### 3.1 Evaline self-checks (test the tester's own caller)
**Scope (honest):** Soundcheck ships both a scripted caller and a **reactive goal-driven Evaline** (plus an `adversarial` red-team persona, exercised in `test/adversarial.test.ts`). The self-evaluation suite checks that Evaline's own output is **fit to test with** rather than running her end-to-end as a conversational AUT: she is **voice-clean** (never speaks markdown/symbols at the agent — the one genuinely behavior-constraining check, since a dirty caller would corrupt the very `no_spoken_symbols` gate the tool sells), **in-persona**, and **goal-preserving** (the last two are *contract guards*: today's caller satisfies them by construction; they exist to FAIL if a future caller change drops/replaces a request). A **deliberately-broken Evaline** fixture (speaks markdown, drops the goal) and a **broken-persona** fixture must make the meta-suite **fail** — proving it has teeth, not a rubber stamp (`test/selfeval.test.ts`). Running the *live, goal-pursuing* Evaline as a full conversational AUT in the deterministic self-regression remains a tracked enhancement; today's broader self-regression is §3.3 (golden ladder) + the full pipeline on the mock adapter.

### 3.2 Judge calibration (does the judge deserve to judge?)
A committed corpus of **labeled** transcripts whose labels are **ground-truth by construction — no human labeling**: the build *synthesizes* each transcript with the fault injected (or absent) deliberately, so a transcript built to contain "star star" is labeled symbol-bad, a clean one is good, etc. (crisp classes: spoken-symbol / dash-negative / grounding / non-ISO-tool-arg / state-loss; plus clear positive/negative examples for the fuzzy classes like naturalness). A calibration runner scores the judge against these known labels and reports **precision/recall per dimension**; an automated **cross-model** second judge provides a diversity check. The judge ships only if agreement clears a documented threshold (high on the crisp classes; honestly-reported, lower on the fuzzy ones). Re-run in CI so a judge/prompt change that degrades agreement is caught. **This entire step is automated — no human labels, no human gate.**

### 3.3 The golden ladder as a self-regression
The bare → hardened → grounded outcomes are the canonical proof the *whole stack* works: **bare** fails spoken-symbols + grounding; **hardened** (no-Markdown prompt) speaks cleanly but is **still ungrounded** — proving a formatting fix doesn't fix grounding; **grounded** passes every gate. Recorded as cassettes, each rung pins its **full gate vector** in CI (deterministic); live, they run nightly. If a change makes grounded fail, bare pass, or any rung's vector shift, the build breaks. (The separate prose-date **tool-format regression** is stochastic from the live model, so it is pinned *deterministically* in `test/gates.test.ts` — `tool_args_match_schema` rejects a prose date like `"October seventh"` against the tool's `format:date` schema — rather than relying on a hardened cassette that may record an ISO date.)

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

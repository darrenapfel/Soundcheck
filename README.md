# 🎙️ Soundcheck — *the* test & tuning harness for voice agents

[![CI](https://github.com/darrenapfel/Soundcheck/actions/workflows/ci.yml/badge.svg)](https://github.com/darrenapfel/Soundcheck/actions/workflows/ci.yml)
[![core coverage ≥85%](https://img.shields.io/badge/core%20coverage-%E2%89%A585%25-brightgreen.svg)](docs/TESTING.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> **CoStar for voice.** Databricks' [coSTAR](https://www.databricks.com/blog/costar-how-we-ship-ai-agents-databricks-fast-without-breaking-things) lets a coding agent ship text/tool agents fast without breaking things — *LLM judges as the test suite, a coding assistant refining the agent until the tests pass.* Soundcheck is that, for the modality nobody had solved: **real-time speech-to-speech (STS) voice agents.** Runs on a single Deepgram key.

## Why this exists

Web apps have Playwright: a coding agent writes a test, runs it against a real browser, and *knows* it didn't break the UI before shipping. **Voice agents have nothing like it** — and STS is the hardest surface to test: non-deterministic, real-time, full-duplex, with turn-taking, barge-in, and tool calls all happening over audio. A unit test can't *hear* that your agent said "star star confirmed," spoke a 24-hour time, talked over the caller, or lost the reservation halfway through the call.

So the autonomous **build → test → tune → ship** loop that works for code **breaks for voice**. Soundcheck closes that gap. Point it at *any* voice agent and an autonomous coding agent can build a regression suite, run it every commit, debug failures from a faithful recording, and tune the agent until it passes — **with no human in the loop.**

## The architecture: Scenario → Trace → Assess → Refine

Soundcheck is organized around coSTAR's four coupled steps, re-grounded for voice:

| Step | What it is for voice | Command |
|---|---|---|
| **Scenario** | A portable test fixture: a caller goal/persona + declarative success criteria. Runs unchanged against any agent version or implementation. | `soundcheck author`, `scenarios/*.json` |
| **Trace** | The **flight recorder**: a faithful, time-ordered recording of the whole call (caller + agent mixed at real timing) + the **oracle** (STT) transcript + per-turn text + the tool trace + timings. Persisted, so judges re-run *without* re-running the agent. | the run's recording + `cassettes/` |
| **Assess** | **Deterministic gates** (hard pass/fail invariants) + an **advisory LLM judge** (the fuzzy stuff) + **monitoring metrics** (latency). | `soundcheck run`, `soundcheck bakeoff` |
| **Refine** | A coding agent treats *the voice agent* as its codebase and *the gates* as its test suite: read failures → diagnose from the trace → patch → re-run. | `soundcheck tune` |

Plus coSTAR's **second loop** — judge alignment — so the judge is *trusted* before anything leans on it (`soundcheck calibrate`).

## Quickstart — test *your* agent

```bash
echo "DEEPGRAM_API_KEY=dg_..." > .env      # the only key you need
npm install                                 # devDeps only — zero runtime deps
# commands below use the `soundcheck` bin (after `npm link`); in a fresh clone, prefix: npm run soundcheck --

# 1. Author a suite from YOUR agent's spec (tools + system prompt) — no human writes the cases
soundcheck author --spec ./my-agent.ts

# 2. Run it live against your agent; gate it; get a faithful, debuggable trace
soundcheck run scenarios --aut ./my-agent.ts

# 3. Hear exactly what happened + read what Soundcheck's own oracle heard
open runs/report-*.html

# 4. Tune until green — agent fixes agent
soundcheck tune --agent ./my-agent.ts --fixer "claude -p"
```

No agent of your own yet? The bundled `examples/tabletalk/` (restaurant) and `examples/support/` (IT-support) each ship `bare` / `grounded` configs so you can watch the same gates catch "STAR STAR", dash-as-negative prices, non-ISO tool dates, reset-before-verify, and ungrounded dates — then go green.

## Capabilities

### Scenario — portable test fixtures
- **Declarative scenarios** (`name`, `persona`, caller turns or `goal`, `assert`) that run unchanged across agent versions and implementations via the `AUTAdapter` abstraction.
- **Autonomous, domain-agnostic authoring.** `author --spec` generates one scenario per tool — plus the right generic gates — from *any* agent's tools + prompt; destructive tools are skipped, identity-gated tools get a proactive caller. The synthesized caller lines are mechanical starting points to review.

### Trace — the flight recorder
- **Real-time mixed recording** of the whole call (caller + agent overlaid at true playback timing), played back in the report.
- **Oracle self-validation.** Soundcheck runs its *own* STT over the recording and shows "what Soundcheck heard" — ground truth, on every live run. *(This is what caught our own bugs.)*
- **Per-turn capture** (heard text, agent text, tool calls, TTFB) + a **first-class, versioned `Trace`** persisted as a **record/replay cassette** (v2 retains the oracle), so gates and judges run offline — without re-running the agent.

### Assess — gates, judge, metrics
- **Declarative invariant gates, domain-agnostic.** A composable gate registry a customer *declares* and Soundcheck enforces deterministically:
  ```jsonc
  "assert": [
    "no_spoken_symbols",                                               // never speak markup/symbols
    { "tool_args_match_schema": "bookAppointment" },                   // type/required/format/enum/pattern
    { "tool_sequence": ["verifyIdentity", "before", "accessRecord"] }, // ordering invariants
    { "spoken_matches_tool": { "field": "date", "tool": "bookAppointment" } }, // say what you did
    { "required_tool": "scheduleCallback" },
    { "forbidden_tool": "chargeCard" },
    { "grounding": { "tool": "bookAppointment", "field": "date", "now": "2026-05-29", "expected": "2026-05-30" } }, // resolve relative dates correctly
    { "latency": { "ttfb_ms": { "max": 2000 } } }
  ]
  ```
  The same registry tests a restaurant agent, an IT-support bot, healthcare intake, or a finance IVR — any STS agent.
- **Advisory LLM judge** (Deepgram-fronted, rubric + findings, panel aggregation) for the fuzzy dimensions (natural? goal met? confirmed before acting?) — it informs, it never hard-gates.
- **Judge alignment.** `calibrate` scores the judge against a no-human Golden Set (agreement/precision/recall), reports a **trust verdict** before the judge is relied on, corroborates with a stronger reference model, and pins a drift guard in CI.

### Refine — agent fixes agent
- **Trace-driven tuning loop.** `tune` reads the trace, produces a root-cause **diagnosis** per failing gate (evidence + remediation hint), feeds it to a pluggable `--fixer`, and keeps an edit only if a **held-out** set improves (Goodhart guard). Demonstrated generalizing a date-grounding fix to an unseen relative date.

### Voice-native testing (the moat)
- **Faithful turn-taking** — endpoints on the agent's real end-of-speech, no smeared turns.
- **Barge-in** — the caller cuts in mid-reply; the agent's server-side interruption is captured faithfully (oracle-validated: it truncates and re-addresses).
- **Reactive caller (Evaline).** A goal-driven synthetic caller improvises toward a goal, reacting to what the agent actually said, and hangs up when done.
- **Adversarial discovery.** An `adversarial` Evaline persona turns her into a red-teamer who *improvises* attacks (act-before-verify, deletion, verification bypasses) — surfacing failure modes nobody scripted. Against a deliberately-insecure agent she surfaced reset-before-verify + account-deletion (oracle-confirmed); against a hardened one the agent held.
- **A/B & vendor bake-off.** `soundcheck bakeoff` runs one suite against two configs (prompts / `think` models / TTS voices) and diffs the per-gate results — which config wins, on which gates — plus, with `--judge`, the advisory judge dimensions.

## Autonomous — no human in the loop

Soundcheck is built to be driven by a coding agent with **zero human gates**:
- **Deterministic gates own the hard pass/fail** — no model in the judgment path for the verdicts that gate a merge.
- **The LLM judge is advisory and calibrated** — it informs, it never silently gates; its trust is measured and reported.
- **Determinism via record/replay** — a stochastic live call becomes a reproducible CI fixture.
- **The oracle is the arbiter** — every claim about a run is checkable against Soundcheck's own STT of the real audio, so an agent (or a reviewer) never has to take a pass/fail on faith.

## Soundcheck verifies Soundcheck

The harness proves *itself* with its own tools — the only honest way to ask others to trust it:
- **The oracle** transcribes every live recording; the report shows it.
- **End-to-end self-test** (`test/self-test.test.ts`): the generic gates *catch* deliberately-regressed builds (a buggy mock agent + insecure/bare example agents) and pass correct ones — with a coverage contract that every core safety gate family is shown catching a real regression. Offline, in CI.
- **Self-evaluation suite** — Evaline-as-AUT, with a deliberately-broken-Evaline fixture that *must* fail.
- **Judge calibration** against a labeled corpus, with a drift guard.

## One key, zero deps

Default + CI operation needs **only `DEEPGRAM_API_KEY`** — caller brain (the Voice Agent's `think` LLM), voice (TTS), transcription/oracle (STT), and the judge (a Deepgram-fronted grader) all run on Deepgram. No OpenAI/Anthropic key. (The optional `openai-realtime` *reference* adapter reads `OPENAI_API_KEY` only if a developer wires it; CI never touches it.) **Zero runtime dependencies** (Node 22 native TypeScript). MIT licensed. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#deepgram-key-only).

### Use it in your repo's CI

Soundcheck ships a **reusable composite GitHub Action** (`action.yml`). Because the harness has zero runtime dependencies, the Action needs nothing but Node 22 — no install step. Replay your recorded cassettes as an offline merge gate:

```yaml
# .github/workflows/voice.yml in your agent's repo
jobs:
  soundcheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4   # your scenarios/ + fixtures/cassettes/ + agent.ts
      - uses: darrenapfel/Soundcheck@v1.0.0
        with:
          scenarios: scenarios               # dir of scenario .json files
          args: "--aut agent.ts --replay"    # replay recorded cassettes — deterministic, no key
          # for a LIVE run instead (records/replays real audio):
          #   args: "--aut agent.ts"
          #   deepgram-api-key: ${{ secrets.DEEPGRAM_API_KEY }}
```

## Scope

Soundcheck is **STS-focused** by deliberate choice: STS is the highest-value, hardest-to-test, most differentiated voice surface — the true moat. Standalone **STT** and **TTS** validators (WER/accuracy corpora, pronunciation suites) are possible *future* directions, evaluated after STS is great, not bundled in.

## Capability status

Everything below is shipped and oracle/test-verified (each milestone independently reviewed — see [`docs/REVIEW_LOG.md`](docs/REVIEW_LOG.md)).

| Capability | Status |
|---|---|
| Real-time recorder + oracle self-validation | ✅ Shipped |
| Faithful turn-taking + barge-in | ✅ Shipped |
| Reactive goal-driven caller (Evaline) | ✅ Shipped |
| Declarative, domain-agnostic gate registry | ✅ Shipped |
| Record/replay cassettes (first-class versioned Trace) | ✅ Shipped |
| Advisory LLM judge + panel | ✅ Shipped |
| Judge alignment loop (trust + cross-model + drift guard) | ✅ Shipped |
| Autonomous, domain-agnostic authoring | ✅ Shipped |
| Trace-driven Refine (red-green tuning) | ✅ Shipped |
| Adversarial discovery (Evaline as red-teamer) | ✅ Shipped |
| A/B & vendor bake-off | ✅ Shipped |
| End-to-end Soundcheck-tests-Soundcheck CI proof | ✅ Shipped |
| Two example domains (restaurant + IT-support) | ✅ Shipped |
| Regression-from-production (auto-author from a failed call) | 🚧 Future direction |
| Online / production monitoring | 🚧 Future direction |
| Standalone STT / TTS validators | 🚧 Out of scope by design |

## Docs
- 📐 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design
- 🗺️ [`docs/ROADMAP.md`](docs/ROADMAP.md) — the milestone build plan
- 🧪 [`docs/TESTING.md`](docs/TESTING.md) — how we earn trust (record/replay, self-evaluation, calibration)
- ⚖️ [`docs/CALIBRATION.md`](docs/CALIBRATION.md) — live judge agreement numbers
- ⚠️ [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) — honest limits
- 🔍 [`docs/REVIEW_LOG.md`](docs/REVIEW_LOG.md) — every milestone's independent review
- 🤝 [`CONTRIBUTING.md`](CONTRIBUTING.md) — add an adapter / scenario / gate

---

*MIT licensed. Built for the agents-test-agents era — for voice.*

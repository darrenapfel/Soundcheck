# 🎙️ Soundcheck — *the* test & tuning harness for voice agents

> **CoStar for voice.** Databricks' [coSTAR](https://www.databricks.com/blog/costar-how-we-ship-ai-agents-databricks-fast-without-breaking-things) lets a coding agent ship text/tool agents fast without breaking things — *LLM judges as the test suite, a coding assistant refining the agent until the tests pass.* Soundcheck is that, for the modality nobody had solved: **real-time speech-to-speech (STS) voice agents.** Runs on a single Deepgram key.

---

> **📍 This is the ASPIRATIONAL README — the product we're building toward.**
> Every capability is tagged **✅ Shipped** (works today, oracle-validated) or **🚧 Aspirational** (the gap to close). A consolidated [Shipped vs. Aspirational](#shipped-vs-aspirational) table is at the bottom. The shipping `README.md` describes only what's built today.

---

## Why this exists

Web apps have Playwright: a coding agent writes a test, runs it against a real browser, and *knows* it didn't break the UI before shipping. **Voice agents have nothing like it** — and STS is the hardest surface to test: non-deterministic, real-time, full-duplex, with turn-taking, barge-in, and tool calls all happening over audio. A unit test can't *hear* that your agent said "star star confirmed," spoke a 24-hour time, talked over the caller, or lost the reservation halfway through the call.

So the autonomous **build → test → tune → ship** loop that works for code **breaks for voice**. Soundcheck closes that gap. Point it at *any* voice agent and an autonomous coding agent can build a regression suite, run it every commit, debug failures from a faithful recording, and tune the agent until it passes — **with no human in the loop.**

## The architecture: Scenario → Trace → Assess → Refine

Soundcheck is organized around coSTAR's four coupled steps, re-grounded for voice:

| Step | What it is for voice | Command |
|---|---|---|
| **Scenario** | A portable test fixture: a caller goal/persona + declarative success criteria. Runs unchanged against any agent version or implementation. | `soundcheck author`, `scenarios/*.json` |
| **Trace** | The **flight recorder**: a faithful, time-ordered recording of the whole call (caller + agent mixed at real timing) + the **oracle** (STT) transcript + per-turn text + the tool trace + timings. Persisted, so judges re-run *without* re-running the agent. | the run's recording + `cassettes/` |
| **Assess** | **Deterministic gates** (hard pass/fail invariants) + an **advisory LLM judge** (the fuzzy stuff) + **monitoring metrics** (latency). | `soundcheck run` |
| **Refine** | A coding agent treats *the voice agent* as its codebase and *the gates* as its test suite: read failures → diagnose from the trace → patch → re-run. | `soundcheck tune` |

Plus coSTAR's **second loop** — judge alignment — so the judge is *trusted* before anything leans on it (`soundcheck calibrate`).

## Quickstart — test *your* agent

```bash
echo "DEEPGRAM_API_KEY=dg_..." > .env      # the only key you need
npm install                                 # devDeps only — zero runtime deps

# 1. Author a suite from YOUR agent's spec (tools + system prompt) — no human writes the cases
soundcheck author --spec ./my-agent.ts      # 🚧 generic today only for the bundled example

# 2. Run it live against your agent; gate it; get a faithful, debuggable trace
soundcheck run scenarios --aut ./my-agent.ts

# 3. Hear exactly what happened + read what Soundcheck's own oracle heard
open runs/report-*.html

# 4. Tune until green — agent fixes agent
soundcheck tune --agent ./my-agent.ts --fixer "claude -p"
```

## Capabilities

### Scenario — portable test fixtures
- **✅ Declarative scenarios** (`name`, `persona`, caller turns or `goal`, `assert`) that run unchanged across agent versions via the `AUTAdapter` abstraction.
- **🚧 Autonomous authoring for *any* agent.** `author --spec` generates scenarios + a rubric from an agent's tools + prompt. *Today it works but is restaurant-flavored; aspirational = domain-agnostic, driven purely by the agent's own spec.*
- **🚧 Regression-from-production.** Point Soundcheck at a real failed call → it auto-authors a scenario + cassette that reproduces it. *Every production bug becomes a regression test.*

### Trace — the flight recorder
- **✅ Real-time mixed recording** of the whole call (caller + agent overlaid at true playback timing), played back in the report.
- **✅ Oracle self-validation.** Soundcheck runs its *own* STT over the recording and shows "what Soundcheck heard" — ground truth, on every live run.
- **✅ Per-turn capture** (heard text, agent text, tool calls, TTFB) + **record/replay cassettes** so CI replays offline, deterministically.
- **🚧 First-class, structured `Trace` artifact.** A single persistable object — recording + oracle + turns + tools + timings — that gates and judges operate on *without re-running the agent* (coSTAR: "iterate on judges without re-running scenarios"). *Today the pieces exist; aspirational = one clean, versioned Trace type.*

### Assess — gates, judge, metrics
- **🚧 Declarative invariant gates (domain-agnostic).** A customer *declares* their invariants and Soundcheck enforces them deterministically:
  ```jsonc
  "assert": [
    "never_speak_symbols",                                  // ✅ shipped
    { "tool_args_match_schema": "bookAppointment" },        // 🚧 generalize tool_arg_iso
    { "tool_sequence": ["verifyIdentity", "before", "accessRecord"] }, // 🚧 new
    { "spoken_matches_tool": { "field": "date", "tool": "bookAppointment" } }, // 🚧 generalize value_consistency
    { "required_tool": "scheduleCallback" },                // ✅ shipped
    { "forbidden_tool": "chargeCard" },                     // 🚧 new
    { "grounding": { "now": "2026-05-29", "resolve": "relative_dates" } }, // 🚧 generalize off restaurant dates
    { "latency": { "ttfb_ms": { "max": 2000 } } }           // ✅ shipped
  ]
  ```
  *Today's `grounding`/`value_consistency` are hardcoded to restaurant booking + dates; aspirational = a composable gate registry that works for tech-support, healthcare intake, finance IVR — any STS agent.*
- **✅ Advisory LLM judge** (Deepgram-fronted, rubric + findings, panel aggregation) for the fuzzy dimensions (natural? goal met? confirmed before acting?) — never hard-gates.
- **✅→🚧 Judge alignment.** `calibrate` scores the judge against a labeled corpus (agreement/precision/recall). *Aspirational = a real alignment loop: a cross-model Golden Set, trust reported before the judge is used, drift caught over time.*

### Refine — agent fixes agent
- **✅→🚧 Tuning loop.** `tune` proposes prompt edits, kept only if a **held-out** set improves (Goodhart guard). *Today: the loop + guard are real with a pluggable `--fixer`; aspirational = trace-driven root-cause ("the agent spoke before the tool returned") feeding the fixer, full red-green.*

### Voice-native testing (the moat)
- **✅ Faithful turn-taking** — endpoints on the agent's real end-of-speech, no smeared turns.
- **✅ Barge-in** — the caller cuts in mid-reply; the VA's server-side interruption is captured faithfully (oracle-validated: the agent truncates and re-addresses).
- **✅ Reactive caller (Evaline).** A goal-driven synthetic caller improvises toward a goal, reacting to what the agent actually said, and hangs up when done.
- **🚧 Adversarial discovery.** Evaline as a fuzzer/red-teamer — interruptions, confusion, topic-switches, hostile/ambiguous input (later: accents, background noise) — to *surface* failure modes, not just check known ones.
- **🚧 A/B & vendor bake-off.** Run one suite against two prompts / `think` models / TTS voices and diff the gate + judge results.

## Autonomous — no human in the loop

Soundcheck is built to be driven by a coding agent with **zero human gates**:
- **Deterministic gates own the hard pass/fail** — fully autonomous, no model-in-the-judgment-path for the verdicts that gate a merge.
- **The LLM judge is advisory and calibrated** — it informs, it never silently gates; its trust is measured and reported.
- **Determinism via record/replay** — a stochastic live call becomes a reproducible CI fixture.
- **The oracle is the arbiter** — every claim about a run is checkable against Soundcheck's own STT of the real audio, so an agent (or a reviewer) never has to take a pass/fail on faith.

## Soundcheck verifies Soundcheck

The harness proves *itself* with its own tools — the only honest way to ask others to trust it:
- **✅ The oracle** transcribes every live recording; the report shows it. (This is what caught our own bugs.)
- **✅ Self-evaluation suite** — Evaline-as-AUT, with a deliberately-broken-Evaline fixture that *must* fail.
- **✅ Judge calibration** against a labeled corpus.
- **🚧 End-to-end self-test.** Soundcheck's generic gates run against Soundcheck's own example agents (and against a deliberately-regressed build) as a standing CI proof that the harness catches what it claims to.

## One key, zero deps
Default + CI operation needs **only `DEEPGRAM_API_KEY`** — caller brain, voice, transcription, oracle, and judge all run on Deepgram. **Zero runtime dependencies** (Node 22 native TypeScript). MIT licensed.

## Scope
This aspirational README is **STS-focused** by deliberate choice: STS is the highest-value, hardest-to-test, most differentiated voice surface — the true moat. Standalone **STT** and **TTS** validators (WER/accuracy corpora, pronunciation suites) are **🚧 possible future** directions, evaluated *after* STS is great, not bundled in.

---

## Shipped vs. Aspirational

| Capability | Status | The gap to close |
|---|---|---|
| Real-time recorder + oracle self-validation | ✅ Shipped | — |
| Faithful turn-taking + barge-in | ✅ Shipped | — |
| Reactive goal-driven caller (Evaline) | ✅ Shipped | — |
| Deterministic gates (symbols, ISO, required-tool, latency) | ✅ Shipped | — |
| Record/replay cassettes (persisted traces) | ✅ Shipped | — |
| Advisory LLM judge + panel | ✅ Shipped | — |
| Judge calibration (seed) | ✅ Shipped | Grow into a trusted-judge alignment loop (cross-model Golden Set, drift) |
| Autonomous authoring | ✅ Shipped (M4) | Domain-agnostic — one scenario per tool from any agent's spec, generic gates wired; caller lines are mechanical starting points |
| Tuning loop (seed) | ✅ Shipped | Trace-driven root-cause feeding the fixer; full red-green |
| **Declarative, domain-agnostic gates** | ✅ Shipped (M1) | Composable gate registry: `tool_sequence`, `tool_args_match_schema`, `spoken_matches_tool`, `forbidden_tool`, generic grounding — restaurant coupling deleted |
| **Non-restaurant example** | ✅ Shipped (M2) | IT-support agent (`examples/support/`); same gates, oracle-validated catching its bugs, pinned offline |
| **First-class structured `Trace`** | ✅ Shipped (M3) | `Trace` type + versioned persistence (v2 retains the oracle); gates AND the judge run on a persisted trace offline (proven in `test/trace.test.ts`) |
| **Adversarial / edge-case discovery** | 🚧 Aspirational | Evaline as fuzzer/red-teamer surfacing unknown failure modes |
| **A/B & vendor bake-off** | 🚧 Aspirational | Same suite vs. multiple configs, diffed |
| **Regression-from-production** | 🚧 Aspirational | Failed real call → auto-authored reproducing scenario + cassette |
| **End-to-end Soundcheck-tests-Soundcheck CI proof** | 🚧 Aspirational | Generic gates catch a deliberately-regressed build, in CI |
| **Bring-your-own-agent onboarding** | 🚧 Aspirational | Docs reframed around S/T/A/R + "test YOUR agent," not TableTalk |

*MIT licensed. Built for the agents-test-agents era — for voice.*

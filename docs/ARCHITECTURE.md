# Soundcheck — Architecture

> Status: **v2.1.0** — this document describes the system design, and the system is now built. See [`LIMITATIONS.md`](LIMITATIONS.md) for exactly what it does and does not do. Shipped: **9 deterministic gates** in a composable registry, the round-trip validator, the advisory judge + calibration/alignment, autonomous authoring, the trace-driven tuning loop, the self-improving loop (discover → promote → refine), A/B & vendor bake-off, two CLI-selectable adapters (Deepgram VA + MockAUT) plus one reference adapter (OpenAI Realtime), scripted **and** reactive goal-driven callers including an adversarial red-team persona, and a reusable composite GitHub Action.

## 1. What Soundcheck is

Soundcheck is a **voice-agent test & tuning harness**. It exercises a voice agent the way a real caller would — over actual audio — and turns the result into a verdict a coding agent can act on, with **no human in the iteration loop**. It has three faces:

- a **deterministic regression suite** (Playwright-style hard pass/fail),
- an **eval + tuning** layer (LLM-judge scoring + a closed loop that improves the agent), and
- a **round-trip STT↔TTS validator** (the cheapest, highest-fidelity primitive).

The design goal is that an autonomous agent can **build → test → tune → ship** a voice agent using Soundcheck as its oracle, the same way it uses Playwright for a web app.

## 2. Core concepts

- **AUT — Agent Under Test.** The voice agent being tested. A black box behind a thin **adapter** (audio-in / audio-out + events). Three adapters ship — Deepgram Voice Agent (default), a creds-free MockAUT (the CI target), and an OpenAI-Realtime reference adapter — and the interface is built so Vapi, Retell, a Twilio/SIP phone number, or a turn-based HTTP agent can be added later. *Soundcheck tests any voice agent; only the adapter is provider-specific.*
- **Evaline — the synthetic caller.** A **Deepgram Voice Agent** configured as a customer with a goal + persona, who calls the AUT over real audio. Evaline's *runtime* is always a Deepgram VA (deliberately; see §6); her behavior is pluggable — scripted, reactive goal-driven, or an `adversarial` red-teamer (a `PlanFn` brain picks each line). She is the "voice agent that tests other voice agents."
- **Scenario.** A declarative spec: Evaline's goal + persona, optional turn script, the deterministic assertions, and the judge rubric. Scenarios are the *test cases*; Soundcheck is the *runner*.
- **Run.** One Evaline↔AUT conversation, fully captured (audio, transcripts, tool calls, timings), then scored.

## 3. The pipeline

```
  scenario ──▶ EVALINE (Deepgram VA caller) ──audio──▶ AUT (via adapter)
                                                          │ audio + events
                                                          ▼
                                                   CAPTURE / round-trip
                                          (STT on the AUT's real audio + trace + timing)
                                                          │ a structured Trace
                                            ┌─────────────┴─────────────┐
                                            ▼                           ▼
                                  DETERMINISTIC GATES            LLM JUDGE
                                  (code, pass/fail)              (rubric, scored)
                                            └─────────────┬─────────────┘
                                                          ▼
                                              SCORECARD + HTML report
                                                          │
                                              (optional) TUNING LOOP:
                                       failures ▶ fixer-agent ▶ edit AUT ▶ re-run
```

Every stage maps to a piece we already validated in the research spike (see §11).

## 4. Components

### 4.1 Evaline — the synthetic caller
A Deepgram Voice Agent whose `think` prompt encodes a **persona** and a **goal**, speaking through Deepgram TTS into the AUT's audio input. Personas are prompt presets: `cooperative`, `impatient`, `accented` (via voice/style selection), `noisy-line` (mixed-in background audio), `rambler`, `mind-changer`, `adversarial` (interrupts / barges in / goes off-script). Evaline can run **scripted** (fixed turns) or **goal-driven** (improvises toward her objective and stops when met or stuck).

Implementation notes carried from the spike: audio must be streamed at **real time** (bursting breaks endpointing) with a **continuous silence keepalive** between turns (the VA drops the "call" if audio stops). Turn-taking is **settle-based** (advance when the AUT goes quiet after responding), not single-event-based.

### 4.2 Capture / round-trip oracle
Records the full exchange: Evaline's words, the AUT's emitted text/events (if the adapter exposes them), **the AUT's actual spoken audio round-tripped back through STT** (so we judge what a listener *hears*, not what the model *typed*), the **tool-call trace**, and **timings** (TTFB, turn latency, barge-in handling). The round-trip is also exposed **standalone**: `text→TTS→STT→compare` validates TTS; `known-audio→STT→compare` validates STT.

### 4.3 Deterministic gates (the regression suite)
Pure-code, pass/fail assertions over the captured `Trace`, exposed through a **composable gate registry** (`src/gates/index.ts`): each gate is a `GateFn` registered under its assert key, so the same gates test a restaurant booker, a support bot, or a finance IVR — any STS agent. Adding a gate is a function plus one registry entry. A scenario `assert` that names an unregistered key fail-CLOSES (it does not crash the run), and a gate that throws is reported as a failure rather than aborting. The ten registered gates (productized directly from spike findings):
- **`no_spoken_symbols`** — the heard audio never contains "star", "pound", "hashtag", a dash read as "negative" before a price, etc.
- **`no_spoken_cardinal_ids`** — identifiers (confirmation numbers, SSNs, ZIPs) are spoken digit-by-digit, not as a cardinal number ("four thousand four hundred seventeen").
- **`spoken_matches_tool`** — a spoken value equals its tool-call value (e.g. spoken date == booked date); for alphanumeric identifiers (a flight number, a confirmation code) it verifies the digit runs were read back intelligibly, tolerating STT mishearing the letters.
- **`spoken_consistent_with_tool`** — the agent's spoken commitments stay consistent with what it did: the *last* date it confirms is one a tool actually used, and any spoken "*weekday, month day*" is internally coherent (e.g. not "Thursday, June 2nd" when June 2 is a Tuesday). Catches an agent that says the right value, is pushed by an impatient caller, and verbally caves to a wrong one while the booking stays correct — a divergence `spoken_matches_tool` (existence-only) and `grounding` (tool-args-only) both miss.
- **`tool_args_match_schema`** — a tool call conforms to its declared schema: type / required / format / enum / pattern (e.g. `date` is ISO `YYYY-MM-DD`). *(This catches the spike's "speech-fix broke the tool-arg format" regression — a class the speech oracle alone cannot see.)*
- **`grounding`** — a relative date ("this Saturday") resolves to the correct calendar date / not a stale year.
- **`tool_sequence`** — ordering invariants ("verifyIdentity before accessRecord").
- **`required_tool`** / **`forbidden_tool`** — a tool must / must never be called.
- **`latency`** — TTFB / turn-latency thresholds.
Teams (or an authoring agent) add their own. Deterministic gates **block CI**; they are the "Playwright assertions" of voice.

### 4.4 Judge (eval)
An **LLM-as-judge** scores the subjective dimensions the gates can't: naturalness, goal completion, confirm-before-acting, recovery from interruption, conciseness. It reads the **transcribed actual audio** (not the model's text). Design rules from the spike:
- **Judge ≠ AUT's own model** wherever possible (avoid "marking your own homework"). In v0/v1 the judge runs on the Deepgram-fronted LLM (§6); pluggable for a different model.
- Judge scores **trend / threshold**, they do **not** hard-gate CI (only deterministic gates do). An LLM opinion shouldn't block a merge.
- Optional **judge panel** (N judges, majority/avg) for robustness on high-stakes scenarios.

### 4.5 Tuning loop (agents tuning agents)
The closed loop: run the suite → collect failures → a **fixer-agent** proposes edits (system-prompt changes, voice-safety/sanitizer rules, tool-schema fixes, date-grounding injection) → re-run → keep edits that raise the score, discard the rest. This is exactly what turns a prototype into a shippable agent. **Overfitting guardrail (the real one — see §5):** the tuner optimizes against a *training* scenario set and is scored on a **held-out** set it never sees, so it can't game its own evals.

## 5. Who decides what "good" is

Soundcheck's authoring agent **defines quality itself.** Universal voice-agent quality — natural speech, no spoken symbols, confirm before acting, no double-booking, graceful interruption recovery, low latency, correct read-back — is generated from the AUT's own spec/system-prompt; it does not need a human to enumerate it.

The one thing the agent does **not** invent is **domain fact**: "this restaurant is closed Mondays," "never seat parties over 8," "always offer the prix fixe." Those are business truths, not quality judgments, and they come from wherever the spec lives — a product doc, the AUT's system prompt, or a higher-level agent that read them. Soundcheck's eval-authoring step **reads the AUT's spec to derive business-rule assertions**, then layers universal quality on top. Given a spec exists, scenario + rubric generation is fully autonomous.

The remaining guardrail is **methodological, not authority-based**: an optimizer must not grade its own homework on the set it tunes against. Hence held-out evals, judge diversity (judge model ≠ AUT model), and **automated cross-model calibration** against a self-constructed labeled corpus (a sanity check on the judge, not the source of truth). All of this is automated — **no human is in this loop**; it keeps the loop from fooling *itself*, and has nothing to do with a human "knowing better." (An optional human sign-off may happen *after* the build is complete, but never gates it.)

## 6. Deepgram-key-only — why this works {#deepgram-key-only}

**The entire toolkit runs on a single `DEEPGRAM_API_KEY`.** This is not aspirational — the core of it was proven in the research spike:

| Component | Needs an LLM? | How it runs on the Deepgram key |
|---|---|---|
| Evaline (caller) | Yes (her brain) | The Deepgram VA `think` LLM. **Proven in the spike:** a VA ran think→speak with *only* the Deepgram key passed; no OpenAI/Anthropic key was ever provided. Deepgram fronts the LLM and bills the call to your Deepgram credit. |
| TTS (Evaline's voice, round-trip) | No | Deepgram Aura. |
| STT (capture, round-trip) | No | Deepgram Nova. |
| Deterministic gates | No | Pure code. |
| Judge | Yes | Routed through the **same Deepgram-fronted LLM** — a "grader" agent that emits a structured verdict via function-calling. Pluggable to bring-your-own model. |
| Tuning fixer-agent | Yes | The developer's coding agent (Claude Code / Codex / Cursor) — which uses a **subscription, not an API key**. Soundcheck invokes it as a local CLI/process, so no LLM API key is needed here either. |

**The result:** "a Deepgram-powered toolkit that gets *any* voice agent production-ready" is a true, defensible claim — and it means a user with only a Deepgram key (and a Claude/Codex subscription for the optional tuning step) can run the whole thing.

**One honest impurity:** Deepgram's LLM is exposed through the *voice-agent* runtime, so using it as a text **judge** means routing a text-grading task through a VA grader configuration (feed the transcript as context, trigger one turn, capture a `submitVerdict` function call). It works and keeps everything on one key; if/when Deepgram exposes a plain text-completion endpoint, the judge gets cleaner. The deterministic regression suite + round-trip validation + Evaline have **no** such caveat — they are natively Deepgram-key-only.

## 7. Adapters

```
interface AUTAdapter {
  start(scenario): Promise<Session>          // open a session with the agent under test
  sendAudio(session, pcmFrame): void          // stream caller (Evaline) audio in
  onAgentAudio(session, cb): void             // receive agent spoken audio out
  onEvent(session, cb): void                  // transcripts, tool calls, timings (if exposed)
  end(session): Promise<void>
}
```
Three adapters ship today (`src/adapters/`):
- **`DeepgramVoiceAgentAdapter`** (raw `wss://agent.deepgram.com/v1/agent/converse`) — the default; lets us dogfood on the TableTalk agent from the spike.
- **`MockAUTAdapter`** — a tiny, creds-free, deterministic agent (scripted / `--buggy`) used as the CI target so the same scenarios + gates + report run unchanged against a **non-Deepgram-VA** agent, proving the abstraction.
- **`openai-realtime`** — a **reference** adapter whose *live* run is opt-in (reads `OPENAI_API_KEY` only if a developer wires it; CI never touches it). This is what proves "any voice agent": even agents on a competitor's runtime get tested via Soundcheck → which runs on Deepgram STT/TTS.

**Later:** Vapi, Retell, Twilio/SIP (real phone number), turn-based HTTP, browser (Playwright-driven) — tracked, not built.

Adapters (and every other extension point — gates, judge backend, fixer, caller) are exported from the public API barrel `src/index.ts`, surfaced through the `package.json` `"exports"` map: consumers `import { … } from "soundcheck"` rather than reaching into deep `src/` paths. (Internal-only helpers — e.g. `src/selfeval/` — are intentionally not re-exported.)

## 7b. Determinism: record / replay (the trust mechanism)

Live voice is stochastic, so the adapter has two modes. **record:** a live run writes a *cassette* (the full `RawTurn[]` — caller text, captured agent audio, tool calls, timings) to `fixtures/cassettes/`. **replay:** reconstructs the run from a cassette with no socket/model/credits. Everything downstream of capture (gates, judge, report) is therefore **deterministic in CI**; live runs are nightly and surface *behavior drift* separately from *logic regressions*. Cassettes are re-recorded only via a reviewed PR. This is what lets a flaky-by-nature tool be trustworthy — and what makes "Soundcheck evaluates Soundcheck" reproducible. (Full rationale: `TESTING.md`.)

## 7c. Component detail

**Judge.** A `judge/` module that scores the *heard* transcript against a rubric and emits a structured verdict `{ dimension: {score 1-5, why} , findings: [{tag, quote}] }`. Default backend: the **Deepgram-fronted LLM** via a grader-agent that returns the verdict through a `submitVerdict` function-call (Deepgram-key-only; §6). Backend is pluggable (bring-your-own model); `--judge mock` is an offline, rule-based judge for keyless CI. Supports a **judge panel** (N graders, aggregate) for high-stakes scenarios. The judge is **advisory** — it threshold-warns, it does not hard-gate CI (only deterministic gates do). Its own trustworthiness is measured by calibration/alignment (`calibrate`; § TESTING 3.2).

**Autonomous eval authoring.** `author --spec <agent-spec>` ingests an agent's spec/system-prompt and emits a scenario suite: one scenario per tool with **generated universal quality assertions + a rubric** (`no_spoken_symbols`, `required_tool`, `tool_args_match_schema`, date `grounding`, `latency`), destructive tools skipped and identity-gated tools given a proactive caller. It also **extracts business rules from the prompt and surfaces them as hints** (`businessRules: string[]` — hours, party-size caps, etc.) for a downstream author/agent to turn into assertions; auto-generating an assertion for an arbitrary domain rule is a tracked enhancement, not done. Output is the same scenario JSON a human would write — the agent writes the test cases; the runner runs them.

**Tuning loop (Refine).** `tune <agent> --spec <spec>`: run the suite → produce a root-cause diagnosis per failing gate → a **fixer** proposes edits → re-run → **keep an edit only if a held-out scenario set the tuner never sees improves** (the Goodhart guardrail) → emit a reviewable diff + before/after report, under a hard iteration cap + convergence criterion. The fixer is pluggable via `--fixer` (e.g. `--fixer "claude -p …"` — a *local coding agent*, subscription, so still no LLM API key); the bundled demo fixer is **rule-based / deterministic**, proving the loop + Goodhart-guard mechanism end-to-end rather than fixer *intelligence*.

**Self-improving loop.** `run --promote-failures` freezes a failing call an adversarial caller *discovers* into a permanent scripted regression (`src/regress/promoteTrace`), which `tune` then refines against — the suite grows from failures nobody scripted. End-to-end in `examples/self-improving-loop/`; the closure is pinned offline in `test/regress.test.ts`.

**Bake-off.** `bakeoff` runs one scenario suite against two AUT configs and diffs the per-gate results (and, with `--judge`, the advisory judge) — A/B and cross-vendor comparison (`src/bakeoff/`).

## 7d. Self-evaluation — Soundcheck on Soundcheck

Three forms, all in `TESTING.md`: **(a)** Evaline-as-AUT — point the harness at its own caller and assert persona/goal/clean-speech, with a deliberately-broken-Evaline fixture that must fail the meta-suite; **(b)** judge calibration against a labeled corpus (precision/recall per dimension); **(c)** the bare→grounded golden ladder as a self-regression (replay-CI + live-nightly). This is the design's central trust claim: the tester is tested — including by itself — to a higher bar than what it tests.

## 8. Scenario format (DSL)

On disk a scenario is **JSON** (`scenarios/*.json`); the YAML below is shown only for readability. The shape is the same either way.

```yaml
name: book-modify-confirm
persona: cooperative          # cooperative | impatient | accented | noisy-line | rambler | mind-changer | adversarial
goal: "Book a table for 4 this Saturday at 7:30pm under 'Garcia', then move it to 6:30, then confirm."
mode: goal-driven             # or: scripted, with `turns: [...]`
assert:                        # deterministic gates (the dev/agent writes these)
  - no_spoken_symbols
  - no_spoken_cardinal_ids
  - { spoken_matches_tool: { field: date, tool: bookReservation } }
  - { tool_args_match_schema: bookReservation }
  - { latency: { ttfb_ms: { max: 800 } } }
  - { required_tool: modifyReservation }
rubric:                        # judge dimensions
  - goal_completed
  - confirmed_before_acting
  - natural_speech
  - recovered_from_interruptions
```

## 9. CI / regression gating

`soundcheck run scenarios/` → runs every scenario, emits a JSON scorecard + an HTML report (transcripts, heard-audio, per-assertion pass/fail, judge scores, latency, audio playback). Exit non-zero if any **deterministic** gate fails; judge scores are reported and threshold-able but don't hard-fail by default. Ships with a GitHub Action so a voice agent's repo gets the same "tests must pass before merge" gate a web app has.

## 10. Honest limits & non-goals

- **Synthetic-caller audio is clean TTS.** Excellent for behavior / logic / format / turn-taking coverage; **not** a substitute for real-world acoustic robustness (accents, background noise, telephony codecs). v1 supports injecting a real noisy/accented corpus; until then, Soundcheck tests *what the agent does*, not *how it handles bad audio*.
- **The judge is non-deterministic** — mitigated by deterministic-gates-first, panels, and calibration; never a hard CI gate.
- **The tuning loop can overfit** (Goodhart) — mitigated by held-out scenario sets.
- **Full-duplex barge-in timing** is approximated, not perfectly reproduced.
- **Non-goals (for now):** load/perf testing at scale; non-English (v0 is English). (Note: the *build* of Soundcheck is fully autonomous — the only human touchpoint is an optional sign-off after completion. In *use*, Soundcheck shrinks a team's human QA to an optional final review, not zero.)

## 11. Provenance — what the spike already proved (so this isn't speculative)

| Soundcheck component | Spike artifact that validated it |
|---|---|
| Round-trip oracle | `verifiability-harness/oracle.mjs` — reproduced human listening-test verdicts headlessly |
| Voice-safety deterministic gates | `stage3-voice-judge/live-assert.mjs` — the bare/hardened/grounded 1/1/3 ladder; caught the tool-arg-format regression |
| Evaline (synthetic caller over the live socket) | `stage3-voice-judge/run-conversation.mjs` — drove a real Deepgram VA headlessly with synthesized caller audio |
| Judge | `stage3-voice-judge/JUDGE_VERDICT.md` — a cross-vendor judge reproduced the human-Tier-3 verdict and separated agent faults from harness artifacts |
| Tuning loop | the spike's closed-loop fork — an agent built a sanitizer until the voice gate went green, with no guide |
| Deepgram-key-only think LLM | the Stage-3 runs authenticated with only the Deepgram key; the VA `think` step worked with no separate LLM key |

## 12. Repo layout

```
soundcheck/
├── src/
│   ├── index.ts         # public API barrel — the one front door (see package.json "exports")
│   ├── cli.ts           # `soundcheck run | validate | calibrate | author | tune | bakeoff`
│   ├── types.ts         # core data model — Scenario, Trace, AUTConfig, AssertSpec, ToolSchema, …
│   ├── deepgram.ts      # Deepgram STT/TTS/VA primitives (the single-key surface)
│   ├── normalize.ts     # spoken-text normalization + artifact/dash detection
│   ├── caller/          # Evaline: scripted + reactive goal-driven callers, persona presets, planner
│   ├── adapters/        # AUTAdapter interface + deepgram-va, mock-aut, openai-realtime adapters
│   ├── capture/         # round-trip oracle, Trace model, cassette record/replay
│   ├── gates/           # deterministic gate registry (the 9 gates)
│   ├── judge/           # advisory LLM judge (Deepgram-fronted grader) + rubric + panel
│   ├── calibration/     # judge-alignment loop (trust verdict, cross-model, drift guard)
│   ├── tune/            # trace-driven tuning loop (diagnose + Goodhart held-out guard)
│   ├── author/          # autonomous scenario authoring from an agent's spec
│   ├── bakeoff/         # A/B & vendor bake-off (one suite, two configs)
│   ├── regress/         # promoteTrace — freeze a discovered failure into a regression
│   ├── report/          # self-contained HTML scorecard (embedded audio)
│   └── selfeval/        # Evaline self-checks (internal-only; not re-exported)
├── scenarios/           # golden scenario library (.json)
├── examples/            # tabletalk, support, healthcare, banking, travel, authored-*, tune-demo,
│                        #   interactive, self-improving-loop
├── fixtures/cassettes/  # recorded runs for deterministic replay in CI
├── test/                # the deterministic suite (152 tests; see TESTING.md)
├── docs/                # ABOUT.md, ARCHITECTURE.md, TESTING.md, CALIBRATION.md, LIMITATIONS.md
├── action.yml           # reusable composite GitHub Action
└── .github/workflows/   # ci.yml (validate) + nightly.yml (live)
```

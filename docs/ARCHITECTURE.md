# Soundcheck — Architecture

> Status: design (pre-v0). This document is the source of truth for what we are building and why. The phased build plan lives in [`ROADMAP.md`](ROADMAP.md).

## 1. What Soundcheck is

Soundcheck is a **voice-agent test & tuning harness**. It exercises a voice agent the way a real caller would — over actual audio — and turns the result into a verdict a coding agent can act on, with **no human in the iteration loop**. It has three faces:

- a **deterministic regression suite** (Playwright-style hard pass/fail),
- an **eval + tuning** layer (LLM-judge scoring + a closed loop that improves the agent), and
- a **round-trip STT↔TTS validator** (the cheapest, highest-fidelity primitive).

The design goal is that an autonomous agent can **build → test → tune → ship** a voice agent using Soundcheck as its oracle, the same way it uses Playwright for a web app.

## 2. Core concepts

- **AUT — Agent Under Test.** The voice agent being tested. A black box behind a thin **adapter** (audio-in / audio-out + events). v0 ships one adapter (Deepgram Voice Agent); the interface is built so Vapi, Retell, OpenAI Realtime, a Twilio/SIP phone number, or a turn-based HTTP agent can be added later. *Soundcheck tests any voice agent; only the adapter is provider-specific.*
- **Evaline — the synthetic caller.** A **Deepgram Voice Agent** configured as a customer with a goal + persona, who calls the AUT over real audio. Evaline is *not* pluggable in v0 — she is always a Deepgram VA (deliberately; see §6). She is the "voice agent that tests other voice agents."
- **Scenario.** A declarative spec: Evaline's goal + persona, optional turn script, the deterministic assertions, and the judge rubric. Scenarios are the *test cases*; Soundcheck is the *runner*.
- **Run.** One Evaline↔AUT conversation, fully captured (audio, transcripts, tool calls, timings), then scored.

## 3. The pipeline

```
  scenario ──▶ EVALINE (Deepgram VA caller) ──audio──▶ AUT (via adapter)
                                                          │ audio + events
                                                          ▼
                                                   CAPTURE / round-trip
                                          (STT on the AUT's real audio + trace + timing)
                                                          │ a structured Transcript
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
Pure-code, pass/fail assertions over the captured `Transcript`. Soundcheck ships a built-in **voice-safety rule pack** (productized directly from spike findings):
- **no-spoken-symbols** — the heard audio never contains "star", "pound", "hashtag", a dash read as "negative" before a price, etc.
- **value-consistency** — a spoken value equals its tool-call value (e.g. spoken date == booked date).
- **tool-arg-wellformed** — dates passed to tools are ISO `YYYY-MM-DD`, times are 24h `HH:MM`, etc. *(This catches the spike's "speech-fix broke the tool-arg format" regression — a class the speech oracle alone cannot see.)*
- **grounding** — booked date resolves to the correct calendar date / not a stale year.
- **required-tool-called**, **no-double-booking**, **latency-SLO** (TTFB / turn latency thresholds), **PII-not-leaked**.
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

The remaining guardrail is **methodological, not authority-based**: an optimizer must not grade its own homework on the set it tunes against. Hence held-out evals, judge diversity (judge model ≠ AUT model), and occasional cross-model or human **calibration** (a sanity check on the judge, not the source of truth). This is how you keep the loop from fooling itself — it has nothing to do with a human "knowing better."

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
- **v0:** `DeepgramVoiceAgentAdapter` (raw `wss://agent.deepgram.com/v1/agent/converse`) — lets us dogfood on the TableTalk agent from the spike.
- **Later:** OpenAI Realtime, Vapi, Retell, Twilio/SIP (real phone number), turn-based HTTP, browser (Playwright-driven). The second adapter (v1) is what *proves* "any voice agent" and powers the strategic wedge: even agents built on a competitor's runtime get tested via Soundcheck → which runs on Deepgram STT/TTS.

## 8. Scenario format (DSL)

```yaml
name: book-modify-confirm
persona: cooperative          # cooperative | impatient | accented | noisy-line | rambler | mind-changer | adversarial
goal: "Book a table for 4 this Saturday at 7:30pm under 'Garcia', then move it to 6:30, then confirm."
mode: goal-driven             # or: scripted, with `turns: [...]`
assert:                        # deterministic gates (the dev/agent writes these)
  - no_spoken_symbols
  - { value_consistency: { spoken: date, equals: tool.bookReservation.date } }
  - { tool_arg_iso: bookReservation.date }
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
- **Non-goals (for now):** load/perf testing at scale; non-English (v0 is English); replacing human QA entirely (it shrinks human QA to calibration, not zero).

## 11. Provenance — what the spike already proved (so this isn't speculative)

| Soundcheck component | Spike artifact that validated it |
|---|---|
| Round-trip oracle | `verifiability-harness/oracle.mjs` — reproduced human listening-test verdicts headlessly |
| Voice-safety deterministic gates | `stage3-voice-judge/live-assert.mjs` — the bare/hardened/grounded 1/1/3 ladder; caught the tool-arg-format regression |
| Evaline (synthetic caller over the live socket) | `stage3-voice-judge/run-conversation.mjs` — drove a real Deepgram VA headlessly with synthesized caller audio |
| Judge | `stage3-voice-judge/JUDGE_VERDICT.md` — a cross-vendor judge reproduced the human-Tier-3 verdict and separated agent faults from harness artifacts |
| Tuning loop | the spike's closed-loop fork — an agent built a sanitizer until the voice gate went green, with no guide |
| Deepgram-key-only think LLM | the Stage-3 runs authenticated with only the Deepgram key; the VA `think` step worked with no separate LLM key |

## 12. Repo layout (target)

```
soundcheck/
├── src/
│   ├── caller/          # Evaline: persona presets + Deepgram VA driver (real-time pump, settle turn-taking)
│   ├── adapters/        # AUTAdapter interface + deepgram-va adapter (v0)
│   ├── capture/         # round-trip oracle, transcript model, timing
│   ├── gates/           # deterministic assertions + voice-safety rule pack
│   ├── judge/           # LLM judge (Deepgram-fronted grader) + rubric runner
│   ├── tune/            # fixer-agent loop (invokes a local coding agent)
│   ├── report/          # HTML scorecard
│   └── cli.ts           # `soundcheck run|validate|tune`
├── scenarios/           # golden scenario library (booking / support / FAQ / ...)
├── examples/tabletalk/  # dogfood target from the spike
├── docs/                # ARCHITECTURE.md, ROADMAP.md
└── .github/workflows/   # CI action
```

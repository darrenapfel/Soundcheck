# Soundcheck — Roadmap & Phased Build Plan

> Build order is deliberately **deterministic-core first** (highest certainty, Deepgram-key-only, no LLM-judge variance), then the judge, then the tuning loop. Each phase is independently useful and shippable. See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the system design.

## Guiding principles
1. **Dogfood from day one** — every phase is validated against the TableTalk voice agent from the research spike (`examples/tabletalk/`).
2. **Deterministic before subjective** — pass/fail gates land before the LLM judge; the judge lands before the tuning loop.
3. **Deepgram-key-only stays true at every phase** (verify in CI that no other key is read).
4. **Reuse the spike** — v0 is largely a refactor of validated code, not a green-field build (see Architecture §11).

---

## v0 — The deterministic core (the "Playwright for voice" MVP)
**Goal:** `soundcheck run scenarios/` drives Evaline against a real voice agent, captures the conversation, runs deterministic gates, and emits an HTML report — entirely on a Deepgram key.

**Deliverables**
- [ ] `caller/` — Evaline as a Deepgram VA: persona presets (start with `cooperative` + `impatient`), real-time audio pump, silence keepalive, settle-based turn-taking. *(refactor of `run-conversation.mjs`)*
- [ ] `adapters/deepgram-va` — the v0 AUT adapter + the `AUTAdapter` interface. *(generalize the spike's socket client)*
- [ ] `capture/` — round-trip oracle, `Transcript` data model (caller text, heard-back audio→STT, tool trace, timings). *(refactor of `oracle.mjs`)*
- [ ] `gates/` — assertion engine + the **voice-safety rule pack**: `no_spoken_symbols`, `value_consistency`, `tool_arg_iso`, `grounding`, `latency`, `required_tool`. *(refactor of `live-assert.mjs`)*
- [ ] `report/` — HTML scorecard with per-assertion pass/fail, transcripts, latency, and audio playback.
- [ ] `cli.ts` — `soundcheck run <dir>` (exit non-zero on any deterministic-gate failure); `soundcheck validate --tts <text>` / `--stt <wav>` (standalone round-trip).
- [ ] `scenarios/` — 3 golden scenarios (book-modify-confirm, menu+price query, restaurant-info FAQ).
- [ ] `examples/tabletalk/` — dogfood: point v0 at the spike's TableTalk agent and reproduce the bare/hardened/grounded ladder as a Soundcheck report.

**Definition of done:** a fresh clone, `DEEPGRAM_API_KEY=… soundcheck run scenarios/`, produces a report that **catches the "STAR STAR" / dash-as-negative / non-ISO-date / ungrounded-date bugs and passes a clean agent** — no other API key, no human in the loop.

**Reuses:** ~70% of v0 exists in the spike (`verifiability-harness/`, `stage3-voice-judge/`); v0 is a clean refactor + packaging.

---

## v1 — Evals + genericity (prove "any voice agent")
**Goal:** add subjective scoring and a second adapter so the "all-purpose" and "Trojan-horse" claims become real.

**Deliverables**
- [ ] `judge/` — LLM-as-judge on the Deepgram-fronted LLM (the grader-agent), rubric runner, optional judge panel; pluggable judge model. *(refactor of the spike's judge)*
- [ ] **Autonomous eval authoring** — `soundcheck author --spec <agent-spec>`: read an AUT's spec/system-prompt, generate scenarios + deterministic assertions (incl. business-rule assertions derived from the spec) + a rubric. Quality is generated; business rules are extracted from the spec (Architecture §5).
- [ ] Persona library complete (`accented`, `noisy-line`, `rambler`, `mind-changer`, `adversarial`).
- [ ] A **second AUT adapter** (OpenAI Realtime *or* Vapi) — the proof that Soundcheck tests agents built on other runtimes (and runs them on Deepgram STT/TTS).
- [ ] `.github/workflows/` — a reusable GitHub Action for voice-agent repos.
- [ ] Real-audio corpus injection (noisy/accented) for the acoustic-robustness gap.

**Definition of done:** Soundcheck authors its own eval suite for an unseen agent spec, scores it with the judge, and runs against two different voice-agent runtimes — all reported uniformly.

---

## v2 — The tuning loop (agents tuning agents)
**Goal:** close the loop from "find the bug" to "fix it to green," autonomously.

**Deliverables**
- [ ] `tune/` — fixer-agent loop: failures → proposed edits (prompt / sanitizer rules / tool schema / date-grounding) → re-run → keep improvements. Invokes a local coding agent (Claude Code / Codex) so no LLM API key is needed.
- [ ] **Held-out scenario set** the tuner never sees — the Goodhart guardrail.
- [ ] Regression dashboard — score trends across commits.
- [ ] `soundcheck tune <agent>` — point it at an agent + its spec and let it iterate to a target score, then emit a diff + a before/after report.

**Definition of done:** given a broken voice agent + its spec, `soundcheck tune` raises its held-out eval score and produces a reviewable diff — demonstrating an autonomous prototype→production loop for voice.

---

## Stretch / community
- More adapters (Retell, LiveKit, Pipecat, Twilio/SIP phone numbers).
- Non-English support.
- A hosted report viewer / shareable run links.
- A public golden-scenario library by vertical (restaurant, support, scheduling, healthcare intake).

## Sequencing summary
**v0 (deterministic core, Deepgram-key-only, mostly a refactor) → v1 (judge + autonomous authoring + 2nd adapter) → v2 (tuning loop + held-out guardrail).** Build v0 first; it is independently demo-able and is the strongest single artifact for showing initiative.

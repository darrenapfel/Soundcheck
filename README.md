# 🎙️ Soundcheck

**The missing test harness for voice agents — Playwright + an LLM judge + a synthetic caller, for speech.**

Web apps have Playwright: a coding agent can write a test, run it against a real browser, and know it didn't break the UI before shipping. **Voice agents have nothing like it.** A unit test can't *hear* that your agent says "star star confirmed star star," can't tell that it spoke a 24-hour time, can't notice it lost the reservation halfway through the call. So the autonomous "build → test → ship" loop that works for code **breaks for voice** — agents converge on green tests and fail on the first spoken word.

Soundcheck closes that gap. You point it at *any* voice agent and it runs real spoken conversations against it, scores them, and (optionally) **tunes the agent until it passes.**

## Meet Evaline

**Evaline** is Soundcheck's synthetic caller — a Deepgram Voice Agent that *calls your voice agent like a real customer*, over real audio, with a goal and a persona (calm, impatient, accented, noisy line, changes-their-mind, adversarial). She's the "voice agent that tests other voice agents."

## What it does (three capabilities)

1. **Deterministic regression suite** — the "Playwright for voice." Hard pass/fail assertions you run before every ship: *never speak a symbol*, *the spoken date equals the booked date*, *pass ISO dates to tools*, *time-to-first-byte under 800 ms*, *required tool was actually called*. The voice regression suite you can't run today.
2. **Evals + tuning** — an LLM judge scores the fuzzy things (natural? completed the goal? confirmed before acting? recovered from an interruption?), and a tuning loop feeds failures back to a fixer-agent that edits and re-runs **until the score goes green.**
3. **STT ↔ TTS validation** — the round-trip oracle: `text → TTS → STT → compare` (validate your TTS) and `audio → STT → compare` (validate your STT). One primitive, flipped.

Together: **a coding agent can build, test, and tune a production-grade voice agent with no human babysitting the loop.**

## One key: Deepgram

Soundcheck needs **only a `DEEPGRAM_API_KEY`.** Evaline's brain (the Voice Agent's `think` LLM), the speech (TTS), and the transcription (STT) all run on Deepgram and bill to your Deepgram credit — no OpenAI/Anthropic key required. (The judge runs on the same Deepgram-fronted LLM by default, and is pluggable if you'd rather bring your own.) See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#deepgram-key-only) for why this works.

## Status

**Pre-v0 — architecture & roadmap first, by design.** This work grew out of a validated research spike (a round-trip oracle that reproduced human listening-test verdicts headlessly, a closed-loop fork that tuned itself to green with no guide, and a synthetic-caller-vs-real-agent run scored by a cross-vendor judge). v0 generalizes that spike into a clean, `git clone`-able tool.

- 📐 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the complete system design
- 🗺️ [`docs/ROADMAP.md`](docs/ROADMAP.md) — the phased build plan (v0 → v1 → v2)

## Why this exists (the thesis)

Great evals are the moat between a prototype and a shippable agent (cf. Databricks' Costar approach to shipping agents fast without breaking things). That eval layer exists for text/tool agents and **does not exist for voice.** Soundcheck is that layer — and because every eval run *consumes* TTS (to speak) and STT (to listen), the harness is itself a meter that runs on speech infrastructure.

---

*MIT licensed. Built for the agent-tests-agent era.*

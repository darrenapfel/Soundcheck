# 🎙️ Soundcheck

[![CI](https://github.com/darrenapfel/Soundcheck/actions/workflows/ci.yml/badge.svg)](https://github.com/darrenapfel/Soundcheck/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**The missing test & tuning harness for voice agents — Playwright + an LLM judge + a synthetic caller, for speech. Runs on a single Deepgram key.**

Web apps have Playwright: a coding agent writes a test, runs it against a real browser, and knows it didn't break the UI before shipping. **Voice agents have nothing like it.** A unit test can't *hear* that your agent says "star star confirmed star star," can't tell it spoke a 24-hour time, can't notice it lost the reservation halfway through the call. So the autonomous "build → test → ship" loop that works for code **breaks for voice** — agents converge on green tests and fail on the first spoken word.

Soundcheck closes that gap. Point it at *any* voice agent: it runs real spoken conversations, **gates** them deterministically, **scores** them with an LLM judge, and (optionally) **tunes** the agent until it passes.

## Meet Evaline

**Evaline** is Soundcheck's synthetic caller — she phones your voice agent like a real customer, over real audio, with a persona (cooperative, impatient, …). She's the "voice agent that tests other voice agents."

## What it does

| Capability | Command | What it gives you |
|---|---|---|
| **Deterministic regression suite** | `soundcheck run` | Hard pass/fail gates: never speak a symbol, spoken date == booked date, ISO dates to tools, required tool called, TTFB SLO |
| **STT ↔ TTS round-trip** | `soundcheck validate` | `text → TTS → STT → compare` (test your TTS) / `audio → STT` (test your STT) |
| **LLM judge (evals)** | `soundcheck run --judge` | Advisory scores for the fuzzy stuff (natural? goal met? confirmed before acting?) on the *heard* audio |
| **Judge calibration** | `soundcheck calibrate` | How much to trust the judge — agreement vs ground truth (self-constructed corpus) |
| **Autonomous authoring** | `soundcheck author` | Generates a scenario suite from your agent's spec — no human writes the cases |
| **Tuning loop** | `soundcheck tune` | Agents tuning agents: a fixer proposes prompt edits, kept only if a **held-out** set improves |

Determinism is built in: a live run **records a cassette**, and CI **replays** it offline — so a stochastic tool stays a deterministic gate. ([`docs/TESTING.md`](docs/TESTING.md))

## Quickstart

```bash
echo "DEEPGRAM_API_KEY=dg_..." > .env     # the only key you need
npm install                                # devDeps only (no runtime deps)

npm test                                   # 62 deterministic tests, no network
npm run soundcheck -- validate --tts "Your table is **booked** for $14."
#   heard "...star star booked star star ... negative fourteen dollars"  -> 🚩

npm run soundcheck -- run scenarios --aut examples/tabletalk/grounded.ts   # ✅ live, passes
npm run soundcheck -- run scenarios --aut examples/tabletalk/bare.ts       # 🚩 live, fails (exit 1)
npm run soundcheck -- run scenarios --adapter mock                         # creds-free, no network
```

The bundled `examples/tabletalk/` dogfood ships `bare` / `hardened` / `grounded` configs so you can watch the suite catch "STAR STAR", dash-as-negative prices, non-ISO tool dates, and ungrounded dates — then go green.

## One key: Deepgram

Soundcheck's default + CI operation needs **only `DEEPGRAM_API_KEY`**: Evaline's brain (the Voice Agent's `think` LLM), her voice (TTS), the transcription (STT), and the judge (a Deepgram-fronted grader) all run on Deepgram. No OpenAI/Anthropic key. (The optional `openai-realtime` *reference* adapter reads `OPENAI_API_KEY` only if a developer wires it; CI never touches it.) See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#deepgram-key-only).

## Why this exists

Great evals are the moat between a prototype and a shippable agent. That layer exists for text/tool agents and **didn't exist for voice.** Soundcheck is that layer — and because every eval run *consumes* TTS (to speak) and STT (to listen), the harness is itself a meter that runs on speech infrastructure.

## Docs
- 📐 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design
- 🗺️ [`docs/ROADMAP.md`](docs/ROADMAP.md) — the milestone build plan (M0–M8)
- 🧪 [`docs/TESTING.md`](docs/TESTING.md) — how we earn trust (record/replay, self-evaluation, calibration)
- ⚖️ [`docs/CALIBRATION.md`](docs/CALIBRATION.md) — live judge agreement numbers
- ⚠️ [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) — honest limits
- 🔍 [`docs/REVIEW_LOG.md`](docs/REVIEW_LOG.md) — every milestone's independent review
- 🤝 [`CONTRIBUTING.md`](CONTRIBUTING.md) — add an adapter / scenario / gate

## Status

**v1.0** — deterministic core + judge + calibration + autonomous authoring + genericity (3 adapters) + self-evaluation + the tuning loop. Zero runtime dependencies (Node 22 native TypeScript). Grew out of a validated research spike; each milestone independently reviewed (see `docs/REVIEW_LOG.md`).

---

*MIT licensed. Built for the agent-tests-agent era.*

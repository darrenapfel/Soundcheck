# Changelog

All notable changes to Soundcheck. Format loosely follows [Keep a Changelog]; versioning is [SemVer].

## [1.0.0] — 2026-05

First public release: a voice-agent test & tuning harness that runs on a single Deepgram key.

### Added
- **Deterministic regression gates** (`run`): `no_spoken_symbols`, `tool_arg_iso`, `grounding`, `value_consistency`, `required_tool`, `latency` — the "Playwright for voice."
- **Round-trip oracle** (`validate`): `text → TTS → STT → compare` (test TTS) and `audio → STT` (test STT).
- **Record / replay** cassettes — live runs record; CI replays offline → a stochastic tool becomes a deterministic merge gate.
- **LLM judge** (`run --judge`, advisory): a Deepgram-fronted one-shot grader with a tolerant verdict parser, a deterministic mock judge for CI, and panel aggregation.
- **Judge calibration** (`calibrate`): agreement + problem-class precision/recall vs a self-constructed labeled corpus (live: 91.7% macro; spoken_cleanly 100% recall / 75% precision).
- **Autonomous eval authoring** (`author`): generate a scenario suite from an agent's spec; surface business rules as hints.
- **Genericity**: Deepgram VA + a creds-free **MockAUT** adapter (CLI-selectable, CI-proven) + an OpenAI Realtime **reference** adapter; `RawTurn.agentSpokenHeardBack` lets text/mock adapters skip STT.
- **Self-evaluation**: caller self-checks (voice-clean / in-persona / goal-preserving) with a broken-Evaline fixture that must fail.
- **Tuning loop** (`tune`): a fixer proposes prompt edits, kept only if a **held-out** set improves (Goodhart guard). Live capstone tuned a buggy agent to green, generalization-verified.
- CI workflow (offline) + nightly live-drift workflow; ESLint; 62 deterministic tests; ≥85% coverage on the core modules.

### Engineering
- Zero runtime dependencies (Node 22 native TypeScript, built-in `WebSocket`/`fetch`).
- Default + CI operation is Deepgram-key-only; CI needs no key.
- Every milestone independently reviewed by a sub-agent (`docs/REVIEW_LOG.md`).

### Known limitations
See [`docs/LIMITATIONS.md`] — clean-TTS callers (not acoustic robustness), advisory judge, rule-based demo fixer, OpenAI adapter is a reference, etc.

[Keep a Changelog]: https://keepachangelog.com/
[SemVer]: https://semver.org/

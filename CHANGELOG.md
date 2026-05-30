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
- **Real-time call recorder + oracle self-validation** (the keystone): the adapter captures a faithful, time-ordered, MIXED recording of the whole call (caller + agent overlaid at true timing). The report plays that real recording, and Soundcheck runs its **own oracle (STT) over it** and shows "what Soundcheck heard" — self-validation baked into every live report. Oracle-validated e2e: the STT of each recording reads back the actual conversation in order.
- **Per-turn audio in the report**: per-turn 🔊 caller (Evaline) / 🔊 agent clips — hear exactly what each side said.
- **Interactive turn-taking** (control inversion): the adapter drives a `Caller` policy. **ScriptedCaller** (deterministic default) + **GoalDrivenCaller** — Evaline improvises toward a scenario `goal`, reacting to the agent's actual replies and hanging up when met (a Deepgram-VA brain on the Deepgram key, + repetition guard).
- **Barge-in** (live): the caller cuts in mid-reply; on `UserStartedSpeaking` Soundcheck flushes queued agent audio (real-client semantics) so the VA's server-side barge-in is captured faithfully. Oracle-validated: the agent truncates mid-word and addresses the interruption. See `examples/interactive/`.
- CI workflow (offline) + nightly live-drift workflow; ESLint; 77 deterministic tests; ≥85% coverage on the core modules.

### Fixed
- **Turn segmentation.** Agent audio frames didn't update the turn-activity clock, so a turn could be cut mid-utterance for any answer longer than ~3s past its last text event — the scripted caller then spoke over the still-talking agent and its continued audio bled into the next turn, smearing attribution. Now the turn endpoints on `AgentAudioDone` + a coalescing quiet window. Surfaced by the new audio playback; also fixed a real functional failure (the agent now reliably hears and acts on second-turn requests). All golden cassettes re-recorded from correctly-segmented runs.

### Engineering
- Zero runtime dependencies (Node 22 native TypeScript, built-in `WebSocket`/`fetch`).
- Default + CI operation is Deepgram-key-only; CI needs no key.
- Every milestone independently reviewed by a sub-agent (`docs/REVIEW_LOG.md`).

### Known limitations
See [`docs/LIMITATIONS.md`] — clean-TTS callers (not acoustic robustness), advisory judge, rule-based demo fixer, OpenAI adapter is a reference, etc.

[Keep a Changelog]: https://keepachangelog.com/
[SemVer]: https://semver.org/

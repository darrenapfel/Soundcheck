---
name: soundcheck
description: Test, debug, and tune voice agents (Deepgram Voice Agent / speech-to-speech) with Soundcheck. Use when building or evaluating a phone/voice agent, when an agent speaks symbols or wrong dates aloud, gets socially-engineered into unsafe tool calls, or when the user wants to author test scenarios, run gated voice tests, compare two agents, or auto-tune a system prompt. Triggers on "test my voice agent", "soundcheck", "the agent said the wrong thing", "evaluate my Deepgram agent".
when_to_use: The user is building/evaluating a voice (speech-to-speech) agent and wants to find or fix failures that text tests miss — spoken symbols, ungrounded relative dates, tool-call ordering/safety, read-back consistency, latency — or wants to author scenarios, run them, bake off two agents, or tune a prompt until it passes.
---

# Soundcheck — voice-agent test harness

Soundcheck is "Playwright for voice agents." You **declare** a voice agent's invariants, it drives a synthetic caller against the agent over real Deepgram audio, and an **oracle (STT over the recording) plus deterministic gates** decide pass/fail. It catches the failures text tests can't see: the agent speaking `**bold**` or "star star" aloud, resolving "this Thursday" to the wrong date, calling a forbidden/destructive tool, or confirming back something it never did.

It is **Deepgram-key-only** (TTS for the caller, STT as the oracle, the Voice Agent API for the live caller brain) with **zero runtime dependencies**. Runs live (needs `DEEPGRAM_API_KEY`) or fully offline from recorded cassettes (`--replay`, no key/network).

## The cardinal rule
The oracle (STT over the *real* recording) or a deterministic gate decides — never a proxy, never the agent's own claim. Never splice, stage, or fabricate evidence. A faithful failure is real; a fabricated pass is a defect. When you record samples or report results, report what actually happened.

## Mental model: Scenario → Trace → Assess → Refine
1. **Scenario** — a declarative test case: a caller `goal` (or scripted `turns`), a `persona` (cooperative / impatient / adversarial), and an `assert` list of invariants. (`reference/scenarios.md`)
2. **Trace** — driving the caller against the agent produces a recording + the oracle's STT + per-turn tool calls + timings. The one persistable artifact (a "cassette" when saved). 
3. **Assess** — the deterministic **gates** run over the Trace (the regression suite that blocks CI). An optional LLM **judge** scores subjective dimensions (advisory, never gating). (`reference/gates.md`)
4. **Refine** — `tune` feeds each failure's trace-evidence to a fixer (a coding agent), keeps an edit only if a held-out set improves, and can freeze a discovered failure into a permanent regression. (`reference/commands.md`)

## The workflow (nothing → well-tuned agent)
`author` a suite from your agent → `run` it and read the report → (optionally `bakeoff` vs a baseline) → `tune --fixer "claude -p"` until green → `calibrate` to trust the judge → `--caller goal --promote-failures` to discover + freeze regressions → `--replay` them in CI. Full worked example: **`tutorials/zero-to-tuned.md`**.

## Reference (read on demand — don't load unless you need the detail)
- **`reference/commands.md`** — every command and flag: `run`, `author`, `tune`, `bakeoff`, `calibrate`, `validate`, `install-skill`.
- **`reference/gates.md`** — the 10 gates: what each asserts, its `assert`-spec shape, and when to declare it.
- **`reference/scenarios.md`** — the scenario JSON schema (`goal`, `persona`, `turns`, `assert`, `liveOnly`, `bargeIn`, `fixtureOnly`).
- **`reference/agents.md`** — how to write the agent-under-test config (`AUTConfig`: tools, toolStubs, systemPrompt, voice, think model).
- **`tutorials/zero-to-tuned.md`** — the end-to-end walkthrough.

## Quickstart
```bash
# install: `npm install -g soundcheck-cli` (the command is `soundcheck`). From a source checkout: `soundcheck` after `npm link`, else `npm run soundcheck -- …`
soundcheck author --spec ./my-agent.ts --out scenarios     # 1. generate a suite from the agent's tools + prompt
soundcheck run scenarios --aut ./my-agent.ts               # 2. drive it live, gate it, write a report
open runs/report-*.html                                    # 3. hear the call + read what the oracle heard
soundcheck tune --agent ./my-agent.ts --fixer "claude -p"  # 4. tune the prompt until the held-out set goes green
```
Offline, no key needed: add `--replay` to `run`/`bakeoff` (loads a recorded cassette and runs the same gates).

## Invariants to respect when working in this repo
- **Deepgram-key-only** by default and in CI; **zero runtime dependencies**; Node 22 native TypeScript (erasable syntax only — no enums/namespaces; `.ts` import specifiers; the only build is the publish-time `tsc -p tsconfig.build.json` → `dist/`).
- The key resolves: `DEEPGRAM_API_KEY` env → `./.env` → `~/.config/soundcheck/.env` → the package `.env`.
- `npm run validate` (typecheck + `eslint --max-warnings=0` + tests) and `npm run smoke` must stay green. Live work needs the key; prefer `--replay`/`--adapter mock` for deterministic, offline iteration.

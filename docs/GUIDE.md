# Soundcheck — the guide

The practical front door: how Soundcheck works and how to use it end to end. For what it *is* and why, see [`ABOUT.md`](ABOUT.md); for how it's built, [`ARCHITECTURE.md`](ARCHITECTURE.md).

## What it does
Soundcheck is "Playwright for voice agents." You **declare** a voice agent's invariants; it drives a synthetic caller against the agent over real Deepgram audio; and an **oracle (STT over the recording) plus deterministic gates** decide pass/fail. It catches what text tests can't see: the agent speaking `**bold**` or "star star" aloud, resolving "this Thursday" to the wrong date, calling a forbidden or destructive tool, or confirming back something it never did.

It is **Deepgram-key-only** (TTS for the caller, STT as the oracle, the Voice Agent API for the live caller brain) with **zero runtime dependencies**. It runs live (needs `DEEPGRAM_API_KEY`) or fully offline from recorded cassettes (`--replay` — no key, no network).

## The cardinal rule
The oracle (STT over the *real* recording) or a deterministic gate decides — never a proxy, never the agent's own claim. Nothing is spliced, staged, or fabricated. A faithful failure is real; a fabricated pass is a defect.

## Mental model: Scenario → Trace → Assess → Refine
1. **Scenario** — a declarative test case: a caller `goal` (or scripted `turns`), a `persona` (cooperative / impatient / adversarial), and an `assert` list of invariants. ([scenario schema](#scenarios) below; full detail in the skill's `reference/scenarios.md`.)
2. **Trace** — driving the caller against the agent produces a recording + the oracle's STT + per-turn tool calls + timings. Saved, it's a **cassette** (replayable offline).
3. **Assess** — the deterministic [**gates**](GATES.md) run over the Trace (the regression suite that blocks CI). An optional LLM **judge** scores subjective dimensions (advisory, never gating; trust it via `calibrate`).
4. **Refine** — [`tune`](COMMANDS.md#tune) feeds each failure's trace evidence to a fixer (a coding agent), keeps an edit only if a held-out set improves, and can freeze a discovered failure into a permanent regression.

## The workflow
From nothing to a gated, tuned agent and a self-growing offline suite:

`author` a suite from your agent → `run` it and read the report → (optionally `bakeoff` vs a baseline) → `tune --fixer "claude -p"` until green → `calibrate` to trust the judge → `--caller goal --promote-failures` to discover + freeze regressions → `--replay` them in CI.

The full worked example is in [`TUTORIAL.md`](TUTORIAL.md).

## Reference
- **[`COMMANDS.md`](COMMANDS.md)** — every command and flag (`run`, `author`, `tune`, `bakeoff`, `calibrate`, `validate`, `compare`, `fixtures`, `install-skill`).
- **[`GATES.md`](GATES.md)** — the 11 gates: what each asserts, its `assert`-spec shape, and when to declare it.
- **[`TUTORIAL.md`](TUTORIAL.md)** — the end-to-end zero-to-tuned walkthrough.
- **[`CALIBRATION.md`](CALIBRATION.md)** — judge agreement numbers. **[`TESTING.md`](TESTING.md)** — how trust is earned. **[`LIMITATIONS.md`](LIMITATIONS.md)** — honest limits.

## Install & run
Install the CLI with `npm install -g soundcheck-cli` — the command is `soundcheck`, and it runs against your own agent from any directory. To run the bundled examples or to work on Soundcheck itself, install from source instead: clone + `npm install` + `npm link` (or `npm run soundcheck --` from the checkout). Set the key once in `DEEPGRAM_API_KEY` (env), `./.env`, or `~/.config/soundcheck/.env` (a user-global fallback so `soundcheck` works from any directory). It also ships a coding-agent **skill** — `soundcheck install-skill` puts it in your global skills dir (see [`COMMANDS.md`](COMMANDS.md#install-skill)).

```bash
soundcheck author --spec ./my-agent.ts --out scenarios     # 1. generate a suite from the agent's tools + prompt
soundcheck run scenarios --aut ./my-agent.ts               # 2. drive it live, gate it, write a report
open runs/report-*.html                                    # 3. hear the call + read what the oracle heard
soundcheck tune --agent ./my-agent.ts --fixer "claude -p"  # 4. tune the prompt until the held-out set goes green
```

<a name="scenarios"></a>
## Scenario schema (quick reference)
A scenario is JSON in a scenarios dir. Required: `name`, `persona` (`cooperative`/`impatient`/`adversarial`), `turns` (caller lines), `assert` (the gates). Optional: `goal` (goal-driven improv caller; live-only), `bargeIn` (scripted interruption; live-only), `liveOnly` / `fixtureOnly` (skipped under `--replay`). One scenario can be driven by any persona via `--persona` — you don't fork the file. Full detail and examples: the skill's `reference/scenarios.md`.

# 🎙️ Soundcheck — the test & tuning harness for voice agents

[![CI](https://github.com/darrenapfel/Soundcheck/actions/workflows/ci.yml/badge.svg)](https://github.com/darrenapfel/Soundcheck/actions/workflows/ci.yml)
[![core coverage ≥85%](https://img.shields.io/badge/core%20coverage-%E2%89%A585%25-brightgreen.svg)](docs/TESTING.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> **The thing a unit test can't do: hear whether your voice agent's speech is actually correct.** Soundcheck drives a synthetic caller through a real spoken conversation with your agent, records the call, transcribes it with its own STT — the **oracle** — and checks what the agent *actually said*, not what the model claimed in text. One Deepgram key, zero runtime dependencies.

## Why

Web apps have Playwright; real-time voice agents have had nothing like it. A conventional test can't *hear* that your agent said "star star confirmed," spoke a 24-hour time, read a confirmation number as "four thousand four hundred seventeen," talked over the caller, or lost the reservation halfway through the call. So the autonomous **build → test → ship** loop that works for code breaks for voice — agents converge on green tests and fail on the first spoken word.

Soundcheck closes that gap, and it's useful two ways:

1. **A test harness for voice — Playwright, but for what your agent *says*.** Write a scenario, run it against your real agent over audio, and gate it in CI. Catch the spoken bug before you ship.
2. **An autonomous eval loop.** Point a coding agent at your voice agent + Soundcheck and it carries an integration from prototype to production: author scenarios → run → diagnose from the recording → tune until green → grow the suite from what it discovers. You review the result instead of refereeing every call.

## Getting Started

### Prerequisites
- **Node 22.6+** — Soundcheck runs TypeScript natively; there's no build step for development.
- **A Deepgram API key** — the only credential (free at [deepgram.com](https://deepgram.com)). Live runs need it; offline `--replay` runs don't.
- **ffmpeg** *(optional)* — only for `--mp3` compact reports; everything else works without it.

### 1. Install
The published CLI — to run Soundcheck against **your own** agent from any directory:
```bash
npm install -g soundcheck-cli   # puts the `soundcheck` command on your PATH (Node 22.6+)
```
Or install from source — to run the bundled examples (the offline demo below) or hack on Soundcheck itself:
```bash
git clone https://github.com/darrenapfel/Soundcheck.git && cd Soundcheck
npm install        # devDeps only — zero runtime dependencies
npm link           # puts the `soundcheck` command on your PATH
```
Set your key once — Soundcheck checks, in order: the `DEEPGRAM_API_KEY` env var → a `./.env` in the current directory → `~/.config/soundcheck/.env` (a user-global fallback, so `soundcheck` works from any directory):
```bash
mkdir -p ~/.config/soundcheck && printf 'DEEPGRAM_API_KEY=dg_...\n' > ~/.config/soundcheck/.env
```
*On a source checkout without `npm link`?* Prefix any command with `npm run soundcheck -- …`. Point `--aut` at your own agent's `.ts` config; it lives in your project, so Node strips its types normally. TypeScript consumers also want `npm i -D @types/node`.

### 2. Install the coding-agent skill
Teach your coding agent how to drive Soundcheck — when to use it, every command, the 10 gates, the scenario schema, and an end-to-end tutorial ([`SKILL.md`](.claude/skills/soundcheck/SKILL.md)):
```bash
soundcheck install-skill          # Claude Code + any other agent (Codex/Gemini) already on your machine
soundcheck install-skill --all    # force all three;  --claude-only for just Claude;  --link to symlink
# fresh clone, before `npm link`:  npm run skill:install
```
The skill also auto-loads for anyone using Claude Code inside this repo (`.claude/skills/soundcheck/`).

### 3. Run the basics
**Try it offline first** — no key, no network, instant (it replays recorded calls and runs the gates). Run this from a source checkout, where the example agent and its recorded calls live:
```bash
soundcheck run scenarios --aut examples/tabletalk/grounded.ts --replay
```
Then the live loop against **your own** agent *(needs your Deepgram key)*:
```bash
soundcheck author --spec ./my-agent.ts --out scenarios     # 1. draft a scenario suite from the agent's tools + prompt
soundcheck run scenarios --aut ./my-agent.ts               # 2. drive it live, gate it, write a report (exit ≠ 0 on any gate failure)
open runs/report-*.html                                    # 3. hear the call + read what the oracle (STT) heard
soundcheck tune --agent ./my-agent.ts --fixer "claude -p"  # 4. tune the prompt until the held-out set goes green
```
Full reference: [`docs/COMMANDS.md`](docs/COMMANDS.md) · the gates: [`docs/GATES.md`](docs/GATES.md) · the end-to-end walkthrough: [`docs/TUTORIAL.md`](docs/TUTORIAL.md).

### 4. Self-improving tuning — with Codex
`tune` hands each failure's trace-driven evidence to a coding-agent **fixer**, which rewrites the system prompt, and keeps the edit only if a **held-out set the fixer never saw** improves (the Goodhart guard). [`examples/tune-demo/`](examples/tune-demo) ships two reference fixers: a deterministic rule-based one, and **[`codex-fixer.sh`](examples/tune-demo/codex-fixer.sh) — the Codex CLI (gpt-5.5), run read-only so it can't touch your files**:
```bash
# needs a live DEEPGRAM_API_KEY and `codex login`
soundcheck tune \
  --agent   examples/tabletalk/bare.ts \
  --train   examples/self-improving-loop/scenarios/book-this-saturday-regression.json \
  --heldout examples/self-improving-loop/heldout-book-sunday.json \
  --fixer   examples/tune-demo/codex-fixer.sh --max 1
```
In a real run, the bare agent (its prompt lacks a date anchor, so it hallucinates the year) went **0/1 → 1/1 on both the trained *and* the unseen held-out call** — Codex rewrote the prompt with a general date resolver, kept only because it generalized. Details: [`examples/tune-demo/README.md`](examples/tune-demo/README.md). Any stdin→stdout coding agent works as a `--fixer` (`claude -p`, a script, etc.).

**▶ Prefer to listen?** The **[sample gallery](samples/#readme)** has real recorded calls — each domain's agent handled by a polite, an impatient, and a hostile caller (all pass), plus Soundcheck *catching* two deliberately-broken agents. Each links to a self-contained report: play the call, read the oracle transcript, see the gates.

**No agent of your own yet?** Five bundled example domains show the *same* gates working everywhere:

| Domain | Folder | What it exercises | Runs |
|---|---|---|---|
| Restaurant booking | `examples/tabletalk/` | spoken symbols, ISO/grounded dates, read-back — `bare`/`hardened`/`grounded` | ✅ offline replay — `grounded` full; `bare`/`hardened` via `--only book-modify-confirm` |
| IT support | `examples/support/` | verify-before-reset, never-delete — `bare`/`grounded`/`insecure` | ✅ offline replay (cassettes) |
| Healthcare clinic | `examples/healthcare/` | verify-before-PHI, never-prescribe, grounded dates | live (goal-driven) |
| Bank card services | `examples/banking/` | verify-before-any-action, never-wire, clean spoken money | live (goal-driven) |
| Airline rebooking | `examples/travel/` | lookup-before-rebook, "tomorrow" grounded, integer bag counts | live (goal-driven) |

Offline, no key — replay the recorded ladders: watch the gates pass on the clean agent and **catch the planted bugs** on the broken one (each command below works as written):

```bash
soundcheck run scenarios --aut examples/tabletalk/grounded.ts --replay                              # ✅ all pass
soundcheck run scenarios --aut examples/tabletalk/bare.ts --replay --only book-modify-confirm       # 🚩 catches STAR STAR + ungrounded date
soundcheck run examples/support/scenarios --aut examples/support/grounded.ts --replay               # ✅ (skips the goal-driven demo)
soundcheck run examples/support/scenarios --aut examples/support/insecure.ts --replay --only frustrated-reset  # 🚩 catches reset-before-verify + forbidden delete
```

The **healthcare, banking, travel** suites (and support's `adversarial-discovery`) are **goal-driven, live-only**: an LLM improvises the caller, so they can't be replayed from a cassette — run them live with your key, e.g. `soundcheck run examples/healthcare/scenarios --aut examples/healthcare/grounded.ts`. (`--replay` skips them and says so; a replay that would run *nothing* fails closed.)

## The loop: Scenario → Trace → Assess → Refine

Soundcheck is organized as a closed loop. Each step has a command; the deterministic checks gate a merge with no model in their path, so the loop runs unattended between your reviews.

| Step | What it is | Command |
|---|---|---|
| **Scenario** | a portable fixture — a caller goal/persona + declarative checks — drafted from your agent's own tools; runs unchanged across versions and implementations | `author` · `scenarios/*.json` |
| **Trace** | the flight recorder — the real call (caller + agent mixed at true timing) + the oracle STT + per-turn text + tool calls + timings, saved as a replayable **cassette** | `run` (records) / `--replay` (offline) |
| **Assess** | deterministic **gates** (hard pass/fail) + an advisory **LLM judge** (the fuzzy stuff) + **latency** | `run` · `bakeoff` |
| **Refine** | a coding agent reads a trace-driven diagnosis, patches the agent, re-runs — keeping an edit only if a **held-out** set improves (Goodhart guard) | `tune --fixer` |
| **Test the tests** | the judge is calibrated against a Golden Set and given a **trust verdict** before anything leans on it; a drift guard fails CI if it regresses | `calibrate` |
| **Grow the suite** | a failure a red-team caller *discovers* is frozen into a permanent, replayable regression — the suite grows itself | `run --promote-failures` |

## What it checks — declarative, domain-agnostic gates

You *declare* a scenario's invariants; the registry enforces them deterministically against what was actually spoken:

```jsonc
"assert": [
  "no_spoken_symbols",                                               // never speak markup/symbols aloud
  "no_spoken_cardinal_ids",                                          // say IDs/SSN/ZIP digit-by-digit, not "four thousand…"
  { "tool_args_match_schema": "bookAppointment" },                   // type/required/format/enum/pattern
  { "tool_sequence": ["verifyIdentity", "before", "accessRecord"] }, // ordering invariants
  { "spoken_matches_tool": { "field": "date", "tool": "bookAppointment" } }, // say what you did
  { "spoken_consistent_with_tool": { "field": "date", "tool": "bookAppointment", "now": "2026-05-29" } }, // don't verbally cave to a date you never booked
  { "required_tool": "scheduleCallback" },
  { "forbidden_tool": "chargeCard" },
  { "grounding": { "tool": "bookAppointment", "field": "date", "now": "2026-05-29", "expected": "2026-05-30" } }, // resolve relative dates
  { "latency": { "ttfb_ms": { "max": 2000 } } }
]
```

The same registry tests a restaurant booker, an IT-support bot, a healthcare scheduler, or a finance IVR — any STS agent. Adding a gate is a function plus one registry entry.

## Capabilities

**Scenario** — Declarative, portable fixtures via the `AUTAdapter` abstraction. **Autonomous, domain-agnostic authoring**: `author --spec` generates one scenario per tool from any agent's tools + prompt (destructive tools skipped, identity-gated tools get a proactive caller).

**Trace** — Real-time mixed **recording** of the whole call, played back in the report. **Oracle self-validation**: Soundcheck runs its own STT over the recording and shows "what it heard" on every live run *(this is what caught our own bugs)*. A first-class, versioned `Trace` persisted as a **record/replay cassette** so gates and judges run offline, without re-running the agent.

**Assess** — A composable **gate registry** (above). An **advisory LLM judge** (rubric + findings, panel aggregation) for the fuzzy dimensions — it informs, it never hard-gates. **Judge alignment**: `calibrate` scores the judge against a no-human Golden Set, reports a trust verdict, corroborates with a stronger reference model, and pins a drift guard in CI.

**Refine** — A trace-driven **tuning loop**: `tune` produces a root-cause diagnosis per failing gate, feeds it to a pluggable `--fixer`, and keeps an edit only if a held-out set improves. Demonstrated generalizing a date-grounding fix to an unseen relative date.

**Voice-native** — Faithful **turn-taking** (endpoints on real end-of-speech). **Barge-in** (the caller cuts in; the agent's interruption is captured faithfully). **Reactive caller (Evaline)** that improvises toward a goal. **Adversarial discovery**: an `adversarial` Evaline red-teams the agent, improvising attacks that surface failures nobody scripted (it drove a deliberately-insecure agent into reset-before-verify + account-deletion, oracle-confirmed). **A/B & vendor bake-off**: `bakeoff` runs one suite against two configs and diffs the per-gate results (plus, with `--judge`, the advisory judge).

**Self-improving** — A discovered failure is promoted into a permanent regression (`run --promote-failures`) and `tune` refines the agent against the grown suite. End-to-end in `examples/self-improving-loop/`; the closure is pinned offline in `test/regress.test.ts`.

## Autonomous — minimal human in the loop

Built to be driven by a coding agent and supervised, not babysat:

- **Deterministic gates own the merge-gating verdicts** — no model in that path.
- **The LLM judge is advisory and calibrated** — it informs; its trust is measured and reported before anything relies on it.
- **Determinism via record/replay** — a stochastic live call becomes a reproducible CI fixture.
- **The oracle is the arbiter** — every claim about a run is checkable against Soundcheck's own STT of the real audio, so neither the agent nor a reviewer takes a pass/fail on faith. You review the result, not every call.

## Soundcheck verifies Soundcheck

The harness proves itself with its own tools — the only honest way to ask others to trust it:

- **The oracle** transcribes every live recording; the report shows it.
- **End-to-end self-test** (`test/self-test.test.ts`): the generic gates *catch* deliberately-regressed builds (a buggy mock + insecure/bare example agents) and pass correct ones — with a coverage contract that every core safety gate family is shown catching a real regression. Offline, in CI.
- **Self-evaluation** — Evaline-as-AUT, with a deliberately-broken-Evaline fixture that must fail.
- **Judge calibration** against a labeled corpus, with a drift guard.

## One key, zero deps

Default + CI operation needs **only `DEEPGRAM_API_KEY`** — caller brain (the Voice Agent's `think` LLM), voice (TTS), transcription/oracle (STT), and the judge all run on Deepgram. No OpenAI/Anthropic key. (The optional `openai-realtime` *reference* adapter reads `OPENAI_API_KEY` only if a developer wires it; CI never touches it.) **Zero runtime dependencies** (Node 22 native TypeScript). MIT licensed. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#deepgram-key-only).

### Use it in your repo's CI

Soundcheck ships a **reusable composite GitHub Action** (`action.yml`) — zero runtime deps, so it needs nothing but Node 22. Replay recorded cassettes as an offline merge gate:

```yaml
# .github/workflows/voice.yml in your agent's repo
jobs:
  soundcheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4   # your scenarios/ + fixtures/cassettes/ + agent.ts
      - uses: darrenapfel/Soundcheck@v2   # pin the released major tag (v2 -> latest v2.x; or pin @v2.0.0)
        with:
          aut: agent.ts                      # your agent-under-test config (required)
          scenarios: scenarios               # dir of scenario .json files
          cassette-dir: fixtures/cassettes   # recorded cassettes (the --replay default)
          # `args` defaults to --replay (offline, deterministic, no key). For a LIVE run instead:
          #   args: ""
          #   deepgram-api-key: ${{ secrets.DEEPGRAM_API_KEY }}
```

## Capability status

Everything below is shipped and oracle/test-verified.

| Capability | Status |
|---|---|
| Real-time recorder + oracle self-validation | ✅ Shipped |
| Faithful turn-taking + barge-in | ✅ Shipped |
| Reactive goal-driven caller (Evaline) + adversarial red-teamer | ✅ Shipped |
| Declarative, domain-agnostic gate registry | ✅ Shipped |
| Record/replay cassettes (first-class versioned Trace) | ✅ Shipped |
| Advisory LLM judge + panel | ✅ Shipped |
| Judge alignment loop (trust + cross-model + drift guard) | ✅ Shipped |
| Autonomous, domain-agnostic authoring | ✅ Shipped |
| Trace-driven Refine (red-green tuning) | ✅ Shipped |
| Self-improving loop: discover → promote → refine (`run --promote-failures`) | ✅ Shipped (`examples/self-improving-loop/`) |
| A/B & vendor bake-off | ✅ Shipped |
| End-to-end Soundcheck-tests-Soundcheck CI proof | ✅ Shipped |
| Five example domains (restaurant, IT-support, healthcare, banking, travel) | ✅ Shipped |
| Regression from *production* traffic (vs. a synthetic caller) | 🚧 Future |
| Online / production monitoring | 🚧 Future |
| Standalone STT / TTS validators | 🚧 Out of scope by design |

Soundcheck is a **pre-ship** harness today: sourcing discovered failures from *real production traffic* and *online monitoring* of live calls are separate surfaces, deliberately deferred. Standalone STT/TTS validators are out of scope by design — evaluate them after STS is great, not bundled in.

## Docs
- 🧭 [`docs/GUIDE.md`](docs/GUIDE.md) — **start here**: how it works + the workflow, end to end
- 🛠️ [`docs/COMMANDS.md`](docs/COMMANDS.md) — every command and flag (`run`, `author`, `tune`, `bakeoff`, `calibrate`, `validate`, `install-skill`)
- 🚦 [`docs/GATES.md`](docs/GATES.md) — the 10 gates: what each asserts and when to declare it
- 🎓 [`docs/TUTORIAL.md`](docs/TUTORIAL.md) — zero to a well-tuned agent, step by step
- 📖 [`docs/ABOUT.md`](docs/ABOUT.md) — what Soundcheck is, both uses, in one page
- 📐 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design
- 🧪 [`docs/TESTING.md`](docs/TESTING.md) — how we earn trust (record/replay, self-evaluation, calibration)
- ⚖️ [`docs/CALIBRATION.md`](docs/CALIBRATION.md) — live judge agreement numbers
- ⚠️ [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) — honest limits
- 🤝 [`CONTRIBUTING.md`](CONTRIBUTING.md) — add an adapter / scenario / gate

---

*MIT licensed. Built for the agents-test-agents era — for voice.*

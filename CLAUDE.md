# CLAUDE.md — Soundcheck developer guide

Soundcheck is the **test & tuning harness for speech-to-speech (STS) voice agents** — "CoStar for voice." It drives real spoken conversations against any voice agent, gates them deterministically, scores them with an advisory LLM judge, and tunes the agent until it passes. Runs on a single Deepgram key. Read `README.md` for the product; this file is the contract for working in the codebase.

## The cardinal rule (non-negotiable)

**The oracle decides, not you.** Validate every claim about a run with Soundcheck's own oracle (STT over the real recording) or a deterministic test — **never** a proxy (per-turn model text, byte offsets, "the run passed"). The gates already do this: they read `turn.agentSpokenHeardBack` = STT of the agent's actual audio (`src/capture/transcript.ts`), not the model's text. Never reconstruct/splice/stage evidence. **A faithful negative is a real result; a fabricated positive is a defect.** If you can't show oracle output or a passing test proving a claim, it is not done.

## Hard constraints

- **Node 22 native TypeScript** via `--experimental-strip-types`. **No build step for development** — the npm scripts, tests, and the GitHub Action all run raw `.ts`. Use `.ts` import extensions. **Erasable-syntax only** — no `enum`, no decorators, no parameter properties, no namespaces. (A *publish-time* `tsc -p tsconfig.build.json` build — `prepack` → `dist/**/*.js` + `.d.ts`, `.ts` import specifiers rewritten to `.js` — exists ONLY so the published npm package runs from `node_modules`, where Node refuses to strip types. `bin`/`main`/`types`/`exports` point at `dist`; `dist/` is gitignored and ships via the `files` allowlist. Do not import `dist/` from `src/`, and do not add a dev build step.)
- **ZERO runtime dependencies.** Built-in `fetch`/`WebSocket`, `node:` builtins only. `package.json` `dependencies` must stay empty (`typescript` is a devDep — the publish build doesn't change this). Anything else is a regression.
- **Deepgram-key-only.** Default + CI operation needs only `DEEPGRAM_API_KEY` — caller brain (VA `think`), TTS, STT/oracle, and judge all run on it. No OpenAI/Anthropic key. (The `openai-realtime` adapter is a non-CLI-selectable reference, imported nowhere.)
- **Deterministic, offline CI.** `.github/workflows/ci.yml` runs `npm run validate` with **no key**, replaying cassettes. Nothing in the validate path may need a key or network. A keyless `git clone` must validate green.
- MIT licensed; secrets gitignored (`.env*`, `*.key`, `runs/`, audio). Never commit a key — `test/security.test.ts` scans the tracked tree on every `validate`.

## Architecture — Scenario → Trace → Assess → Refine

| Step | What | Where |
|---|---|---|
| **Scenario** | portable test fixture: caller `goal`/`persona` + declarative `assert` invariants | `src/types.ts`, `examples/*/scenarios/*.json`, `src/author/` |
| **Trace** | the flight recorder: real-time mixed recording + oracle STT + per-turn text + tool trace + timings; persisted as a versioned cassette | `src/capture/` (`transcript.ts`, `cassette.ts`), `src/adapters/` |
| **Assess** | deterministic **gates** (hard pass/fail) + advisory **judge** + **calibration** | `src/gates/`, `src/judge/`, `src/calibration/`, `src/bakeoff/` |
| **Refine** | trace-driven tuning loop with a Goodhart held-out guard | `src/tune/` |

Caller ("Evaline"): `src/caller/` — `ScriptedCaller` (deterministic, CI) and `GoalDrivenCaller` (live VA brain). Report: `src/report/html.ts` (self-contained HTML, base64 audio). CLI: `src/cli.ts` (thin shell over the library).

## Public API & extension points

Consumers import from the front door (`src/index.ts` → the `"soundcheck"` package export), not deep paths. The supported seams:
- **A gate** — write a `GateFn(spec, ctx)`, add one `REGISTRY` entry (`src/gates/index.ts`). Gates must **fail closed** (a throw → `pass:false`).
- **An adapter** — implement `AUTAdapter` (`src/adapters/types.ts`) to test a new runtime.
- **A judge backend** — implement `JudgeBackend`; keep verdict parsing tolerant (small models emit malformed JSON).
- **A fixer** — any program reading `{prompt, diagnosis}` JSON on stdin, writing an improved prompt to stdout (`--fixer`).
- **A persona** — extend `Persona` (`src/types.ts`) + both `PERSONA_VOICE` maps + the planner's tactics.

`src/selfeval/` is internal (Soundcheck testing itself) — not part of the public API.

## Commands

```bash
npm run validate     # typecheck + lint + test — the gate. Must be green (offline, no key).
npm test             # all test/*.test.ts (Node test runner)
npm run soundcheck -- run scenarios --aut examples/healthcare/grounded.ts   # live run + report
npm run soundcheck -- bakeoff <dir> --a A.ts --b B.ts [--replay]            # A/B diff
```

`soundcheck` subcommands: `run`, `validate`, `calibrate`, `author`, `tune`, `bakeoff`. `--replay` is offline; `--turns N` deepens goal-driven calls; `--record` saves a cassette.

## Soundcheck tests Soundcheck

`test/self-test.test.ts` is the standing proof: the generic gates **catch** deliberately-regressed builds (buggy mock + insecure/bare examples) and **pass** correct ones, with a coverage contract that every core safety gate family is shown catching a real regression. If you change a gate, this must still have teeth. `test/selfeval.test.ts` (Evaline self-check) and `test/calibration.test.ts` (judge drift guard) round it out.

## Working discipline

- **Determinism:** gate-logic changes usually need **no** re-record (verify parity on existing cassettes); behavior changes need a re-recorded cassette via a **reviewed PR, never silently** (`runs/` is gitignored; cassettes live in `fixtures/cassettes/`).
- **Review:** every substantive change gets an independent review before it lands; address BLOCKER/MAJOR before moving on.
- **Honesty bar:** no overclaiming in docs; advisory things stay advisory (the judge never hard-gates a merge).

## Map of docs
`docs/ABOUT.md` · `docs/ARCHITECTURE.md` · `docs/TESTING.md` · `docs/CALIBRATION.md` · `docs/LIMITATIONS.md` · `CONTRIBUTING.md`.

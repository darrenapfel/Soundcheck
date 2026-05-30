# Contributing to Soundcheck

Thanks for helping build the test layer for the voice-agent era.

## Setup
```bash
npm install          # devDeps only (typescript, @types/node, eslint) — zero runtime deps
echo "DEEPGRAM_API_KEY=dg_..." > .env   # only needed for LIVE runs; tests/CI don't need it
npm run validate     # typecheck + lint + tests (fully offline, deterministic)
```
Node 22+ (we run TypeScript natively via `--experimental-strip-types`; no build step). Keep **zero runtime dependencies** — anything new needs justification in `docs/ARCHITECTURE.md`.

## The golden rules
1. **CI must stay offline + deterministic.** Live voice is stochastic. Use **record/replay** cassettes for any pipeline-level test; never gate CI on a live call. (`docs/TESTING.md`)
2. **Only `DEEPGRAM_API_KEY`** in the default/CI path. A new adapter for another runtime may read its own key, but only when explicitly selected — never in CI.
3. **Tests must constrain behavior.** Assert exact values; add a failing-case (teeth) test, not just a happy path.
4. **Be honest in docs.** If a feature is scoped/experimental, say so (see `docs/LIMITATIONS.md`).

## How to add…
- **A new AUT adapter** (test another runtime): implement `AUTAdapter` (`src/adapters/types.ts`) — `runConversation(aut, callerTurns) → RawTurn[]`. Audio adapters leave `agentSpokenHeardBack` unset (capture round-trips via STT); text/mock adapters set it. Mirror `DeepgramVoiceAgentAdapter`'s `WsFactory`/`SynthFn` injection so it's offline-testable. See `mock-aut.ts` for the simplest example.
- **A new gate**: add it in `src/gates/index.ts`, wire it into the dispatcher, and add a fixture unit test in `test/gates.test.ts` (assert it fails on a bad transcript AND passes on a good one).
- **A scenario**: drop a `.json` in `scenarios/` (`name`, `persona`, `turns` or `goal`, `assert`), or let `soundcheck author` generate one from a spec.
- **A judge backend**: implement `JudgeBackend` (`src/judge/types.ts`); keep the verdict parsing tolerant (small models emit malformed JSON — see `parse.ts`).
- **A tuning fixer**: any program reading `{"prompt","diagnosis"}` JSON on stdin (where `diagnosis` is a `{gate, problem, hint}[]` — trace-derived evidence per failing gate) and writing an improved prompt to stdout (e.g. `claude -p`, `codex`, a script).

## Before opening a PR
- `npm run validate` green; coverage maintained (`npm run test:coverage`).
- If you recorded cassettes, say why in the PR (cassettes are re-recorded only via review).
- No secrets in code/tests/fixtures (`test/security.test.ts` enforces this).

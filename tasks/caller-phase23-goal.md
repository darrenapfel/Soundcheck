# GOAL — Close CALLER_GAPS Phases 2 & 3 (with PROOF); finish Soundcheck publish-ready

Repo: `/Users/darrenapfel/DEVELOPER/Soundcheck`. Read first: `docs/CALLER_GAPS.md`, `CLAUDE.md`, `docs/REVIEW_LOG.md`; `src/caller/{policy,planner,evaline}.ts`; `src/adapters/deepgram-va.ts` (barge-in); `test/caller-policy.test.ts`. Autonomous — no human gates; every gate is a test, the oracle, or the reviewer. Write the proof matrix (below) first, then execute.

## Cardinal rule
- The ORACLE decides. Prove every behavioral claim with Soundcheck's oracle (STT over the real recording) OR a deterministic test — never a proxy; "the prompt contains the rule" is not sufficient alone for a LIVE claim.
- Never splice/stage/hand-edit evidence. A faithful negative is real; a fabricated positive is a defect. If unprovable (no key), say so + leave a reproducible command — never imply it was shown.

## Hard constraints
Deepgram-key-only (never import `openai-realtime`); ZERO runtime deps (`dependencies` stays `{}`); erasable-syntax TS, `.ts` imports, NO dev build step (the `dist` build is publish-time only); caller tests use a mock `PlanFn` (offline). Protect the baseline: `npm run validate` (typecheck + `eslint . --max-warnings=0` + 137 tests) and `npm run smoke` green. Never commit a secret.

## The work — close every tracked gap
**Phase 2** (`src/caller/planner.ts`):
- **M3** mid-call silence: distinguish turn-0 from empty-because-silent (`turnIndex>0` + empty `lastAgent`); prompt a prod ("Are you still there?").
- **M5** push-back: a CROSS-persona rule (cooperative + impatient, not just adversarial) reacting in character to unsafe/wrong agent behavior — see the M5 row.
- **M6** committed-facts: echo prior caller turns' concrete values (name/date/time/party/codes) as "facts you've committed to"; stay consistent on a re-ask; answer clarifying questions from the goal.

**Phase 3:**
- **L2** (first — unblocks L1): `PERSONA_VOICE` is defined twice (`policy.ts` + `evaline.ts`) — define once in the lower module + import (no cycle).
- **L1**: a DISTINCT Aura-2 voice/rate per persona (today all share `aura-2-orion-en`).
- **L4**: thread optional `interrupt?{text,afterMs}` through `PlanDecision` → `CallerAction.interrupt` (adapter already handles it; reuse the scripted barge-in path).

Mark any new scenarios `liveOnly`/`fixtureOnly` so `test/example-contract.test.ts` stays green.

## Definition of Done — PROOF is the bar
1. **PROOF MATRIX**: each gap → (a) exact deterministic test name(s) proving the logic offline (mock `PlanFn` / config / prompt-content), AND (b) for live behavior (M3 prod, M5 push-back, M6 re-ask consistency, L4 barge-in) an ORACLE artifact: a real recording whose `oracleTranscript`/`report-*.html` shows it — commit the cassette / pin a replay regression where possible. L1: a test asserting 3 distinct voices + the report renders per-persona audio (acoustics aren't gate-tested — say so).
2. `docs/CALLER_GAPS.md` "Tracked" table EMPTY; every gap in Fixed with its proof named; plan → "all shipped".
3. `npm run validate` + `npm run smoke` green; state the new test count (>137) and list added tests.
4. **INDEPENDENT REVIEW** that tries to REFUTE each proof (cassettes faithful not staged; tests have teeth — neuter a rule → red; no constraint regressed). Log verdict + fixes in `docs/REVIEW_LOG.md`.
5. Update `docs/LIMITATIONS.md`, `CHANGELOG [Unreleased]`, `docs/COMPLETION_REPORT.md` (with the proof matrix).
6. **CLOSEOUT**: cut the stable tag (move `@v2.0.0-rc.1` → `@v2`/`v2.0.0` on the reviewed HEAD; see `docs/RELEASE_CRITERIA.md`).

## Workflow
Branch `session/2026-05-30-caller-phase23` (created). Clusters L2→L1, then M3/M5/M6, then L4 — each ends green + a focused commit. PR → both CI jobs green → merge to `main`. Live proofs need `DEEPGRAM_API_KEY`; if absent, ship the deterministic floor + reproducible live commands + report demonstrated-vs-pending honestly.

# GOAL — Close CALLER_GAPS Phases 2 & 3; finish Soundcheck to "no open caller gaps, publish-ready," with comprehensive PROOF

> **How to use this:** hand this file to a fresh Claude Code session running on the Soundcheck
> repo (Opus, medium/high reasoning). It is a goal-shaped, autonomous brief in the style of the
> original M1–M8 build: run to best completion with no mid-run human gates — every gate is a
> test, the oracle, or the reviewer. Begin by reading the files listed under *Read first*, then
> write the **proof matrix** (below) as your plan, then execute it.

Repo: `/Users/darrenapfel/DEVELOPER/Soundcheck` (work here; cwd may be the parent workspace).

**Read first, in order:** `docs/CALLER_GAPS.md`, `docs/LIMITATIONS.md`, `docs/ARCHITECTURE.md`,
`docs/TESTING.md`, `CLAUDE.md`, `docs/REVIEW_LOG.md` (newest rows). Then `src/caller/{policy.ts,
planner.ts,evaline.ts}`, `src/adapters/deepgram-va.ts` (the barge-in path), `test/caller-policy.test.ts`.

---

## Cardinal rule (overrides any optimism)

- **The ORACLE decides, not you.** Validate EVERY behavioral claim with Soundcheck's own oracle
  (STT over the real mixed recording) OR a deterministic test — NEVER a proxy. For a LIVE claim,
  "the model text said so" and "the prompt contains the rule" are not sufficient on their own.
- **Never reconstruct, splice, hand-edit, or stage evidence.** A faithful NEGATIVE is a real
  result worth reporting; a fabricated or flattering POSITIVE is a defect.
- If something cannot be proven (e.g. no live key), **say so plainly** and leave a reproducible
  command + an honest "pending live capture" — do not imply it was demonstrated.

## Hard constraints (a violation is a regression)

- **Deepgram-key-only:** default + CI read only `DEEPGRAM_API_KEY`. Never import the
  `openai-realtime` reference adapter. No OpenAI/Anthropic key.
- **ZERO runtime dependencies:** `package.json` `"dependencies"` stays empty; `node:` builtins +
  built-in `fetch`/`WebSocket` only.
- **Erasable-syntax TypeScript**, `.ts` import extensions, **NO dev build step** (the `dist/`
  build is publish-time only — do not add a build to the dev/validate path).
- **Baseline to protect:** `npm run validate` green (typecheck + `eslint . --max-warnings=0` +
  137 tests) and `npm run smoke` green. Never commit a secret; gitignore `.env` before any `add`;
  the tracked tree is scanned by `test/security.test.ts`.
- Caller-logic tests use a **mock `PlanFn`** (offline, deterministic). The live Deepgram-VA brain
  is never used in CI.

---

## The work — close every remaining tracked gap in `docs/CALLER_GAPS.md`

### Phase 2 — realism of the goal-driven brain

- **M3 (mid-call silence):** today an empty agent reply mid-call renders as "(the call just
  connected)", so Evaline re-greets instead of prodding. Distinguish turn-0 from
  empty-because-silent (`turnIndex > 0` + empty `lastAgent`) and prompt a prod ("Hello? Are you
  still there?"). Touch: `src/caller/planner.ts` (the `plannerPrompt` branch); confirm the adapter
  passes an empty `lastAgent` through on a silent turn.
- **M5 (push-back on bad agent behavior):** a cross-persona rule (cooperative + impatient too,
  not just adversarial) to react in character when the agent does something unsafe or wrong —
  question an over-broad data request, push back on a wrong charge, show frustration at repeated
  failure. Touch: `src/caller/planner.ts`.
- **M6 (committed-facts scratchpad):** echo the concrete values from prior caller turns (name,
  date, time, party size, codes/IDs) into the prompt as "facts you've committed to," with an
  instruction to stay consistent on a re-ask and to answer the agent's clarifying questions from
  the goal. Touch: `src/caller/planner.ts` (extract values from `history`).

### Phase 3 — polish / DRY

- **L2 (FIRST — it unblocks L1):** `PERSONA_VOICE` is defined twice (`src/caller/policy.ts` and
  `src/caller/evaline.ts`). Define it ONCE in the lower module and import; mind the
  `policy ↔ evaline` import direction (no cycle).
- **L1:** give each persona a DISTINCT Aura-2 voice (and/or rate) so a prosody-sensitive agent can
  hear the difference (today all three share `aura-2-orion-en`).
- **L4:** thread an optional `interrupt?: { text; afterMs }` through `PlanDecision` so the
  GOAL-DRIVEN caller can barge in (the scripted caller already can). `GoalDrivenCaller` maps it
  onto `CallerAction.interrupt`, which `src/adapters/deepgram-va.ts` already handles — reuse that
  path.

If new example scenarios are added, mark each `liveOnly` or `fixtureOnly` so
`test/example-contract.test.ts` stays green.

---

## Definition of Done — comprehensive PROOF (this is the bar, not "code written")

1. **PROOF MATRIX.** Produce a table mapping EVERY gap (M3, M5, M6, L1, L2, L4) to:
   - (a) the exact deterministic test name(s) that prove the logic offline (mock `PlanFn` /
     config assertion / prompt-content assertion), AND
   - (b) for every LIVE-observable behavior (M3 prod, M5 push-back, M6 consistency on a re-ask,
     L4 barge-in), an ORACLE artifact: a real recorded call whose `oracleTranscript` /
     `runs/report-*.html` shows the behavior. Commit the cassette and/or reference the report
     path. Where pinning as a replay regression is possible (e.g. L4, like the existing scripted
     barge-in), do it.

   For **L1**, distinctness is proven by a test asserting three distinct voice models AND the
   report rendering per-persona caller audio (acoustics are not gate-tested by design — say so).
2. `docs/CALLER_GAPS.md` "🚧 Tracked" table is **EMPTY** — every gap moved to a Fixed section
   with its fix + the proof artifact named. Update the phased plan to "all phases shipped."
3. `npm run validate` green (typecheck, `eslint --max-warnings=0`, all tests) and `npm run smoke`
   green. State the new test count (grown from 137) and list the added tests.
4. **INDEPENDENT REVIEW:** spawn an adversarial reviewer (sub-agent or a fresh reviewer pass) that
   tries to REFUTE each proof — checks the cassettes are faithful (look for genuine STT drift, not
   staged text), the tests have teeth (neuter the new rule → the test goes red), and no constraint
   regressed. Log the verdict + fixes as a new row in `docs/REVIEW_LOG.md`.
5. **Docs updated:** `docs/LIMITATIONS.md` (the realism caveats these close), `CHANGELOG`
   `[Unreleased]`, `docs/COMPLETION_REPORT.md` (or a closing section) with the proof matrix.
6. **PROJECT CLOSEOUT:** cut the stable release tag the README/Action snippet expects (move the
   Action pin from `@v2.0.0-rc.1` to `@v2` / `v2.0.0` on the reviewed HEAD per
   `docs/RELEASE_CRITERIA.md`). Optional polish: bump CI off the deprecated Node-20 runner warning.

---

## Workflow

- This work happens on branch `session/2026-05-30-caller-phase23` (already created). Work in
  clusters (**L2 → L1**, then **M3 / M5 / M6**, then **L4**), each ending green with its tests +
  a focused commit. Match the repo's existing commit-message and PR conventions (read recent
  `git log`). Open a PR; ensure BOTH CI jobs (`validate` + `smoke`) are green; merge to `main`
  (or present for merge if the owner gates merges).
- **Live oracle validation needs `DEEPGRAM_API_KEY`.** If present, record the capstone proofs and
  commit the artifacts. If absent, ship the deterministic floor, commit a reproducible live
  command per live proof, and report demonstrated-vs-pending HONESTLY — never fabricate.

**Autonomy:** run to best completion with no mid-run human gates; every gate is a test, the
oracle, or the reviewer. Calibrate claims to what was actually shown.

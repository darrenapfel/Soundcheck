# Soundcheck Round-Three PR Review

Date: 2026-05-30
Reviewed HEAD: `0cf9cd6` (`main`, `origin/main`)
Baseline: round-two review at `687c637` / `docs/SOUNDCHECK_ROUND2_READINESS_REVIEW.md`
Scope: PRs merged after the round-two baseline, especially public execution paths, packaging, example contract, caller behavior, and docs drift.

## PRs Reviewed

| PR | Merge commit | Title | Review focus |
|---|---|---|---|
| #7 | `83e61ed` | Round-2 readiness fixes + caller Phase 1 | Example contract, Windows path containment, lint warnings, caller termination integrity. |
| #8 | `60838de` | Packaging: publish-time build so npm install runs | Dist build, installed CLI, package smoke, CI wiring. |
| #9 | `c6079d3` | Caller Phases 2 & 3 | Caller realism/polish, goal-driven barge-in, release tags. |
| #10 | `0cf9cd6` | Docs sync after caller Phases 2-3 | Test-count/doc inventory sync and stale claims. |

The direct commit `621dd6b` added the round-two report and caller-gaps phased plan between the baseline and PR #7; I treated it as context rather than a product PR.

## Executive Verdict

The post-review PRs closed the big round-two blockers. Most importantly, the public package runtime failure is fixed: Soundcheck now builds to `dist` at pack time and the installed-package smoke passes. The example contract is also much better: live-only and fixture-only examples skip cleanly under replay instead of crashing on missing cassettes. The caller work is meaningfully more robust, with termination reasons, stronger prompt constraints, persona voice cleanup, and deterministic tests around the policy layer.

Readiness score: **88 / 100**.

This is now much closer to public-ready. I found no new P0 release blocker in the merged PRs. The remaining issues are mostly public-polish and edge-case correctness: TypeScript consumers need `@types/node` even though the package does not declare that type dependency, docs still contradict the newly-fixed packaging/tag state in a few places, and the `goal_reached` guard only attaches to scenarios with a `goal` field even though the CLI can force `--caller goal` on a non-goal scenario.

## What Improved Since Round Two

- **P0 packaging fixed.** `package.json` now points `main`, `types`, and `exports` at `dist`; `prepack` builds JavaScript and declarations; `bin/soundcheck.mjs` loads `dist/cli.js` when present.
- **Package smoke added to CI.** `scripts/smoke-package.sh` packs, installs into a throwaway consumer, imports the package, and runs an installed CLI replay.
- **Stable tags now exist.** Remote tags include `v2` and `v2.0.0`, and README uses `darrenapfel/Soundcheck@v2`.
- **Example contract fixed for the prior obvious gaps.** Interactive goal/barge-in examples are now `liveOnly`; tune-demo and authored examples are `fixtureOnly`; replay skips them cleanly and fails closed if nothing runs.
- **Windows cassette containment fixed.** `isWithinRoot()` uses `path.relative`, with POSIX and Windows tests.
- **Strict lint is currently clean.** `npm run lint -- --max-warnings=0` passes.
- **Caller termination integrity added.** `TerminationReason` is threaded from caller to capture to trace/cassette/report, and `runGates()` adds a synthetic `goal_reached` gate for goal scenarios with known termination.
- **Caller realism/polish improved.** Distinct persona voices, one voice-source map, mid-call silence handling, push-back rules, committed-facts prompting, and goal-driven barge-in are covered in deterministic policy tests.

## Verification Run

All commands below were run locally at `0cf9cd6`:

| Check | Result |
|---|---|
| `npm run validate` | Pass; typecheck, lint, 144/144 tests. |
| `npm run lint -- --max-warnings=0` | Pass; no warnings emitted. |
| `npm test` | Pass; 144/144. |
| `npm run test:coverage` | Pass; all-files line coverage 89.27%, branch 86.17%, functions 89.90%. |
| `npm run build` | Pass; emits `dist/**/*.js` and `.d.ts`. |
| `npm run smoke` | Pass; pack/install/import/installed CLI replay. |
| `git ls-remote --tags origin 'refs/tags/v*'` | `v2`, `v2.0.0`, and RC tags present. |

README replay commands:

- `run scenarios --aut examples/tabletalk/grounded.ts --replay`: passed.
- `run scenarios --aut examples/tabletalk/bare.ts --replay --only book-modify-confirm`: failed as expected, catching the planted speech/grounding bugs.
- `run examples/support/scenarios --aut examples/support/grounded.ts --replay`: passed, skipping the live-only adversarial scenario.
- `run examples/support/scenarios --aut examples/support/insecure.ts --replay --only frustrated-reset`: failed as expected, catching reset-before-verify and forbidden delete.

Previously broken example-contract probes:

- `examples/interactive --only goal-specials --replay`: now skips as live-only and exits 2 because zero replayable scenarios ran.
- `examples/interactive --only barge-in-closing --replay`: same, clean skip/fail-closed.
- `examples/self-improving-loop/scenarios --replay`: no missing cassette; replayed the committed regression, then skipped the live-only discovery scenario.
- `examples/tune-demo/scenarios --replay`: clean fixture-only skips, then fail-closed zero replay.
- `examples/authored-* --replay`: clean fixture-only skips, then fail-closed zero replay.

Additional consumer checks:

- Installed CLI from packed tarball works when the consumer's agent/scenarios/fixtures are outside `node_modules`.
- A fresh TypeScript consumer **without** `@types/node` fails typechecking on Soundcheck's declarations because exported types reference `Buffer` and `node:path`.
- The same consumer passes after installing `@types/node`.
- Running bundled `.ts` examples in-place from `node_modules/soundcheck/examples/...` still fails because Node refuses to strip TypeScript under `node_modules`.

## Findings

### P2 - Published types require `@types/node`, but the package does not declare or test that dependency

Evidence:

- `dist/types.d.ts` exposes `Buffer` in public `Trace`/`CapturedTurn` fields.
- `dist/adapters/types.d.ts` exposes `Buffer` in `RawTurn` and `ConversationCapture`.
- A clean TypeScript consumer importing `soundcheck` failed `tsc --noEmit` with missing `Buffer` and missing `node:path` type declarations.
- Installing `@types/node` in that consumer made the same typecheck pass.

Impact:

- Runtime package execution is fixed, but TypeScript consumers can still hit a confusing first-use failure if they do not already have Node types installed.
- `scripts/smoke-package.sh` imports from a `.ts` file using Node type stripping, but it does not run `tsc` in the consumer project, so it misses this.

Recommendation:

- Either document `@types/node` as required for TypeScript consumers, add it as a dependency/peer type dependency, or reduce public declaration exposure to `Uint8Array`/`ArrayBufferLike` where feasible.
- Add a smoke step that runs consumer `tsc --noEmit` against an import of `soundcheck`.

### P2 - `goal_reached` does not guard forced `--caller goal` runs unless the scenario has a `goal` field

Evidence:

- `src/cli.ts` enables goal mode when `opts.caller === "goal"` even if `scenario.goal` is absent, falling back to `"Accomplish your task with the agent, then end the call."`.
- `src/gates/index.ts` only injects `goal_reached` when `scenario.goal && t.terminationReason`.

Impact:

- If a user forces `--caller goal` on a scripted scenario without `goal`, a `turn_cap`, `planner_error`, or `repeat_guard` termination can avoid the synthetic termination gate.
- The normal documented live-only goal examples are covered because they have `goal`, so this is an edge case rather than a top-path bug.

Recommendation:

- Thread an explicit `goalDriven: true` or `effectiveGoal` marker onto the trace/context, or clone the scenario with the fallback goal before calling `runGates`.
- Add a test for `--caller goal` on a scenario without a `goal` field.

### P2 - Docs sync left stale statements that contradict the new PR state

Evidence:

- `CHANGELOG.md` says the README Action snippet pins `@v2.0.0-rc.1`, but README now pins `@v2`.
- `docs/RELEASE_CRITERIA.md` still says the README snippet pins `@v2.0.0-rc.1` and instructs cutting/moving `v2`, but remote `v2` and `v2.0.0` tags now exist and README uses `@v2`.
- `docs/REVIEW_LOG.md` says the round-two P0 packaging issue was deferred to an owner decision, even though PR #8 resolved it and smoke is green.

Impact:

- Developers reviewing the docs see conflicting release state: some files say the P0 is open/deferred and the tag does not exist; the code and remote tags say the opposite.

Recommendation:

- Add one doc-only cleanup PR after #10 to align CHANGELOG, RELEASE_CRITERIA, and REVIEW_LOG with PR #8/#9 reality.
- Keep historical review reports as-is, but current status documents should not contradict current HEAD.

### P2 - CI validates lint, but does not enforce warning-clean lint as the default gate

Evidence:

- `npm run lint -- --max-warnings=0` is clean today.
- `npm run validate` still calls `npm run lint`, and `package.json` defines `"lint": "eslint ."`.

Impact:

- A future warning can pass `npm run validate` and the CI `validate` job, despite docs claiming zero warnings as the release bar.

Recommendation:

- Change the `lint` script to `eslint . --max-warnings=0`, or update CI to run the strict form.

### P3 - Bundled package examples are not runnable in-place from `node_modules`

Evidence:

- The installed package includes `examples/**/*.ts`.
- Running `./node_modules/.bin/soundcheck run node_modules/soundcheck/scenarios --aut node_modules/soundcheck/examples/tabletalk/grounded.ts --replay` fails with: `Stripping types is currently unsupported for files under node_modules`.
- The smoke test works by copying `examples`, `src`, `scenarios`, and `fixtures` out to the consumer root before running the example.

Impact:

- This does not break normal consumer usage, where the user's own `.ts` agent lives outside `node_modules`.
- It can surprise a reviewer trying to run packaged examples directly.

Recommendation:

- Either document that packaged examples must be copied before running, or publish built JS examples / a `soundcheck example` helper that materializes them into the current project.

### P3 - Latency message renders `n/ams`

Evidence:

- Support replay output includes `latency — ok (avg TTFB n/ams)` when all TTFB values are `null`.
- The formatting is `avg ?? "n/a"` followed by `ms`.

Impact:

- Cosmetic only, but it appears in public CLI output.

Recommendation:

- Format as `avg == null ? "ok (avg TTFB n/a)" : "ok (avg TTFB ${avg}ms)"`.

## PR-by-PR Notes

### PR #7

Verdict: successful. It addresses the main round-two P1/P2 set and adds real guardrails. The example-contract test is useful, but it verifies "some cassette exists for this scenario name" rather than "every documented AUT/scenario combination is replay-backed." That is acceptable for the current README, which uses explicit `--only` on partial ladders, but it is not a full matrix contract.

### PR #8

Verdict: successful for runtime packaging. The prior P0 is resolved for normal installed CLI usage. The remaining packaging issues are type-consumer polish and in-place packaged examples, not runtime blockers.

### PR #9

Verdict: strong deterministic progress. The caller-policy tests now cover the right policy seams. The live brain itself remains exploratory and was not revalidated live in this review. The main residual correctness edge is the `--caller goal` forced-mode gate omission noted above.

### PR #10

Verdict: useful but incomplete docs sync. Counts and inventory are mostly current, but several release-state statements were already stale by the time #8/#9 landed. This should be cleaned up before external review.

## Updated Readiness Score

| Axis | Score | Notes |
|---|---:|---|
| Core architecture | 88 | Stronger caller model and trace tagging; one forced-goal edge remains. |
| CLI correctness | 88 | Top public commands and fail-closed replay work; minor output polish remains. |
| Example usefulness | 84 | Contract is explicit; live-only domains still lack committed replay evidence. |
| Test suite | 91 | 144 tests plus smoke; add consumer typecheck and forced-goal edge test. |
| Documentation accuracy | 82 | README improved, but current status docs contradict packaging/tag state. |
| Public packaging | 86 | Runtime fixed; TypeScript declarations and packaged examples need polish. |
| Security/robustness | 88 | Windows path fix and smoke help; clean-tree guard still open. |

Overall readiness: **88 / 100**.

## Recommended Next Actions

1. Add consumer `tsc --noEmit` to `scripts/smoke-package.sh` and decide how to handle `@types/node`.
2. Make the goal termination gate apply to forced `--caller goal` runs too.
3. Clean stale release-state docs in CHANGELOG, RELEASE_CRITERIA, and REVIEW_LOG.
4. Enforce `eslint . --max-warnings=0` in the default lint/CI path.
5. Fix the `n/ams` latency string.
6. Decide whether packaged examples should be copy-only, built, or runnable in place.


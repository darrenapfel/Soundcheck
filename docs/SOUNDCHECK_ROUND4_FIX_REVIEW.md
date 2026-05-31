# Soundcheck Round 4 Fix Review

Date: 2026-05-31
Reviewer: Codex
Scope: PR #11 and all changes after the round-three baseline `0cf9cd6` through `14fc390`.

This review is intentionally limited to review/reporting. No source code changes were made.

## Executive Verdict

Round-three fixes are real and materially improve the project. On `main`, Soundcheck now looks close to a public-ready v2 candidate: the default validation path is strict, package smoke now exercises the installed tarball plus TypeScript declarations, the `goal_reached` gate now keys on the actual caller mode, and the offline examples I retested behave as advertised.

The main remaining blocker is release hygiene: the public `v2` and `v2.0.0` tags still peel to the pre-fix commit `c6079d34`, while `main` is now `14fc390`. That means a developer following the README's GitHub Action pin (`darrenapfel/Soundcheck@v2`) will not get the fixes reviewed here.

Readiness score:

- `main` at `14fc390`: **91/100**
- documented public refs (`@v2` / `@v2.0.0`) as currently cut: **86/100**

Release recommendation: **GO for code-quality direction; NO-GO for public release until the version/tag story is fixed.**

## What Changed Since Round 3

Reviewed commits after `0cf9cd6`:

- `14fc390` - Merge PR #11, "Round-3 review fixes"
- `84fcadd` - docs sync for round-three findings
- `878c5b4` - `@types/node` peer + consumer typecheck smoke; examples documented as source references
- `6ccc328` - `goal_reached` caller-mode guard; strict lint; latency `n/a`
- `3c82e2a` - round-three review report

Files changed across this range included `package.json`, `scripts/smoke-package.sh`, `src/gates/index.ts`, `src/types.ts`, `src/adapters/*`, `src/capture/*`, and targeted tests.

## Round-Three Findings Recheck

| Prior finding | Current status | Evidence |
|---|---:|---|
| Published types need Node types | Mostly fixed | `@types/node` is now an optional peer; README tells TS consumers to install it; `npm run smoke` installs TS + Node types and typechecks a consumer. Strict consumers without `@types/node` still fail, but this is now documented. |
| `goal_reached` missed forced `--caller goal` on no-goal scenarios | Fixed | `goalDriven` now flows from caller -> capture -> transcript -> cassette -> `Trace`; `runGates()` keys on `t.goalDriven`, not `scenario.goal`. |
| Docs stale on release state | Partially fixed | README/CHANGELOG/REVIEW_LOG are better, but release tags are now the concrete mismatch and several current docs still say 144 tests. |
| Default lint did not fail on warnings | Fixed | `package.json` now runs `eslint . --max-warnings=0`; `npm run validate` exercised it. |
| Packaged `.ts` examples not runnable in-place from `node_modules` | Accepted and documented | README states bundled examples are source references and must be copied out. Smoke test copies examples/src/scenarios/fixtures into a consumer project and replays there. |
| Latency string rendered `n/ams` | Fixed | `src/gates/index.ts` now prints `ok (avg TTFB n/a)`; support replay verified this exact output. |

## Verification Run

All commands below were run locally from `/Users/darrenapfel/DEVELOPER/Soundcheck`.

| Check | Result |
|---|---:|
| `npm run validate` | Pass: typecheck, strict lint, 145/145 tests |
| `npm run test:coverage` | Pass: 145/145 tests; all-files line coverage 89.33%, branch 86.16%, funcs 89.98% |
| `npm run build` | Pass |
| `npm run smoke` | Pass: pack -> install tarball -> import package -> replay from consumer project -> TS consumer typecheck |
| `npm pack --dry-run` | Pass: `soundcheck-2.0.0.tgz`, 168 files, 219.3 kB package |
| `git status --short` before report | Clean |

Package smoke specifically proved:

- `dist/cli.js` and `dist/index.js` are present after install.
- A consumer `.ts` file can import `soundcheck`.
- The installed CLI runs an offline replay from `node_modules`.
- A TypeScript consumer with `typescript` + `@types/node` typechecks against published declarations.

Additional TypeScript check:

- A strict declaration-checking consumer without `@types/node` still fails on `Buffer` / `node:path`.
- This is acceptable only because the README now states the requirement.

## Example Validation

I re-ran the copy-paste offline examples and the failure examples:

| Example command | Expected | Actual |
|---|---:|---:|
| `run scenarios --aut examples/tabletalk/grounded.ts --replay` | Pass | Pass, 3/3 scenarios |
| `run scenarios --aut examples/tabletalk/bare.ts --replay --only book-modify-confirm` | Fail | Fail on `no_spoken_symbols` and `grounding` |
| `run examples/support/scenarios --aut examples/support/grounded.ts --replay` | Pass | Pass; `adversarial-discovery` skipped as live-only |
| `run examples/support/scenarios --aut examples/support/bare.ts --replay --only reset-and-callback` | Fail | Fail on `no_spoken_symbols` and `grounding` |
| `run examples/support/scenarios --aut examples/support/insecure.ts --replay --only frustrated-reset` | Fail | Fail on `tool_sequence` and `forbidden_tool` |
| `run examples/self-improving-loop/scenarios --aut examples/tabletalk/bare.ts --replay --only book-this-saturday-regression` | Fail | Fail on `grounding`, as promised |
| `run examples/healthcare/scenarios --aut examples/healthcare/grounded.ts --replay` | Fail closed | Exit 2; live-only scenario skipped and no vacuous green |

I did not count live-only healthcare, banking, travel, interactive, or discovery runs as validated in this pass. They require live Deepgram calls and are explicitly marked live-only.

The `tune` demo command starts a live/stochastic flow and produced no progress output for over a minute in my run, so I stopped it rather than spend live-call budget inside a release review. The deterministic `tune` and regression tests are green, but the live demo would benefit from progress logging or an expected-duration note.

## Findings

### P1 - Public `@v2` / `@v2.0.0` refs are stale relative to the fixed `main`

Evidence:

- `HEAD` is `14fc3908b819c45bd293d9f7f644c12b1ab7cdc8`.
- `v2^{}` and `v2.0.0^{}` peel to `c6079d34dc90507ff417cca1f282b58577b8d4e3`.
- `git diff v2^{}..HEAD` includes the round-three fixes in `package.json`, `scripts/smoke-package.sh`, `src/gates/index.ts`, `src/capture/*`, and tests.
- README still tells users to pin `darrenapfel/Soundcheck@v2`, and says `@v2.0.0` is also an option.

Why this matters:

Developers following the public README will execute the older action/source tree. They will miss the `goalDriven` fix, strict default lint, optional peer declaration, expanded smoke, and latency wording fix.

Recommended fix:

- If `v2.0.0` is not yet public/consumed, recreate both tags on the reviewed release commit and push tags deliberately.
- If `v2.0.0` may already be consumed, do not move the immutable patch tag. Bump package version to `2.0.1`, cut `v2.0.1`, and move the mutable `v2` major tag to that commit.
- Update README/CHANGELOG/RELEASE_CRITERIA to match the chosen release.

### P2 - The release clean-tree guard is still open

Evidence:

- `docs/RELEASE_CRITERIA.md` still has the clean-tree release guard unchecked.
- `npm pack --dry-run` includes all of `docs/`, including review reports, so local uncommitted docs can enter the tarball if a release is packed from a dirty tree.

Recommended fix:

- Add a release script or prepack guard for release mode that verifies:
  - `git diff --quiet`
  - `git diff --cached --quiet`
  - optionally, `git status --short --untracked-files=no` or an explicit allowlist for generated `dist`
- At minimum, document the exact release command sequence and require the guard before tagging or publishing.

### P2 - The new `goalDriven` persistence path is correct in code but under-tested

Evidence:

- Code persists `goalDriven` in `src/capture/cassette.ts` and copies it in `src/capture/transcript.ts`.
- Tests cover `goal_reached` behavior with a manually constructed `Trace`.
- Tests cover adapter-level `goalDriven` for `converse()`.
- No test currently asserts that `buildTranscript()` copies `terminationReason` / `goalDriven`, or that `saveCassette()` / `loadCassette()` round-trip them.

Why this matters:

The round-three fix depends on this metadata surviving record/replay. A future omission in cassette or transcript plumbing would silently remove the `goal_reached` row from replayed goal-driven cassettes.

Recommended fix:

- Add a capture test asserting `buildTranscript()` preserves `terminationReason` and `goalDriven`.
- Add a cassette test asserting both fields survive save/load.

### P3 - Current docs still contain stale 144-test counts

Evidence:

- The current suite is 145 tests.
- `CHANGELOG.md` and the latest `docs/REVIEW_LOG.md` row say 145.
- `docs/RELEASE_CRITERIA.md`, `docs/COMPLETION_REPORT.md`, `docs/CALLER_GAPS.md`, and the top coverage note in `docs/REVIEW_LOG.md` still contain current-looking 144-test statements.

Recommended fix:

- Update current-state docs to 145.
- Leave historical review reports alone where they intentionally describe the count at that time.

### P3 - The live `tune` example could use progress output

Evidence:

- The self-improving replay regression works offline.
- The live `tune` command is covered deterministically by unit tests, but the example command produced no progress output after the initial banner for more than a minute in this review, so I interrupted it.

Recommended fix:

- Print per-evaluation progress in `cmdTune()` (`evaluating train`, `evaluating held-out`, `running fixer`, etc.).
- Add an expected duration / live-key note near the command in `examples/self-improving-loop/README.md`.

## Final Assessment

Soundcheck is now credible as a serious public artifact. The core harness has the right shape: deterministic replay, oracle-grounded gates, installed-package smoke, strict lint, examples that demonstrate both clean and broken agents, and a practical GitHub Action path.

The remaining work is mostly release discipline and a small amount of test hardening. Fix the stale public tags/version, add metadata round-trip tests for `goalDriven`, and clean the current-state docs. After that, I would be comfortable moving the score into the mid-90s and treating this as a strong Deepgram-facing submission.

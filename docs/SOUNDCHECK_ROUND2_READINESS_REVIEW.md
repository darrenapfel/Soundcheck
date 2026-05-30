# Soundcheck Round-Two Public Readiness Review

Date: 2026-05-30
Reviewed commit: `687c637` (`main`, `origin/main`)
Reviewer scope: code, packaging, tests, README/examples, and CLI behavior. Existing core `docs/` content was not re-reviewed because it is actively being updated by another agent. The pre-existing local modification to `docs/CALLER_GAPS.md` was left untouched.

## Executive Verdict

Soundcheck is materially stronger than the first review. The main P0/P1 behavioral fixes landed: zero-match filters now fail closed, live-only replay no longer reports vacuous green, the Action shape is usable in-source, the Deepgram adapter has handshake timeouts and cleanup, `.env` lookup now works from a consumer CWD, and the test suite is substantially better.

However, it is not yet public-release bulletproof. The largest remaining blocker is packaging: the installed npm binary fails from `node_modules` because Node's native TypeScript stripping refuses to strip files under `node_modules`. A Deepgram reviewer cloning the repo can run the examples; a developer installing the package cannot run the CLI as published. There are also still example-contract gaps: several examples documented as live-only are not marked `liveOnly`, so `--replay` produces missing-cassette errors instead of the clean skip/fail-closed behavior introduced for the other domains.

Readiness score: **78 / 100**

Interpretation: credible interview artifact and strong repo-clone demo; not yet a public package or documentation-ready release.

## Five-Step Verification

### 1. Known Blockers From The Prior Review

Status: mostly fixed, with one platform-specific caveat.

Verified fixed:

- Quickstart now points to the user's own agent path: `soundcheck author --spec ./my-agent.ts --out scenarios` and `soundcheck run scenarios --aut ./my-agent.ts`.
- GitHub Action input shape now requires `aut`, has `cassette-dir`, defaults `args` to `--replay`, and passes `SOUNDCHECK_CASSETTE_DIR`.
- `run --only` with zero matches exits 2 and does not report green.
- `bakeoff --only` with zero matches exits 2 and does not report a vacuous tie.
- `--replay` skips scenarios marked `liveOnly`; if the replay would run zero scenarios, it exits 2.
- `author --today YYYY-MM-DD` works and reports the date anchor.
- Mock mode is labeled as `mock (offline)`.
- `.env` lookup checks `process.cwd()/.env` before the package `.env`.
- Deepgram REST calls have hard timeouts and non-retryable 4xx behavior.
- Deepgram Voice Agent setup waits for `Welcome` then `SettingsApplied`, rejects setup `Error`, times out instead of hanging, and closes the socket/pump in `finally`.
- Async tool stubs are awaited and failures are returned as structured tool errors.
- Scenario/AUT labels used for cassettes are sanitized.

Residual caveat:

- Cassette path containment uses `p.startsWith(root + "/")` in `src/capture/cassette.ts`. On Windows, `path.resolve` returns backslash-separated paths, so valid cassette paths can fail the containment check. Use `path.relative(root, p)` plus `!rel.startsWith("..") && !path.isAbsolute(rel)` or `path.sep`-aware checking, and add a Windows-path unit test.

### 2. Example Contract Decision

Status: partially done.

The current contract is clear for the top-level README examples:

- Restaurant booking, grounded: offline replay-backed.
- Restaurant booking, bare/hardened: replay-backed only for the `book-modify-confirm` ladder.
- IT support, grounded/bare/insecure: replay-backed for scripted scenarios, with `adversarial-discovery` skipped under replay.
- Healthcare, banking, travel: live-only, goal-driven.
- Support adversarial discovery: live-only in the scenario metadata.

The contract is still incomplete across the full `examples/` tree:

- `examples/interactive/goal-specials.json` has `goal` but no `liveOnly`.
- `examples/interactive/barge-in-closing.json` has `bargeIn` but no `liveOnly`.
- `examples/self-improving-loop/scenarios/book-this-saturday.json` has `goal` but no `liveOnly`.
- `examples/tune-demo/scenarios/*.json` have no cassettes and no explicit fixture/demo-only marker.
- `examples/authored-*/*.json` have no cassettes and no explicit fixture/generated-only marker.

Recommendation: make the contract machine-readable for every example scenario. At minimum, add `liveOnly: true` to goal-driven/barge-in scenarios without cassettes. Better: add a small manifest or scenario field that distinguishes `replayVerified`, `liveOnly`, `fixtureOnly`, and `generatedFixture`, then gate it in tests.

### 3. Cassette Coverage

Status: improved for the primary demos, incomplete for the full examples directory.

Replay-backed cassettes currently exist for:

- `book-modify-confirm`: `tabletalk-grounded`, `tabletalk-bare`, `tabletalk-hardened`
- `menu-price`: `tabletalk-grounded`
- `restaurant-info`: `tabletalk-grounded`
- `reset-and-callback`: `support-grounded`, `support-bare`
- `frustrated-reset`: `support-grounded`, `support-insecure`
- `adversarial-discovery`: `support-bare`, `support-insecure`
- `book-this-saturday-regression`: `tabletalk-bare`

Missing or intentionally absent cassettes:

- Healthcare, banking, travel live-only scenarios have no cassettes. That is acceptable only if the docs explicitly treat them as live demos and provide recent live evidence.
- Interactive scenarios have no cassettes but also lack `liveOnly`.
- Tune-demo scenarios have no cassettes and are not labeled as tune fixtures.
- Authored scenario fixtures have no cassettes and are not labeled as generated fixtures.
- Full `scenarios/` replay against `tabletalk-bare` or `tabletalk-hardened` fails after `book-modify-confirm` because `menu-price` and `restaurant-info` cassettes are only recorded for `tabletalk-grounded`. The top-level README avoids this with `--only`, but the table language can still read as if all variants are fully replay-backed.

### 4. Automated Tests For The Example Contract

Status: partial.

Good new coverage:

- `test/cli.test.ts` proves zero-match fail-closed behavior for `run` and `bakeoff`.
- `test/cli.test.ts` proves support replay skips `liveOnly` and all-live-only replay exits 2.
- `test/cli.test.ts` proves the Action-shaped command works with `SOUNDCHECK_CASSETTE_DIR`.
- `test/adapter-loop.test.ts` now exercises the Deepgram adapter loop offline, including reactive caller, setup error, setup timeout, and recorder drain.
- `test/report.test.ts` pins report audio rendering, oracle/gate/judge rendering, and HTML escaping.

Remaining automated coverage gap:

- There is no test that enumerates every `examples/**/*.json` scenario and asserts one of:
  - it has at least one cassette for the advertised AUT, or
  - it is `liveOnly`, or
  - it is explicitly marked fixture/generated-only and excluded from replay examples.

This is the test that would have caught the remaining interactive/self-improving/tune-demo/authored contract drift.

### 5. Full Re-Review And Example Validation

Status: repo-clone validation mostly green; package/public validation blocked.

Commands run:

- `npm test`: passed, 127/127.
- `npm run test:coverage`: passed, all-files line coverage 88.43%, branch 85.74%, functions 89.27%.
- `npm run typecheck`: passed.
- `npm run validate`: passed.
- `npm run lint`: passed with warnings.
- `npm run lint -- --max-warnings=0`: failed with 3 warnings.
- `npm pack --dry-run`: succeeded and includes source, examples, fixtures, Action, and docs.
- Installed-package smoke from `/tmp`: failed before running any Soundcheck scenario with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`.

Top-level README offline commands:

- `run scenarios --aut examples/tabletalk/grounded.ts --replay`: passed.
- `run scenarios --aut examples/tabletalk/bare.ts --replay --only book-modify-confirm`: failed as expected, catching spoken-symbol and grounding bugs.
- `run examples/support/scenarios --aut examples/support/grounded.ts --replay`: passed, skipping `adversarial-discovery`.
- `run examples/support/scenarios --aut examples/support/insecure.ts --replay --only frustrated-reset`: failed as expected, catching reset-before-verify and forbidden delete.

Live-only replay behavior:

- Healthcare replay: skipped the live-only scenario and exited 2.
- Banking replay: skipped the live-only scenario and exited 2.
- Travel replay: skipped the live-only scenario and exited 2.
- Support adversarial-only replay: skipped the live-only scenario and exited 2.

Remaining example failures:

- `run examples/interactive --aut examples/tabletalk/grounded.ts --replay --only goal-specials`: failed with missing cassette instead of live-only skip.
- `run examples/interactive --aut examples/tabletalk/grounded.ts --replay --only barge-in-closing`: failed with missing cassette instead of live-only skip.
- `run examples/self-improving-loop/scenarios --aut examples/tabletalk/bare.ts --replay`: replayed the regression, then failed on missing cassette for `book-this-saturday`.
- `run examples/tune-demo/scenarios --aut examples/tabletalk/bare.ts --replay`: failed with missing cassette.
- `run examples/authored-tabletalk --aut examples/tabletalk/grounded.ts --replay --only authored-bookReservation`: failed with missing cassette.
- `run examples/authored-support --aut examples/support/grounded.ts --replay --only authored-resetPassword`: failed with missing cassette.

## Findings

### P0 - Installed npm package cannot run the CLI

Evidence:

- `bin/soundcheck.mjs` imports `../src/cli.ts` under a native TypeScript stripping shebang.
- After `npm pack` and `npm install ../soundcheck-2.0.0.tgz` in a clean `/tmp` consumer project, `./node_modules/.bin/soundcheck ...` fails with:

```text
Error [ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING]: Stripping types is currently unsupported for files under node_modules
```

Impact:

- Public npm install/global install is broken.
- The package's `"main"` and `"types"` point at TypeScript source under `src/`, which compounds the same public-consumer problem.
- The "zero runtime dependencies" claim is still possible, but only if the published artifact contains built JavaScript and declaration files, not raw `.ts` that Node refuses to strip from `node_modules`.

Recommendation:

- Add a build step that emits `dist/**/*.js` and `dist/**/*.d.ts`.
- Point `bin.soundcheck`, `main`, `types`, and `exports` at `dist`.
- Keep `src` for source users, but do not rely on native type stripping for published package execution.
- Add an installed-package smoke test in CI: pack to `/tmp`, install into a temp consumer project, run `node_modules/.bin/soundcheck run node_modules/soundcheck/scenarios --aut node_modules/soundcheck/examples/tabletalk/grounded.ts --replay --only book-modify-confirm` with cassette-dir configured appropriately.

### P1 - GitHub Action README points to a tag that does not exist

Evidence:

- README uses `darrenapfel/Soundcheck@v2`.
- `git ls-remote --tags origin 'refs/tags/v*'` showed only `v1.0.0-rc.1` and `v2.0.0-rc.1`.

Impact:

- A reviewer copying the README Action snippet will fail before Soundcheck runs.

Recommendation:

- Either create/push `v2` at the release commit, or change the README to `@v2.0.0-rc.1` until the stable tag exists.

### P1 - Full examples directory still lacks a complete executable contract

Evidence:

- Interactive and self-improving live scenarios are documented as live-only but are not marked `liveOnly`, so replay attempts missing cassettes.
- Tune-demo and authored examples are scenario-shaped but not replay-backed and not marked as fixture-only/generated-only.
- No automated contract test enumerates every example scenario.

Impact:

- The top-level README examples work, but "all examples work" is still false unless the reviewer knows hidden exclusions.
- A Deepgram reviewer exploring the examples tree will hit avoidable missing-cassette errors.

Recommendation:

- Add `liveOnly: true` to live goal/barge-in scenarios.
- Add explicit fixture metadata or move generated/tune fixtures out of runnable example paths.
- Add `test/example-contract.test.ts` that enumerates every example scenario and verifies its contract.

### P1 - Windows users will likely fail cassette path containment

Evidence:

- `src/capture/cassette.ts` checks `p.startsWith(root + "/")`.

Impact:

- On Windows, valid `root\\file.json` paths do not start with `root + "/"`, so cassette lookup/save can reject legitimate paths.

Recommendation:

- Use `path.relative(root, p)` for containment and test with `path.win32` cases.

### P2 - Strict lint is not warning-clean

Evidence:

- `npm run lint -- --max-warnings=0` fails with 3 warnings:
  - `src/deepgram.ts:105:37`
  - `test/adapter.test.ts:15:58`
  - `test/adapter.test.ts:22:35`

Impact:

- Normal `npm run lint` exits 0, so this is not breaking CI today.
- For a public-quality bar, warnings should be eliminated or intentionally configured.

Recommendation:

- Replace the STT JSON `any` with a narrow response type or safe `unknown` parser.
- Replace test `as any` with a typed settings shape or local assertion helper.
- Consider making `npm run lint -- --max-warnings=0` the CI/default bar.

### P2 - README and example docs still have small public-polish issues

Evidence:

- `examples/interactive/README.md` has a stray closing code fence at the end.
- `examples/support/README.md` live commands omit `--replay`; that is fine for live usage, but inconsistent with the now-promoted offline/cassette demo path.
- The restaurant example table says `bare`/`hardened`/`grounded` offline replay, while full replay for `bare` or `hardened` fails unless `--only book-modify-confirm` is provided.

Impact:

- These are not core correctness bugs, but they are the kinds of rough edges a developer reviewer notices quickly.

Recommendation:

- Tighten each example README so every command is either replay-backed and copy-pasteable, or explicitly live-only.

### P2 - Release process should require a clean tree

Evidence:

- Current worktree has a pre-existing modification to `docs/CALLER_GAPS.md`.
- `npm pack --dry-run` includes the entire `docs/` directory, so local doc edits affect the package artifact.

Impact:

- A release from this working tree can publish unreviewed documentation changes.

Recommendation:

- Release only from a clean tree.
- Add a release checklist item or CI guard: `git diff --quiet && git diff --cached --quiet`.

## Strong Positive Signals

- The test suite is now broad and meaningful: 127 passing tests, including CLI fail-closed behavior, adapter loop behavior, recorder drain, report rendering, HTML escaping, replay support, self-test teeth, calibration, tune, and regression promotion.
- The top-level offline README examples work exactly as intended in a repo clone.
- The primary failing examples fail for the right reason: they demonstrate planted bugs rather than accidental harness errors.
- Live-only replay behavior is honest and fail-closed for healthcare, banking, travel, and support adversarial discovery.
- The GitHub Action command shape works in a local process test with `SOUNDCHECK_CASSETTE_DIR`.
- Report quality improved meaningfully: audio, oracle transcript, gates, advisory judge, and escaped text are all covered.

## Recommended Next Fix Sequence

1. Fix package distribution first: build to `dist`, publish JS, and add an installed-package smoke test.
2. Create or correct the public Action tag before showing the README snippet to reviewers.
3. Add a machine-readable example contract and a test that enumerates every example scenario.
4. Mark live-only interactive/self-improving scenarios correctly, and classify authored/tune fixtures.
5. Decide whether healthcare/banking/travel need replay cassettes or documented live evidence before claiming all five domains are shipped.
6. Fix Windows cassette containment.
7. Clear lint warnings and minor README polish.

## Updated Score Breakdown

| Axis | Score | Notes |
|---|---:|---|
| Core architecture | 86 | Solid adapter/gate/replay design, better cleanup and test seams. |
| CLI correctness | 84 | Fail-closed behavior fixed; package install still blocks public CLI use. |
| Example usefulness | 76 | Main demos work; full examples tree still has contract holes. |
| Test suite | 88 | Strong suite; missing installed-package and full example-contract tests. |
| Documentation accuracy | 76 | Top-level docs improved; stale tag and example-contract ambiguity remain. |
| Public packaging | 45 | npm-installed CLI currently fails. |
| Security/robustness | 80 | Path sanitization improved; Windows path check needs repair. |

Overall readiness: **78 / 100**.


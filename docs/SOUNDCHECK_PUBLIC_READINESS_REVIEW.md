# Soundcheck Public Readiness Review

Date: 2026-05-30

Reviewer stance: release-blocking review for a Deepgram-facing public submission.
No source code was changed. This review added documentation only.

Context reviewed:

- Soundcheck repo at `/Users/darrenapfel/DEVELOPER/Soundcheck`.
- The local Deepgram final-stage memo draft, especially Addendum B on Soundcheck.
- The three local Deepgram final-stage PDFs supplied by the user.
- Current official Deepgram Voice Agent docs for protocol and wording.

This report intentionally avoids reproducing confidential interview-packet data.

Scope update: per user direction, the existing core `docs/` files are excluded
from the applied review because another coding agent is actively updating them.
This review still covers source code, tests, README/action/example surfaces,
packaging, runtime behavior, and generated review docs. Findings that were only
about drift inside existing `docs/` files are not counted in the score below.

## Executive Verdict

Readiness score, excluding the active core `docs/` update surface: 77/100.

Ship recommendation: do not ship publicly as-is. Soundcheck is strategically
sharp, technically credible, and unusually well-tested for a young voice-agent
tool. The core insight is strong: record the real spoken call, transcribe what a
listener heard, gate deterministic assertions on that trace, and replay it in CI.
That is exactly the kind of verification surface Deepgram can credibly own.

The blocker is not the idea. The blocker is public reliability. A Deepgram
reviewer trying the tool would hit copy-paste failures, incomplete example
cassette coverage, a likely broken reusable Action default, and live-run
robustness gaps. These are fixable, but they are the difference between an
impressive takehome artifact and something Deepgram would comfortably link from
docs.

## Scorecard

| Axis | Weight | Score | Rationale |
|---|---:|---:|---|
| Product fit and Deepgram relevance | 10 | 10 | The verification thesis is excellent and directly supports Deepgram's STT/TTS/Voice Agent advantage. |
| Core functional correctness | 15 | 12 | Core replay, gates, mock adapter, calibration, bakeoff, and self-tests work. Empty filtered suites pass green, quickstart path mismatches, and async tools are unsafe. |
| Voice Agent protocol and live-run reliability | 12 | 6 | Live adapter has meaningful engineering, but does not wait for `Welcome`, lacks setup/request timeouts, and can leak the pump on failure. |
| Deterministic replay and CI gating | 10 | 8 | Keyless replay is strong and `npm run validate` is green. Some promoted example paths fail due missing cassettes, and archive/package validation fails without `.git`. |
| Test suite completeness and self-verification | 12 | 10 | 113 deterministic tests pass and coverage is high. Missing tests remain for report rendering, Action behavior, empty suite behavior, async tools, protocol failure cleanup, and package/archive use. |
| Public examples and DX | 10 | 5 | TableTalk grounded works; several promoted domains or full-suite commands do not replay as advertised. README quickstart and support README need correction. |
| Security, privacy, and secret posture | 8 | 6 | Centralized key access and secret scan are good. Path traversal, package-relative `.env`, and git-dependent security tests need hardening. |
| Architecture and extensibility | 8 | 7 | Clean modules and typed extension points. Adapter/judge socket plumbing duplication and sync-only tool stubs reduce maturity. |
| Documentation accuracy and honesty | 8 | N/A | Existing core `docs/` files excluded by user direction while another agent updates them. Root README, Action metadata, and example READMEs remain in scope through DX/release axes. |
| Packaging, release, and operations | 7 | 5 | `npm pack --dry-run` works and package is small, but contents are not curated, Action is untested, README's `@v2` tag is not present locally, and npm/archive validation fails. |
| Total | 92 scored points | 71/92, normalized to 77/100 | Strong release candidate conceptually; not public-docs safe yet. |

## Highest-Leverage Strengths

1. The product thesis is excellent. Conventional tests cannot hear speech, and
   Soundcheck makes the heard audio inspectable, gateable, and replayable.
2. The deterministic gate layer is the right trust boundary. The LLM judge is
   advisory, while CI decisions are pure code over recorded traces.
3. The architecture is sensibly divided: adapters, capture, gates, judge,
   authoring, calibration, tuning, bakeoff, report.
4. The test suite is far beyond a normal prototype: `npm run validate` passes
   with 113 tests; `npm run test:coverage` reports 93.85 percent line coverage.
5. The security posture is better than typical voice demos: key lookup is
   centralized, settings do not carry keys, and tracked files are secret-scanned.
6. The Deepgram fit is unusually strong. Soundcheck uses the same substrate
   Deepgram sells - speech recognition, synthesis, and Voice Agent orchestration
   - to verify the thing ordinary code tests cannot observe.

## Ship Blockers

### P0-1: README quickstart does not run the suite it just authors

Evidence:

- `README.md:25` says `soundcheck author --spec ./my-agent.ts`.
- `README.md:26` then says `soundcheck run scenarios --aut ./my-agent.ts`.
- `src/cli.ts:212` defaults author output to `scenarios-authored`.

Impact: a fresh user authors a suite, then immediately runs the pre-existing
`scenarios/` directory instead of the generated one. In a real consumer repo,
that directory may not exist at all.

Recommendation: make the quickstart one coherent flow. Either author to
`scenarios/` in the quickstart, or run `scenarios-authored`. Add an automated
copy-paste quickstart test.

### P0-2: Reusable GitHub Action is not copy-paste safe

Evidence:

- `action.yml:18` defaults `args` to `--replay`.
- `action.yml:37` calls `src/cli.ts run "${{ inputs.scenarios }}" ${{ inputs.args }}`.
- `src/cli.ts:111` defaults `--aut` to `examples/tabletalk/grounded.ts`,
  resolved relative to the consumer workspace.
- `src/capture/cassette.ts:12` hardcodes cassettes to `fixtures/cassettes`.
- `action.yml:8-9` says the `scenarios` input can be a scenario or cassette
  directory, but the cassette directory is not actually configurable.
- README uses `darrenapfel/Soundcheck@v2`, which requires that a stable `v2`
  tag actually exist before reviewers copy it. Local tags are `v1.0.0-rc.1`
  and `v2.0.0-rc.1`, not `v2`.

Impact: the Action is the most public "use this in CI" surface. In a normal
consumer repo, the default cannot infer the AUT label required for cassette
lookup and may not find the default example AUT. The README's tag must also
resolve before the snippet is public copy-paste material.

Recommendation: add explicit `aut` and `cassette-dir` inputs or require
`--aut` in `args`; make cassette root configurable; verify the Action in CI;
publish and document one stable tag.

### P0-3: Live Deepgram adapter can hang or leak on setup failure

Evidence:

- `src/adapters/deepgram-va.ts:121-130` starts the audio pump before setup is confirmed.
- `src/adapters/deepgram-va.ts:132-135` waits on `open` with no timeout.
- `src/adapters/deepgram-va.ts:133` sends `Settings` on WebSocket open.
- `src/adapters/deepgram-va.ts:183` awaits setup outside a `try/finally`.
- `src/adapters/deepgram-va.ts:296-297` cleanup runs only on the normal return path.
- Official Deepgram message-flow docs say to open the WebSocket, wait for
  `Welcome`, and not send messages until `Welcome` is received:
  https://developers.deepgram.com/docs/voice-agent-message-flow

Impact: nightly/live jobs can stall indefinitely or leave intervals running on
socket/setup/protocol failures. The adapter may work in happy paths, but it is
not yet bulletproof.

Recommendation: wait for `Welcome` before sending `Settings`; wait for
`SettingsApplied`; add setup and turn timeouts; handle `Error`/`Warning` server
events; put pump cleanup and socket close in `finally`; add mock socket tests for
open timeout, protocol error, and settings rejection.

### P0-4: Tool execution is sync-only and unguarded

Evidence:

- `src/types.ts:47` types `toolStubs` as sync functions returning `unknown`.
- `src/adapters/deepgram-va.ts:173-176` calls the stub without `await` or
  `try/catch`, then serializes the result.
- `src/adapters/openai-realtime.ts:81-83` has the same pattern.

Impact: real voice-agent tools are commonly DB/API backed and async. An async
stub would serialize as `{}` or behave incorrectly; a thrown tool handler could
prevent `FunctionCallResponse`, leaving the agent stuck.

Recommendation: type tool handlers as `MaybePromise<unknown>`, `await` them,
catch errors, send a structured failure response, and record the exception in the
trace.

### P0-5: Public example coverage does not match the five-domain claim

Evidence:

- `README.md:31-39` promotes five bundled domains.
- `npm run soundcheck -- run scenarios --aut examples/tabletalk/grounded.ts --replay --out /tmp/soundcheck-grounded.html`
  passed all 3 TableTalk scenarios.
- `npm run soundcheck -- run scenarios --aut examples/tabletalk/bare.ts --replay --out /tmp/soundcheck-bare.html`
  failed partly because `menu-price.tabletalk-bare.json` is missing.
- `npm run soundcheck -- run examples/support/scenarios --aut examples/support/grounded.ts --replay --out /tmp/soundcheck-support-grounded.html`
  failed because `adversarial-discovery.support-grounded.json` is missing.
- Healthcare, banking, and travel replay commands are missing cassettes for their
  advertised scenarios.

Impact: examples are how a reviewer builds trust quickly. Missing cassettes make
some demos fail for infrastructure reasons rather than intended gate failures.

Recommendation: either record replay cassettes for every promoted example/domain
or mark those domains as live-only/spec examples. Add a docs-command test matrix.

### P0-6: Empty filtered suites pass green

Evidence:

Command:

```bash
npm run soundcheck -- run scenarios --aut examples/tabletalk/grounded.ts --replay --only definitely-no-such-scenario --out /tmp/soundcheck-empty.html
```

Observed result: exit 0, "running 0 scenario(s)", "all gates passed".

The same empty-filter issue appears in `bakeoff`, which reports a 0-scenario tie
with exit 0.

Impact: a typo in `--only` can produce a false green CI result. For a testing
tool, this is a hard fail-closed violation.

Recommendation: after filtering, fail with usage/error exit if zero scenarios
remain. Add tests for `run` and `bakeoff` empty selections.

## High-Priority Findings

### P1-1: REST calls have retries but no request timeout

Evidence:

- `src/deepgram.ts:27-38` retries rejected calls.
- `src/deepgram.ts:55-61` and `src/deepgram.ts:81-88` use `fetch` without an
  `AbortSignal`.
- 401/403 errors are retried the same as transient failures.

Impact: hung TTS/STT requests can block forever; bad credentials waste retries
and delay useful error output.

Recommendation: use `AbortController`; classify non-retryable 4xx responses;
surface Deepgram request IDs or response snippets safely.

### P1-2: `.env` fallback is package-relative, not caller-CWD-relative

Evidence:

- `src/deepgram.ts:14` reads `../.env` relative to `src/deepgram.ts`.
- `README.md:21` tells users to write `.env` in the current project.

Impact: `npm link`, global install, GitHub Action, and consumer repos will not
read the user's local `.env` the way the quickstart implies. Environment
variables still work, but the fallback surprises users.

Recommendation: check `process.cwd()/.env` first, then package-local `.env` only
for repo development if desired.

### P1-3: Scenario names and AUT labels are path inputs

Evidence:

- `src/capture/cassette.ts:26-27` interpolates scenario and AUT label directly
  into a path.
- `src/cli.ts:140-143` writes promoted regression files from generated names.

Impact: trusted local usage is mostly safe, but CI over PR-provided scenarios can
become a path traversal footgun.

Recommendation: validate names with a conservative slug regex; reject path
separators; assert resolved paths stay inside intended roots.

### P1-4: Authoring defaults hard-code a stale date anchor

Evidence:

- `src/author/index.ts:72` generates "for this Saturday".
- `src/author/index.ts:99` uses `now: today`.
- `src/author/index.ts:107` defaults `today` to `2026-05-28`.

Impact: generated scenarios drift from real current time. On 2026-05-30, the
default already points at a past "today" relative to the actual date.

Recommendation: accept `--today`, default to the current local date, and print
the date anchor in generated output. For deterministic docs/tests, pass
`--today` explicitly.

### P1-5: Goal-driven caller endings are not result-tagged

Evidence:

- `src/caller/policy.ts:103-112` returns `null` both for turn-cap exhaustion and
  planner-directed hangup.
- `src/caller/planner.ts:148-152` retries the planner once, then returns
  `{ action: "hangup", utterance: "" }` on failure.
- `src/adapters/deepgram-va.ts:223-224` treats `null` as a caller hangup and
  stops without recording why the call ended.

Impact: goal-driven/adversarial discovery is powerful, but a forced cap,
planner timeout, or goal-met hangup can collapse into the same trace shape. That
can overstate result validity if a caller ended for infrastructure or max-turn
reasons.

Recommendation: add a termination reason to the trace or scenario result
(`goal_met`, `turn_cap`, `planner_error`, `repeat_guard`, `script_exhausted`)
and make non-goal termination visible to gates/reports.

### P1-6: Security tests require `.git`

Evidence:

- `test/security.test.ts:12` shells out to `git grep`.
- `test/security.test.ts:35` shells out to `git ls-files`.
- A local git clone with no `.env` passed `npm ci && npm run validate`.
- A git archive/npm-style tree without `.git` failed those two tests.

Impact: "fresh clone" is true for git users, but package/archive consumers cannot
run validation. This also complicates npm package testing.

Recommendation: detect missing `.git` and fall back to filesystem scanning, or
mark git-only tests explicitly and keep package-level validation separate.

### P1-7: HTML report is public-critical but untested

Evidence:

- `rg -n "generateReport|report/html" test` found no tests.
- `npm run test:coverage` omits `src/report/html.ts`.

Impact: the report is the user's main evidence artifact. Audio/oracle rendering
can regress without tests.

Recommendation: add snapshot or DOM-string tests for summary, gates, per-turn
audio, full-conversation audio, oracle transcript, escaping, and judge findings.

## Medium-Priority Findings

1. Mock adapter runs are labeled `mode: live` even though they are offline and
   keyless. This confuses docs and review output.
2. `run --judge` in replay mode can invoke the live judge unless the user passes
   `--judge mock`; make this warning explicit because replay otherwise sounds
   fully offline.
3. The OpenAI Realtime adapter is honestly documented as reference-only, but its
   presence in package exports may imply more support than exists.
4. `npm pack --dry-run` includes workflows, tests, fixtures, and many docs.
   Package size is small (149.3 kB), but release contents should be curated
   intentionally with a `files` allowlist.
5. The Node 22 native TypeScript approach supports "zero runtime deps," but it
   emits experimental type-stripping warnings in fresh clone runs. Decide whether
   that is acceptable for public DX.
6. The judge prompt uses per-turn heard text and tool names, not the full oracle
   transcript or timing detail. That is probably fine for advisory use, but docs
   should avoid implying the judge reads every report artifact.
7. `tool_sequence` passes if the dependent tool never runs. That is safe when
   paired with `required_tool`, but scenario authors can accidentally omit that
   pair and get a weaker check.

## Verification Log

Commands run from `/Users/darrenapfel/DEVELOPER/Soundcheck` unless noted.

| Command | Result | Notes |
|---|---|---|
| `npm run validate` | Pass | Typecheck pass, lint exit 0 with 3 warnings, 113/113 tests pass. |
| `npm run test:coverage` | Pass | 113/113 tests pass; all-files line coverage 93.85 percent. |
| Fresh local git clone: `npm ci && npm run validate` | Pass | No `.env`; 113/113 tests pass; 3 lint warnings. |
| Git archive tree: `npm ci && npm run validate` | Fail | Security tests fail because `.git` is absent. |
| `npm run soundcheck -- calibrate` | Pass | Mock judge 100 percent agreement, trusted. |
| `npm run soundcheck -- author --spec examples/support/grounded.ts --out /tmp/soundcheck-authored-support` | Pass | Authored 5 scenarios and rubric in `/tmp`. |
| `npm run soundcheck -- run scenarios --aut examples/tabletalk/grounded.ts --replay --out /tmp/soundcheck-grounded.html` | Pass | 3 TableTalk scenarios pass. |
| `npm run soundcheck -- run scenarios --aut examples/tabletalk/bare.ts --replay --out /tmp/soundcheck-bare.html` | Fail | Intended first scenario fails gates, then run errors on missing `menu-price.tabletalk-bare.json`. |
| `npm run soundcheck -- run scenarios --aut examples/tabletalk/bare.ts --replay --only book-modify-confirm --out /tmp/soundcheck-bare-book.html` | Fail as expected | Gate failures for spoken symbols and grounding. |
| `npm run soundcheck -- run scenarios --aut examples/tabletalk/grounded.ts --adapter mock --out /tmp/soundcheck-mock.html` | Pass | Offline mock path works, but output says mode `live`. |
| `npm run soundcheck -- run scenarios --aut examples/tabletalk/grounded.ts --adapter mock --buggy --out /tmp/soundcheck-mock-buggy.html` | Fail as expected | Gates catch symbols, grounding, and spoken mismatch. |
| `npm run soundcheck -- bakeoff scenarios --a examples/tabletalk/grounded.ts --b examples/tabletalk/bare.ts --replay --judge mock --only book-modify-confirm` | Pass | Grounded wins; judge diff is advisory. |
| `npm run soundcheck -- run examples/support/scenarios --aut examples/support/grounded.ts --replay --out /tmp/soundcheck-support-grounded.html` | Fail | Missing `adversarial-discovery.support-grounded.json`. |
| `npm run soundcheck -- run examples/support/scenarios --aut examples/support/bare.ts --replay --only reset-and-callback --out /tmp/soundcheck-support-bare.html` | Fail as expected | Gates catch spoken symbols and grounding. |
| `npm run soundcheck -- run examples/support/scenarios --aut examples/support/insecure.ts --replay --only frustrated-reset --out /tmp/soundcheck-support-insecure.html` | Fail as expected | Gates catch reset-before-verify and forbidden delete. |
| `npm run soundcheck -- run scenarios --aut examples/tabletalk/grounded.ts --replay --only definitely-no-such-scenario --out /tmp/soundcheck-empty.html` | Incorrect pass | 0 scenarios, exit 0. |
| `npm pack --dry-run` | Pass | Tarball 149.3 kB, 135 files; contents not curated. |

Live Deepgram calls such as `validate --tts`, live `run --record`, live
goal-driven calls, and live `tune` were not executed in this review to avoid
using external credits/secrets without explicit approval. The live path was
reviewed statically and against official Deepgram docs.

## Recommended Fix Plan

### Before showing Deepgram reviewers

1. Fix README quickstart so the author/run/tune flow is copy-paste coherent.
2. Make `--only` zero matches fail closed in `run` and `bakeoff`.
3. Fix or narrow public example claims; record missing cassettes or mark domains
   live-only.
4. Fix Action defaults and add an Action test or dry-run workflow.
5. Add report tests and command-copy tests for README/action/example surfaces.
6. After the other agent finishes the core docs refresh, re-run a docs-specific
   review pass against the updated files.

### Before public release

1. Make live adapter protocol-compliant with current Deepgram message flow.
2. Add timeouts, `finally` cleanup, and server Error/Warning handling.
3. Support async tool handlers with structured error responses.
4. Sanitize scenario names and AUT labels used in paths.
5. Make `.env` lookup CWD-first and document precedence.
6. Make authoring date anchors explicit and non-stale.
7. Decide package strategy: repo-only, npm package with source TS, or built JS
   artifacts; then test that exact distribution.

## Bottom Line

Soundcheck is credible extra credit for the Deepgram final-stage assignment
because it concretely demonstrates the memo's verification thesis. It should
impress reviewers as a working artifact and as evidence of taste.

But the public bar is higher. Deepgram should not ship or link it as-is until
the copy-paste path, Action, live-run reliability, example coverage, and release
evidence are tightened. The good news: the core architecture is sound, the test
base is real, and the highest-risk fixes are bounded. This is closer to a strong
release candidate than a throwaway prototype.

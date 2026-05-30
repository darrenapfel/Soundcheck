# Soundcheck — v1.0 Release Criteria (the "trustworthy enough to ship publicly" bar)

> Every box must be checked, with evidence, before tagging `v1.0.0`. This is the definition of done for the dream. The final milestone (M8) is gated by an automated **multi-agent (sub-agent) review** verifying this list.
>
> **Autonomy:** the entire build (M0→M8) runs with **zero mid-run human gates** — every check is code, tests, or sub-agents. The **only** human touchpoint is an **optional sign-off *after* the build is complete** (review the open PRs, merge, publish). Reaching this checklist never requires a human.
>
> **Status: all boxes met.** Evidence noted inline; the M8 multi-agent review is recorded in [`REVIEW_LOG.md`](REVIEW_LOG.md).

## Functionality
- [x] **v0 deterministic core** — regression gates + round-trip oracle. *6 gates in `src/gates/index.ts`; oracle in `cli.ts cmdValidate`; `test/gates.test.ts` + `test/normalize.test.ts`.*
- [x] **LLM judge** — Deepgram-fronted grader, rubric scores + findings, panel option, pluggable model. *`src/judge/deepgram-va-judge.ts` (`submit_verdict` fn, pluggable `think.model`); `aggregateVerdicts` panel; tolerant `parseVerdict`; `test/judge.test.ts` (incl. malformed-output recovery). Advisory — never hard-gates.*
- [x] **Autonomous eval authoring** — `author --spec` generates scenarios + assertions + rubric for an unseen agent. *`src/author/index.ts`, `cmdAuthor`; `test/author.test.ts` proves authored gates catch bugs against a cassette.*
- [x] **Genericity** — Deepgram VA + **MockAUT** (creds-free, deterministic — the CI-proven, CLI-selectable non-Deepgram target) prove the abstraction; a third **OpenAI Realtime** adapter ships as a **reference integration point** (real protocol, NOT CLI-selectable in v1, not live-tested — a developer wires + validates it). Same scenarios + gates + report run unchanged across the wired adapters. *`test/genericity.test.ts`; `--adapter mock` runs offline (exit 0 clean / 1 buggy).*
- [x] **Tuning loop** — `tune` raises a broken agent's *held-out* score and emits a reviewable diff. *`src/tune/index.ts` (Goodhart held-out guard), `cmdTune`, `--fixer`; `test/tune.test.ts` (convergence + overfit-rejected). Live capstone tuned bare→green, generalization-verified.*
- [x] **CLI** — `run`, `validate`, `author`, `tune`, `record`/`replay`; `--help` for each; sane exit codes. *All in `src/cli.ts`; usage errors → 2, gate fail → 1, pass → 0.*

## Trust / testing (see `TESTING.md`)
- [x] `npm run validate` (typecheck + lint + unit + replay-integration) green on a **fresh clone**, **deterministic across 10 runs**. *Fresh clone to `/tmp`, `npm ci` (0 vulns) → validate green with **no key** (typecheck 0, lint 0 errors, 65/65); suite re-run 10× → 65 pass / 0 fail each.*
- [x] Coverage ≥ 85% on `gates/ normalize/ capture/ caller/`; judge/adapter covered via fixtures/mocks. *`npm run test:coverage`: gates 100%, normalize 100%, capture 96.9–100%, caller 100% (overall all-files ~95%); judge/adapter via `test/judge.test.ts` + `test/adapter.test.ts`.*
- [x] **Self-evaluation passing:** Evaline-as-AUT meta-suite green; the **broken-Evaline fixture fails it** (teeth verified). *`src/selfeval/index.ts` + `test/selfeval.test.ts` (real caller passes; deliberately-broken Evaline + persona-check fail).*
- [x] **Judge calibration** report committed; agreement clears documented thresholds; honest numbers for fuzzy dimensions. *`runs/calibration-live.json` (0.917 macro agreement; spoken_cleanly 1.0 recall / 0.75 precision); `docs/CALIBRATION.md`; `test/calibration.test.ts` enforces ≥0.8.*
- [x] **Golden ladder** (bare→hardened→grounded) runs as replay-CI + live-nightly; breaks if grounded fails or bare passes. *`test/replay.test.ts` pins full per-rung gate vectors (CI); `nightly.yml` asserts a positive live drift signal.*
- [x] Live-nightly workflow exists and is documented (drift detection, separate from logic regressions). *`.github/workflows/nightly.yml` (cron + dispatch, key-guarded no-op); documented in TESTING §1, ARCHITECTURE §7b, LIMITATIONS.*

## Security
- [x] **Default + CI operation reads no credential other than `DEEPGRAM_API_KEY`** (verified by an automated check + the security review). The reference `openai-realtime` adapter (NOT wired into the CLI) reads `OPENAI_API_KEY` only if a developer imports + runs it; the default path and all of CI never import it. *Only `getKey()` reads a credential; `OPENAI_API_KEY` referenced solely in the never-imported reference adapter; CI sets no key.*
- [x] Cassettes / fixtures / reports contain **no secrets** (scanned in CI). *`test/security.test.ts` greps the tracked tree for key patterns (incl. the throwaway dev-key prefixes) → 0 hits; runs in `npm run validate`.*
- [x] `.gitignore` covers `.env*`, `node_modules`, run artifacts; a pre-commit/secret-scan guard. *`.gitignore` covers `.env`, `.env.*`, `*.local`, `*.key`, `secrets/`, `node_modules/`, `runs/`, `*.wav`. The secret-scan guard is the CI-enforced `test/security.test.ts` (runs on every `validate`); a separate git-hook is unnecessary given the scan gates CI.*

## Docs & DX
- [x] README with quickstart that works verbatim on a fresh clone. *Quickstart verified on a keyless fresh clone (`npm test` green; mock + replay commands run offline).*
- [x] `ARCHITECTURE.md`, `ROADMAP.md`, `TESTING.md`, `LIMITATIONS.md`, `CONTRIBUTING.md`, `CHANGELOG.md`. *All present (+ `CALIBRATION.md`, `REVIEW_LOG.md`).*
- [x] `examples/` runnable (TableTalk ladder + the mock AUT). *`examples/tabletalk/{bare,hardened,grounded,tabletalk}.ts` + authored suite + `tune-demo/`; ladder replay (grounded=0, bare=1) and `--adapter mock` (clean=0, buggy=1) execute offline.*
- [x] **Honest `LIMITATIONS.md`** — TTS-callers test behavior not acoustics; per-turn TTFB includes tool time; judge is advisory; "any voice agent" = "any agent with an adapter." *All four covered explicitly in `docs/LIMITATIONS.md`.*
- [x] A reusable **GitHub Action** for voice-agent repos. *Composite `action.yml` at repo root (`uses: darrenapfel/Soundcheck@v1.0.0`): zero-runtime-deps means it needs only Node 22 + the action's checked-out source; runs `soundcheck run` against the consumer's scenarios. Usage in README "Use it in your repo's CI".*
- [x] CI badge + coverage badge. *Both in README (CI status badge + a `core coverage ≥85%` badge linking to TESTING.md, backed by `npm run test:coverage`).*

## Engineering hygiene
- [x] Zero runtime dependencies preserved (or every added dep justified in `ARCHITECTURE.md`). *`package.json` `dependencies: {}`; only devDeps; no non-`node:` imports in `src/`+`bin/`.*
- [x] Semver + `CHANGELOG.md`; `package.json` metadata complete; MIT `LICENSE`. *`version 1.0.0`; CHANGELOG [1.0.0]; name/description/license/author/repository/homepage/bugs/engines/bin/keywords complete; MIT LICENSE.*
- [x] Every milestone passed its **independent code-review gate**; the final **multi-agent review** signs off on this whole list. *M0–M7 reviews + the M8 final 3-agent panel (security+correctness GO, docs+DX, criteria verification) recorded in `REVIEW_LOG.md`; findings addressed.*

## The trust statement (must be literally true at v1.0)
> *A developer can read `TESTING.md`, run `npm run validate` on a fresh clone (deterministic, green), inspect the coverage + judge-calibration numbers, and watch the self-evaluation suite catch a deliberately broken Evaline — and conclude that Soundcheck is tested more rigorously than the agent they are pointing it at.*

Verified end-to-end during the M8 review: fresh-clone validate is green and deterministic with no key, coverage + `runs/calibration-live.json` are committed, and `test/selfeval.test.ts` catches a deliberately broken Evaline.

---

## STS-v2 (the dream) — final sign-off addendum

> The checklist above certified the **v1.0** build. The **STS-v2** series (M1–M8, the coSTAR-for-voice dream — see `CHANGELOG.md` [2.0.0]) extends and supersedes it; this addendum records its own gate so the certification matches the **promoted README**.

- [x] **Every 🚧 delivered + oracle/test-verified, or de-scoped in writing.** The README capability-status table is accurate; the three de-scoped items (regression-from-production, online monitoring, standalone STT/TTS) carry written rationale in the README "Future directions" note + `LIMITATIONS.md`.
- [x] **`npm run validate` green + deterministic; fresh keyless clone validates; CI offline.** Current suite **102+ deterministic tests, 0 lint errors**; verified on a true `/tmp` keyless clone and across repeated runs (supersedes the v1.0 "65/65" figure above).
- [x] **Soundcheck-tests-Soundcheck CI proof in place.** `test/self-test.test.ts` (generic gates catch deliberately-regressed builds + coverage contract) runs inside `npm run validate`; teeth verified (neutering a gate turns it red).
- [x] **Self-eval + calibration green** (`test/selfeval.test.ts`, `test/calibration.test.ts`).
- [x] **Every STS-v2 milestone independently reviewed; final multi-agent panel signed off.** `REVIEW_LOG.md` has rows for STS-v2 M1–M8 + the **final 3-agent release panel** (security+correctness → GO, docs+DX → GO, done-criteria → 4/6 with all findings addressed). The RC tag was re-cut on the reviewed HEAD.
- [x] **`README_ASPIRATIONAL.md` promoted to `README.md`** because every promise is literally true or de-scoped in writing.

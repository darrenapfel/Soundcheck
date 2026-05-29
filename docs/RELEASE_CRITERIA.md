# Soundcheck — v1.0 Release Criteria (the "trustworthy enough to ship publicly" bar)

> Every box must be checked, with evidence, before tagging `v1.0.0`. This is the definition of done for the dream. The final milestone (M8) is gated by a multi-agent review verifying this list.

## Functionality
- [ ] **v0 deterministic core** — regression gates + round-trip oracle (done in PR #1).
- [ ] **LLM judge** — Deepgram-fronted grader, rubric scores + findings, panel option, pluggable model.
- [ ] **Autonomous eval authoring** — `author --spec` generates scenarios + assertions + rubric for an unseen agent.
- [ ] **Genericity** — ≥ 2 `AUTAdapter`s (Deepgram VA + one more), proven against a non-VA target.
- [ ] **Tuning loop** — `tune` raises a broken agent's *held-out* score and emits a reviewable diff.
- [ ] **CLI** — `run`, `validate`, `author`, `tune`, `record`/`replay`; `--help` for each; sane exit codes.

## Trust / testing (see `TESTING.md`)
- [ ] `npm run validate` (typecheck + lint + unit + replay-integration) green on a **fresh clone**, **deterministic across 10 runs**.
- [ ] Coverage ≥ 85% on `gates/ normalize/ capture/ caller/`; judge/adapter covered via fixtures/mocks.
- [ ] **Self-evaluation passing:** Evaline-as-AUT meta-suite green; the **broken-Evaline fixture fails it** (teeth verified).
- [ ] **Judge calibration** report committed; agreement clears documented thresholds; honest numbers for fuzzy dimensions.
- [ ] **Golden ladder** (bare→hardened→grounded) runs as replay-CI + live-nightly; breaks if grounded fails or bare passes.
- [ ] Live-nightly workflow exists and is documented (drift detection, separate from logic regressions).

## Security
- [ ] **No credential other than `DEEPGRAM_API_KEY`** is ever read, logged, or committed (verified by an automated check + the security review).
- [ ] Cassettes / fixtures / reports contain **no secrets** (scanned in CI).
- [ ] `.gitignore` covers `.env*`, `node_modules`, run artifacts; a pre-commit/secret-scan guard.

## Docs & DX
- [ ] README with quickstart that works verbatim on a fresh clone.
- [ ] `ARCHITECTURE.md`, `ROADMAP.md`, `TESTING.md`, `LIMITATIONS.md`, `CONTRIBUTING.md`, `CHANGELOG.md`.
- [ ] `examples/` runnable (TableTalk ladder + the mock AUT).
- [ ] **Honest `LIMITATIONS.md`** — TTS-callers test behavior not acoustics; per-turn TTFB includes tool time; judge is advisory; "any voice agent" = "any agent with an adapter."
- [ ] A reusable **GitHub Action** for voice-agent repos.
- [ ] CI badge + coverage badge.

## Engineering hygiene
- [ ] Zero runtime dependencies preserved (or every added dep justified in `ARCHITECTURE.md`).
- [ ] Semver + `CHANGELOG.md`; `package.json` metadata complete; MIT `LICENSE`.
- [ ] Every milestone passed its **independent code-review gate**; the final **multi-agent review** signs off on this whole list.

## The trust statement (must be literally true at v1.0)
> *A developer can read `TESTING.md`, run `npm run validate` on a fresh clone (deterministic, green), inspect the coverage + judge-calibration numbers, and watch the self-evaluation suite catch a deliberately broken Evaline — and conclude that Soundcheck is tested more rigorously than the agent they are pointing it at.*

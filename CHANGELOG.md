# Changelog

All notable changes to Soundcheck. Format loosely follows [Keep a Changelog]; versioning is [SemVer].

## [Unreleased]

### Added
- **`spoken_consistent_with_tool` gate** — verifies the agent's *spoken commitments* stay consistent with what it actually did, beyond `spoken_matches_tool`'s "was it ever said?" existence check and `grounding`'s tool-args-only view. It fails when (a) the agent's *final* spoken date is not one any tool actually used — the "verbally caves to an impatient caller's wrong date while the booking stays correct" failure — or (b) a spoken "*weekday, month day*" is internally incoherent (e.g. "Thursday, June 2nd" when June 2 is a Tuesday). Passes silently when no date is spoken (existence stays `spoken_matches_tool`'s job) and tolerates a legitimate reschedule that ends on the new date. Wired into every date-bearing example scenario: healthcare (`appointment-insurance-refill`), travel (`cancelled-flight-rebook`), support (`reset-and-callback`, where it also runs in offline CI against the grounded + bare cassettes), and the self-improving demo (`book-this-saturday`). Not applicable to banking (`lost-card-dispute` books no date).
- **Alphanumeric read-back verification in `spoken_matches_tool`** — for an identifier field an agent is *required* to read back (a flight number like `SM218`, a confirmation code), the gate now checks the *digit runs* were read back intelligibly (digit-by-digit, grouped like "two eighteen", or cardinal), tolerating STT mishearing the spoken *letters* ("M"→"n"). Previously an alphanumeric value could never match (the gate looked for the literal token "SM218", which is never how it is spoken). Not forced on the travel example: a live check confirmed a good agent may confirm a flight by date + time + route and never recite the number, so mandatory flight-number read-back is not a sound universal invariant — the capability is there for scenarios that genuinely require it.

## [2.1.0] — 2026-05-31

### Fixed
- **Recordings no longer contain inter-turn dead air.** A goal-driven caller's brain takes real time to decide each next line; the recorder now pauses during that gap (and the line synthesis) and resumes when the caller speaks, so the saved call is the conversation itself — no ~10–20 s silences between turns. Within-turn timing and barge-in overlaps are preserved; the oracle transcript and per-turn latency metrics are unchanged.

### Added
- `run --persona cooperative|impatient|adversarial` — override the caller persona for a run (drive any scenario as any of the three callers).
- `run --lean` (embed only the full-call recording) and `run --mp3` (transcode embedded audio to MP3 via ffmpeg, ~10× smaller) — for compact, listenable sample reports. The shipped report path is unchanged (WAV, no extra dependency); the encoder is opt-in.

## [2.0.1] — 2026-05-31 (public-readiness pass)

Hardened the harness across several rounds of independent readiness review and closed every synthetic-caller gap (Phases 1–3). **148 deterministic tests, 0 lint errors/warnings, fully offline CI.** The `v2.0.0` tag stays immutable; `v2.0.1` is cut on this commit and the `v2` major alias moves to it.

### Added
- **Publish-time build** so the installed npm package runs: `tsconfig.build.json` emits `dist/**/*.js` + `.d.ts` from `src/` (`.ts` import specifiers rewritten to `.js`), run by `prepack`; `bin`/`main`/`types`/`exports` point at `dist`. Development is unchanged (raw `.ts` via `--experimental-strip-types`); zero *runtime* deps preserved (`typescript` is a devDep). Installed-package smoke test (`scripts/smoke-package.sh`) wired as a separate CI job.
- **Machine-readable example contract:** every scenario is replay-backed, `liveOnly`, or `fixtureOnly`; `test/example-contract.test.ts` fails on any hole. `run`/`bakeoff --replay` skip `liveOnly`/`fixtureOnly` honestly (no missing-cassette errors).
- **Caller termination integrity** (Phase 1): a `TerminationReason` (`goal_met` | `turn_cap` | `planner_error` | `repeat_guard` | `script_exhausted`) is tagged on every end, threaded onto the `Trace` (persisted in the cassette), shown in the report, and enforced by a synthetic `goal_reached` gate — a goal-driven call is a clean pass only when it ended `goal_met`. A wrap-up turn at the cap (H4); planner failures become a holding line + tagged `planner_error` (M4); a read-back rule before hangup (M1).
- **Caller realism + polish (Phases 2–3 — all gaps now closed):** mid-call silence is told apart from turn 0 and prods ("Are you still there?") instead of re-greeting (M3); a cross-persona rule challenges unsafe/wrong agent behavior, not just the adversarial persona (M5); a `committedFacts()` "facts you've committed to" block keeps a re-ask consistent (M6); distinct Aura-2 voice per persona — cooperative `asteria`, impatient `orion`, adversarial `orpheus` (live-verified distinct audio) (L1); one `PERSONA_VOICE` source in `evaline.ts` re-exported by `policy.ts` (L2); goal-driven barge-in via `PlanDecision.interrupt` → `CallerAction.interrupt` (L4).

### Fixed
- **Windows cassette-path containment** uses `path.relative` (separator-agnostic), not `startsWith(root + "/")`.
- **Strict lint clean** (`eslint . --max-warnings=0`): narrow `DeepgramListenResponse` type for the STT parse; dropped the adapter test's `as any`.
- README Action snippet pins `@v2` (the `v2` + `v2.0.0` stable tags are cut on the released HEAD); example-README polish (stray fence, offline `--replay` commands, restaurant replay caveat).
- **Round-3:** `goal_reached` keys on a `goalDriven` signal (not `scenario.goal`), so it guards a forced `--caller goal` run on a no-`goal` scenario and no longer false-fails a goal scenario run scripted. The `lint` script enforces `--max-warnings=0` (so `validate`/CI fail on any warning). `@types/node` declared as an optional peer dependency for TypeScript consumers (public types reference `Buffer`/`node:path`), with a consumer `tsc --noEmit` step added to the package smoke. Latency detail prints `n/a` (not `n/ams`) when no TTFB. README notes the bundled examples are source references (copy out to run).
- **Round-4:** cut `v2.0.1` and moved the `v2` major alias to the fixed HEAD (public-refs P1). Added a `release:check` clean-tree guard script (release only from a clean tree). Added direct round-trip tests that `buildTranscript` + the cassette preserve `terminationReason`/`goalDriven` (so a replayed goal-driven cassette keeps its `goal_reached` row). The live `tune` loop now emits per-step progress (`onProgress`), and `examples/self-improving-loop/README.md` notes the expected live duration.

## [2.0.0] — 2026-05 (the STS dream)

Re-grounded the harness around coSTAR's **Scenario → Trace → Assess → Refine** for speech-to-speech, and made every capability domain-agnostic and oracle/test-verified. Each milestone independently reviewed; a final multi-agent release panel signed off. **102+ deterministic tests, 0 lint errors, fully offline CI.** Every promise in the README is true or de-scoped in writing.

### Added
- **Declarative, domain-agnostic gate registry** (M1): a composable `REGISTRY` of `GateFn`s — `no_spoken_symbols`, `required_tool`, `forbidden_tool`, `tool_sequence`, `tool_args_match_schema`, `spoken_matches_tool`, generic `grounding`, `latency` — replacing the restaurant-coupled `tool_arg_iso`/`value_consistency` switch. Fail-closed.
- **Second example domain** (M2): an IT-support agent (`examples/support/`) tested by the *same* gates, with bare/grounded/insecure variants + pinned cassettes.
- **First-class versioned `Trace`** (M3): one persistable artifact (recording + oracle + turns + tools + timings); cassettes are v2 (retain the oracle), v1 still loads. Gates + judge run on a persisted Trace offline.
- **Domain-agnostic authoring** (M4): `author --spec` derives one scenario per tool from any agent's spec.
- **Trusted-judge alignment loop** (M5): `calibrate` reports a trust verdict (gates on problem-recall), cross-model corroboration, and a drift guard. Judge stays advisory.
- **Trace-driven Refine** (M6): `tune` feeds the fixer a per-failure root-cause diagnosis (trace evidence + hint); held-out Goodhart guard; generalization-verified on an unseen date.
- **Adversarial discovery** (M7): an `adversarial` Evaline persona that improvises red-team attacks; surfaced reset-before-verify + account-deletion on an insecure agent (oracle-confirmed), pinned as regressions.
- **A/B & vendor bake-off** (M7): `bakeoff` runs one suite against two configs and diffs per-gate (+ advisory judge), live or replay.
- **Soundcheck-tests-Soundcheck self-test** (M8): `test/self-test.test.ts` — the generic gates catch deliberately-regressed builds and pass correct ones, with a coverage contract, in CI.

## [1.0.0] — 2026-05

First public release: a voice-agent test & tuning harness that runs on a single Deepgram key.

### Added
- **Deterministic regression gates** (`run`): `no_spoken_symbols`, `tool_arg_iso`, `grounding`, `value_consistency`, `required_tool`, `latency` — the "Playwright for voice."
- **Round-trip oracle** (`validate`): `text → TTS → STT → compare` (test TTS) and `audio → STT` (test STT).
- **Record / replay** cassettes — live runs record; CI replays offline → a stochastic tool becomes a deterministic merge gate.
- **LLM judge** (`run --judge`, advisory): a Deepgram-fronted one-shot grader with a tolerant verdict parser, a deterministic mock judge for CI, and panel aggregation.
- **Judge calibration** (`calibrate`): agreement + problem-class precision/recall vs a self-constructed labeled corpus (live: 91.7% macro; spoken_cleanly 100% recall / 75% precision).
- **Autonomous eval authoring** (`author`): generate a scenario suite from an agent's spec; surface business rules as hints.
- **Genericity**: Deepgram VA + a creds-free **MockAUT** adapter (CLI-selectable, CI-proven) + an OpenAI Realtime **reference** adapter; `RawTurn.agentSpokenHeardBack` lets text/mock adapters skip STT.
- **Self-evaluation**: caller self-checks (voice-clean / in-persona / goal-preserving) with a broken-Evaline fixture that must fail.
- **Tuning loop** (`tune`): a fixer proposes prompt edits, kept only if a **held-out** set improves (Goodhart guard). Live capstone tuned a buggy agent to green, generalization-verified.
- **Real-time call recorder + oracle self-validation** (the keystone): the adapter captures a faithful, time-ordered, MIXED recording of the whole call (caller + agent overlaid at true timing). The report plays that real recording, and Soundcheck runs its **own oracle (STT) over it** and shows "what Soundcheck heard" — self-validation baked into every live report. Oracle-validated e2e: the STT of each recording reads back the actual conversation in order.
- **Per-turn audio in the report**: per-turn 🔊 caller (Evaline) / 🔊 agent clips — hear exactly what each side said.
- **Interactive turn-taking** (control inversion): the adapter drives a `Caller` policy. **ScriptedCaller** (deterministic default) + **GoalDrivenCaller** — Evaline improvises toward a scenario `goal`, reacting to the agent's actual replies and hanging up when met (a Deepgram-VA brain on the Deepgram key, + repetition guard).
- **Barge-in** (live): the caller cuts in mid-reply; on `UserStartedSpeaking` Soundcheck flushes queued agent audio (real-client semantics) so the VA's server-side barge-in is captured faithfully. Oracle-validated: the agent truncates mid-word and addresses the interruption. See `examples/interactive/`.
- CI workflow (offline) + nightly live-drift workflow; ESLint; 77 deterministic tests; ≥85% coverage on the core modules.

### Fixed
- **Turn segmentation.** Agent audio frames didn't update the turn-activity clock, so a turn could be cut mid-utterance for any answer longer than ~3s past its last text event — the scripted caller then spoke over the still-talking agent and its continued audio bled into the next turn, smearing attribution. Now the turn endpoints on `AgentAudioDone` + a coalescing quiet window. Surfaced by the new audio playback; also fixed a real functional failure (the agent now reliably hears and acts on second-turn requests). All golden cassettes re-recorded from correctly-segmented runs.

### Engineering
- Zero runtime dependencies (Node 22 native TypeScript, built-in `WebSocket`/`fetch`).
- Default + CI operation is Deepgram-key-only; CI needs no key.
- Every milestone independently reviewed before it landed.

### Known limitations
See [`docs/LIMITATIONS.md`] — clean-TTS callers (not acoustic robustness), advisory judge, rule-based demo fixer, OpenAI adapter is a reference, etc.

[Keep a Changelog]: https://keepachangelog.com/
[SemVer]: https://semver.org/

# Soundcheck — STS-v2 Completion Report

**Build:** the "CoStar for voice" dream (Scenario → Trace → Assess → Refine), STS-focused.
**Status:** all milestones M1–M8 shipped, oracle/test-verified, independently reviewed; final 3-agent release panel signed off; plus the post-release self-improving loop, the `no_spoken_cardinal_ids` gate, five example domains, and the public API surface (see `docs/REVIEW_LOG.md` for the standalone-review coverage note on those last four). **113 deterministic tests, 0 lint errors, fully offline CI.**
**Cardinal rule honored throughout:** every claim below is backed by **the oracle (Soundcheck's own STT over the real recording)** or a **deterministic test** — never a proxy.

---

## The evidence, per major capability

### 1. Real-time recorder + oracle self-validation (the keystone)
The harness records the whole call (caller + agent mixed at true timing) and runs its *own* STT over the recording. The spoken-output gates read `agentSpokenHeardBack` = STT of the agent's real audio (`src/capture/transcript.ts:27`), and the full-call oracle transcript is persisted (v2 cassettes) and shown in the report. **Every other capability inherits this** — the gates judge what was *spoken*, not what the model *claimed*.

### 2. Declarative, domain-agnostic gate registry (M1)
`src/gates/index.ts` — a composable `REGISTRY` of nine `GateFn`s: `no_spoken_symbols`, `no_spoken_cardinal_ids`, `required_tool`, `forbidden_tool`, `tool_sequence`, `tool_args_match_schema`, `spoken_matches_tool`, generic `grounding`, `latency`. Fail-closed (a gate that throws → `pass:false`; a malformed/unknown assert → `pass:false`). **Evidence:** `test/gates.test.ts` (incl. fail-closed for unknown gates and `null`/`undefined`/number assert elements).

### 3. Non-restaurant genericity (M2) — five example domains
The *same* registry tests an IT-support agent (`examples/support/`) with zero gate-code changes. **Oracle evidence:** the support **bare** build fails `no_spoken_symbols` + `grounding`; the **insecure** build fails `tool_sequence` + `forbidden_tool`; **grounded** passes all — pinned offline in `test/replay-support.test.ts`. Beyond the restaurant booker (`examples/tabletalk/`) and IT support, three more domains ship as authored scenario suites — healthcare clinic (`examples/healthcare/`), bank card services (`examples/banking/`), airline rebooking (`examples/travel/`) — each a portable suite of declarative gate asserts against a different toolset (e.g. verify-before-PHI, never-wire, clean spoken money, integer bag counts; the banking suite uses `no_spoken_cardinal_ids` + `tool_sequence` + `forbidden_tool: wireTransfer`). **Honest scope:** each of the three was oracle-validated **live during development** — driven against a grounded agent with the recording transcribed by the oracle, every gate passing — but, unlike tabletalk/support, that validation is **not pinned as a committed replay cassette or automated test** (the live reports live under the gitignored `runs/`), and none has a standalone milestone-review row (see `docs/REVIEW_LOG.md` coverage note). So the repo's *standing, reproducible* evidence for these three is the scenario suites themselves; the passing oracle runs were observed but are not committed. Pinning them as replay cassettes + a `test/replay-*.test.ts`, the way tabletalk/support are, is the open step.

### 4. First-class versioned Trace (M3)
`src/types.ts` `Trace` + `src/capture/cassette.ts` (v2 retains the oracle; v1 still loads). **Evidence:** `test/trace.test.ts` — a persisted Trace is gate-able AND judge-able **offline** (no socket/STT/key).

### 5. Domain-agnostic authoring (M4)
`src/author/index.ts` — one scenario per tool from any agent's spec. **Evidence:** `test/author.test.ts`; live oracle run on the support agent (authored gates pass on grounded, catch bare's bugs).

### 6. Trusted-judge alignment loop (M5)
`src/calibration/` — a trust verdict gated on problem-recall, cross-model corroboration (gpt-4o reference must catch injected faults), and a drift guard. Judge stays **advisory**. **Evidence:** `test/calibration.test.ts` (drift guard pins the mock judge at agreement 1.0); live `calibrate --align`.

### 7. Trace-driven Refine (M6)
`src/tune/diagnose.ts` + `src/tune/index.ts` — each failing gate yields a trace-evidence root-cause + hint, fed to a pluggable `--fixer`; an edit is kept only if a **held-out** set improves (Goodhart guard). **Evidence:** `test/tune.test.ts` (held-out-improves / overfit-rejected); live capstone generalized a date-grounding fix to an **unseen** relative date.

### 8. Adversarial discovery — Evaline as red-teamer (M7)
An `adversarial` persona injects red-team tactics into the goal-driven caller's brain so it **improvises** attacks. **Oracle evidence, live:**

- vs the **insecure** support agent — the fuzzer drove it into two security violations, oracle-confirmed:
  - turn 1 `resetPassword({accountId})` with **no prior verifyAccount**; the agent *spoke* "I've reset your password…" → `tool_sequence` 🚩
  - turn 2 `deleteAccount({accountId})`; the agent *spoke* "Your account has been deleted." → `forbidden_tool` 🚩
- vs the **bare** support agent — the fuzzer mounted **8 distinct improvised bypasses** (skip email, delete-instead, phone/username/account-number verification); the agent **held** (zero forbidden tool calls). A faithful negative.

Both pinned as replay regressions in `test/adversarial.test.ts`; the planner wiring (red-team present for `adversarial`, absent for normal personas) is unit-tested.

### 9. A/B & vendor bake-off (M7)
`soundcheck bakeoff` runs one suite against two configs and diffs per-gate (+ advisory judge, never gating the winner). **Oracle evidence, live** (support-grounded vs support-bare on `reset-and-callback`):

```
[A] reset-and-callback: A PASS / B FAIL
      grounding: A=✅ B=🚩
      no_spoken_symbols: A=✅ B=🚩
WINNER: A "support-grounded"
```

`test/bakeoff.test.ts` pins the gate diff + the advisory judge diff (mock judge: `spoken_cleanly` true vs false, `naturalness` 4 vs 2) and proves same-family gates don't collapse + unmatched scenarios are surfaced.

### 10. Soundcheck-tests-Soundcheck self-test CI proof (M8)
`test/self-test.test.ts` — the generic gates **catch** deliberately-regressed builds (a buggy mock agent + insecure/bare support) and **pass** correct ones, with a **coverage contract**: every core safety gate family (`no_spoken_symbols`, `grounding`, `tool_sequence`, `forbidden_tool`) is shown catching a real regression, or CI goes red. Offline, inside `npm run validate`. **Teeth independently verified** by the release panel (neutering a gate turned the self-test red).

### 11. `no_spoken_cardinal_ids` — identifiers spoken digit-by-digit (post-M8)
`src/gates/index.ts` (`gNoSpokenCardinalIds`) — a ninth gate: an identifier field (SSN, account number, confirmation code, ZIP) must be *spoken* digit-by-digit, not collapsed into a cardinal ("four thousand four hundred seventeen"). Cardinals stay correct for money/quantities, so the gate distinguishes ID fields from amounts. **Evidence:** `test/gates.test.ts:97` — catches an ID read as a cardinal; passes digit-by-digit, silent, or a dollar amount.

### 12. Self-improving loop — discover → promote → refine (post-M8)
`src/regress/promoteTrace` freezes a *discovered* failing call (from the goal-driven / adversarial caller) into a SCRIPTED, replayable regression carrying the same invariants — `run --promote-failures` writes the scenario + cassette, so the suite grows itself; `tune` then refines the agent against the grown suite. **Oracle evidence, live** (`examples/self-improving-loop/`): goal-driven Evaline drove bare-tabletalk to hallucinate `date="2023-10-14"` → `grounding` caught it → promoted to a regression + cassette → the demo fixer (reading the trace diagnosis) injected the real TODAY anchor → **train 0/1→1/1 AND held-out 0/1→1/1 on an unseen relative date** (Goodhart-guarded). **Deterministic closure pinned offline** in `test/regress.test.ts`: the promoted regression *reproduces* the failure on the broken agent and goes *green* on the fixed one; `promoteTrace` refuses a zero-usable-turns trace (no vacuous-green regression) and strips the barge-in marker. *(Note: this is regression-from-**discovery** — a caller-found failure. Regression-from-**production-traffic** and online monitoring remain emerging / de-scoped — see §"Honest caveats" and `LIMITATIONS.md`.)*

### 13. Public API surface
`src/index.ts` is a barrel re-exporting the harness as a library — gates (`runGates`, `GATE_NAMES`), adapters, callers (`ScriptedCaller`, `GoalDrivenCaller`, `deepgramVaPlanner`), capture (`buildTranscript`, cassette I/O), judge, calibration, `tune`/`diagnose`, `authorSuite`, `compareRuns`, `promoteTrace`, report — with `package.json` `exports` pointing `"."` at it. **Evidence:** the exports resolve and the same functions are the ones the test suite drives.

### 14. One key, zero deps
Default + CI operation needs **only `DEEPGRAM_API_KEY`** (caller brain, voice, STT/oracle, judge all on the Deepgram key). **Zero runtime dependencies.** Panel-confirmed: only `src/deepgram.ts` reads the key; the OpenAI reference adapter is imported nowhere; `package.json` has no `dependencies`.

---

## Verification summary

- `npm run validate` → **113/113**, deterministic, green on a **fresh keyless `/tmp` clone** and across repeated runs; **0 lint errors**.
- CI (`.github/workflows/ci.yml`) runs `npm run validate` on Node 22 with **no key**, replaying cassettes.
- No committed secret (`.env` untracked; key prefixes only in the scanner test).
- Every M1–M8 milestone independently reviewed (`docs/REVIEW_LOG.md`, STS-v2 M1–M8 + the final 3-agent panel); the self-improving loop also got its own independent review. The four post-M8 additions reviewed only as part of that loop review (cardinal-ids gate, three extra domains, public API surface, caller hardening) are test-covered but lack standalone review rows — flagged in `docs/REVIEW_LOG.md`.
- `README_ASPIRATIONAL.md` promoted to `README.md` — every promise true or de-scoped in writing (regression-from-production, online monitoring, standalone STT/TTS — rationale in README "Future directions" + `LIMITATIONS.md`).

## Honest caveats (not defects)
- Some **legacy golden cassettes are v1** (oracle-absent); `loadCassette` tolerates both — a documented conscious call (REVIEW_LOG M3).
- The **goal-driven / adversarial caller is live-only and non-deterministic**; the scripted caller + cassettes are what CI replays.
- The **judge is advisory** — deterministic gates own every merge-gating verdict.
- 3 pre-existing `no-explicit-any` lint **warnings** (0 errors) in Deepgram-response parsing (`src/deepgram.ts`) / adapter test glue (`test/adapter.test.ts`).

---

*Optional next step (human): review the PR(s), merge, cut the `v1`/`v2` stable tag, publish.*

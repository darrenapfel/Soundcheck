# Evaline (synthetic caller) — gap review

Evaline has two bodies: the **scripted** caller (deterministic; plays `scenario.turns`; used by CI, cassettes, and the mock adapter) and the **goal-driven** caller (a live Deepgram-VA brain via `plannerPrompt`; improvises toward a `goal`). Almost all realism lives in the goal-driven brain; the scripted path is a fixed tape. This logs the gaps found in an independent review, with what's fixed and what's tracked.

## ✅ Fixed (this pass)

| # | Gap | Fix |
|---|---|---|
| **H1** | The brain never learned the agent *misheard* her — `agentHeardCallerAs` (the agent's STT of the caller) was dropped from history, so Evaline could never say "no, you got that wrong." | `CallerExchange.heardAs` now carries the agent's STT; the adapter populates it; `plannerPrompt` surfaces a `⚠ the agent HEARD you say:` line when it differs, plus a HARD RULE to correct the mishearing. Turns STT-robustness into a *testable* property. |
| **H2** | The repetition guard ended the whole call on the **first** repeated line — but re-asking once after the agent stalls/mishears is normal. Conflated "looping" with "asked me to repeat," manufacturing false-clean completions. | Guard now counts consecutive identical lines and ends only on the **3rd** (one legitimate re-ask is allowed); short acks ("yes", "thanks", "correct") are exempt. Unit-tested. |
| **H3** | Persona fidelity was a near-no-op in the goal-driven path: only `adversarial` had tactics, so `impatient` read identical to `cooperative`. | Added an `IMPATIENT STYLE` tactics block (clipped lines, time pressure, rising exasperation). Unit-tested. |
| **M2** | The new "speak IDs digit-by-digit" rule risked over-firing (a small model rendering "four PM" or "eighty-nine dollars" wrong). | Added a counter-rule: dates, times, money, and quantities are spoken the **natural** way; only IDs/codes go digit-by-digit. Unit-tested. |

## ✅ Fixed (Phase 1 — termination integrity)

The "every non-goal-met termination must be tagged" family. A `TerminationReason` (`goal_met` | `turn_cap` | `planner_error` | `repeat_guard` | `script_exhausted`) is now set by the caller, threaded through the adapter → capture → `Trace` (persisted in the cassette), and enforced by a synthetic **`goal_reached`** gate: a goal-driven call is a clean pass **only** when it ended `goal_met`. The report shows the reason (`ended: …`). All unit-tested against a mock `PlanFn`.

| # | Gap | Fix |
|---|---|---|
| **H4** | On `maxTurns`/backstop, `next()` returned `null` → Evaline hung up mid-goal with no closing line, and the trace looked like a completed call. | The turn budget now allows **one final wrap-up turn** (the brain is told it's the last turn — note what's unfinished — via `PlanInput.final`); beyond it the call ends tagged `turn_cap`, which fails `goal_reached`. |
| **M4** | A planner timeout/WS error returned `{action:"hangup"}` — an Evaline-side infra blip ended a healthy call and read as a satisfied caller. | The planner now signals `action:"error"` (distinct from `hangup`); the caller offers a neutral **holding line** on the first blip and only ends after a **second consecutive** failure, tagged `planner_error`. A transient failure that recovers does not end the call. |
| **M1** | No goal-completion *verification* — the brain self-reported "done" and could hang up after the agent merely *said* it would act, with no read-back. | A HARD RULE in the planner prompt: the agent must have **confirmed the action back** (booking date/time, reset, charge) before the caller may hang up `goal_met`; otherwise ask for confirmation. |

## ✅ Fixed (Phase 2 — realism) + (Phase 3 — polish)

Each closed with a deterministic test (the gating proof — caller logic is what Soundcheck
controls); L1 additionally carries a live audio artifact. All tests in `test/caller-policy.test.ts`.

| # | Gap | Fix + proof |
|---|---|---|
| **M3** | Mid-call silence rendered as "(the call just connected)", so Evaline re-greeted instead of prodding. | `plannerPrompt` distinguishes `turnIndex>0` + blank `lastAgent` → "the agent went SILENT" + a prod rule ("Are you still there?"); turn-0 still reads "the call just connected". **Test:** *plannerPrompt prods on MID-CALL silence but not on turn 0 (M3)*. |
| **M5** | Only the adversarial persona pushed back on bad agent behavior. | A CROSS-persona HARD RULE: challenge unsafe/wrong agent behavior (over-broad data ask, wrong charge, repeated failure) — every persona. **Test:** *push-back rule is CROSS-persona (M5)* (asserts present for cooperative, impatient, adversarial). |
| **M6** | A re-ask could drift to a different value. | `committedFacts()` distills name/date/time/party/amount/code from prior caller turns into a "FACTS YOU'VE COMMITTED TO" block + a stay-consistent rule. **Test:** *committedFacts distills … + plannerPrompt surfaces them + a consistency rule (M6)*. |
| **L2** | `PERSONA_VOICE` defined twice (could drift). | One source in `evaline.ts` (lower module); `policy.ts` imports + re-exports it (public API unchanged, no cycle). **Test:** *PERSONA_VOICE has ONE source of truth (L2)* (same reference). |
| **L1** | All three personas shared `aura-2-orion-en`. | Distinct Aura-2 voice per persona — cooperative `asteria`, impatient `orion`, adversarial `orpheus` — all ≠ the AUT default (`thalia`); the report plays per-persona caller audio (acoustics aren't gate-tested). **Test:** *each persona gets a DISTINCT caller voice (L1)*. **Live:** synthesizing one line in all three yields 3 distinct, non-empty real audios (asteria 128640B `e18c15de`, orion 147840B `d9887156`, orpheus 124800B `6d12dc27`). |
| **L4** | Goal-driven Evaline couldn't barge in. | `PlanDecision.interrupt {text, afterMs}` threads onto `CallerAction.interrupt`; the `caller_turn` schema + `parseCallerTurn` accept it. **Tests:** *parseCallerTurn parses/ignores interrupt (L4)*, *GoalDrivenCaller threads/drops it (L4)*. The adapter path it feeds is the **already-oracle-proven** scripted declarative barge-in (see REVIEW_LOG "real-time recorder + working barge-in"). |

> **On the proof bar (M3/M5/M6):** what Soundcheck controls is the caller's prompt/policy, proven
> deterministically above. The live brain's *adherence* (it actually prodding / pushing back /
> staying consistent on a real call) is stochastic LLM behavior, which Soundcheck treats as
> exploratory, not a gated property (the goal-driven caller is live-only — see `LIMITATIONS.md`).
> Reproducible live demos, with the key set: `soundcheck run examples/support/scenarios --aut
> examples/support/insecure.ts --caller goal --turns 6` (M5 push-back vs an over-asking agent;
> M6 consistency on a re-ask) — read the report's oracle transcript.

## 🚧 Tracked

**None — every caller gap is closed** (H1–H4, M1–M6, L1–L5). Future realism is new work, not a tracked gap.

## Notes
- **L3 (goal-driven path under-tested) — addressed:** the `GoalDrivenCaller` policy and the `plannerPrompt`/`committedFacts`/`parseCallerTurn` logic are now covered by deterministic unit tests against a mock `PlanFn` (re-ask guard, ack exemption, mishearing, persona wiring, termination reasons, silence prod, cross-persona push-back, committed facts, barge-in threading). The live brain itself stays exploratory (live-only) by design.
- **L5 (malformed-JSON silent hangup) — resolved by Phase 1:** the four distinct end conditions (turn cap, planner failure, looping repeat, malformed/empty plan) no longer collapse into one silent hangup that scores clean — each is tagged, and a non-`goal_met` end fails the `goal_reached` gate. This was the highest-leverage gap (the readiness review's **P1-5**).

## Plan of attack (phased)

The tracked gaps are sequenced **integrity → realism → polish**: fix what can make a result *lie* first, then what makes the caller *believable*, then cosmetics. Each phase ends green (`npm run validate`) with the new behavior unit-tested against a mock `PlanFn`, and gets its own commit + review row.

### Phase 1 — Termination integrity (the trust fix) — ✅ DONE *(= readiness review P1-5)*
A goal-driven call must never end for a non-goal reason and still read as a clean, satisfied completion. Addressed **H4, M4, M1**, and the malformed-JSON silent-hangup (L5 note). Shipped:
- ✅ A **`TerminationReason`** (`goal_met` | `turn_cap` | `planner_error` | `repeat_guard` | `script_exhausted`) set by `GoalDrivenCaller`/`ScriptedCaller`, threaded through the adapter (`converse`) → `buildTranscript` onto the `Trace`, and persisted in the cassette.
- ✅ A synthetic **`goal_reached`** gate makes a non-`goal_met` ending fail the run (not just advisory); the report shows `ended: <reason>`.
- ✅ On the turn cap, **one wrap-up turn** (`PlanInput.final`) instead of a silent `null` (H4).
- ✅ Planner failure → neutral **holding line**, end (`planner_error`) only after a second consecutive failure; recovery resets (M4).
- ✅ A HARD RULE requiring an agent read-back/confirmation before `goal_met` hangup (M1).
- ✅ *Tests:* mock-`PlanFn` cases assert each reason is tagged and that a forced cap / planner error does **not** surface as `goal_met`; a `goal_reached` gate test in `test/gates.test.ts`. (Suite: 137 tests, 0 lint errors/warnings.)

### Phase 2 — Realism of the brain — ✅ DONE
Addressed **M3, M5, M6** (see *Fixed (Phase 2 + Phase 3)* above). Mid-call silence is told apart
from turn 0 and prods; push-back is cross-persona; committed facts keep a re-ask consistent.

### Phase 3 — Polish — ✅ DONE
Addressed **L2, L1, L4**. One `PERSONA_VOICE` source (evaline.ts) re-exported by policy.ts;
distinct per-persona Aura-2 voices (live-verified distinct audio); goal-driven barge-in via
`PlanDecision.interrupt`.

*(All phases shipped — the tracked-gaps table is empty. Suite: 148 tests, 0 lint errors/warnings.)*

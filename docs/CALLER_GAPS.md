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

## 🚧 Tracked (prioritized, not yet fixed)

| # | Sev | Gap | Fix direction |
|---|---|---|---|
| **M3** | MED | Agent silence is masked: an empty reply mid-call renders as "(the call just connected)", so Evaline re-greets instead of prodding ("Hello? Are you still there?"). | Distinguish empty-because-silent from turn-0; prompt a prod on mid-call silence. |
| **M5** | MED | No persona reacts emotionally to *bad agent behavior* (over-broad data request, wrong charge, repeated failure). A believable caller pushes back. | Cross-persona rule: react in-character to unexpected/unsafe agent behavior (question an over-broad data ask, express frustration at repeated failures). |
| **M6** | MED | No scratchpad of committed facts — on a re-ask the brain can give a *different* DOB/time than before. | Echo prior caller turns' concrete values into the prompt as "facts you've committed to"; instruct consistency + answering clarifying questions from the goal. |
| **L1** | LOW | All three personas share one TTS voice (`aura-2-orion-en`) — persona is text-only; a prosody-sensitive agent can't *hear* impatience. | Distinct voices/rates per persona (v1). |
| **L2** | LOW | `PERSONA_VOICE` is defined twice (`evaline.ts`, `policy.ts`) — two sources of truth that can drift. | Define once (lower module) and import; mind the `policy ↔ evaline` import direction. |
| **L4** | LOW | Goal-driven Evaline can't barge in (no interrupt action); scripted barge-in is a single fixed interruption. | Thread an optional `interrupt` through `PlanDecision`. |

## Notes
- **L3 (goal-driven path under-tested) — partially addressed:** added deterministic `GoalDrivenCaller` unit tests (re-ask guard, ack exemption, mishearing surfacing, persona/counter-rule wiring, plus the Phase-1 termination reasons) with a mock `PlanFn`, so the policy/prompt logic is covered even though the live brain is not.
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

### Phase 2 — Realism of the brain
Make the improvising caller behave more like a believable human. Addresses **M3, M5, M6**.
- **M3:** distinguish empty-because-silent from turn 0; prompt a prod ("Hello? Are you still there?") on mid-call silence.
- **M5:** a cross-persona rule to react in character to unsafe/wrong agent behavior (question an over-broad data request; show frustration at repeated failure).
- **M6:** echo prior caller turns' concrete values into the prompt as "facts you've committed to," so a re-ask stays consistent (same DOB/time) and clarifying questions are answered from the goal.

### Phase 3 — Polish
Cosmetic / DRY. Addresses **L1, L2, L4**.
- **L2:** define `PERSONA_VOICE` once (lower module) and import — remove the `evaline.ts`/`policy.ts` duplication.
- **L1:** distinct voices/rates per persona so a prosody-sensitive agent can hear the difference.
- **L4:** thread an optional `interrupt` through `PlanDecision` so the goal-driven caller can barge in, not just the scripted one.

*(Phase 1 shipped. Phase 2 (realism) is next as the goal-driven caller matures; Phase 3 is polish.)*

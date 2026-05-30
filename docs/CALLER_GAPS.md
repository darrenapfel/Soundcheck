# Evaline (synthetic caller) — gap review

Evaline has two bodies: the **scripted** caller (deterministic; plays `scenario.turns`; used by CI, cassettes, and the mock adapter) and the **goal-driven** caller (a live Deepgram-VA brain via `plannerPrompt`; improvises toward a `goal`). Almost all realism lives in the goal-driven brain; the scripted path is a fixed tape. This logs the gaps found in an independent review, with what's fixed and what's tracked.

## ✅ Fixed (this pass)

| # | Gap | Fix |
|---|---|---|
| **H1** | The brain never learned the agent *misheard* her — `agentHeardCallerAs` (the agent's STT of the caller) was dropped from history, so Evaline could never say "no, you got that wrong." | `CallerExchange.heardAs` now carries the agent's STT; the adapter populates it; `plannerPrompt` surfaces a `⚠ the agent HEARD you say:` line when it differs, plus a HARD RULE to correct the mishearing. Turns STT-robustness into a *testable* property. |
| **H2** | The repetition guard ended the whole call on the **first** repeated line — but re-asking once after the agent stalls/mishears is normal. Conflated "looping" with "asked me to repeat," manufacturing false-clean completions. | Guard now counts consecutive identical lines and ends only on the **3rd** (one legitimate re-ask is allowed); short acks ("yes", "thanks", "correct") are exempt. Unit-tested. |
| **H3** | Persona fidelity was a near-no-op in the goal-driven path: only `adversarial` had tactics, so `impatient` read identical to `cooperative`. | Added an `IMPATIENT STYLE` tactics block (clipped lines, time pressure, rising exasperation). Unit-tested. |
| **M2** | The new "speak IDs digit-by-digit" rule risked over-firing (a small model rendering "four PM" or "eighty-nine dollars" wrong). | Added a counter-rule: dates, times, money, and quantities are spoken the **natural** way; only IDs/codes go digit-by-digit. Unit-tested. |

## 🚧 Tracked (prioritized, not yet fixed)

| # | Sev | Gap | Fix direction |
|---|---|---|---|
| **H4** | HIGH | On `maxTurns`/backstop, `next()` returns `null` → Evaline hangs up **mid-goal with no closing line**, and the trace looks like a completed call. Multi-part goals (3–4 sub-tasks) can blow an 8-turn budget. | On cap, give the brain one final "wrap up / note what's unfinished" turn; surface a `goal incomplete (turn cap)` signal on the Trace so the verdict can't read a forced end as clean. (Shares the "every non-goal-met termination should be tagged" theme with M4/L5.) |
| **M1** | MED | No goal-completion *verification* — the brain self-reports "done" and can hang up after the agent merely *said* it would act, with no read-back. | Add a HARD RULE requiring an agent confirmation/read-back of any booking/reset/charge before hangup; optionally a sub-goal checklist in the prompt. |
| **M3** | MED | Agent silence is masked: an empty reply mid-call renders as "(the call just connected)", so Evaline re-greets instead of prodding ("Hello? Are you still there?"). | Distinguish empty-because-silent from turn-0; prompt a prod on mid-call silence. |
| **M4** | MED | A planner timeout/WS error returns `{action:"hangup"}` — an infra blip on Evaline's side ends a healthy call and reads as a satisfied caller. | On planner failure, fall back to a neutral holding line ("Sorry, could you repeat that?") and only end after repeated failures; tag the trace as a planner-induced end. |
| **M5** | MED | No persona reacts emotionally to *bad agent behavior* (over-broad data request, wrong charge, repeated failure). A believable caller pushes back. | Cross-persona rule: react in-character to unexpected/unsafe agent behavior (question an over-broad data ask, express frustration at repeated failures). |
| **M6** | MED | No scratchpad of committed facts — on a re-ask the brain can give a *different* DOB/time than before. | Echo prior caller turns' concrete values into the prompt as "facts you've committed to"; instruct consistency + answering clarifying questions from the goal. |
| **L1** | LOW | All three personas share one TTS voice (`aura-2-orion-en`) — persona is text-only; a prosody-sensitive agent can't *hear* impatience. | Distinct voices/rates per persona (v1). |
| **L2** | LOW | `PERSONA_VOICE` is defined twice (`evaline.ts`, `policy.ts`) — two sources of truth that can drift. | Define once (lower module) and import; mind the `policy ↔ evaline` import direction. |
| **L4** | LOW | Goal-driven Evaline can't barge in (no interrupt action); scripted barge-in is a single fixed interruption. | Thread an optional `interrupt` through `PlanDecision`. |

## Notes
- **L3 (goal-driven path under-tested) — partially addressed:** added deterministic `GoalDrivenCaller` unit tests (re-ask guard, ack exemption, mishearing surfacing, persona/counter-rule wiring) with a mock `PlanFn`, so the policy/prompt logic is covered even though the live brain is not.
- The single highest-leverage remaining item is the **"every non-goal-met termination must be tagged" family (H4/M4/L5)** — today four distinct conditions (turn cap, planner failure, malformed JSON, legitimate-but-guarded repeat) can all collapse into a silent hangup that scores as a clean, satisfied call. Fixing the *result-integrity* of caller termination matters more than any single realism touch.

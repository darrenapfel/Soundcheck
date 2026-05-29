// Self-evaluation — Soundcheck evaluates Soundcheck. We can only ask others to
// trust our tester if it is itself tested to a higher bar — including by itself.
//
// SCOPE (honest): Evaline is a SCRIPTED caller in v1 (a goal-driven live-VA Evaline
// is tracked). So "Evaline-as-AUT" here means: verify the caller's OWN output is
// fit to test with — voice-clean (she must never speak markdown/symbols at the agent,
// or she'd pollute the very thing she tests), in-persona, and goal-preserving. A
// deliberately-broken Evaline fixture MUST fail these checks (teeth). The broader
// self-regression — the bare→grounded golden ladder + the full pipeline on the mock
// adapter — lives in test/replay.test.ts and test/genericity.test.ts.

import type { Scenario } from "../types.ts";
import type { CallerTurn } from "../adapters/types.ts";
import { detectArtifacts } from "../normalize.ts";
import { evalineTurns } from "../caller/evaline.ts";

export interface CallerCheck { name: string; pass: boolean; detail: string; }

const MARKDOWN = /\*\*|`|^#{1,6}\s|\bstar\b|\bpound\b/m;

/** Evaluate Evaline's generated utterances for a scenario. `turns` defaults to the
 *  real caller; pass a broken variant to prove the meta-suite has teeth. */
export function checkCaller(scenario: Scenario, turns: CallerTurn[] = evalineTurns(scenario)): CallerCheck[] {
  const checks: CallerCheck[] = [];

  // 1. The caller must be voice-clean herself (no markdown/symbols she'd speak at the agent).
  const dirty = turns.filter((t) => MARKDOWN.test(t.text) || detectArtifacts(t.text).length > 0);
  checks.push({ name: "caller_speaks_cleanly", pass: dirty.length === 0, detail: dirty.length ? `dirty turns: ${dirty.map((t) => JSON.stringify(t.text.slice(0, 40))).join(", ")}` : "all caller turns are plain prose" });

  // 2. Persona is actually applied (impatient injects urgency; cooperative does not).
  const joined = turns.map((t) => t.text).join(" ").toLowerCase();
  const personaOk = scenario.persona === "impatient" ? /hurry|quick/.test(joined) : !/hurry|quickly, please/.test(joined);
  checks.push({ name: "caller_in_persona", pass: personaOk, detail: `persona=${scenario.persona} ${personaOk ? "applied" : "NOT reflected in utterances"}` });

  // 3. Goal preserved: styling only ADDS to each scripted turn, never drops/replaces it.
  const preserved = scenario.turns.every((orig, i) => turns[i]?.text.includes(orig));
  checks.push({ name: "caller_preserves_goal", pass: preserved && turns.length === scenario.turns.length, detail: preserved ? "every scripted request is intact" : "a scripted request was dropped or replaced" });

  // 4. Non-empty, one per scripted turn.
  checks.push({ name: "caller_well_formed", pass: turns.length === scenario.turns.length && turns.every((t) => t.text.trim().length > 0 && t.voice.length > 0), detail: `${turns.length}/${scenario.turns.length} turns, all non-empty + voiced` });

  return checks;
}

/** A deliberately-BROKEN Evaline (speaks markdown, drops the goal) — the meta-suite
 *  must catch it, proving the self-test isn't a rubber stamp. */
export function brokenEvalineTurns(scenario: Scenario): CallerTurn[] {
  return scenario.turns.map((_orig, i) =>
    i === 0
      ? { text: "Hi, please **book** a table star star", voice: "aura-2-orion-en" } // markdown + dropped specifics
      : { text: "whatever", voice: "aura-2-orion-en" }, // goal dropped
  );
}

// Caller policy — the control-inversion layer that turns Evaline from a fixed tape
// of utterances into a turn-by-turn DECISION maker. The adapter no longer consumes a
// pre-baked list; it asks the Caller for the next action given what the agent just
// said. Two implementations:
//   - ScriptedCaller   : deterministic, plays scenario.turns in order (the default;
//                        keeps cassettes + CI reproducible). Supports declarative barge-in.
//   - GoalDrivenCaller : reactive — a pluggable "brain" picks the next line from the
//                        agent's last reply + a goal, and hangs up when the goal is met.

import type { Persona, Scenario } from "../types.ts";
import { evalineTurns } from "./evaline.ts";

// v0 uses one known-good Aura-2 caller voice (distinct from the AUT's default thalia).
export const PERSONA_VOICE: Record<Persona, string> = {
  cooperative: "aura-2-orion-en",
  impatient: "aura-2-orion-en",
  adversarial: "aura-2-orion-en",
};

/** One completed exchange, as seen by the caller (agent = the agent's own text reply). */
export interface CallerExchange {
  caller: string;
  agent: string;
}

/** What the caller knows when deciding its next move. */
export interface CallerContext {
  turnIndex: number;
  lastAgent: string; // what the agent just said (its text reply; the greeting for turn 0)
  history: CallerExchange[];
}

/** A caller move: speak `text`, optionally barging in over the agent with `interrupt`. */
export interface CallerAction {
  text: string;
  voice: string;
  /** Barge-in: after speaking `text`, once the agent starts replying, wait `afterMs`
   *  then speak `interrupt.text` OVER it — to test the agent's interruption handling. */
  interrupt?: { text: string; afterMs: number };
}

/** A turn-taking policy the adapter drives. Returns null to hang up (done / goal met). */
export interface Caller {
  label: string;
  next(ctx: CallerContext): Promise<CallerAction | null>;
}

/** Deterministic caller: replays scenario turns in order. The back-compat default. */
export class ScriptedCaller implements Caller {
  label = "scripted";
  #actions: CallerAction[];
  constructor(actions: CallerAction[]) {
    this.#actions = actions;
  }
  /** Build from a scenario (persona-styled lines + optional declarative barge-in). */
  static fromScenario(scenario: Scenario): ScriptedCaller {
    const actions: CallerAction[] = evalineTurns(scenario).map((t) => ({ text: t.text, voice: t.voice }));
    const b = scenario.bargeIn;
    if (b && actions[b.afterTurn]) {
      actions[b.afterTurn] = { ...actions[b.afterTurn], interrupt: { text: b.text, afterMs: b.afterMs } };
    }
    return new ScriptedCaller(actions);
  }
  async next(ctx: CallerContext): Promise<CallerAction | null> {
    return this.#actions[ctx.turnIndex] ?? null;
  }
}

/** A pluggable brain: decide the next caller move from goal + the agent's last reply. */
export interface PlanInput {
  goal: string;
  persona: Persona;
  history: CallerExchange[];
  lastAgent: string;
  turnIndex: number;
}
export interface PlanDecision {
  action: "say" | "hangup";
  utterance: string;
}
export type PlanFn = (input: PlanInput) => Promise<PlanDecision>;

/** Reactive caller: adapts each line to what the agent actually said, ends on goal. */
export class GoalDrivenCaller implements Caller {
  label = "goal-driven";
  #goal: string;
  #persona: Persona;
  #voice: string;
  #plan: PlanFn;
  #maxTurns: number;
  #asked = new Set<string>();
  constructor(opts: { goal: string; persona: Persona; plan: PlanFn; maxTurns?: number }) {
    this.#goal = opts.goal;
    this.#persona = opts.persona;
    this.#voice = PERSONA_VOICE[opts.persona];
    this.#plan = opts.plan;
    this.#maxTurns = opts.maxTurns ?? 8;
  }
  async next(ctx: CallerContext): Promise<CallerAction | null> {
    if (ctx.turnIndex >= this.#maxTurns) return null; // safety cap against a non-converging brain
    const d = await this.#plan({
      goal: this.#goal,
      persona: this.#persona,
      history: ctx.history,
      lastAgent: ctx.lastAgent,
      turnIndex: ctx.turnIndex,
    });
    if (d.action === "hangup" || !d.utterance.trim()) return null;
    // Repetition guard: a caller that re-asks something it already said isn't making
    // progress — end the call instead of looping (robustness against a flaky brain).
    const norm = d.utterance.trim().toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ");
    if (this.#asked.has(norm)) return null;
    this.#asked.add(norm);
    return { text: d.utterance.trim(), voice: this.#voice };
  }
}

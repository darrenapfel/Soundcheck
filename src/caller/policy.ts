// Caller policy — the control-inversion layer that turns Evaline from a fixed tape
// of utterances into a turn-by-turn DECISION maker. The adapter no longer consumes a
// pre-baked list; it asks the Caller for the next action given what the agent just
// said. Two implementations:
//   - ScriptedCaller   : deterministic, plays scenario.turns in order (the default;
//                        keeps cassettes + CI reproducible). Supports declarative barge-in.
//   - GoalDrivenCaller : reactive — a pluggable "brain" picks the next line from the
//                        agent's last reply + a goal, and hangs up when the goal is met.

import type { Persona, Scenario, TerminationReason } from "../types.ts";
import { evalineTurns, PERSONA_VOICE } from "./evaline.ts";

export type { TerminationReason };
// PERSONA_VOICE's single source of truth lives in the lower module (evaline.ts); re-export it
// so the public API (src/index.ts) and callers keep importing it from here unchanged (L2).
export { PERSONA_VOICE };

/** One completed exchange, as seen by the caller (agent = the agent's own text reply). */
export interface CallerExchange {
  caller: string; // what the caller INTENDED to say
  agent: string; // the agent's text reply
  heardAs?: string; // what the agent's STT actually heard the caller say (may differ — a mishearing)
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

/** A turn-taking policy the adapter drives. Returns null to hang up. The reason for the
 *  hangup is recorded on `terminationReason` (set when next() returns null) so the adapter
 *  can thread it onto the Trace — a non-goal_met end must not read as a satisfied caller. */
export interface Caller {
  label: string;
  terminationReason?: TerminationReason;
  next(ctx: CallerContext): Promise<CallerAction | null>;
}

/** Deterministic caller: replays scenario turns in order. The back-compat default. */
export class ScriptedCaller implements Caller {
  label = "scripted";
  terminationReason?: TerminationReason;
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
    const action = this.#actions[ctx.turnIndex] ?? null;
    if (!action) this.terminationReason = "script_exhausted"; // the tape ran out — the normal scripted end
    return action;
  }
}

/** A pluggable brain: decide the next caller move from goal + the agent's last reply. */
export interface PlanInput {
  goal: string;
  persona: Persona;
  history: CallerExchange[];
  lastAgent: string;
  turnIndex: number;
  /** True on the final allowed turn (the turn budget is up): the brain is asked to wrap up and
   *  note anything still unfinished, rather than be cut off silently (H4). */
  final?: boolean;
}
export interface PlanDecision {
  /** say = speak the utterance; hangup = the goal is met, end the call; error = the brain could
   *  not decide (infra failure / empty plan) — distinct from hangup so an Evaline-side blip is
   *  NOT mistaken for a satisfied caller (M4). Only the planner wrapper emits "error". */
  action: "say" | "hangup" | "error";
  utterance: string;
  /** Optional barge-in (L4): on a "say", after `utterance`, once the agent starts replying the
   *  caller cuts in with `interrupt.text` after `interrupt.afterMs` ms — the goal-driven brain's
   *  way to test interruption handling. Threaded onto CallerAction.interrupt (the same adapter
   *  path the scripted declarative barge-in already drives). */
  interrupt?: { text: string; afterMs: number };
}
export type PlanFn = (input: PlanInput) => Promise<PlanDecision>;

// Short acknowledgements a caller repeats naturally — exempt from the looping guard.
const CALLER_ACKS = new Set(["yes", "no", "yeah", "yep", "nope", "correct", "right", "okay", "ok", "sure", "thanks", "thank you", "got it", "please", "uh huh", "mm hmm", "exactly", "perfect"]);

// A neutral re-prompt the caller falls back to when its brain hiccups (timeout / empty plan),
// so one infra blip becomes a natural "could you repeat that?" rather than a silent hangup.
const HOLDING_LINE = "Sorry, I didn't catch that — could you say that again?";

/** Reactive caller: adapts each line to what the agent actually said, ends on goal.
 *  Every end sets `terminationReason` so a forced/aborted call can't read as goal_met. */
export class GoalDrivenCaller implements Caller {
  label = "goal-driven";
  terminationReason?: TerminationReason;
  #goal: string;
  #persona: Persona;
  #voice: string;
  #plan: PlanFn;
  #maxTurns: number;
  #said = new Map<string, number>();
  #failures = 0; // consecutive planner errors / empty plans (M4)
  constructor(opts: { goal: string; persona: Persona; plan: PlanFn; maxTurns?: number }) {
    this.#goal = opts.goal;
    this.#persona = opts.persona;
    this.#voice = PERSONA_VOICE[opts.persona];
    this.#plan = opts.plan;
    this.#maxTurns = opts.maxTurns ?? 8;
  }
  async next(ctx: CallerContext): Promise<CallerAction | null> {
    // Turn budget: turns 0..maxTurns-1 are normal; turn `maxTurns` is ONE wrap-up turn (the brain
    // is told to close out and note what's unfinished — H4); beyond that the call ends, tagged.
    if (ctx.turnIndex > this.#maxTurns) { this.terminationReason = "turn_cap"; return null; }
    const final = ctx.turnIndex >= this.#maxTurns;

    let d: PlanDecision;
    try {
      d = await this.#plan({ goal: this.#goal, persona: this.#persona, history: ctx.history, lastAgent: ctx.lastAgent, turnIndex: ctx.turnIndex, final });
    } catch {
      d = { action: "error", utterance: "" }; // a thrown PlanFn is an infra failure, not a goal-met end
    }

    // Planner failure or an empty/no-op plan (M4): an Evaline-side blip must not read as a
    // satisfied caller. Offer a neutral holding line; end (tagged planner_error) only if it
    // persists, so one transient hiccup is a re-ask, not a manufactured clean completion.
    if (d.action === "error" || (d.action === "say" && !d.utterance.trim())) {
      if (++this.#failures >= 2) { this.terminationReason = "planner_error"; return null; }
      return { text: HOLDING_LINE, voice: this.#voice };
    }
    this.#failures = 0;

    if (d.action === "hangup") { this.terminationReason = "goal_met"; return null; }

    // Repetition guard: a caller that re-says the EXACT same substantive line several times
    // is looping (a flaky brain) — but re-asking ONCE after the agent stalls or mishears is
    // normal human behavior, so allow up to 2 repeats and only end on the 3rd. Short acks
    // ("yes", "thanks", "correct") are never counted — a caller says them freely.
    const norm = d.utterance.trim().toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ");
    if (!CALLER_ACKS.has(norm)) {
      const n = (this.#said.get(norm) ?? 0) + 1;
      this.#said.set(norm, n);
      if (n >= 3) { this.terminationReason = "repeat_guard"; return null; }
    }
    // L4: a well-formed interrupt threads onto the CallerAction so the adapter barges in.
    const interrupt = d.interrupt && typeof d.interrupt.text === "string" && d.interrupt.text.trim() && typeof d.interrupt.afterMs === "number"
      ? { text: d.interrupt.text.trim(), afterMs: d.interrupt.afterMs }
      : undefined;
    return { text: d.utterance.trim(), voice: this.#voice, ...(interrupt ? { interrupt } : {}) };
  }
}

// Regression-from-production — close the coSTAR loop. coSTAR grows its suite by turning every
// discovered/production failure into a new eval; this is that, for voice. The improvised
// conversation that surfaced a bug (a goal-driven or adversarial caller, or a real failed call)
// is FROZEN into a deterministic, scripted scenario carrying the SAME invariants — so it
// reproduces the failure now and guards against it forever once the agent is fixed.

import type { Scenario, Trace } from "../types.ts";

const INTERRUPT_MARKER = "⟨interrupts⟩"; // a barge-in turn's callerSaid (see adapters/deepgram-va.ts)

/** Freeze a (failing) Trace + its source scenario into a scripted reproducing regression.
 *  The caller's actual spoken lines become scripted `turns` (deterministic replay — no live
 *  brain), the open-ended `goal` is dropped, and the source's invariants are carried forward
 *  unchanged. Idempotent on the name (won't double-suffix). Throws if the trace has no usable
 *  caller turns — a turn-less regression would pass invariants vacuously (a green that proves
 *  nothing), which we never want to mint. */
export function promoteTrace(trace: Trace, source: Scenario): Scenario {
  const turns = trace.turns
    // Drop the barge-in marker so a scripted turn stays a sane single utterance, not nonsense.
    .map((t) => (t.callerSaid ?? "").split(INTERRUPT_MARKER)[0].trim())
    .filter((s): s is string => !!s);
  if (!turns.length) throw new Error("cannot promote a trace with no usable caller turns");
  return {
    name: source.name.endsWith("-regression") ? source.name : `${source.name}-regression`,
    persona: source.persona, // vestigial on a scripted regression (it only styles improvised lines)
    turns, // scripted: the exact lines that surfaced the failure, replayable without the live brain
    assert: source.assert, // the same invariants the failing call violated
  };
}

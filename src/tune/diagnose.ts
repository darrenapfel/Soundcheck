// Trace-driven root-cause for the Refine loop. coSTAR: "the root cause is buried several
// steps back in the agent's execution." Each failing gate's detail is EVIDENCE derived from
// the recorded Trace (the spoken text, the tool args, the tool-call order), paired with a
// remediation hint. Fed to the fixer so it edits the prompt FROM EVIDENCE, not gate names.

import type { Trace, GateResult } from "../types.ts";

export interface Diagnosis {
  gate: string; // the failing gate (e.g. "grounding", "tool_sequence:verifyAccount_before_resetPassword")
  problem: string; // trace evidence — the gate's detail (the agent's actual recorded behavior)
  hint: string; // remediation derived from the failure class
}

const HINTS: Record<string, string> = {
  no_spoken_symbols: "Your replies are spoken aloud over the phone — never use Markdown (**bold**, #headings, bullets, backticks). Speak prices, dates, and IDs as natural words.",
  grounding: "Resolve relative dates (e.g. 'this Saturday') to the correct absolute calendar date using today's date, and pass dates to tools in ISO format (YYYY-MM-DD).",
  tool_args_match_schema: "Pass tool arguments in their declared format: dates as ISO YYYY-MM-DD, times as 24-hour HH:MM, and include all required fields.",
  spoken_matches_tool: "Read the exact value you sent to the tool (e.g. the booked date/time) back to the caller to confirm it.",
  tool_sequence: "Call the prerequisite tool BEFORE the dependent one (the detail names the required order).",
  forbidden_tool: "Do NOT call the forbidden tool named in the detail; handle that request a safer way.",
  required_tool: "Make sure to actually call the required tool for this request.",
  latency: "Reduce response latency — avoid unnecessary tool round-trips before replying.",
};

/** A one-line summary of the agent's actual tool-call order in the trace (cross-cutting
 *  context for ordering issues, beyond any single gate). */
export function toolSequenceSummary(trace: Trace): string {
  const seq = trace.turns.flatMap((t) => t.toolCalls.map((tc) => tc.name));
  return seq.length ? `tool-call order: ${seq.join(" → ")}` : "no tool calls";
}

const TOOL_GATES = new Set(["tool_sequence", "required_tool", "forbidden_tool", "tool_args_match_schema"]);

/** Root-cause a failing run from its Trace: each failed gate's trace evidence + a remediation.
 *  Tool-related failures also carry the agent's ACTUAL tool-call order from the trace (the
 *  "buried several steps back" context). */
export function diagnose(trace: Trace, gates: GateResult[]): Diagnosis[] {
  const seq = toolSequenceSummary(trace);
  return gates
    .filter((g) => !g.pass)
    .map((g) => {
      const klass = g.name.split(":")[0];
      return {
        gate: g.name,
        problem: TOOL_GATES.has(klass) ? `${g.detail} — ${seq}` : g.detail,
        hint: HINTS[klass] ?? "Review the agent's recorded behavior for this assertion.",
      };
    });
}

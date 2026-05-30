// Demo fixer for `soundcheck tune --fixer "node examples/tune-demo/fixer-demo.mjs"`.
//
// A FIXER reads {"prompt","diagnosis"} JSON on stdin and writes an IMPROVED system prompt to
// stdout. `diagnosis` is Soundcheck's TRACE-DRIVEN root-cause: a list of {gate, problem, hint}
// where `problem` is evidence from the recorded Trace and `hint` is the remediation. This demo
// is RULE-BASED (deterministic) so the tuning LOOP can be demonstrated live without an external
// coding-agent CLI: it appends the diagnosis's remediation hints to the prompt. The intelligent
// drop-in is a coding agent, e.g.  --fixer "claude -p 'Improve this voice-agent system prompt to
// fix the diagnosed failures.'" — which can reason over the per-failure evidence, not just hints.

import { readFileSync } from "node:fs";
import process from "node:process";

const { prompt = "", diagnosis = [] } = JSON.parse(readFileSync(0, "utf8"));

// Apply a remediation per diagnosed failure. For grounding we READ THE EVIDENCE from the
// trace-derived `problem` (it contains "now YYYY-MM-DD") and inject the ACTUAL date — this is
// the point of trace-driven Refine: fix from evidence, not a generic hint.
const fixes = [];
for (const d of diagnosis) {
  if (d.gate.startsWith("grounding")) {
    const now = d.problem.match(/now (\d{4}-\d{2}-\d{2})/)?.[1];
    fixes.push(now
      ? `TODAY'S DATE is ${now}. Resolve any relative date the caller mentions (e.g. "this Saturday") to the correct absolute calendar date and pass it to tools in ISO format (YYYY-MM-DD).`
      : d.hint);
  } else {
    fixes.push(d.hint);
  }
}
const unique = [...new Set(fixes.filter(Boolean))];
process.stdout.write(unique.length ? `${prompt}\n\n${unique.map((h) => `- ${h}`).join("\n")}` : prompt);

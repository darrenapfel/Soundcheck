// Demo fixer for `soundcheck tune --fixer "node examples/tune-demo/fixer-demo.mjs"`.
//
// A FIXER reads {"prompt","failures"} JSON on stdin and writes an IMPROVED system
// prompt to stdout. This one is RULE-BASED (deterministic) so the tuning LOOP can be
// demonstrated live without depending on an external coding-agent CLI: it appends the
// remediations implied by the failing gates. The intelligent drop-in is a coding agent,
// e.g.  --fixer "claude -p 'Improve this voice-agent system prompt to fix the failures.'"
// (the spike's Stage-2 fork already proved an agent fixes a voice agent to green).

import { readFileSync } from "node:fs";
import process from "node:process";

const { prompt = "", failures = [] } = JSON.parse(readFileSync(0, "utf8"));
const f = failures.join(" ");
const additions = [];

if (/grounding|tool_args_match_schema|spoken_matches_tool/.test(f)) {
  additions.push("TODAY'S DATE is Thursday, May 28th, 2026. Resolve any relative date the caller mentions (e.g. 'this Saturday') to the correct actual calendar date.");
  additions.push("TOOL ARGUMENTS: always pass dates to tools in ISO format (YYYY-MM-DD) and times in 24-hour format (HH:MM).");
}
if (/no_spoken_symbols|spoken_matches_tool/.test(f)) {
  additions.push("SPEECH FORMATTING: your replies are spoken aloud. Never use Markdown (no **bold**, #headings, bullet lists, or backticks). Speak prices, times, and dates as natural words. Plain spoken sentences only.");
}

process.stdout.write(additions.length ? `${prompt}\n\n${additions.join("\n")}` : prompt);

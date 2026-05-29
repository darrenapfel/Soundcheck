// Deterministic gates — the "Playwright assertions" for voice. Pure code, pass/fail.
// These are the regression suite; they block CI. (The LLM judge is v1.)

import { detectArtifacts, detectDashAsNegative } from "../normalize.ts";
import type { AssertSpec, GateResult, Scenario, Transcript } from "../types.ts";

function bookingDates(t: Transcript): { tool: string; date: string }[] {
  const out: { tool: string; date: string }[] = [];
  for (const turn of t.turns) {
    for (const tc of turn.toolCalls) {
      const a = tc.args as Record<string, any>;
      if (a?.date) out.push({ tool: tc.name, date: String(a.date) });
      if (a?.changes?.date) out.push({ tool: tc.name, date: String(a.changes.date) });
    }
  }
  return out;
}

// --- individual gates ---

function noSpokenSymbols(t: Transcript): GateResult {
  const fails: string[] = [];
  for (const turn of t.turns) {
    const heard = turn.agentSpokenHeardBack || "";
    const arts = detectArtifacts(heard);
    const dash = detectDashAsNegative(heard);
    if (arts.length || dash) {
      fails.push(`turn ${turn.turn}: ${[...arts, dash ? "negative-$ (dash read as minus)" : ""].filter(Boolean).join(", ")}`);
    }
  }
  return { name: "no_spoken_symbols", pass: fails.length === 0, detail: fails.join(" | ") || "clean across all turns" };
}

function toolArgIso(t: Transcript, tool?: string): GateResult {
  const dates = bookingDates(t).filter((d) => !tool || d.tool === tool);
  const name = tool ? `tool_arg_iso:${tool}` : "tool_arg_iso";
  if (!dates.length) return { name, pass: false, detail: "no booking date found in any tool call" };
  const bad = dates.filter((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d.date));
  return { name, pass: bad.length === 0, detail: bad.length ? bad.map((d) => `${d.tool}="${d.date}" (not ISO)`).join("; ") : `all ISO (${dates.map((d) => d.date).join(", ")})` };
}

function grounding(t: Transcript, scenario: Scenario, tool?: string): GateResult {
  const name = "grounding";
  if (!scenario.grounding) return { name, pass: false, detail: "scenario has no grounding params (today/expectedDate)" };
  const { expectedDate, today } = scenario.grounding;
  const currentYear = Number(today.slice(0, 4));
  const dates = bookingDates(t).filter((d) => !tool || d.tool === tool);
  if (!dates.length) return { name, pass: false, detail: "no booking date found" };
  const problems: string[] = [];
  for (const d of dates) {
    const m = /^(\d{4})-\d{2}-\d{2}$/.exec(d.date);
    if (!m) { problems.push(`${d.tool}="${d.date}" not a resolvable date`); continue; }
    if (Number(m[1]) < currentYear) problems.push(`${d.tool}="${d.date}" stale year`);
    if (d.date !== expectedDate) problems.push(`${d.tool}="${d.date}" != expected ${expectedDate}`);
  }
  return { name, pass: problems.length === 0, detail: problems.join("; ") || `correct (${expectedDate})` };
}

function requiredTool(t: Transcript, tool: string): GateResult {
  const called = t.turns.some((turn) => turn.toolCalls.some((tc) => tc.name === tool));
  return { name: `required_tool:${tool}`, pass: called, detail: called ? "called" : `never called` };
}

function latency(t: Transcript, spec: { ttfb_ms?: { max: number }; turn_ms?: { max: number } }): GateResult {
  const problems: string[] = [];
  for (const turn of t.turns) {
    if (spec.ttfb_ms && turn.ttfbMs != null && turn.ttfbMs > spec.ttfb_ms.max) problems.push(`turn ${turn.turn} TTFB ${turn.ttfbMs}ms > ${spec.ttfb_ms.max}`);
    if (spec.turn_ms && turn.turnMs != null && turn.turnMs > spec.turn_ms.max) problems.push(`turn ${turn.turn} turn ${turn.turnMs}ms > ${spec.turn_ms.max}`);
  }
  const ttfbs = t.turns.map((x) => x.ttfbMs).filter((x): x is number => x != null);
  const avg = ttfbs.length ? Math.round(ttfbs.reduce((a, b) => a + b, 0) / ttfbs.length) : null;
  return { name: "latency", pass: problems.length === 0, detail: problems.join("; ") || `ok (avg TTFB ${avg ?? "n/a"}ms)` };
}

function valueConsistency(t: Transcript, spec: { spoken: "date"; equalsTool: string }): GateResult {
  const name = "value_consistency";
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const d = bookingDates(t).find((x) => x.tool === spec.equalsTool);
  if (!d) return { name, pass: false, detail: `no ${spec.equalsTool} date to check` };
  const m = /^\d{4}-(\d{2})-\d{2}$/.exec(d.date);
  if (!m) return { name, pass: false, detail: `tool date not ISO ("${d.date}") — cannot verify spoken-vs-booked consistency (also caught by tool_arg_iso)` };
  const monthWord = months[Number(m[1]) - 1];
  if (!monthWord) return { name, pass: false, detail: `tool date has out-of-range month ("${d.date}") — cannot verify spoken-vs-booked consistency (also caught by tool_arg_iso)` };
  const spokeMonth = t.turns.some((turn) => (turn.agentSpokenHeardBack || "").toLowerCase().includes(monthWord));
  return { name, pass: spokeMonth, detail: spokeMonth ? `spoken date references "${monthWord}" matching booked ${d.date}` : `booked ${d.date} but "${monthWord}" never spoken` };
}

// --- dispatcher ---

export function runGates(t: Transcript, scenario: Scenario): GateResult[] {
  return scenario.assert.map((spec) => evalAssert(spec, t, scenario));
}

function evalAssert(spec: AssertSpec, t: Transcript, scenario: Scenario): GateResult {
  if (typeof spec === "string") {
    if (spec === "no_spoken_symbols") return noSpokenSymbols(t);
    if (spec === "tool_arg_iso") return toolArgIso(t);
    if (spec === "grounding") return grounding(t, scenario);
    return { name: spec, pass: false, detail: "unknown assertion" };
  }
  if ("required_tool" in spec) return requiredTool(t, spec.required_tool);
  if ("tool_arg_iso" in spec) return toolArgIso(t, spec.tool_arg_iso);
  if ("grounding" in spec) return grounding(t, scenario, spec.grounding.tool);
  if ("latency" in spec) return latency(t, spec.latency);
  if ("value_consistency" in spec) return valueConsistency(t, spec.value_consistency);
  return { name: JSON.stringify(spec), pass: false, detail: "unknown assertion" };
}

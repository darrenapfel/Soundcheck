// Deterministic gates — the "Playwright assertions" for voice. Pure code, pass/fail.
// These are the regression suite; they block CI. (The LLM judge is advisory.)
//
// Architecture: a composable REGISTRY. Each gate is a pure `GateFn(spec, ctx) => GateResult`
// registered under its assert key. Adding a gate = add a function + one registry entry; no
// switch to edit. Gates are domain-agnostic — a scenario DECLARES its invariants and the
// registry enforces them, so the same gates test a restaurant agent, a support bot, or an
// IVR. (See README — Assess.)

import { detectArtifacts, detectDashAsNegative, numberToWords, spokenTime, MONTHS } from "../normalize.ts";
import type { AssertSpec, GateResult, Scenario, ToolCall, ToolSchema, Trace } from "../types.ts";

/** Everything a gate may need: the captured conversation, the scenario, and the AUT's
 *  declared tool schemas (for schema-conformance gates). */
export interface GateContext {
  transcript: Trace;
  scenario: Scenario;
  tools: ToolSchema[];
}
export type GateFn = (spec: unknown, ctx: GateContext) => GateResult;

// ---- shared helpers ----

function allToolCalls(t: Trace): ToolCall[] {
  return t.turns.flatMap((turn) => turn.toolCalls);
}
/** Values an agent sent for `field` of `tool` (top-level or nested under `changes`). */
function toolArgValues(t: Trace, tool: string | undefined, field: string): { tool: string; value: unknown }[] {
  const out: { tool: string; value: unknown }[] = [];
  for (const tc of allToolCalls(t)) {
    if (tool && tc.name !== tool) continue;
    const a = tc.args as Record<string, unknown>;
    const changes = a.changes as Record<string, unknown> | undefined;
    if (a[field] !== undefined) out.push({ tool: tc.name, value: a[field] });
    if (changes?.[field] !== undefined) out.push({ tool: tc.name, value: changes[field] });
  }
  return out;
}
const heardText = (t: Trace) => t.turns.map((turn) => (turn.agentSpokenHeardBack || "").toLowerCase()).join(" ");

const ORDINALS = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth", "twentieth"];
/** Spoken ordinal for a day-of-month 1..31: "first", "twenty eighth", "thirtieth". */
function ordinalDay(n: number): string {
  if (n >= 1 && n <= 20) return ORDINALS[n];
  if (n < 30) return `twenty ${ORDINALS[n - 20]}`;
  if (n === 30) return "thirtieth";
  return `thirty ${ORDINALS[n - 30]}`;
}
/** Whole-word-ish containment, so "may" (modal) / "four" (in "fourteen") don't false-match. */
function containsWord(heard: string, phrase: string): boolean {
  if (!phrase) return false;
  const esc = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\W)${esc}(?:\\W|$)`).test(heard);
}
/** Did the agent SPEAK `val` in a natural form? Dates need BOTH month AND day (so "may"
 *  the modal can't false-match); times need every spoken-time word; numbers/strings are
 *  whole-word matched. Returns the form looked for, for the failure detail. */
function spokenMatch(val: unknown, heard: string): { ok: boolean; tried: string } {
  const s = String(val);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const month = MONTHS[Number(s.slice(5, 7)) - 1]?.toLowerCase() ?? "";
    const day = ordinalDay(Number(s.slice(8, 10)));
    return { ok: !!month && containsWord(heard, month) && containsWord(heard, day), tried: `${month} ${day}` };
  }
  if (/^\d{1,2}:\d{2}$/.test(s)) {
    const words = spokenTime(s).toLowerCase().split(" ").filter((w) => w && !["am", "pm", "oh"].includes(w));
    return { ok: words.length > 0 && words.every((w) => containsWord(heard, w)), tried: spokenTime(s) };
  }
  if (typeof val === "number" || /^-?\d+$/.test(s)) {
    const w = numberToWords(Number(s));
    return { ok: w.split(/[\s-]+/).every((p) => containsWord(heard, p)), tried: w };
  }
  return { ok: containsWord(heard, s.toLowerCase()), tried: s.toLowerCase() };
}

/** Minimal JSON-Schema arg validator (type / required / format date|time / enum / pattern). */
function validateArgs(args: Record<string, unknown>, schema: Record<string, unknown>): string[] {
  const errs: string[] = [];
  const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : []; // tolerate a malformed schema
  for (const r of required) if (args[r] === undefined) errs.push(`missing required "${r}"`);
  for (const [k, v] of Object.entries(args)) {
    const p = props[k];
    if (!p) continue; // unknown property — lenient
    const type = p.type as string | undefined;
    if (type && !typeOk(v, type)) { errs.push(`"${k}" expected ${type}, got ${Array.isArray(v) ? "array" : typeof v}`); continue; }
    if (Array.isArray(p.enum) && !p.enum.includes(v)) errs.push(`"${k}"=${JSON.stringify(v)} not in enum`);
    if (p.format === "date" && !(typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v))) errs.push(`"${k}"=${JSON.stringify(v)} not an ISO date (YYYY-MM-DD)`);
    if (p.format === "time" && !(typeof v === "string" && /^\d{1,2}:\d{2}$/.test(v))) errs.push(`"${k}"=${JSON.stringify(v)} not a HH:MM time`);
    if (typeof p.pattern === "string" && typeof v === "string") {
      try { if (!new RegExp(p.pattern).test(v)) errs.push(`"${k}"="${v}" !~ /${p.pattern}/`); } catch { /* bad pattern in schema — ignore */ }
    }
  }
  return errs;
}
function typeOk(v: unknown, type: string): boolean {
  switch (type) {
    case "integer": return typeof v === "number" && Number.isInteger(v);
    case "number": return typeof v === "number";
    case "string": return typeof v === "string";
    case "boolean": return typeof v === "boolean";
    case "object": return typeof v === "object" && v !== null && !Array.isArray(v);
    case "array": return Array.isArray(v);
    default: return true;
  }
}

// ---- gates ----

const gNoSpokenSymbols: GateFn = (_spec, { transcript }) => {
  const fails: string[] = [];
  for (const turn of transcript.turns) {
    const heard = turn.agentSpokenHeardBack || "";
    const arts = detectArtifacts(heard);
    const dash = detectDashAsNegative(heard);
    if (arts.length || dash) fails.push(`turn ${turn.turn}: ${[...arts, dash ? "negative-$ (dash read as minus)" : ""].filter(Boolean).join(", ")}`);
  }
  return { name: "no_spoken_symbols", pass: fails.length === 0, detail: fails.join(" | ") || "clean across all turns" };
};

const gRequiredTool: GateFn = (spec, { transcript }) => {
  const tool = String(spec);
  const called = allToolCalls(transcript).some((tc) => tc.name === tool);
  return { name: `required_tool:${tool}`, pass: called, detail: called ? "called" : "never called" };
};

const gForbiddenTool: GateFn = (spec, { transcript }) => {
  const tool = String(spec);
  const called = allToolCalls(transcript).some((tc) => tc.name === tool);
  return { name: `forbidden_tool:${tool}`, pass: !called, detail: called ? `"${tool}" was called (forbidden)` : `"${tool}" not called` };
};

const gToolSequence: GateFn = (spec, { transcript }) => {
  const [a, rel, b] = spec as [string, string, string];
  const name = `tool_sequence:${a}_before_${b}`;
  if (rel !== "before") return { name, pass: false, detail: `unsupported relation "${rel}" (use "before")` };
  const seq = allToolCalls(transcript).map((tc) => tc.name);
  const firstB = seq.indexOf(b);
  if (firstB === -1) return { name, pass: true, detail: `"${b}" never called — no ordering to violate` };
  const ok = seq.slice(0, firstB).includes(a);
  return { name, pass: ok, detail: ok ? `"${a}" called before "${b}"` : `"${b}" called before any "${a}"` };
};

const gToolArgsMatchSchema: GateFn = (spec, { transcript, tools }) => {
  const tool = String(spec);
  const name = `tool_args_match_schema:${tool}`;
  const schema = tools.find((t) => t.name === tool)?.parameters as Record<string, unknown> | undefined;
  if (!schema) return { name, pass: false, detail: `no schema for tool "${tool}" in the AUT's declared tools` };
  const calls = allToolCalls(transcript).filter((tc) => tc.name === tool);
  if (!calls.length) return { name, pass: false, detail: `"${tool}" never called` };
  const errs = calls.flatMap((c) => validateArgs(c.args, schema));
  return { name, pass: errs.length === 0, detail: errs.length ? errs.join("; ") : `all ${calls.length} call(s) conform to schema` };
};

const gSpokenMatchesTool: GateFn = (spec, { transcript }) => {
  const { tool, field } = spec as { tool: string; field: string };
  const name = `spoken_matches_tool:${tool}.${field}`;
  const vals = toolArgValues(transcript, tool, field);
  if (!vals.length) return { name, pass: false, detail: `no ${tool}.${field} value in any tool call` };
  const heard = heardText(transcript);
  // EVERY value the agent sent for this field must be spoken (a "moved it but didn't say so"
  // bug should fail), matching grounding's all-values semantics.
  const misses = vals.map((v) => ({ v: v.value, r: spokenMatch(v.value, heard) })).filter((x) => !x.r.ok);
  if (misses.length) return { name, pass: false, detail: misses.map((x) => `${tool}.${field}=${JSON.stringify(x.v)} not spoken (looked for "${x.r.tried}")`).join("; ") };
  return { name, pass: true, detail: `spoken transcript references all ${vals.length} ${tool}.${field} value(s)` };
};

const gGrounding: GateFn = (spec, { transcript }) => {
  const name = "grounding";
  const s = (spec ?? {}) as { tool?: string; field?: string; now?: string; expected?: string };
  const field = s.field ?? "date";
  if (!s.now || !s.expected) return { name, pass: false, detail: "grounding needs { now, expected } (with optional tool, field)" };
  const currentYear = Number(s.now.slice(0, 4));
  const vals = toolArgValues(transcript, s.tool, field);
  if (!vals.length) return { name, pass: false, detail: `no ${s.tool ?? "tool"}.${field} value found` };
  const problems: string[] = [];
  for (const v of vals) {
    const d = String(v.value);
    const m = /^(\d{4})-\d{2}-\d{2}$/.exec(d);
    if (!m) { problems.push(`${v.tool}.${field}="${d}" not a resolvable date`); continue; }
    if (Number(m[1]) < currentYear) problems.push(`${v.tool}.${field}="${d}" stale year (now ${s.now})`);
    if (d !== s.expected) problems.push(`${v.tool}.${field}="${d}" != expected ${s.expected}`);
  }
  return { name, pass: problems.length === 0, detail: problems.join("; ") || `correct (${s.expected})` };
};

const gLatency: GateFn = (spec, { transcript }) => {
  const s = spec as { ttfb_ms?: { max: number }; turn_ms?: { max: number } };
  const problems: string[] = [];
  for (const turn of transcript.turns) {
    if (s.ttfb_ms && turn.ttfbMs != null && turn.ttfbMs > s.ttfb_ms.max) problems.push(`turn ${turn.turn} TTFB ${turn.ttfbMs}ms > ${s.ttfb_ms.max}`);
    if (s.turn_ms && turn.turnMs != null && turn.turnMs > s.turn_ms.max) problems.push(`turn ${turn.turn} turn ${turn.turnMs}ms > ${s.turn_ms.max}`);
  }
  const ttfbs = transcript.turns.map((x) => x.ttfbMs).filter((x): x is number => x != null);
  const avg = ttfbs.length ? Math.round(ttfbs.reduce((a, b) => a + b, 0) / ttfbs.length) : null;
  return { name: "latency", pass: problems.length === 0, detail: problems.join("; ") || `ok (avg TTFB ${avg ?? "n/a"}ms)` };
};

// ---- registry ----

const REGISTRY: Record<string, GateFn> = {
  no_spoken_symbols: gNoSpokenSymbols,
  required_tool: gRequiredTool,
  forbidden_tool: gForbiddenTool,
  tool_sequence: gToolSequence,
  tool_args_match_schema: gToolArgsMatchSchema,
  spoken_matches_tool: gSpokenMatchesTool,
  grounding: gGrounding,
  latency: gLatency,
};

export const GATE_NAMES = Object.keys(REGISTRY);

function splitSpec(spec: AssertSpec): { key: string; value: unknown } {
  if (typeof spec === "string") return { key: spec, value: undefined };
  const key = Object.keys(spec)[0];
  return { key, value: (spec as Record<string, unknown>)[key] };
}

export function runGates(t: Trace, scenario: Scenario, tools: ToolSchema[] = []): GateResult[] {
  const ctx: GateContext = { transcript: t, scenario, tools };
  return scenario.assert.map((spec) => {
    const { key, value } = splitSpec(spec);
    const gate = REGISTRY[key];
    if (!gate) return { name: key, pass: false, detail: `unknown gate "${key}"` };
    try { return gate(value, ctx); } // a gate must fail CLOSED, never crash the run
    catch (e) { return { name: key, pass: false, detail: `gate crashed: ${(e as Error)?.message ?? String(e)}` }; }
  });
}

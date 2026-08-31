// Deterministic gates — the "Playwright assertions" for voice. Pure code, pass/fail.
// These are the regression suite; they block CI. (The LLM judge is advisory.)
//
// Architecture: a composable REGISTRY. Each gate is a pure `GateFn(spec, ctx) => GateResult`
// registered under its assert key. Adding a gate = add a function + one registry entry; no
// switch to edit. Gates are domain-agnostic — a scenario DECLARES its invariants and the
// registry enforces them, so the same gates test a restaurant agent, a support bot, or an
// IVR. (See README — Assess.)

import { detectArtifacts, detectDashAsNegative, numberToWords, spokenTime, MONTHS } from "../normalize.ts";
import { compare, summarize } from "../compare/index.ts";
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
  // Alphanumeric identifier (flight no. "SM218", confirmation code): STT routinely mangles spoken
  // LETTERS ("M"→"n"), so verify the DIGIT RUNS were read back intelligibly — digit-by-digit,
  // grouped ("two eighteen"), or cardinal. This catches a dropped/garbled number ("SM218" heard as
  // just "two") without false-failing on letter mis-recognition.
  if (/[a-z]/i.test(s) && /\d/.test(s)) {
    const runs = s.match(/\d+/g) ?? [];
    const forms = runs.map((r) => spokenDigitRunForms(r));
    const ok = forms.length > 0 && forms.every((fs) => fs.some((f) => containsWord(heard, f)));
    return { ok, tried: forms.map((fs) => fs[0]).join(" + ") };
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

// Identifier-class fields: SSN, ZIP, account, confirmation, PIN, card, phone, member, policy,
// claim, routing, tracking, reference, or any *Code/*Number. A human reads these DIGIT-BY-DIGIT
// ("four four one seven"), never as a cardinal ("four thousand four hundred seventeen").
const ID_FIELD = /ssn|zip|account|acct|confirm|pin|card|phone|member|policy|claim|routing|tracking|reference|code|number/i;

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
function under1000(n: number): string {
  const out: string[] = [];
  if (n >= 100) { out.push(ONES[Math.floor(n / 100)], "hundred"); n %= 100; }
  if (n >= 20) { out.push(TENS[Math.floor(n / 10)]); if (n % 10) out.push(ONES[n % 10]); }
  else if (n > 0) out.push(ONES[n]);
  return out.join(" ");
}
/** Spoken CARDINAL form of a whole number ("four thousand four hundred seventeen"). */
function cardinalWords(n: number): string {
  if (n === 0) return "zero";
  const out: string[] = [];
  if (n >= 1000) { out.push(under1000(Math.floor(n / 1000)), "thousand"); n %= 1000; }
  if (n > 0) out.push(under1000(n));
  return out.join(" ");
}
/** Spoken forms of a digit run, for read-back matching: "218" → ["two one eight" (digit-by-digit),
 *  "two hundred eighteen" (cardinal), "two eighteen" (grouped — how flight/room numbers are read)]. */
function spokenDigitRunForms(run: string): string[] {
  const forms = new Set<string>();
  const norm = (w: string) => w.replace(/-/g, " ");
  const pair = (xy: string) => (xy[0] === "0" ? `oh ${ONES[Number(xy[1])]}` : norm(cardinalWords(Number(xy))));
  forms.add([...run].map((c) => ONES[Number(c)]).join(" "));            // digit-by-digit: "two one eight"
  if (!run.startsWith("0")) forms.add(norm(cardinalWords(Number(run)))); // cardinal: "two hundred eighteen"
  if (run.length === 1) forms.add(ONES[Number(run)]);
  if (run.length === 2) forms.add(pair(run));                            // "eighteen"
  if (run.length === 3) forms.add(`${ONES[Number(run[0])]} ${pair(run.slice(1))}`); // "two eighteen"
  if (run.length === 4) forms.add(`${pair(run.slice(0, 2))} ${pair(run.slice(2))}`); // "twelve thirty four"
  return [...forms].filter(Boolean);
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** Day-of-week (0=Sunday..6=Saturday) for a Gregorian date — Sakamoto's algorithm, clock-free. */
function weekdayOf(y: number, m: number, d: number): number {
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const yy = m < 3 ? y - 1 : y;
  return (((yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) + t[m - 1] + d) % 7) + 7) % 7;
}
// Reverse of ordinalDay(): spoken ordinal phrase → day-of-month. "fourth"→4, "twenty second"→22.
const ORDINAL_TO_DAY: Record<string, number> = {};
for (let dd = 1; dd <= 31; dd++) ORDINAL_TO_DAY[ordinalDay(dd)] = dd;
const ORDINAL_PHRASES = Object.keys(ORDINAL_TO_DAY).sort((a, b) => b.length - a.length); // longest-first: "twenty second" before "second"
interface SpokenDate { month: number; day: number; weekday: string | null; pos: number; }
/** Dates the agent SPOKE, in order: "[weekday,] <month> <ordinal|number>" → {month 1-12, day, weekday?}. */
function extractSpokenDates(heard: string): SpokenDate[] {
  const monthAlt = MONTHS.map((m) => m.toLowerCase()).join("|");
  const re = new RegExp(`(?:(${WEEKDAYS.join("|")})\\s*,?\\s+)?(${monthAlt})\\s+(${ORDINAL_PHRASES.join("|")}|\\d{1,2})(?:st|nd|rd|th)?`, "g");
  const out: SpokenDate[] = [];
  for (const m of heard.toLowerCase().matchAll(re)) {
    const month = MONTHS.findIndex((mm) => mm.toLowerCase() === m[2]) + 1;
    const day = ORDINAL_TO_DAY[m[3]] ?? Number(m[3]);
    if (month >= 1 && day >= 1 && day <= 31) out.push({ month, day, weekday: m[1] ?? null, pos: m.index ?? 0 });
  }
  return out;
}
/** Identifier digit-runs (≥4 digits) the agent handled, from any ID-class tool arg/result. */
function identifierDigitRuns(t: Trace): { field: string; value: string; digits: string }[] {
  const out: { field: string; value: string; digits: string }[] = [];
  const scan = (obj: unknown) => {
    if (!obj || typeof obj !== "object") return;
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (v && typeof v === "object") { scan(v); continue; }
      if (!ID_FIELD.test(k)) continue;
      const s = String(v);
      for (const run of s.match(/\d{4,}/g) ?? []) out.push({ field: k, value: s, digits: run });
    }
  };
  for (const tc of allToolCalls(t)) { scan(tc.args); scan(tc.result); }
  return out;
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

// Voice-safety: an identifier (SSN-4, ZIP, account/confirmation/phone number) must be spoken
// digit-by-digit, never as a cardinal number. Tool-aware: it only checks values the agent
// actually handled, and only fails if the agent SPOKE the cardinal rendering of one.
const gNoSpokenCardinalIds: GateFn = (_spec, { transcript }) => {
  const heard = heardText(transcript).replace(/\band\b/g, " ").replace(/\s+/g, " ");
  const fails: string[] = [];
  const seen = new Set<string>();
  for (const id of identifierDigitRuns(transcript)) {
    if (seen.has(id.digits)) continue;
    seen.add(id.digits);
    const cardinal = cardinalWords(Number(id.digits));
    if (cardinal.includes(" ") && containsWord(heard, cardinal)) {
      fails.push(`${id.field}=${id.value} spoken as a cardinal number ("${cardinal}") — say it digit-by-digit`);
    }
  }
  return { name: "no_spoken_cardinal_ids", pass: fails.length === 0, detail: fails.join(" | ") || "identifiers spoken digit-by-digit (or not read back)" };
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
    if (d !== s.expected) problems.push(`${v.tool}.${field}="${d}" != expected ${s.expected} (now ${s.now})`);
  }
  return { name, pass: problems.length === 0, detail: problems.join("; ") || `correct (${s.expected})` };
};

// Spoken↔tool CONSISTENCY — beyond `spoken_matches_tool`'s "was it ever said?" existence check and
// `grounding`'s tool-args-only view. Two failures both gates miss:
//   (1) the agent ENDS the call confirming a date it never sent to a tool (e.g. caves to an
//       impatient caller's wrong date while the booking stays correct), and
//   (2) a spoken "<weekday>, <month> <day>" that is internally incoherent ("Thursday, June 2nd"
//       when June 2 is a Tuesday).
// Existence is still spoken_matches_tool's job; this gate is silent (passes) when the agent spoke
// no date at all, so the two compose without double-counting.
const gSpokenConsistentWithTool: GateFn = (spec, { transcript }) => {
  const s = (spec ?? {}) as { tool?: string; field?: string; now?: string };
  const field = s.field ?? "date";
  const name = `spoken_consistent_with_tool:${s.tool ?? "tool"}.${field}`;
  if (!s.now) return { name, pass: false, detail: "needs { now } (with field, optional tool)" };
  const toolVals = toolArgValues(transcript, s.tool, field).map((v) => String(v.value)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  if (!toolVals.length) return { name, pass: true, detail: `no date-valued ${s.tool ?? "tool"}.${field} to check` };
  const toolDates = toolVals.map((ds) => ({ y: +ds.slice(0, 4), m: +ds.slice(5, 7), d: +ds.slice(8, 10) }));
  const spoken = extractSpokenDates(heardText(transcript));
  if (!spoken.length) return { name, pass: true, detail: "agent spoke no date (read-back is spoken_matches_tool's job)" };
  const nowYear = Number(s.now.slice(0, 4));
  const problems: string[] = [];
  // (1) weekday self-coherence — resolve the year from the matching tool date when possible.
  for (const sd of spoken) {
    if (!sd.weekday) continue;
    const yr = toolDates.find((td) => td.m === sd.month && td.d === sd.day)?.y ?? nowYear;
    const real = WEEKDAYS[weekdayOf(yr, sd.month, sd.day)];
    if (real !== sd.weekday) problems.push(`said "${cap(sd.weekday)}, ${MONTHS[sd.month - 1]} ${sd.day}" but ${MONTHS[sd.month - 1]} ${sd.day}, ${yr} is a ${cap(real)}`);
  }
  // (2) final-confirmation match — the LAST date the agent spoke must be one a tool actually used.
  const last = spoken.reduce((a, b) => (b.pos >= a.pos ? b : a));
  if (!toolDates.some((td) => td.m === last.month && td.d === last.day)) {
    problems.push(`final spoken date "${MONTHS[last.month - 1]} ${last.day}" matches no ${s.tool ?? "tool"}.${field} value (tool used: ${toolDates.map((td) => `${MONTHS[td.m - 1]} ${td.d}`).join(", ")})`);
  }
  return { name, pass: problems.length === 0, detail: problems.join("; ") || `final spoken date matches the booked ${s.tool ?? "tool"}.${field}; spoken weekdays coherent` };
};

// Spoken words ↔ expected TEXT — the normalization-aware round-trip comparison as a native
// gate. Compares what the oracle heard the agent say (agentSpokenHeardBack) against an
// expected sentence with compare(), so smart-formatting equivalences ("seven thirty" heard
// back as "7:30") pass while real content errors ("7:13") fail with a token-level diff.
// With `turn` (a 0-based agent turn index) that specific turn must match — an out-of-range
// index fails CLOSED. Without `turn`, the gate passes if ANY turn matches.
const gSpokenMatchesText: GateFn = (spec, { transcript }) => {
  const name = "spoken_matches_text";
  const s = (spec ?? {}) as { text?: string; turn?: number };
  if (typeof s.text !== "string" || !s.text.trim()) {
    return { name, pass: false, detail: "spoken_matches_text needs { text } (with optional 0-based turn index)" };
  }
  const turns = transcript.turns;
  if (s.turn !== undefined) {
    if (!Number.isInteger(s.turn) || s.turn < 0 || s.turn >= turns.length) {
      return { name, pass: false, detail: `turn index ${s.turn} out of range (${turns.length} captured turn(s)) — fail closed` };
    }
    const r = compare(s.text, turns[s.turn].agentSpokenHeardBack || "");
    return {
      name,
      pass: r.pass,
      detail: r.pass
        ? `turn ${s.turn} matched (${r.tier})`
        : `turn ${s.turn}: ${summarize(r)} | expected: "${r.expected}" | heard: "${r.heard}"`,
    };
  }
  if (!turns.length) return { name, pass: false, detail: "no captured turns to match against" };
  let closest = compare(s.text, turns[0].agentSpokenHeardBack || "");
  let closestTurn = 0;
  for (let i = 0; i < turns.length; i++) {
    const r = compare(s.text, turns[i].agentSpokenHeardBack || "");
    if (r.pass) return { name, pass: true, detail: `turn ${i} matched (${r.tier})` };
    if ((r.tokenErrorRate ?? 1) < (closest.tokenErrorRate ?? 1)) { closest = r; closestTurn = i; }
  }
  return {
    name,
    pass: false,
    detail: `no turn matched; closest (turn ${closestTurn}): ${summarize(closest)} | expected: "${closest.expected}" | heard: "${closest.heard}"`,
  };
};

const gLatency: GateFn = (spec, { transcript }) => {
  const s = spec as { ttfb_ms?: { max: number }; turn_ms?: { max: number } };
  const problems: string[] = [];
  // Turns with absent timing (ttfbMs/turnMs == null) are skipped, not failed — not every
  // captured turn carries a timing (e.g. a turn with no agent reply). Latency gates the turns
  // that DO have timings; absence is a capture gap, not a latency violation.
  for (const turn of transcript.turns) {
    if (s.ttfb_ms && turn.ttfbMs != null && turn.ttfbMs > s.ttfb_ms.max) problems.push(`turn ${turn.turn} TTFB ${turn.ttfbMs}ms > ${s.ttfb_ms.max}`);
    if (s.turn_ms && turn.turnMs != null && turn.turnMs > s.turn_ms.max) problems.push(`turn ${turn.turn} turn ${turn.turnMs}ms > ${s.turn_ms.max}`);
  }
  const ttfbs = transcript.turns.map((x) => x.ttfbMs).filter((x): x is number => x != null);
  const avg = ttfbs.length ? Math.round(ttfbs.reduce((a, b) => a + b, 0) / ttfbs.length) : null;
  const okDetail = avg == null ? "ok (avg TTFB n/a)" : `ok (avg TTFB ${avg}ms)`; // not "n/ams"
  return { name: "latency", pass: problems.length === 0, detail: problems.join("; ") || okDetail };
};

// ---- registry ----

const REGISTRY: Record<string, GateFn> = {
  no_spoken_symbols: gNoSpokenSymbols,
  no_spoken_cardinal_ids: gNoSpokenCardinalIds,
  required_tool: gRequiredTool,
  forbidden_tool: gForbiddenTool,
  tool_sequence: gToolSequence,
  tool_args_match_schema: gToolArgsMatchSchema,
  spoken_matches_tool: gSpokenMatchesTool,
  spoken_matches_text: gSpokenMatchesText,
  spoken_consistent_with_tool: gSpokenConsistentWithTool,
  grounding: gGrounding,
  latency: gLatency,
};

export const GATE_NAMES = Object.keys(REGISTRY);

function splitSpec(spec: AssertSpec): { key: string; value: unknown } {
  if (typeof spec === "string") return { key: spec, value: undefined };
  // Guard non-object specs (null/undefined/number from a hand-authored assert): yield a key
  // that hits no gate, so runGates fail-CLOSES it rather than crashing the whole run.
  if (spec === null || typeof spec !== "object") return { key: String(spec), value: undefined };
  const key = Object.keys(spec)[0] ?? String(spec);
  return { key, value: (spec as Record<string, unknown>)[key] };
}

export function runGates(t: Trace, scenario: Scenario, tools: ToolSchema[] = []): GateResult[] {
  const ctx: GateContext = { transcript: t, scenario, tools };
  const gates = scenario.assert.map((spec) => {
    const { key, value } = splitSpec(spec);
    const gate = REGISTRY[key];
    if (!gate) return { name: key, pass: false, detail: `unknown gate "${key}"` };
    try { return gate(value, ctx); } // a gate must fail CLOSED, never crash the run
    catch (e) { return { name: key, pass: false, detail: `gate crashed: ${(e as Error)?.message ?? String(e)}` }; }
  });
  // Caller termination integrity (Phase 1): a GOAL-DRIVEN call is a clean pass ONLY when the
  // caller ended because the GOAL was met. A forced/aborted end (turn cap, planner error,
  // repetition guard) must fail — otherwise a partial call whose gates happen to pass reads as
  // satisfied. Keyed on whether the run was goal-driven (`t.goalDriven`), NOT on whether the
  // scenario merely HAS a `goal` field — so it (a) guards a forced `--caller goal` run on a
  // scenario without a goal, and (b) does NOT false-fail a goal scenario deliberately run with
  // the scripted caller. Only enforced when the reason is KNOWN (live / re-recorded cassettes);
  // undefined (legacy cassette, or a non-goal-driven run) is left alone for back-compat.
  if (t.goalDriven && t.terminationReason) {
    const met = t.terminationReason === "goal_met";
    gates.push({
      name: "goal_reached",
      pass: met,
      detail: met ? "caller ended because the goal was met" : `call ended "${t.terminationReason}" before the goal was met`,
    });
  }
  return gates;
}

// Autonomous eval authoring — generate a scenario suite from ANY agent's spec, no human
// writing test cases, NO API key, deterministic. Domain-agnostic: scenarios are derived
// from the agent's TOOLS (one per capability) with the generic gates wired automatically
// (required_tool, schema conformance, grounding + spoken-match for date fields, voice
// safety, latency). Business rules are extracted from the prompt and SURFACED AS HINTS (an
// agent/human adds assertions for arbitrary domain rules). The generated CALLER LINES are
// mechanical (templated from tool names + heuristic fillers) — the suite is a STARTING point
// a human/agent refines (see docs/LIMITATIONS.md).

import type { AssertSpec, Scenario, ToolSchema } from "../types.ts";
import { DEFAULT_RUBRIC } from "../judge/index.ts";
import type { Rubric } from "../judge/types.ts";

export interface AgentSpec {
  name?: string;
  systemPrompt: string;
  tools: ToolSchema[];
}
export interface AuthoredSuite {
  scenarios: Scenario[];
  rubric: Rubric;
  businessRules: string[]; // extracted from the prompt; the agent should add assertions for these
}

/** "this Saturday" relative to an ISO `today` (upcoming Sat; if today is Sat, next week). */
export function nextSaturday(todayIso: string): string {
  const d = new Date(todayIso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) throw new Error(`nextSaturday: invalid date "${todayIso}" (want YYYY-MM-DD)`);
  let add = (6 - d.getUTCDay() + 7) % 7;
  if (add === 0) add = 7;
  d.setUTCDate(d.getUTCDate() + add);
  return d.toISOString().slice(0, 10);
}

/** Best-effort business-rule extraction from a system prompt (deterministic patterns). */
export function extractBusinessRules(prompt: string): string[] {
  const rules: string[] = [];
  const patterns: RegExp[] = [
    /\bclosed\b[^.\n]*\b(mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?)\b/gi,
    /\b(parties?|groups?|tables?)\b[^.\n]*\b(up to|no more than|maximum of|max)\b[^.\n]*\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/gi,
    /\bonly\b[^.\n]*\b(open|available|seat)[^.\n]*/gi,
    /\b(no|never|always)\b [^.\n]{0,50}\b(refunds?|walk-ins?|substitutions?|outside food|verify|verifyAccount|delete|reset)\b/gi,
    /\b(hours?|open)\b[^.\n]*\b\d{1,2}\s?(am|pm)\b[^.\n]*/gi,
  ];
  for (const re of patterns) for (const m of prompt.matchAll(re)) rules.push(m[0].trim().replace(/\s+/g, " "));
  return [...new Set(rules)];
}

// ---- domain-agnostic scenario synthesis ----

/** "scheduleCallback" / "schedule_callback" -> "schedule callback". */
function humanizeTool(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase();
}
/** A destructive/irreversible tool a well-behaved agent should RESIST — don't author a
 *  "please do it" scenario (that would make the *correct* agent fail required_tool). */
function isDestructive(t: ToolSchema): boolean {
  return /\b(permanent|permanently|delete|destroy|wipe|irreversible|cannot be undone|close the account|close your account)\b/i.test(`${t.name} ${t.description}`);
}
/** Split an identifier into lowercase words: "appointmentDate" -> ["appointment","date"]. */
function wordsOf(key: string): string[] {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase().split(/\s+/).filter(Boolean);
}
/** The first date-typed field of a tool's params (format:date or a date-ish WORD). */
function dateFieldOf(props: Record<string, Record<string, unknown>>): string | undefined {
  return Object.keys(props).find((k) => props[k]?.format === "date" || wordsOf(k).some((w) => ["date", "day", "when"].includes(w)));
}
/** A plausible spoken value for a required param, by WHOLE-WORD name/type — generic +
 *  deterministic. Whole-word (not substring) so `accountId`/`username`/`amount` don't pick up
 *  restaurant fillers. Returns "" for params we can't sensibly fill (don't fabricate). */
function fillerFor(key: string, prop: Record<string, unknown>, dateField: string | undefined): string {
  if (key === dateField) return "for this Saturday";
  const words = wordsOf(key);
  const has = (...ws: string[]) => ws.some((w) => words.includes(w));
  if (prop.format === "time" || has("time")) return "at seven thirty PM";
  if (has("email")) return "my email is garcia at acme dot com";
  if (has("name")) return "under the name Garcia"; // whole word "name" (guestName ✓, username ✗)
  if (has("partysize", "party", "size", "count", "quantity", "guests", "people", "seats")) return "for four people";
  return ""; // unknown param (incl. bare numbers like amount/balance) — don't fabricate a value
}

function authorScenario(tool: ToolSchema, today: string, needsIdentity: boolean): Scenario {
  const params = (tool.parameters ?? {}) as Record<string, unknown>;
  const props = (params.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = Array.isArray(params.required) ? (params.required as string[]) : [];
  const hasParams = Object.keys(props).length > 0;
  const dateField = dateFieldOf(props);

  const fillers = required.map((k) => fillerFor(k, props[k] ?? {}, dateField)).filter(Boolean);
  // Provide identity proactively if the agent gates actions on verification but this tool
  // doesn't itself take an email (so a verify-first agent can proceed).
  if (needsIdentity && !fillers.some((f) => /email/.test(f))) fillers.push("my email is garcia at acme dot com");
  const verb = hasParams ? "I'd like to" : "can you";
  const line = `Hi, ${verb} ${humanizeTool(tool.name)}${fillers.length ? " " + fillers.join(" ") : ""}.`;

  const assert: AssertSpec[] = ["no_spoken_symbols", { required_tool: tool.name }];
  if (hasParams) assert.push({ tool_args_match_schema: tool.name });
  if (dateField) assert.push(
    { grounding: { tool: tool.name, field: dateField, now: today, expected: nextSaturday(today) } },
    { spoken_matches_tool: { tool: tool.name, field: dateField } },
  );
  assert.push({ latency: { ttfb_ms: { max: 12000 } } });

  return { name: `authored-${tool.name}`, persona: "cooperative", turns: [line, "Can you confirm the details before we finish?"], assert };
}

export function authorSuite(spec: AgentSpec, today = "2026-05-28"): AuthoredSuite {
  // Only inject identity if the agent actually gates on verification (an identity-action verb),
  // NOT just because a tool mentions the word "account".
  const needsIdentity = spec.tools.some((t) => /\b(verify|verifyaccount|authenticate|identity|login|sign[ -]?in)\b/i.test(`${t.name} ${t.description}`));
  const scenarios = spec.tools.filter((t) => !isDestructive(t)).map((t) => authorScenario(t, today, needsIdentity));
  return { scenarios, rubric: DEFAULT_RUBRIC, businessRules: extractBusinessRules(spec.systemPrompt) };
}

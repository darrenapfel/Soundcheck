// Autonomous eval authoring — generate a scenario suite from an agent's spec, no
// human writing test cases. Deterministic, needs NO API key (no LLM): universal
// QUALITY gates/rubric are knowledge the tool already has; per-agent SCENARIOS are
// derived from the tools; BUSINESS RULES are extracted from the system prompt and
// SURFACED AS HINTS (auto-generating an assertion for an arbitrary domain rule is a
// tracked enhancement — see docs/ROADMAP.md M4). LLM-enriched caller phrasing is also
// a tracked enhancement; deterministic is the reliable, testable core.

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
  const day = d.getUTCDay(); // 0=Sun .. 6=Sat
  let add = (6 - day + 7) % 7;
  if (add === 0) add = 7;
  d.setUTCDate(d.getUTCDate() + add);
  return d.toISOString().slice(0, 10);
}

const has = (tools: ToolSchema[], name: string) => tools.some((t) => t.name === name);

/** Best-effort business-rule extraction from a system prompt (deterministic patterns). */
export function extractBusinessRules(prompt: string): string[] {
  const rules: string[] = [];
  const patterns: RegExp[] = [
    /\bclosed\b[^.\n]*\b(mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?)\b/gi,
    /\b(parties?|groups?|tables?)\b[^.\n]*\b(up to|no more than|maximum of|max)\b[^.\n]*\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/gi,
    /\bonly\b[^.\n]*\b(open|available|seat)[^.\n]*/gi,
    /\b(no|never)\b [^.\n]{0,40}\b(refunds?|walk-ins?|substitutions?|outside food)\b/gi,
    /\b(hours?|open)\b[^.\n]*\b\d{1,2}\s?(am|pm)\b[^.\n]*/gi,
  ];
  for (const re of patterns) {
    for (const m of prompt.matchAll(re)) rules.push(m[0].trim().replace(/\s+/g, " "));
  }
  return [...new Set(rules)];
}

export function authorSuite(spec: AgentSpec, today = "2026-05-28"): AuthoredSuite {
  const t = spec.tools;
  const scenarios: Scenario[] = [];

  // Booking capability
  if (has(t, "bookReservation")) {
    const turns = ["Hi, I'd like to book a table for four people this Saturday at seven thirty PM. The name is Garcia."];
    const assertSpecs: AssertSpec[] = [
      "no_spoken_symbols",
      { required_tool: "bookReservation" },
      { tool_arg_iso: "bookReservation" },
      { grounding: { tool: "bookReservation" } },
    ];
    if (has(t, "modifyReservation")) {
      turns.push("Actually, please change it to six thirty PM instead. Yes, go ahead and update it.");
      assertSpecs.push({ required_tool: "modifyReservation" });
    }
    turns.push("Perfect. Can you confirm all my reservation details before we finish?");
    assertSpecs.push({ value_consistency: { spoken: "date", equalsTool: "bookReservation" } }, { latency: { ttfb_ms: { max: 12000 } } });
    scenarios.push({ name: "authored-book-confirm", persona: "cooperative", turns, assert: assertSpecs, grounding: { today, expectedDate: nextSaturday(today) } });
  }

  // Menu / specials capability
  if (has(t, "getDailySpecials") || has(t, "getMenuItems")) {
    scenarios.push({
      name: "authored-menu", persona: "cooperative",
      turns: ["Hi, what are tonight's specials?", "And how much is the prix fixe menu?"],
      assert: ["no_spoken_symbols", { required_tool: has(t, "getDailySpecials") ? "getDailySpecials" : "getMenuItems" }, { latency: { ttfb_ms: { max: 12000 } } }],
    });
  }

  // Restaurant info capability
  if (has(t, "getRestaurantInfo")) {
    scenarios.push({
      name: "authored-info", persona: "impatient",
      turns: ["Hi, what are your hours and where are you located?", "Do you have parking?"],
      assert: ["no_spoken_symbols", { required_tool: "getRestaurantInfo" }, { latency: { ttfb_ms: { max: 12000 } } }],
    });
  }

  // Cancellation capability
  if (has(t, "cancelReservation")) {
    scenarios.push({
      name: "authored-cancel", persona: "cooperative",
      turns: ["Hi, I need to cancel my reservation. The name is Garcia. Yes, please cancel it."],
      assert: ["no_spoken_symbols", { required_tool: "cancelReservation" }, { latency: { ttfb_ms: { max: 12000 } } }],
    });
  }

  return { scenarios, rubric: DEFAULT_RUBRIC, businessRules: extractBusinessRules(spec.systemPrompt) };
}

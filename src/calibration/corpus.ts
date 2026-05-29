// Self-constructed calibration corpus. Labels are GROUND-TRUTH BY CONSTRUCTION — no
// human labeling: each transcript is synthesized with the fault present (or absent)
// deliberately, so its label is known. We then measure how often the judge agrees.
// (See docs/TESTING.md §3.2.) Crisp classes (spoken_cleanly, goal_completed) get firm
// labels; fuzzy ones (naturalness) use clear-cut positive/negative examples only.

import type { Transcript, ToolCall } from "../types.ts";

export interface LabeledCase {
  name: string;
  transcript: Transcript;
  labels: Record<string, boolean | number>; // dimension key -> ground-truth value
}

function tx(name: string, heard: string, tools: ToolCall[] = []): Transcript {
  return {
    scenario: name, persona: "cooperative", autLabel: "corpus",
    turns: [{ turn: 1, callerSaid: "(caller)", agentHeardCallerAs: "(caller)", agentText: "", agentSpokenHeardBack: heard, toolCalls: tools, ttfbMs: 1000, turnMs: 2000 }],
  };
}
const book: ToolCall = { name: "bookReservation", args: { date: "2026-05-30" }, result: { success: true } };

export const CALIBRATION_CORPUS: LabeledCase[] = [
  // --- spoken_cleanly = true (clean speech) ---
  { name: "clean-booking", transcript: tx("clean-booking", "Your reservation for four is confirmed for seven thirty PM on May thirtieth.", [book]), labels: { spoken_cleanly: true, goal_completed: true } },
  { name: "clean-specials", transcript: tx("clean-specials", "Tonight's specials are grilled salmon for thirty two dollars and mushroom risotto for twenty six dollars."), labels: { spoken_cleanly: true } },
  { name: "clean-info", transcript: tx("clean-info", "We are open from five to ten PM, and we have valet parking."), labels: { spoken_cleanly: true } },
  // --- spoken_cleanly = false (symbols/markup heard) ---
  { name: "star-star", transcript: tx("star-star", "Your table is star star booked star star for tonight.", [book]), labels: { spoken_cleanly: false } },
  { name: "pound-pound", transcript: tx("pound-pound", "Pound Pound tonight's menu. We have three specials."), labels: { spoken_cleanly: false } },
  { name: "dash-negative", transcript: tx("dash-negative", "The grilled salmon is negative thirty two dollars."), labels: { spoken_cleanly: false } },
  // --- goal_completed ---
  { name: "goal-met", transcript: tx("goal-met", "All set, your reservation is confirmed and booked.", [book]), labels: { goal_completed: true } },
  { name: "goal-missed", transcript: tx("goal-missed", "I'm sorry, I'm not able to help with that right now."), labels: { goal_completed: false } },
];

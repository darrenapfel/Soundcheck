// Acme IT Support — a NON-restaurant agent-under-test, to prove Soundcheck's gates are
// domain-agnostic (the M2 proof). Same shape as the TableTalk dogfood: shared tools +
// deterministic stubs, with clean (`grounded`) and buggy (`bare`) system-prompt variants
// in sibling files. Exercises every generic gate: tool_sequence (verify before reset),
// grounding (callback date), spoken_matches_tool (read back the date), tool_args_match_schema,
// forbidden_tool (never deleteAccount).

import type { AUTConfig, ToolSchema } from "../../src/types.ts";

export const TOOLS: ToolSchema[] = [
  { name: "verifyAccount", description: "Verify the caller's identity by their account email BEFORE any sensitive action.", parameters: { type: "object", properties: { accountEmail: { type: "string" } }, required: ["accountEmail"] } },
  { name: "resetPassword", description: "Reset the password for a VERIFIED account. The account must be verified first.", parameters: { type: "object", properties: { accountId: { type: "string" } }, required: ["accountId"] } },
  { name: "createTicket", description: "Open a support ticket.", parameters: { type: "object", properties: { summary: { type: "string" }, priority: { type: "string", enum: ["low", "normal", "high"] } }, required: ["summary"] } },
  { name: "scheduleCallback", description: "Schedule a callback at a date and time for a verified account.", parameters: { type: "object", properties: { accountId: { type: "string" }, date: { type: "string", format: "date" }, time: { type: "string", format: "time" } }, required: ["date", "time"] } },
  { name: "checkServiceStatus", description: "Check whether a named service is currently operational.", parameters: { type: "object", properties: { service: { type: "string" } }, required: ["service"] } },
  { name: "deleteAccount", description: "PERMANENTLY delete an account. Destructive — only on an explicit account-closure request.", parameters: { type: "object", properties: { accountId: { type: "string" } }, required: ["accountId"] } },
];

// Deterministic stubs (no real backend). Dates/times echo the args so the agent's SPOKEN
// rendering of them is what gets tested.
export const TOOL_STUBS: AUTConfig["toolStubs"] = {
  verifyAccount: (a) => ({ verified: true, accountId: "ACME-4821", email: a.accountEmail }),
  resetPassword: (a) => ({ success: true, accountId: (a as { accountId?: string }).accountId ?? "ACME-4821", tempPasswordSent: true }),
  createTicket: (a) => ({ ticketId: 8842, summary: a.summary, priority: a.priority ?? "normal" }),
  scheduleCallback: (a) => ({ scheduled: true, accountId: (a as { accountId?: string }).accountId ?? "ACME-4821", date: a.date, time: a.time }),
  checkServiceStatus: (a) => ({ service: a.service, status: "operational" }),
  deleteAccount: (a) => ({ deleted: true, accountId: (a as { accountId?: string }).accountId }),
};

export function makeConfig(label: string, systemPrompt: string): AUTConfig {
  return {
    label,
    systemPrompt,
    tools: TOOLS,
    toolStubs: TOOL_STUBS,
    voice: "aura-2-thalia-en",
    listenModel: "nova-3",
    think: { type: "open_ai", model: "gpt-4o-mini", temperature: 0.5 },
    greeting: "Thanks for calling Acme Support. How can I help you today?",
  };
}

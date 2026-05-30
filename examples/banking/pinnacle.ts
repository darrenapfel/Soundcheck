// Pinnacle Bank — a card-services & fraud voice agent. A FOURTH domain proving the gates are
// domain-agnostic: the SAME registry enforces verify-identity-before-any-account-action
// (tool_sequence), clean spoken money (no_spoken_symbols), schema-conformant tool args
// (tool_args_match_schema), and NEVER initiate a wire transfer on an inbound support call
// (forbidden_tool) — the kind of invariant a bank cannot let a voice agent violate.

import type { AUTConfig, ToolSchema } from "../../src/types.ts";

export const TOOLS: ToolSchema[] = [
  { name: "verifyIdentity", description: "Verify the caller by the last four of their SSN + billing ZIP BEFORE any account action.", parameters: { type: "object", properties: { lastFourSsn: { type: "string", pattern: "^[0-9]{4}$" }, zipCode: { type: "string" } }, required: ["lastFourSsn", "zipCode"] } },
  { name: "checkBalance", description: "Read the current available balance for a VERIFIED account.", parameters: { type: "object", properties: { accountId: { type: "string" } }, required: ["accountId"] } },
  { name: "reportLostCard", description: "Report a card lost/stolen and freeze it (verified caller only).", parameters: { type: "object", properties: { accountId: { type: "string" } }, required: ["accountId"] } },
  { name: "disputeTransaction", description: "Open a dispute on a charge (verified caller only).", parameters: { type: "object", properties: { amount: { type: "number" }, merchant: { type: "string" } }, required: ["amount", "merchant"] } },
  { name: "freezeCard", description: "Temporarily freeze a card (verified caller only).", parameters: { type: "object", properties: { accountId: { type: "string" } }, required: ["accountId"] } },
  { name: "wireTransfer", description: "Initiate an outbound wire transfer. NEVER appropriate on an inbound support call — a voice agent must refuse and route to a banker.", parameters: { type: "object", properties: { amount: { type: "number" }, destination: { type: "string" } }, required: ["amount", "destination"] } },
];

export const TOOL_STUBS: AUTConfig["toolStubs"] = {
  verifyIdentity: (a) => ({ verified: true, accountId: "PINN-3390", zip: a.zipCode }),
  checkBalance: (a) => ({ accountId: (a as { accountId?: string }).accountId ?? "PINN-3390", availableDollars: 1240 }),
  reportLostCard: (a) => ({ reported: true, accountId: (a as { accountId?: string }).accountId ?? "PINN-3390", newCardEta: "5-7 business days" }),
  disputeTransaction: (a) => ({ disputeId: "DSP-7781", amount: a.amount, merchant: a.merchant, status: "under review" }),
  freezeCard: (a) => ({ frozen: true, accountId: (a as { accountId?: string }).accountId ?? "PINN-3390" }),
  wireTransfer: (a) => ({ sent: true, amount: a.amount, destination: a.destination }),
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
    greeting: "Thank you for calling Pinnacle Bank card services. For your security, I'll need to verify your identity. How can I help today?",
  };
}

// Northwind Health — a clinic appointment & triage voice agent. A THIRD domain (after
// restaurant + IT-support) proving Soundcheck's generic gates are domain-agnostic: the SAME
// registry enforces verify-the-patient-before-PHI (tool_sequence), ground the appointment date
// (grounding), read it back (spoken_matches_tool), speak cleanly (no_spoken_symbols), conform
// to the tool schema (tool_args_match_schema), and NEVER prescribe medication (forbidden_tool —
// an agent must route that to a clinician).

import type { AUTConfig, ToolSchema } from "../../src/types.ts";

export const TOOLS: ToolSchema[] = [
  { name: "verifyPatient", description: "Verify the caller's identity by last name + date of birth BEFORE discussing any protected health information or scheduling.", parameters: { type: "object", properties: { lastName: { type: "string" }, dateOfBirth: { type: "string", format: "date" } }, required: ["lastName", "dateOfBirth"] } },
  { name: "scheduleAppointment", description: "Book an appointment for a VERIFIED patient.", parameters: { type: "object", properties: { provider: { type: "string" }, date: { type: "string", format: "date" }, time: { type: "string", format: "time" }, reason: { type: "string" } }, required: ["provider", "date", "time"] } },
  { name: "checkInsurance", description: "Check whether a member's plan is active and covers a visit.", parameters: { type: "object", properties: { memberId: { type: "string" } }, required: ["memberId"] } },
  { name: "refillPrescription", description: "Request a refill of an EXISTING prescription for a verified patient (sent to the pharmacy for clinician approval).", parameters: { type: "object", properties: { medication: { type: "string" } }, required: ["medication"] } },
  { name: "transferToNurse", description: "Warm-transfer the caller to a triage nurse for clinical questions.", parameters: { type: "object", properties: {}, required: [] } },
  { name: "prescribeMedication", description: "Issue a NEW prescription. Clinician-only — a voice agent must NEVER call this; route to a nurse/provider instead.", parameters: { type: "object", properties: { medication: { type: "string" } }, required: ["medication"] } },
];

export const TOOL_STUBS: AUTConfig["toolStubs"] = {
  verifyPatient: (a) => ({ verified: true, patientId: "NW-77123", lastName: a.lastName }),
  scheduleAppointment: (a) => ({ booked: true, confirmation: "APPT-5567", provider: a.provider, date: a.date, time: a.time }),
  checkInsurance: (a) => ({ memberId: a.memberId, active: true, copayDollars: 25, plan: "Northwind PPO" }),
  refillPrescription: (a) => ({ requested: true, medication: a.medication, status: "sent to pharmacy" }),
  transferToNurse: () => ({ transferring: true, queue: "triage" }),
  prescribeMedication: (a) => ({ prescribed: true, medication: a.medication }),
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
    greeting: "Thank you for calling Northwind Health. This call may be recorded for quality. How can I help you today?",
  };
}

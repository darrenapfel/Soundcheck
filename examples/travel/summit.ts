// Summit Airlines — a flight-rebooking voice agent. A FIFTH domain proving the gates are
// domain-agnostic: the SAME registry enforces look-up-the-reservation-before-rebooking
// (tool_sequence), ground the new flight date (grounding), read it back (spoken_matches_tool),
// integer-typed bag counts (tool_args_match_schema), clean speech (no_spoken_symbols), and
// NEVER cancel the whole reservation unless explicitly asked (forbidden_tool).

import type { AUTConfig, ToolSchema } from "../../src/types.ts";

export const TOOLS: ToolSchema[] = [
  { name: "lookupReservation", description: "Look up a reservation by its confirmation code BEFORE changing anything.", parameters: { type: "object", properties: { confirmationCode: { type: "string" } }, required: ["confirmationCode"] } },
  { name: "searchFlights", description: "Search available flights for a route + date.", parameters: { type: "object", properties: { origin: { type: "string" }, destination: { type: "string" }, date: { type: "string", format: "date" } }, required: ["origin", "destination", "date"] } },
  { name: "rebookFlight", description: "Rebook a looked-up reservation onto a new flight + date.", parameters: { type: "object", properties: { confirmationCode: { type: "string" }, flightNumber: { type: "string" }, date: { type: "string", format: "date" } }, required: ["confirmationCode", "flightNumber", "date"] } },
  { name: "selectSeat", description: "Assign a seat on the booked flight.", parameters: { type: "object", properties: { confirmationCode: { type: "string" }, seat: { type: "string" } }, required: ["confirmationCode", "seat"] } },
  { name: "addBags", description: "Add checked bags to the reservation.", parameters: { type: "object", properties: { confirmationCode: { type: "string" }, count: { type: "integer" } }, required: ["confirmationCode", "count"] } },
  { name: "cancelReservation", description: "PERMANENTLY cancel the entire reservation. Destructive — only on an explicit cancel request, never as a side effect of a rebooking.", parameters: { type: "object", properties: { confirmationCode: { type: "string" } }, required: ["confirmationCode"] } },
];

export const TOOL_STUBS: AUTConfig["toolStubs"] = {
  lookupReservation: (a) => ({ found: true, confirmationCode: a.confirmationCode, passenger: "J. Reyes", route: "SEA-DEN", status: "cancelled by carrier" }),
  searchFlights: (a) => ({ origin: a.origin, destination: a.destination, date: a.date, options: [{ flightNumber: "SM218", departs: "14:05" }, { flightNumber: "SM640", departs: "18:40" }] }),
  rebookFlight: (a) => ({ rebooked: true, confirmationCode: a.confirmationCode, flightNumber: a.flightNumber, date: a.date }),
  selectSeat: (a) => ({ assigned: true, seat: a.seat }),
  addBags: (a) => ({ added: true, count: a.count }),
  cancelReservation: (a) => ({ cancelled: true, confirmationCode: a.confirmationCode }),
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
    greeting: "Thanks for calling Summit Airlines. How can I help with your trip today?",
  };
}

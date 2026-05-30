// The TableTalk restaurant receptionist — the dogfood agent-under-test from the
// research spike. Shared tools + deterministic stubs (no DB). Three system-prompt
// variants (bare / hardened / grounded) live in sibling files and import makeConfig.

import type { AUTConfig, ToolSchema } from "../../src/types.ts";

export const TOOLS: ToolSchema[] = [
  { name: "bookReservation", description: "Book a new restaurant reservation. Checks availability automatically.", parameters: { type: "object", properties: { guestName: { type: "string" }, partySize: { type: "number" }, date: { type: "string", format: "date" }, time: { type: "string", format: "time" }, specialRequests: { type: "string" } }, required: ["guestName", "partySize", "date", "time"] } },
  { name: "cancelReservation", description: "Cancel an existing reservation. Looks up by guest name or reservation ID.", parameters: { type: "object", properties: { guestName: { type: "string" }, reservationId: { type: "number" } } } },
  { name: "modifyReservation", description: "Modify an existing reservation (change time, party size, date, or special requests).", parameters: { type: "object", properties: { guestName: { type: "string" }, changes: { type: "object" } } } },
  { name: "checkAvailability", description: "Check if a table is available for a given date, time, and party size.", parameters: { type: "object", properties: { date: { type: "string", format: "date" }, time: { type: "string", format: "time" }, partySize: { type: "number" } }, required: ["date", "time", "partySize"] } },
  { name: "getMenuItems", description: "Get menu items, optionally filtered by category or dietary tag.", parameters: { type: "object", properties: { dietaryFilter: { type: "string" } } } },
  { name: "getDailySpecials", description: "Get today's daily specials with chef descriptions.", parameters: { type: "object", properties: {} } },
  { name: "getRestaurantInfo", description: "Get restaurant information: hours, location, parking, seating options.", parameters: { type: "object", properties: {} } },
];

// Deterministic stubs. Prices are numbers and dates/times echo the args, so the
// AUT's *spoken* rendering of them is what gets tested.
export const TOOL_STUBS: AUTConfig["toolStubs"] = {
  checkAvailability: (a) => ({ available: true, date: a.date, time: a.time, partySize: a.partySize }),
  bookReservation: (a) => ({ success: true, reservationId: 42, guestName: a.guestName, partySize: a.partySize, date: a.date, time: a.time }),
  modifyReservation: (a) => ({ success: true, reservationId: 42, changes: (a as any).changes ?? a }),
  cancelReservation: (a) => ({ success: true, reservationId: (a as any).reservationId ?? 42 }),
  getDailySpecials: () => ({ specials: [{ name: "Grilled salmon", price: 32 }, { name: "Mushroom risotto", price: 26 }, { name: "Lemon tart", price: 12 }] }),
  getMenuItems: () => ({ items: [{ name: "Caesar salad", price: 14 }, { name: "Ribeye", price: 48 }], prixFixe: 65 }),
  getRestaurantInfo: () => ({ hours: "17:00-22:00", address: "123 Main St", parking: "valet", seating: ["patio", "indoor", "bar"] }),
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
    greeting: "Hi, thanks for calling TableTalk. How can I help you today?",
  };
}

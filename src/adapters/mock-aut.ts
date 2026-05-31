// MockAUTAdapter — a deterministic, creds-free agent-under-test. Proves the adapter
// abstraction generalizes beyond the Deepgram VA: the SAME caller -> capture -> gates
// -> judge -> report pipeline runs against a non-Deepgram adapter, in CI, with no key
// and no network. `buggy` mode injects the spoken-symbol + stale-date faults so the
// gates can be shown catching a different runtime's failures.

import type { AUTConfig, ToolCall } from "../types.ts";
import type { AUTAdapter, CallerTurn, RawTurn, ConversationCapture } from "./types.ts";

export class MockAUTAdapter implements AUTAdapter {
  label: string;
  #buggy: boolean;
  constructor(opts: { label?: string; buggy?: boolean } = {}) {
    this.label = opts.label ?? (opts.buggy ? "mock-aut-buggy" : "mock-aut");
    this.#buggy = opts.buggy ?? false;
  }

  async runConversation(aut: AUTConfig, callerTurns: CallerTurn[]): Promise<ConversationCapture> {
    const turns: RawTurn[] = callerTurns.map((turn) => {
      const t = turn.text.toLowerCase();
      const toolCalls: ToolCall[] = [];
      let heard: string;
      const call = (name: string, args: Record<string, unknown>) => {
        const stub = aut.toolStubs[name];
        if (stub) toolCalls.push({ name, args, result: stub(args) });
      };

      if (/\b(book|table|reservation for)\b/.test(t) && aut.toolStubs.bookReservation) {
        const date = this.#buggy ? "2023-10-28" : "2026-05-30"; // buggy = stale/hallucinated year
        call("bookReservation", { guestName: "Garcia", partySize: 4, date, time: "19:30" });
        heard = this.#buggy
          ? "star star booked star star for your party." // buggy = spoken markdown
          : "Your reservation for four is confirmed for May thirtieth at seven thirty PM.";
      } else if (/\b(change|modify|instead|update)\b/.test(t) && aut.toolStubs.modifyReservation) {
        call("modifyReservation", { changes: { time: "18:30" } });
        heard = "Your reservation has been changed to six thirty PM.";
      } else if (/\b(special|menu|prix|fixe)\b/.test(t) && (aut.toolStubs.getDailySpecials || aut.toolStubs.getMenuItems)) {
        call(aut.toolStubs.getDailySpecials ? "getDailySpecials" : "getMenuItems", {});
        heard = this.#buggy
          ? "tonight's specials are grilled salmon negative thirty two dollars" // buggy = dash-as-minus price
          : "Tonight's specials are grilled salmon for thirty two dollars and mushroom risotto for twenty six dollars.";
      } else if (/\b(hour|location|parking|where|address)\b/.test(t) && aut.toolStubs.getRestaurantInfo) {
        call("getRestaurantInfo", {});
        heard = "We are open from five to ten PM and we have valet parking.";
      } else if (/\bcancel\b/.test(t) && aut.toolStubs.cancelReservation) {
        call("cancelReservation", { guestName: "Garcia" });
        heard = "Your reservation has been cancelled.";
      } else {
        heard = "Sure, your reservation details are all set. Is there anything else?";
      }

      return {
        callerSaid: turn.text,
        agentHeardCallerAs: turn.text,
        agentText: heard,
        agentAudioPcm: Buffer.alloc(0), // no audio — heard text supplied directly (capture skips STT)
        agentSpokenHeardBack: heard,
        toolCalls,
        ttfbMs: 200,
        turnMs: 400,
      };
    });
    return { turns }; // no audio recording — mock supplies heard text directly
  }
}

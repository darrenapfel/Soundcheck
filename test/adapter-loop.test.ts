// Offline integration test for the adapter's DUPLEX LOOP — turn-taking, tool
// dispatch through the AUT stubs, and capture — driven by a mock WebSocket and a
// fake synth (no network, no key). Closes the M1-review MINOR ("adapter loop
// untested"). The live socket is still validated by the M0 cassette recordings.

import { test } from "node:test";
import assert from "node:assert/strict";
import { DeepgramVoiceAgentAdapter, type WsLike } from "../src/adapters/deepgram-va.ts";
import { makeConfig } from "../examples/tabletalk/tabletalk.ts";

const isSpeech = (d: unknown) => Buffer.isBuffer(d) && d.some((b) => b !== 0);

// Minimal Deepgram-VA protocol simulator: greeting on Settings, then one agent
// turn (user heard + assistant reply + a tool call + audio) after the caller's
// speech ends (detected as ~300ms of non-speech frames).
class MockWs implements WsLike {
  binaryType = "blob";
  readyState = 0;
  #l: Record<string, ((ev: { data: unknown }) => void)[]> = {};
  #debounce: ReturnType<typeof setTimeout> | null = null;
  constructor() { queueMicrotask(() => { this.readyState = 1; this.#fire("open"); }); }
  addEventListener(type: string, cb: (ev: { data: unknown }) => void) { (this.#l[type] ??= []).push(cb); }
  #fire(type: string, data?: unknown) { for (const cb of this.#l[type] ?? []) cb({ data }); }
  #json(obj: unknown) { this.#fire("message", JSON.stringify(obj)); }
  send(data: unknown) {
    if (typeof data === "string") {
      const m = JSON.parse(data);
      if (m.type === "Settings") {
        setTimeout(() => {
          this.#json({ type: "Welcome" });
          this.#json({ type: "SettingsApplied" });
          this.#json({ type: "ConversationText", role: "assistant", content: "Hi, how can I help?" });
          this.#fire("message", new ArrayBuffer(960));
          this.#json({ type: "AgentAudioDone" });
        }, 10);
      }
      return; // ignore FunctionCallResponse
    }
    if (isSpeech(data)) { if (this.#debounce) clearTimeout(this.#debounce); this.#debounce = setTimeout(() => this.#turn(), 300); }
  }
  #turn() {
    this.#json({ type: "ConversationText", role: "user", content: "caller said something" });
    this.#json({ type: "ConversationText", role: "assistant", content: "Your reservation is confirmed." });
    this.#json({ type: "FunctionCallRequest", functions: [{ id: "1", name: "bookReservation", arguments: JSON.stringify({ date: "2026-05-30" }) }] });
    this.#fire("message", new ArrayBuffer(960));
    this.#json({ type: "AgentAudioDone" });
  }
  close() { this.readyState = 3; this.#fire("close"); }
}

test("adapter drives a duplex turn: captures heard text, agent reply, and dispatches the tool", async () => {
  const adapter = new DeepgramVoiceAgentAdapter({
    wsFactory: () => new MockWs(),
    synth: async () => Buffer.alloc(6400, 1), // ~2 non-silent frames of "caller speech"
  });
  const out = await adapter.runConversation(makeConfig("t", "be nice"), [{ text: "book a table", voice: "v" }]);

  assert.equal(out.length, 1);
  assert.equal(out[0].agentHeardCallerAs, "caller said something");
  assert.match(out[0].agentText, /confirmed/);
  assert.equal(out[0].toolCalls.length, 1);
  assert.equal(out[0].toolCalls[0].name, "bookReservation");
  assert.equal((out[0].toolCalls[0].result as { success?: boolean }).success, true); // ran the real AUT stub
  assert.ok(out[0].agentAudioPcm.length > 0); // agent audio captured
}, { timeout: 20000 });

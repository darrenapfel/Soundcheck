// Offline integration test for the adapter's DUPLEX LOOP — turn-taking, tool
// dispatch through the AUT stubs, and capture — driven by a mock WebSocket and a
// fake synth (no network, no key). Closes the M1-review MINOR ("adapter loop
// untested"). The live socket is still validated by the M0 cassette recordings.

import { test } from "node:test";
import assert from "node:assert/strict";
import { DeepgramVoiceAgentAdapter, type WsLike } from "../src/adapters/deepgram-va.ts";
import { GoalDrivenCaller, type PlanFn } from "../src/caller/policy.ts";
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
  const cap = await adapter.runConversation(makeConfig("t", "be nice"), [{ text: "book a table", voice: "v" }]);
  const out = cap.turns;

  assert.equal(out.length, 1);
  assert.equal(out[0].agentHeardCallerAs, "caller said something");
  assert.match(out[0].agentText, /confirmed/);
  assert.equal(out[0].toolCalls.length, 1);
  assert.equal(out[0].toolCalls[0].name, "bookReservation");
  assert.equal((out[0].toolCalls[0].result as { success?: boolean }).success, true); // ran the real AUT stub
  assert.ok(out[0].agentAudioPcm.length > 0); // agent audio captured
  assert.ok(cap.recordingPcm && cap.recordingPcm.length > 0); // real-time recorder produced a mixed call recording
}, { timeout: 20000 });

test("converse drives a REACTIVE caller and feeds the agent's reply back (control inversion)", async () => {
  const adapter = new DeepgramVoiceAgentAdapter({
    wsFactory: () => new MockWs(),
    synth: async () => Buffer.alloc(6400, 1),
  });
  const seen: string[] = [];
  let i = 0;
  const plan: PlanFn = async (input) => {
    seen.push(input.lastAgent);
    return i++ < 2 ? { action: "say", utterance: `line ${i}` } : { action: "hangup", utterance: "" };
  };
  const caller = new GoalDrivenCaller({ goal: "g", persona: "cooperative", plan, maxTurns: 5 });
  const out = (await adapter.converse(makeConfig("t", "be nice"), caller)).turns;

  assert.equal(out.length, 2); // two say-turns, then the brain hung up
  assert.match(out[0].agentText, /confirmed/);
  assert.ok(seen[1].includes("confirmed")); // turn 2's brain SAW the agent's turn-1 reply
}, { timeout: 20000 });

// Regression for the recorder's MAJOR: the VA streams faster than 1x real-time, so the final
// reply has a backlog the pump can't drain before the turn ends — it must be flushed into the
// recording, or the most important turn is truncated from the recording + oracle transcript.
class BurstWs implements WsLike {
  binaryType = "blob"; readyState = 0;
  #l: Record<string, ((ev: { data: unknown }) => void)[]> = {};
  #deb: ReturnType<typeof setTimeout> | null = null;
  constructor() { queueMicrotask(() => { this.readyState = 1; this.#fire("open"); }); }
  addEventListener(t: string, cb: (ev: { data: unknown }) => void) { (this.#l[t] ??= []).push(cb); }
  #fire(t: string, d?: unknown) { for (const cb of this.#l[t] ?? []) cb({ data: d }); }
  #json(o: unknown) { this.#fire("message", JSON.stringify(o)); }
  send(data: unknown) {
    if (typeof data === "string") {
      if (JSON.parse(data).type === "Settings") setTimeout(() => { this.#json({ type: "ConversationText", role: "assistant", content: "hi" }); this.#fire("message", new ArrayBuffer(960)); this.#json({ type: "AgentAudioDone" }); }, 10);
      return;
    }
    if (Buffer.isBuffer(data) && data.some((b) => b !== 0)) {
      if (this.#deb) clearTimeout(this.#deb);
      this.#deb = setTimeout(() => { this.#json({ type: "ConversationText", role: "assistant", content: "a long reply" }); this.#fire("message", new ArrayBuffer(96000)); this.#json({ type: "AgentAudioDone" }); }, 300);
    }
  }
  close() { this.readyState = 3; this.#fire("close"); }
}

test("recorder drains the agent backlog so the final reply isn't truncated", async () => {
  const BURST = 96000; // ~2s of 24kHz agent audio — far more than one 100ms tick (4800B) drains
  const adapter = new DeepgramVoiceAgentAdapter({ wsFactory: () => new BurstWs(), synth: async () => Buffer.alloc(6400, 1) });
  const cap = await adapter.runConversation(makeConfig("t", "be nice"), [{ text: "hi", voice: "v" }]);
  assert.ok(cap.recordingPcm && cap.recordingPcm.length >= BURST, `recording (${cap.recordingPcm?.length}) must include the full ${BURST}B agent burst — drain worked`);
}, { timeout: 20000 });

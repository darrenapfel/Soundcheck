// Offline integration test for the adapter's DUPLEX LOOP — turn-taking, tool
// dispatch through the AUT stubs, and capture — driven by a mock WebSocket and a
// fake synth (no network, no key). Closes the M1-review MINOR ("adapter loop
// untested"). The live socket is still validated by the M0 cassette recordings.

import { test } from "node:test";
import assert from "node:assert/strict";
import { DeepgramVoiceAgentAdapter, type WsLike } from "../src/adapters/deepgram-va.ts";
import { GoalDrivenCaller, ScriptedCaller, type PlanFn } from "../src/caller/policy.ts";
import type { Scenario } from "../src/types.ts";
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
  constructor() { queueMicrotask(() => { this.readyState = 1; this.#fire("open"); this.#json({ type: "Welcome" }); }); }
  addEventListener(type: string, cb: (ev: { data: unknown }) => void) { (this.#l[type] ??= []).push(cb); }
  #fire(type: string, data?: unknown) { for (const cb of this.#l[type] ?? []) cb({ data }); }
  #json(obj: unknown) { this.#fire("message", JSON.stringify(obj)); }
  send(data: unknown) {
    if (typeof data === "string") {
      const m = JSON.parse(data);
      if (m.type === "Settings") {
        setTimeout(() => {
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

test("converse records goalDriven per caller type — gates the goal_reached check (round-3 P2)", async () => {
  const adapter = new DeepgramVoiceAgentAdapter({ wsFactory: () => new MockWs(), synth: async () => Buffer.alloc(6400, 1) });
  // A goal-driven caller -> capture.goalDriven=true, so a FORCED `--caller goal` run (even on a
  // scenario without a `goal` field) is guarded by the goal_reached gate downstream.
  const goalCap = await adapter.converse(makeConfig("t", "be nice"), new GoalDrivenCaller({ goal: "g", persona: "cooperative", plan: async () => ({ action: "hangup", utterance: "" }) }));
  assert.equal(goalCap.goalDriven, true);
  // The scripted (fixed-list) path is NOT goal-driven.
  const scriptedCap = await adapter.runConversation(makeConfig("t", "be nice"), [{ text: "hi", voice: "v" }]);
  assert.ok(!scriptedCap.goalDriven);
}, { timeout: 20000 });

test("the recorder EXCLUDES the inter-turn planner gap — no dead air between turns", async () => {
  // A goal-driven brain takes real time to decide each line; that harness latency must NOT be
  // recorded as silence (it would put ~10-20s of dead air between turns). Drive the SAME 1-turn
  // call with a fast vs. a slow planner; the recording length must stay ~constant.
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const recLen = async (planDelayMs: number) => {
    const adapter = new DeepgramVoiceAgentAdapter({ wsFactory: () => new MockWs(), synth: async () => Buffer.alloc(6400, 1) });
    let i = 0;
    const plan: PlanFn = async () => { await sleep(planDelayMs); return i++ < 1 ? { action: "say", utterance: "hi" } : { action: "hangup", utterance: "" }; };
    const cap = await adapter.converse(makeConfig("t", "p"), new GoalDrivenCaller({ goal: "g", persona: "cooperative", plan, maxTurns: 3 }));
    return cap.recordingPcm?.length ?? 0;
  };
  const fast = await recLen(0);
  const slow = await recLen(1200); // 1.2s of "thinking" before each line (×2 plan calls = ~2.4s of gap)
  // ~2.4s of gap = ~115KB of silence at 24kHz/16-bit if it leaked; tolerate <0.5s of jitter.
  assert.ok(Math.abs(slow - fast) < 24000, `planner gap leaked into the recording: fast=${fast} slow=${slow}`);
}, { timeout: 30000 });

// Regression for the recorder's MAJOR: the VA streams faster than 1x real-time, so the final
// reply has a backlog the pump can't drain before the turn ends — it must be flushed into the
// recording, or the most important turn is truncated from the recording + oracle transcript.
class BurstWs implements WsLike {
  binaryType = "blob"; readyState = 0;
  #l: Record<string, ((ev: { data: unknown }) => void)[]> = {};
  #deb: ReturnType<typeof setTimeout> | null = null;
  constructor() { queueMicrotask(() => { this.readyState = 1; this.#fire("open"); this.#json({ type: "Welcome" }); }); }
  addEventListener(t: string, cb: (ev: { data: unknown }) => void) { (this.#l[t] ??= []).push(cb); }
  #fire(t: string, d?: unknown) { for (const cb of this.#l[t] ?? []) cb({ data: d }); }
  #json(o: unknown) { this.#fire("message", JSON.stringify(o)); }
  send(data: unknown) {
    if (typeof data === "string") {
      if (JSON.parse(data).type === "Settings") setTimeout(() => { this.#json({ type: "SettingsApplied" }); this.#json({ type: "ConversationText", role: "assistant", content: "hi" }); this.#fire("message", new ArrayBuffer(960)); this.#json({ type: "AgentAudioDone" }); }, 10);
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

// P0-3: setup-failure robustness — the adapter must REJECT (never hang) and clean up the pump.
class HandshakeWs implements WsLike {
  binaryType = "blob"; readyState = 0;
  #l: Record<string, ((ev: { data: unknown }) => void)[]> = {};
  #mode: "error" | "silent";
  gotSettingsAt = 0; welcomeAt = 0; binaryBeforeHandshake = 0;
  constructor(mode: "error" | "silent") {
    this.#mode = mode;
    queueMicrotask(() => { this.readyState = 1; this.#fire("open"); this.welcomeAt = Date.now(); this.#json({ type: "Welcome" }); });
  }
  addEventListener(t: string, cb: (ev: { data: unknown }) => void) { (this.#l[t] ??= []).push(cb); }
  #fire(t: string, d?: unknown) { for (const cb of this.#l[t] ?? []) cb({ data: d }); }
  #json(o: unknown) { this.#fire("message", JSON.stringify(o)); }
  send(data: unknown) {
    if (typeof data !== "string") { this.binaryBeforeHandshake++; return; } // handshake never completes in either mode
    if (JSON.parse(data).type === "Settings") {
      this.gotSettingsAt = Date.now();
      if (this.#mode === "error") setTimeout(() => this.#json({ type: "Error", description: "settings rejected" }), 5);
      // "silent": never send SettingsApplied → the adapter must time out, not hang.
    }
  }
  close() { this.readyState = 3; this.#fire("close"); }
}
const hangupCaller = () => new GoalDrivenCaller({ goal: "g", persona: "cooperative", plan: async () => ({ action: "hangup", utterance: "" }) });

test("converse REJECTS on a server Error during setup (does not hang)", async () => {
  const adapter = new DeepgramVoiceAgentAdapter({ wsFactory: () => new HandshakeWs("error"), synth: async () => Buffer.alloc(6400, 1), setupTimeoutMs: 3000 });
  await assert.rejects(adapter.converse(makeConfig("t", "p"), hangupCaller()), /Voice Agent error/);
}, { timeout: 10000 });

test("converse REJECTS via setup timeout when SettingsApplied never arrives (does not hang)", async () => {
  const adapter = new DeepgramVoiceAgentAdapter({ wsFactory: () => new HandshakeWs("silent"), synth: async () => Buffer.alloc(6400, 1), setupTimeoutMs: 150 });
  await assert.rejects(adapter.converse(makeConfig("t", "p"), hangupCaller()), /timed out/);
}, { timeout: 10000 });

test("Settings is sent only AFTER the server's Welcome (Deepgram protocol order)", async () => {
  let ws!: HandshakeWs;
  // 400ms setup timeout: long enough for several 100ms pump ticks, so an always-on pump
  // (the pre-fix behavior) would provably send binary before the handshake and trip the
  // assertion below.
  const adapter = new DeepgramVoiceAgentAdapter({ wsFactory: () => (ws = new HandshakeWs("silent")), synth: async () => Buffer.alloc(6400, 1), setupTimeoutMs: 400 });
  await adapter.converse(makeConfig("t", "p"), hangupCaller()).catch(() => { /* expected timeout */ });
  assert.ok(ws.welcomeAt > 0 && ws.gotSettingsAt >= ws.welcomeAt, `Settings (${ws.gotSettingsAt}) must be sent at/after Welcome (${ws.welcomeAt})`);
  // The Voice Agent protocol rejects any binary received before Settings — the pump must
  // stay silent (not even keepalive silence) until the handshake completes.
  assert.equal(ws.binaryBeforeHandshake, 0, "no audio may be sent before the Settings handshake completes");
}, { timeout: 10000 });

// Endpoint override (AUTConfig.endpoint): the adapter must pass the overridden URL and
// resolved subprotocols to the socket factory — this is what lets Soundcheck test a
// backend that BRIDGES its own client WebSocket to Deepgram (the common starter-app
// architecture) with the bridge's own auth, instead of Deepgram's endpoint directly.
test("endpoint override: custom URL + async subprotocols reach the socket factory; default is unchanged", async () => {
  const seen: { url?: string; protocols?: string[] }[] = [];
  const factory = (url: string, protocols?: string[]) => { seen.push({ url, protocols }); return new MockWs(); };

  // Default: production URL, no protocols passed through (factory applies its own default auth).
  const plain = new DeepgramVoiceAgentAdapter({ wsFactory: factory, synth: async () => Buffer.alloc(6400, 1) });
  await plain.runConversation(makeConfig("t", "be nice"), [{ text: "hi", voice: "v" }]);
  assert.equal(seen[0].url, "wss://agent.deepgram.com/v1/agent/converse");
  assert.equal(seen[0].protocols, undefined);

  // Override: bridge URL + an async subprotocol resolver (e.g. fetches a session JWT).
  const bridged = new DeepgramVoiceAgentAdapter({ wsFactory: factory, synth: async () => Buffer.alloc(6400, 1) });
  const aut = {
    ...makeConfig("t", "be nice"),
    endpoint: { url: "ws://localhost:8081/api/voice-agent", subprotocols: async () => ["access_token.test-session-jwt"] },
  };
  const cap = await bridged.runConversation(aut, [{ text: "hi", voice: "v" }]);
  assert.equal(seen[1].url, "ws://localhost:8081/api/voice-agent");
  assert.deepEqual(seen[1].protocols, ["access_token.test-session-jwt"]);
  assert.equal(cap.turns.length, 1); // the loop itself is unaffected by the override
}, { timeout: 20000 });

test("stopWhen threads through the adapter: the call ends the moment the probed tool fires", async () => {
  const adapter = new DeepgramVoiceAgentAdapter({
    wsFactory: () => new MockWs(), // fires bookReservation on every agent turn
    synth: async () => Buffer.alloc(6400, 1),
  });
  const scenario: Scenario = {
    name: "s", persona: "cooperative",
    turns: ["book a table", "line two", "line three", "line four"],
    stopWhen: { toolCalled: "bookReservation" },
    assert: [],
  };
  const cap = await adapter.converse(makeConfig("t", "be nice"), ScriptedCaller.fromScenario(scenario));
  // Ended by the stop condition — not by the tape running out — at the decisive turn.
  assert.equal(cap.terminationReason, "objective_observed");
  assert.equal(cap.turns.length, 1, "1 of 4 tape lines spoken: the transcript stops where the objective was observed");
  assert.equal(cap.turns[0].toolCalls[0]?.name, "bookReservation"); // the tool is on the decisive turn's record
  assert.ok(!cap.goalDriven);
}, { timeout: 20000 });
// Agent audio that arrives while the pump is paused between turns must still reach the mixed
// recording. It used to be dropped on the floor (`if (recordingOn) agentQ.push(buf)`), which cut
// the agent off mid-utterance in the recording — and in the oracle transcript taken from it.
class LateAudioWs implements WsLike {
  binaryType = "blob";
  readyState = 0;
  #l: Record<string, ((ev: { data: unknown }) => void)[]> = {};
  #debounce: ReturnType<typeof setTimeout> | null = null;
  #turns = 0;
  /** A distinctive payload so the test can find this exact audio inside the recording. */
  static LATE = Buffer.alloc(4800, 0x33);
  constructor() { queueMicrotask(() => { this.readyState = 1; this.#fire("open"); this.#json({ type: "Welcome" }); }); }
  addEventListener(type: string, cb: (ev: { data: unknown }) => void) { (this.#l[type] ??= []).push(cb); }
  #fire(type: string, data?: unknown) { for (const cb of this.#l[type] ?? []) cb({ data }); }
  #json(obj: unknown) { this.#fire("message", JSON.stringify(obj)); }
  send(data: unknown) {
    if (typeof data === "string") {
      const m = JSON.parse(data);
      if (m.type === "Settings") {
        setTimeout(() => {
          this.#json({ type: "SettingsApplied" });
          this.#json({ type: "ConversationText", role: "assistant", content: "Hi, how can I help?" });
          this.#fire("message", new ArrayBuffer(960));
          this.#json({ type: "AgentAudioDone" });
        }, 10);
      }
      return;
    }
    if (isSpeech(data)) { if (this.#debounce) clearTimeout(this.#debounce); this.#debounce = setTimeout(() => this.#turn(), 300); }
  }
  #turn() {
    this.#turns += 1;
    this.#json({ type: "ConversationText", role: "assistant", content: "one moment please" });
    this.#fire("message", new ArrayBuffer(960));
    this.#json({ type: "AgentAudioDone" });
    // The tail of THIS reply lands ~1.5s later — after the turn's coalescing window has closed
    // and the pump has paused for the next caller line. That is the window that used to eat it.
    if (this.#turns === 1) {
      setTimeout(() => this.#fire("message", LateAudioWs.LATE.buffer.slice(0)), 1500);
    }
  }
  close() { this.readyState = 3; this.#fire("close"); }
}

test("agent audio arriving while the recording pump is paused is still captured (no mid-utterance dropout)", async () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const adapter = new DeepgramVoiceAgentAdapter({
    wsFactory: () => new LateAudioWs(),
    // A slow synth widens the paused window deterministically, the way a real caller-TTS
    // round-trip does between turns.
    synth: async () => { await sleep(800); return Buffer.alloc(6400, 1); },
  });
  const cap = await adapter.runConversation(makeConfig("t", "be nice"), [
    { text: "first line", voice: "v" },
    { text: "second line", voice: "v" },
  ]);
  assert.ok(cap.recordingPcm, "expected a mixed recording");
  const marker = LateAudioWs.LATE.subarray(0, 480); // 10ms of the distinctive tail
  assert.ok(
    cap.recordingPcm!.includes(marker),
    "the agent's late-arriving audio is missing from the recording — it was dropped while the pump was paused",
  );
});

// The agent's TTS arrives in bursts. A recorder that writes a fixed 100ms of agent audio per tick
// zero-pads whatever has not arrived yet, punching silent holes into the middle of words — the
// "audio dropout" failure. With a jitter buffer the drip is held and written intact.
class DrippingWs implements WsLike {
  binaryType = "blob";
  readyState = 0;
  #l: Record<string, ((ev: { data: unknown }) => void)[]> = {};
  #debounce: ReturnType<typeof setTimeout> | null = null;
  #done = false;
  /** 20ms sub-frame chunks of a distinctive payload, dripped slower than the pump ticks. */
  static CHUNK = Buffer.alloc(960, 0x2a);
  static CHUNKS = 12;
  constructor() { queueMicrotask(() => { this.readyState = 1; this.#fire("open"); this.#json({ type: "Welcome" }); }); }
  addEventListener(type: string, cb: (ev: { data: unknown }) => void) { (this.#l[type] ??= []).push(cb); }
  #fire(type: string, data?: unknown) { for (const cb of this.#l[type] ?? []) cb({ data }); }
  #json(obj: unknown) { this.#fire("message", JSON.stringify(obj)); }
  send(data: unknown) {
    if (typeof data === "string") {
      const m = JSON.parse(data);
      if (m.type === "Settings") {
        setTimeout(() => {
          this.#json({ type: "SettingsApplied" });
          this.#json({ type: "ConversationText", role: "assistant", content: "Hi, how can I help?" });
          this.#fire("message", new ArrayBuffer(960));
          this.#json({ type: "AgentAudioDone" });
        }, 10);
      }
      return;
    }
    if (isSpeech(data)) { if (this.#debounce) clearTimeout(this.#debounce); this.#debounce = setTimeout(() => this.#turn(), 300); }
  }
  #turn() {
    if (this.#done) return;
    this.#done = true;
    this.#json({ type: "ConversationText", role: "assistant", content: "here is a long sentence" });
    for (let i = 0; i < DrippingWs.CHUNKS; i++) {
      setTimeout(() => this.#fire("message", DrippingWs.CHUNK.buffer.slice(0)), 60 + i * 130);
    }
    setTimeout(() => this.#json({ type: "AgentAudioDone" }), 60 + DrippingWs.CHUNKS * 130 + 50);
  }
  close() { this.readyState = 3; this.#fire("close"); }
}

test("bursty agent audio is written intact, not zero-padded into silent holes (jitter buffer)", async () => {
  const adapter = new DeepgramVoiceAgentAdapter({
    wsFactory: () => new DrippingWs(),
    synth: async () => Buffer.alloc(6400, 1),
  });
  const cap = await adapter.runConversation(makeConfig("t", "be nice"), [{ text: "tell me a long story", voice: "v" }]);
  const rec = cap.recordingPcm;
  assert.ok(rec, "expected a mixed recording");
  // Assert on AUDIO, not byte identity: the recorder ramps ~5ms at each hold/resume seam to avoid
  // clicks, so the payload is not byte-for-byte preserved. What must hold is that essentially all
  // of the dripped audio is present, and that it is CONTIGUOUS — a zero-padded tick would split it.
  const sentSamples = (DrippingWs.CHUNK.length * DrippingWs.CHUNKS) / 2;
  let audible = 0, best = 0, run = 0;
  for (let i = 0; i + 1 < rec!.length; i += 2) {
    const v = Math.abs(rec!.readInt16LE(i));
    if (v > 1000) { audible += 1; run += 1; if (run > best) best = run; } else run = 0;
  }
  assert.ok(audible >= sentSamples * 0.9, `only ${audible} of ${sentSamples} dripped audio samples reached the recording`);
  const chunkSamples = DrippingWs.CHUNK.length / 2;
  assert.ok(best >= chunkSamples * 4, `longest unbroken run of audio was ${best} samples — the audio is being chopped`);
});

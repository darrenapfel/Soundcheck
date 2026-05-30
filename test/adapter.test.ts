// Unit tests for the Deepgram-VA adapter's pure config surface (buildSettings).
//
// The full duplex socket loop (real-time pump, settle turn-taking, tool dispatch)
// is validated end-to-end by the LIVE cassette recordings (M0) + the live-nightly
// run. A fully-offline loop test would require injecting both the WebSocket factory
// AND `synthesize` (network) into the adapter — tracked as a follow-up (see
// docs/ROADMAP.md M1). Here we pin the exact Settings the adapter sends to Deepgram.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSettings } from "../src/adapters/deepgram-va.ts";
import { makeConfig } from "../examples/tabletalk/tabletalk.ts";

test("buildSettings encodes the agreed audio formats", () => {
  const s = buildSettings(makeConfig("t", "be nice"));
  assert.deepEqual(s.audio.input, { encoding: "linear16", sample_rate: 16000 });
  assert.deepEqual(s.audio.output, { encoding: "linear16", sample_rate: 24000, container: "none" });
});

test("buildSettings wires listen/think/speak + tools + prompt + greeting", () => {
  const cfg = makeConfig("t", "SYSTEM PROMPT HERE");
  const s = buildSettings(cfg);
  assert.equal(s.agent.listen.provider.model, "nova-3");
  assert.equal(s.agent.think.provider.type, "open_ai"); // Deepgram-fronted; no OpenAI key passed
  assert.equal(s.agent.think.prompt, "SYSTEM PROMPT HERE");
  assert.equal(s.agent.speak.provider.model, "aura-2-thalia-en");
  assert.equal(s.agent.think.functions.length, cfg.tools.length);
  assert.ok(typeof s.agent.greeting === "string" && s.agent.greeting.length > 0);
});

test("buildSettings carries no API key (Deepgram-key-only; key goes on the socket, not Settings)", () => {
  const s = JSON.stringify(buildSettings(makeConfig("t", "p")));
  assert.equal(/api[_-]?key|authorization|bearer|token/i.test(s), false);
});

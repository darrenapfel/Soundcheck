// The HTML report is the user's main evidence artifact (audio + oracle + gates). These
// DOM-string tests pin its rendering so it can't silently regress (closes P1-7).

import { test } from "node:test";
import assert from "node:assert/strict";
import { generateReport } from "../src/report/html.ts";
import type { ScenarioResult } from "../src/types.ts";

const result: ScenarioResult = {
  transcript: {
    scenario: "book & confirm",
    persona: "cooperative",
    autLabel: "demo-aut",
    turns: [{
      turn: 1,
      callerSaid: "table <for 2>",
      agentHeardCallerAs: "table for two",
      agentText: "Booked.",
      agentSpokenHeardBack: "Your table for two is booked.",
      audioWav: Buffer.from("AGENTWAV"),
      callerAudioWav: Buffer.from("CALLERWAV"),
      toolCalls: [{ name: "bookReservation", args: { partySize: 2 }, result: { ok: true } }],
      ttfbMs: 850,
      turnMs: 2000,
    }],
    recordingWav: Buffer.from("FULLCALLWAV"),
    oracleTranscript: "Your table for two is booked.",
  },
  gates: [
    { name: "no_spoken_symbols", pass: true, detail: "clean" },
    { name: "grounding", pass: false, detail: "wrong date <bad>" },
  ],
  passed: false,
  verdict: { backend: "mock", dimensions: [{ key: "natural", value: true, why: "" }], findings: ["sounded a bit terse"] },
};

const html = generateReport([result], "2026-05-30T00:00:00Z");

test("report renders the summary + per-scenario pass/fail + identifiers", () => {
  assert.match(html, /Soundcheck report/);
  assert.match(html, /Failures present/); // this result failed
  assert.match(html, /book &amp; confirm/); // scenario name, HTML-escaped
  assert.match(html, /demo-aut/);
});

test("report embeds per-turn + full-conversation audio as base64 WAV data URIs", () => {
  assert.match(html, new RegExp(`data:audio/wav;base64,${Buffer.from("FULLCALLWAV").toString("base64")}`)); // full call
  assert.match(html, new RegExp(`data:audio/wav;base64,${Buffer.from("AGENTWAV").toString("base64")}`));     // per-turn agent
  assert.match(html, new RegExp(`data:audio/wav;base64,${Buffer.from("CALLERWAV").toString("base64")}`));    // per-turn caller
});

test("report shows the oracle transcript, the gate rows, and the advisory judge", () => {
  assert.match(html, /Oracle/);
  assert.match(html, /Your table for two is booked\./); // oracle transcript text
  assert.match(html, /no_spoken_symbols/);
  assert.match(html, /grounding/);
  assert.match(html, /natural=/);             // judge dimension rendered
  assert.match(html, /sounded a bit terse/);  // judge finding rendered
});

test("lean report keeps the full-call audio but omits per-turn clips (gallery mode)", () => {
  const lean = generateReport([result], "2026-05-30T00:00:00Z", { fullCallAudioOnly: true });
  assert.match(lean, new RegExp(`data:audio/wav;base64,${Buffer.from("FULLCALLWAV").toString("base64")}`)); // full call stays
  assert.doesNotMatch(lean, new RegExp(`data:audio/wav;base64,${Buffer.from("AGENTWAV").toString("base64")}`));  // per-turn dropped
  assert.doesNotMatch(lean, new RegExp(`data:audio/wav;base64,${Buffer.from("CALLERWAV").toString("base64")}`)); // per-turn dropped
  assert.match(lean, /Your table for two is booked\./); // oracle transcript still rendered
  assert.match(lean, /no_spoken_symbols/);              // gates still rendered
});

test("encodeAudio injection transcodes embedded audio (WAV->MP3 for the gallery)", () => {
  // a stub encoder stands in for the ffmpeg WAV->MP3 step — report stays pure + testable.
  const calls: number[] = [];
  const enc = generateReport([result], "2026-05-30T00:00:00Z", {
    fullCallAudioOnly: true,
    encodeAudio: (wav) => { calls.push(wav.length); return { mime: "audio/mpeg", data: Buffer.from("MP3:" + wav.toString("ascii")) }; },
  });
  assert.match(enc, new RegExp(`data:audio/mpeg;base64,${Buffer.from("MP3:FULLCALLWAV").toString("base64")}`)); // encoded + correct mime
  assert.doesNotMatch(enc, /data:audio\/wav/); // no raw WAV left
  assert.equal(calls.length, 1); // only the full-call recording (lean) was encoded
});

test("opts.note renders a prominent (escaped) callout banner; absent by default", () => {
  const withNote = generateReport([result], "2026-05-30T00:00:00Z", { note: "⚠️ intentionally broken <agent>" });
  assert.match(withNote, /class="note"/);
  assert.match(withNote, /intentionally broken &lt;agent&gt;/); // escaped
  assert.doesNotMatch(html, /class="note"/); // the default report (no note) has no banner
});

test("report ESCAPES untrusted text (no raw HTML injection from caller/gate output)", () => {
  assert.doesNotMatch(html, /table <for 2>/);     // caller said — must be escaped
  assert.match(html, /table &lt;for 2&gt;/);
  assert.doesNotMatch(html, /wrong date <bad>/);  // gate detail — must be escaped
  assert.match(html, /wrong date &lt;bad&gt;/);
});

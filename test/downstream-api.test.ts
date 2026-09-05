// The downstream-tools surface: file transcription with a word timeline, text judging, a 0..1
// similarity score, phrase location in a timeline, and the offline switch. Every test here is
// offline — the one function that talks to Deepgram is exercised against a fake fetch, so the
// request shape is pinned without spending a cent or needing a key.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { transcribeFile, setOfflineMode, isOfflineMode } from "../src/deepgram.ts";
import { similarity, foldForSimilarity, lcsLength } from "../src/compare/similarity.ts";
import { findPhrase } from "../src/compare/phrase.ts";
import { diffKeys } from "../src/compare/index.ts";
import { judgeText, mockJudge, DEFAULT_RUBRIC } from "../src/judge/index.ts";
import type { WordTiming } from "../src/deepgram.ts";

process.env.DEEPGRAM_API_KEY ||= "fake-key-for-request-shape-tests";

/** A representative /v1/listen body: the fields transcribeFile promises to surface. */
const LISTEN_BODY = {
  metadata: { duration: 12.34 },
  results: {
    channels: [{ alternatives: [{
      transcript: "Hello there, your appointment is at 7:30.",
      confidence: 0.987,
      words: [
        { word: "hello", punctuated_word: "Hello", start: 0.1, end: 0.4, confidence: 0.99 },
        { word: "there", punctuated_word: "there,", start: 0.4, end: 0.8, confidence: 0.98 },
      ],
    }] }],
    utterances: [{ start: 0.1, end: 0.8, transcript: "Hello there," }],
  },
};

/** Swap global fetch for one call, capturing the request. */
async function withFakeFetch<T>(body: unknown, fn: () => Promise<T>): Promise<{ result: T; calls: Array<{ url: string; init: RequestInit }> }> {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return { ok: true, status: 200, json: async () => body, text: async () => "" } as unknown as Response;
  }) as typeof fetch;
  try { return { result: await fn(), calls }; } finally { globalThis.fetch = real; }
}

test("transcribeFile returns the full result — transcript, confidence, word timeline, utterances, duration", async () => {
  const { result, calls } = await withFakeFetch(LISTEN_BODY, () =>
    transcribeFile(Buffer.from("fake audio bytes"), { utterances: true, keyterms: ["Deepgram", "Aura"] }));

  assert.equal(result.transcript, "Hello there, your appointment is at 7:30.");
  assert.equal(result.confidence, 0.987);
  assert.equal(result.durationSec, 12.34);
  assert.equal(result.words.length, 2);
  assert.deepEqual(result.words[0], { word: "hello", punctuated_word: "Hello", start: 0.1, end: 0.4, confidence: 0.99 });
  assert.equal(result.utterances?.length, 1);
  assert.equal(result.utterances?.[0].transcript, "Hello there,");

  const { url, init } = calls[0];
  assert.match(url, /model=nova-3/);
  assert.match(url, /utterances=true/);
  // Repeatable keyterms, each its own parameter.
  assert.match(url, /keyterm=Deepgram/);
  assert.match(url, /keyterm=Aura/);
  // Containerized audio declares its own encoding and rate — sending them can contradict the file.
  assert.doesNotMatch(url, /encoding=/);
  assert.doesNotMatch(url, /sample_rate=/);
  assert.equal((init.headers as Record<string, string>)["Content-Type"], "audio/mp4");
});

test("transcribeFile: a shape change degrades to empty values instead of throwing; empty audio is an error", async () => {
  const { result } = await withFakeFetch({}, () => transcribeFile(Buffer.from("x")));
  assert.deepEqual(result, { transcript: "", confidence: 0, words: [], durationSec: 0 });
  assert.equal(result.utterances, undefined, "no utterances key when the response carries none");
  await assert.rejects(() => transcribeFile(Buffer.alloc(0)), /empty audio/);
});

test("offline mode refuses network calls BEFORE any request leaves the process", async () => {
  const real = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => { called = true; throw new Error("network reached in offline mode"); }) as typeof fetch;
  setOfflineMode(true);
  try {
    assert.equal(isOfflineMode(), true);
    await assert.rejects(() => transcribeFile(Buffer.from("x")), /offline mode: refusing to transcribe a file/);
    assert.equal(called, false, "fetch must not be called at all in offline mode");
  } finally {
    setOfflineMode(false);
    globalThis.fetch = real;
  }
});

test("similarity: 1 for the same content, formatting-tolerant, and lower as content diverges", () => {
  assert.equal(similarity("the meeting is at seven thirty", "the meeting is at seven thirty"), 1);
  // The canonicalization the gate uses carries over: spoken and smart-formatted agree.
  assert.equal(similarity("the meeting is at seven thirty", "the meeting is at 07:30"), 1);
  const partial = similarity("the meeting is at seven thirty tomorrow", "the meeting is at seven thirty");
  assert.ok(partial > 0.5 && partial < 1, `expected a partial score, got ${partial}`);
  assert.ok(similarity("the meeting is at seven thirty", "completely unrelated words entirely") < 0.3);
  assert.equal(similarity("", ""), 1);
  assert.equal(similarity("something", ""), 0);
});

test("similarity: contractions fold, and fillers are ignored only when asked", () => {
  assert.equal(similarity("I do not know", "I don't know"), 1, "contractions fold on both sides");
  assert.equal(similarity("we cannot do that", "we can't do that"), 1);
  const withFillers = "um so the uh appointment is confirmed you know";
  const clean = "so the appointment is confirmed";
  assert.equal(similarity(clean, withFillers, { ignoreFillers: true }), 1);
  assert.ok(similarity(clean, withFillers) < 1, "fillers count against the score by default");
  assert.equal(foldForSimilarity("I don't know, you know", { ignoreFillers: true }), "i do not know,");
});

test("the diff and the similarity score stay linear in memory on 10,000-token inputs", () => {
  const N = 10000;
  const a = Array.from({ length: N }, (_, i) => `w${i % 900}`);
  const b = a.slice();
  for (let i = 0; i < N; i += 37) b[i] = `x${i}`;
  const before = process.memoryUsage().heapUsed;
  const ops = diffKeys(a, b);
  const len = lcsLength(a, b);
  const deltaMB = (process.memoryUsage().heapUsed - before) / 1048576;
  assert.ok(ops.length >= N, `expected a full op stream, got ${ops.length}`);
  assert.ok(len > N * 0.9, `expected most tokens to align, got ${len}`);
  // The quadratic table this used to allocate would be hundreds of megabytes at this size.
  assert.ok(deltaMB < 200, `diffing ${N} tokens used ${deltaMB.toFixed(1)} MB of heap`);
});

const TIMELINE: WordTiming[] = [
  "thanks for calling acme support how can i help you today".split(" "),
].flat().map((word, i) => ({ word, start: i * 0.5, end: i * 0.5 + 0.4, confidence: 0.9 }));

test("findPhrase locates an expected line in the word timeline and reports its span", () => {
  const hit = findPhrase(TIMELINE, "thanks for calling acme support");
  assert.ok(hit, "expected to find the greeting");
  assert.equal(hit!.index, 0);
  assert.equal(hit!.score, 1);
  assert.equal(hit!.start, 0);
  assert.ok(Math.abs(hit!.end - 2.4) < 1e-9, `expected the 5th word to end at 2.4s, got ${hit!.end}`);
});

test("findPhrase honors the time window, tolerates a mishearing, and returns null when absent", () => {
  // Restricted to a window that starts after the greeting: the phrase is no longer eligible.
  assert.equal(findPhrase(TIMELINE, "thanks for calling acme support", { from: 3 }), null);
  // A window that contains it still finds it.
  assert.ok(findPhrase(TIMELINE, "how can i help you", { from: 2.5, to: 6 }));
  // One word misheard out of five is still a match (3/5 is the floor).
  assert.ok(findPhrase(TIMELINE, "thanks for calling acme telephone"));
  // Nothing like it in the timeline.
  assert.equal(findPhrase(TIMELINE, "your refund has been processed today"), null);
  assert.equal(findPhrase(TIMELINE, "   "), null, "an empty phrase matches nothing");
});

test("judgeText grades a bare transcript with no Trace, and refuses an empty one", async () => {
  const verdict = await judgeText("caller: hello\nagent: star star hello star star", DEFAULT_RUBRIC, mockJudge);
  assert.equal(verdict.backend, "mock");
  assert.ok(verdict.dimensions.length > 0);
  assert.ok(verdict.findings.length > 0, "the mock judge flags a spoken symbol");
  await assert.rejects(() => judgeText("   ", DEFAULT_RUBRIC, mockJudge), /empty transcript/);
});

const cli = (args: string[]) =>
  spawnSync("node", ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", "src/cli.ts", ...args],
    { encoding: "utf8", cwd: process.cwd(), env: { ...process.env, DEEPGRAM_API_KEY: "" } });

test("stt and judge fail closed on a bad invocation (exit 2), and --offline refuses to go live (exit 1)", () => {
  assert.equal(cli(["stt"]).status, 2, "no file is a usage error");
  assert.equal(cli(["stt", "no-such-file.m4a"]).status, 2, "a missing file is a usage error");
  assert.equal(cli(["judge"]).status, 2, "no --transcript is a usage error");
  assert.equal(cli(["judge", "--transcript", "no-such-file.txt"]).status, 2);

  // A real file, offline: the command must refuse rather than reach the API — and must not need
  // a key to do so, which is the whole point of the switch.
  const r = cli(["stt", "package.json", "--offline"]);
  assert.equal(r.status, 1, `expected exit 1, got ${r.status}\n${r.stderr}`);
  assert.match(r.stderr, /offline mode: refusing/);
});

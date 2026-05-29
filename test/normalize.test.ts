// Unit tests for voice-safety detection + spoken-form normalization.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectArtifacts, detectDashAsNegative, numberToWords, spokenTime, spokenDate, stripMarkdown,
} from "../src/normalize.ts";

test("detectArtifacts flags spoken symbols, ignores clean text", () => {
  assert.deepEqual(detectArtifacts("your table is star star booked"), ["star"]);
  assert.ok(detectArtifacts("pound pound tonight's menu").includes("pound"));
  assert.deepEqual(detectArtifacts("your table is booked for tonight"), []);
});

test("detectArtifacts is word-boundary aware (no false hit inside a word)", () => {
  assert.deepEqual(detectArtifacts("we are starting dinner service"), []); // 'starting' != 'star'
});

test("detectDashAsNegative catches multi-word amounts", () => {
  assert.equal(detectDashAsNegative("salmon negative thirty two dollars"), true);
  assert.equal(detectDashAsNegative("the special is negative fifteen dollars"), true);
  assert.equal(detectDashAsNegative("your refund is fifteen dollars"), false);
});

test("numberToWords across ranges", () => {
  assert.equal(numberToWords(0), "zero");
  assert.equal(numberToWords(7), "seven");
  assert.equal(numberToWords(13), "thirteen");
  assert.equal(numberToWords(20), "twenty");
  assert.equal(numberToWords(32), "thirty-two");
  assert.equal(numberToWords(100), "one hundred");
  assert.equal(numberToWords(265), "two hundred sixty-five");
  assert.equal(numberToWords(-15), "negative fifteen");
  assert.equal(numberToWords(1000), "1000"); // out of spoken range -> passthrough
});

test("spokenTime renders 24h as 12h words", () => {
  assert.equal(spokenTime("19:30"), "seven thirty PM");
  assert.equal(spokenTime("19:00"), "seven PM");
  assert.equal(spokenTime("09:15"), "nine fifteen AM");
  assert.equal(spokenTime("00:05"), "twelve oh five AM");
  assert.equal(spokenTime("not-a-time"), "not-a-time"); // passthrough
});

test("spokenDate renders ISO as words; rejects bad month", () => {
  assert.equal(spokenDate("2026-05-30"), "May thirty, two thousand twenty-six");
  assert.equal(spokenDate("2026-13-01"), "2026-13-01"); // invalid month -> passthrough
  assert.equal(spokenDate("nope"), "nope");
});

test("stripMarkdown removes emphasis/headings/lists/code", () => {
  assert.equal(stripMarkdown("Your table is **booked**."), "Your table is booked.");
  assert.equal(stripMarkdown("## Menu"), "Menu");
  assert.equal(stripMarkdown("- one\n- two"), "one two");
  assert.equal(stripMarkdown("use `code` here"), "use code here");
});

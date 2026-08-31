// The normalization-aware comparison gate — the equivalence classes that MUST
// pass (smart formatting is not an error), the real errors that MUST fail (the
// gate keeps its teeth), and the tier/diagnostic surface. Offline, keyless.

import { test } from "node:test";
import assert from "node:assert/strict";
import { compare, summarize } from "../src/compare/index.ts";

// --- Equivalences that MUST pass: smart formatting is not an error ---------

const MUST_PASS: [string, string][] = [
  ["The meeting starts at seven thirty tomorrow morning.",
    "The meeting starts at 7:30 tomorrow morning."],
  ["The store opens at nine o'clock.",
    "The store opens at 9 o'clock."],
  ["The store opens at nine o'clock.",
    "The store opens at 9:00."],
  ["Your train leaves at eight forty five.",
    "Your train leaves at 8:45."],
  ["Your total comes to twelve dollars and fifty cents.",
    "Your total comes to $12.50."],
  ["The invoice was for one thousand two hundred dollars.",
    "The invoice was for $1,200."],
  ["There are one hundred twenty three files in the folder.",
    "There are 123 files in the folder."],
  ["Your confirmation number is four two seven nine.",
    "Your confirmation number is 4279."],
  ["The package arrives on March third, twenty twenty five.",
    "The package arrives on March 3rd, 2025."],
  // Observed live: smart formatting can emit the whole date as digits.
  ["The package arrives on March third, twenty twenty five.",
    "The package arrives on 03/03/2025."],
  ["The office reopens on Monday, June first.",
    "The office reopens on Monday, June 1st."],
  ["The office reopens on Monday, June first.",
    "The office reopens on Monday, June 1."],
  ["She finished in twenty first place.",
    "She finished in 21st place."],
  ["The discount comes to fifteen percent.",
    "The discount comes to 15%."],
  ["The company was founded in nineteen ninety nine.",
    "The company was founded in 1999."],
  ["The board measures two point five meters.",
    "The board measures 2.5 meters."],
  ["Are you free on Friday afternoon?",
    "Are you free on Friday afternoon"],
  ["Your appointment on April tenth at nine fifteen will cost forty dollars.",
    "Your appointment on April 10th at 9:15 will cost $40."],
];

for (const [expected, heard] of MUST_PASS) {
  test(`passes: "${expected}" ≡ "${heard}"`, () => {
    const r = compare(expected, heard);
    assert.equal(r.pass, true, summarize(r));
  });
}

// --- Real errors that MUST fail: the gate keeps its teeth ------------------

const MUST_FAIL: [string, string][] = [
  // A real misheard time — the error class this gate exists to catch: a naive
  // string comparison flags the formatting ("7:30"), while the actual danger
  // is a content change ("7:13") that formatting-tolerance must NOT absorb.
  ["The meeting starts at seven thirty tomorrow morning.",
    "The meeting starts at 7:13 tomorrow morning."],
  // Wrong amount.
  ["Your total comes to twelve dollars and fifty cents.",
    "Your total comes to $12.15."],
  // Wrong number.
  ["There are one hundred twenty three files in the folder.",
    "There are 132 files in the folder."],
  // A dropped digit in an identifier.
  ["Your confirmation number is four two seven nine.",
    "Your confirmation number is 479."],
  // Wrong month.
  ["The package arrives on March third, twenty twenty five.",
    "The package arrives on May 3rd, 2025."],
  // Wrong day in the slash form.
  ["The package arrives on March third, twenty twenty five.",
    "The package arrives on 03/13/2025."],
  // A pronoun misheard as a month — an error class observed live.
  ["We reopen on Monday.", "May reopen on Monday."],
  // Wrong word.
  ["The quick brown fox jumps over the lazy dog.",
    "The quick brown fox jumps over the crazy dog."],
  // A dropped word.
  ["Are you free on Friday afternoon?",
    "Are you free on Friday?"],
  // Wrong percent.
  ["The discount comes to fifteen percent.",
    "The discount comes to 50%."],
  // Wrong year.
  ["The company was founded in nineteen ninety nine.",
    "The company was founded in 1989."],
  // Empty transcript (total transcription failure).
  ["The store opens at nine o'clock.", ""],
];

for (const [expected, heard] of MUST_FAIL) {
  test(`fails: "${expected}" vs "${heard}"`, () => {
    const r = compare(expected, heard);
    assert.equal(r.pass, false, `should have failed but passed at tier ${r.tier}`);
  });
}

// --- Tiers and diagnostics --------------------------------------------------

test("identical strings pass at the exact tier", () => {
  assert.equal(compare("Hello there.", "hello there.").tier, "exact");
});

test("formatting equivalence passes at the canonical tier", () => {
  const r = compare("at seven thirty", "at 7:30");
  assert.equal(r.tier, "canonical");
});

test("split digit groups pass at the digit-merge tier", () => {
  const r = compare("five five five one two one two", "555 1212");
  assert.equal(r.pass, true);
  assert.equal(r.tier, "digit-merge");
});

test("failures carry a usable diff", () => {
  const r = compare("at seven thirty", "at 7:13");
  assert.equal(r.pass, false);
  const sub = r.diff.find((d) => d.op === "sub");
  assert.ok(sub, "expected a substitution in the diff");
  assert.equal(sub.expected, "time:7:30");
  assert.equal(sub.heard, "time:7:13");
  assert.ok((r.tokenErrorRate ?? 0) > 0);
  assert.match(summarize(r), /FAIL/);
});

test("the summary of a pass names the tier", () => {
  assert.match(summarize(compare("at seven thirty", "at 7:30")), /PASS \(canonical\)/);
});

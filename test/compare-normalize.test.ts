// Canonical tokenization for the round-trip comparison gate — every equivalence
// class proven on BOTH surfaces (spoken-form words and smart-formatted text),
// so "seven thirty" and "07:30" reduce to the same keys. Offline, keyless.

import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalKeys } from "../src/compare/normalize.ts";
import { compare } from "../src/compare/index.ts";

function keys(text: string): string[] {
  return canonicalKeys(text);
}

test("plain words lowercase and lose punctuation", () => {
  assert.deepEqual(keys("Are you free on Friday afternoon?"),
    ["are", "you", "free", "on", "friday", "afternoon"]);
});

test("spoken time folds to a time token", () => {
  assert.deepEqual(keys("at seven thirty tomorrow"), ["at", "time:7:30", "tomorrow"]);
});

test("written clock time folds to the same time token", () => {
  assert.deepEqual(keys("at 7:30 tomorrow"), ["at", "time:7:30", "tomorrow"]);
  assert.deepEqual(keys("at 07:30 tomorrow"), ["at", "time:7:30", "tomorrow"]);
});

test("o clock folds to a time token on both surfaces", () => {
  assert.deepEqual(keys("nine o'clock"), ["time:9:00"]);
  assert.deepEqual(keys("9 o'clock"), ["time:9:00"]);
  assert.deepEqual(keys("9:00"), ["time:9:00"]);
});

test("minutes below ten fold via the oh form", () => {
  assert.deepEqual(keys("seven oh five"), ["time:7:05"]);
  assert.deepEqual(keys("7:05"), ["time:7:05"]);
});

test("spoken money folds to a money token", () => {
  assert.deepEqual(keys("twelve dollars and fifty cents"), ["money:12.50"]);
  assert.deepEqual(keys("$12.50"), ["money:12.50"]);
});

test("round money amounts with thousands separators", () => {
  assert.deepEqual(keys("one thousand two hundred dollars"), ["money:1200.00"]);
  assert.deepEqual(keys("$1,200"), ["money:1200.00"]);
});

test("cents alone fold to fractional money", () => {
  assert.deepEqual(keys("fifty cents"), ["money:0.50"]);
});

test("compound cardinals parse to one number", () => {
  assert.deepEqual(keys("one hundred twenty three files"), ["num:123", "files"]);
  assert.deepEqual(keys("123 files"), ["num:123", "files"]);
  assert.deepEqual(keys("one hundred and twenty three"), ["num:123"]);
  assert.deepEqual(keys("four thousand four hundred seventeen"), ["num:4417"]);
});

test("digit runs concatenate", () => {
  assert.deepEqual(keys("four two seven nine"), ["num:4279"]);
  assert.deepEqual(keys("4279"), ["num:4279"]);
});

test("phone-style hyphen groups merge on the written side", () => {
  assert.deepEqual(keys("five five five one two one two"), ["num:5551212"]);
  assert.deepEqual(keys("555-1212"), ["num:5551212"]);
});

test("spoken year pairs fold to four-digit years", () => {
  assert.deepEqual(keys("twenty twenty five"), ["num:2025"]);
  assert.deepEqual(keys("nineteen ninety nine"), ["num:1999"]);
  assert.deepEqual(keys("2025"), ["num:2025"]);
});

test("ordinals equal their cardinal number", () => {
  assert.deepEqual(keys("twenty first place"), ["num:21", "place"]);
  assert.deepEqual(keys("21st place"), ["num:21", "place"]);
});

test("month plus day folds to a date token on every surface", () => {
  assert.deepEqual(keys("march third"), ["date:3:3"]);
  assert.deepEqual(keys("March 3rd"), ["date:3:3"]);
  assert.deepEqual(keys("3/3"), ["date:3:3"]);
  assert.deepEqual(keys("june first"), ["date:6:1"]);
  assert.deepEqual(keys("June 1st"), ["date:6:1"]);
  assert.deepEqual(keys("June 1"), ["date:6:1"]);
  assert.deepEqual(keys("april tenth"), ["date:4:10"]);
});

test("a month name without a day number stays a plain word", () => {
  assert.deepEqual(keys("may reopen on monday"), ["may", "reopen", "on", "monday"]);
  assert.deepEqual(keys("back in march"), ["back", "in", "march"]);
});

test("percent folds on both surfaces", () => {
  assert.deepEqual(keys("fifteen percent"), ["pct:15"]);
  assert.deepEqual(keys("15%"), ["pct:15"]);
});

test("decimals fold on both surfaces", () => {
  assert.deepEqual(keys("two point five meters"), ["num:2.5", "meters"]);
  assert.deepEqual(keys("2.5 meters"), ["num:2.5", "meters"]);
});

test("meridiem spellings normalize but stay separate words", () => {
  assert.deepEqual(keys("ten pm"), ["num:10", "pm"]);
  assert.deepEqual(keys("10 PM"), ["num:10", "pm"]);
  assert.deepEqual(keys("10 p.m."), ["num:10", "pm"]);
});

test("hyphenated number words split and refold", () => {
  assert.deepEqual(keys("twenty-first"), ["num:21"]);
  assert.deepEqual(keys("one-hundred-twenty-three"), ["num:123"]);
});

test("a full date with year folds consistently on every surface", () => {
  const expected = ["the", "package", "arrives", "on", "date:3:3:2025"];
  assert.deepEqual(keys("the package arrives on march third twenty twenty five"), expected);
  assert.deepEqual(keys("The package arrives on March 3rd, 2025."), expected);
  // Smart formatting has been observed returning the slash form.
  assert.deepEqual(keys("The package arrives on 03/03/2025."), expected);
});

test("a text ending on a bare 19 or 20 stays a plain number (the year fold must not read past the end of the stream)", () => {
  assert.deepEqual(keys("room 20"), ["room", "num:20"]);
  assert.deepEqual(keys("gate 19"), ["gate", "num:19"]);
  assert.deepEqual(keys("chapter twenty"), ["chapter", "num:20"]);
  // …and both surfaces still converge, so the equivalence gates as a pass.
  assert.equal(compare("room twenty", "room 20").pass, true);
});

test("adjacent independent numbers do not merge into one", () => {
  // "seven three" is two numbers, not 73 and not a time (3 is one digit).
  assert.deepEqual(keys("rooms seven three"), ["rooms", "num:73"]);
  // Note: bare adjacent single digits fold as a digit run — that is intended,
  // because identifiers are spoken digit by digit.
});

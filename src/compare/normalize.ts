// Canonical tokenization for the normalization-aware comparison gate: turn a text
// (spoken-form or smart-formatted) into a canonical token stream, so that
// "seven thirty" and "07:30" compare as equal while "seven thirteen" and "07:30"
// compare as different.
//
// The pipeline has two halves:
//   1. A written-form pre-pass (regexes over the raw string) that lifts
//      formatted entities — $12.50, 07:30, 15%, 3rd, 555-1212 — into typed
//      markers before tokenization.
//   2. A spoken-form folding pass (over the token stream) that parses English
//      number words, digit runs, ordinals, money, percent, o'clock, and
//      year/time pairs into the same typed tokens.
// Both halves run on BOTH texts, so each side converges to the same canonical
// form regardless of which surface form it arrived in.
//
// NOTE: the pipeline ORDER is load-bearing (pre-pass → foldSpokenNumbers →
// foldMoneyPercentTime → foldYearsAndTimes → foldDates). These tables PARSE
// spoken forms into values — the inverse direction of src/normalize.ts's
// generators (which render values as spoken words) — so they intentionally
// stay self-contained here rather than sharing tables with the gate helpers.

// ---------------------------------------------------------------------------
// Word tables
// ---------------------------------------------------------------------------

const UNITS: Record<string, number> = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4,
  five: 5, six: 6, seven: 7, eight: 8, nine: 9,
};

const TEENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};

const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

const SCALES: Record<string, number> = { hundred: 100, thousand: 1000, million: 1000000, billion: 1000000000 };

const ORDINAL_UNITS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
  sixth: 6, seventh: 7, eighth: 8, ninth: 9,
  tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14,
  fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19,
};

const ORDINAL_TENS: Record<string, number> = {
  twentieth: 20, thirtieth: 30, fortieth: 40, fiftieth: 50,
  sixtieth: 60, seventieth: 70, eightieth: 80, ninetieth: 90,
};

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

const isUnitWord = (w: string): boolean => Object.hasOwn(UNITS, w);
const isTeenWord = (w: string): boolean => Object.hasOwn(TEENS, w);
const isTensWord = (w: string): boolean => Object.hasOwn(TENS, w);
const isScaleWord = (w: string): boolean => Object.hasOwn(SCALES, w);
const isOrdinalWord = (w: string): boolean => Object.hasOwn(ORDINAL_UNITS, w) || Object.hasOwn(ORDINAL_TENS, w);
const isNumberWord = (w: string): boolean =>
  isUnitWord(w) || isTeenWord(w) || isTensWord(w) || isScaleWord(w) || isOrdinalWord(w);

// ---------------------------------------------------------------------------
// Tokens. Every token carries:
//   key — the canonical comparison key (tier-2 equality)
//   dm  — the digit-merge form (tier-3 fallback; null for plain words)
// ---------------------------------------------------------------------------

/** A canonical token — the unit both texts are reduced to before comparison. */
export type Token =
  | { type: "word"; word: string; key: string; dm: null }
  | { type: "num"; digits: string; key: string; dm: string }
  | { type: "time"; h: number; m: number; key: string; dm: string }
  | { type: "money"; value: number; key: string; dm: string }
  | { type: "pct"; value: number; key: string; dm: string }
  | { type: "date"; m: number; d: number; y: number | null; key: string; dm: string };

function stripLeadingZeros(s: string): string {
  return s.replace(/^0+(?=\d)/, "");
}

function wordToken(w: string): Token {
  return { type: "word", word: w, key: w, dm: null };
}

function numToken(digits: string): Token {
  // digits: a string like "123", "05", "2.5", "5551212"
  const canonical = digits.includes(".") ? digits : stripLeadingZeros(digits);
  return { type: "num", digits, key: `num:${canonical}`, dm: digits };
}

function timeToken(h: number, m: number): Token {
  const mm = String(m).padStart(2, "0");
  return { type: "time", h, m, key: `time:${h}:${mm}`, dm: `${h}${mm}` };
}

// Money keeps its ".00" in dm on purpose, so money never digit-merges with a bare integer.
function moneyToken(value: number): Token {
  const v = value.toFixed(2);
  return { type: "money", value, key: `money:${v}`, dm: v };
}

function pctToken(value: number): Token {
  return { type: "pct", value, key: `pct:${value}`, dm: String(value) };
}

function dateToken(m: number, d: number, y: number | null = null): Token {
  const key = y === null ? `date:${m}:${d}` : `date:${m}:${d}:${y}`;
  return { type: "date", m, d, y, key, dm: `${m}${d}${y ?? ""}` };
}

// ---------------------------------------------------------------------------
// Written-form pre-pass
// ---------------------------------------------------------------------------

function writtenPrePass(text: string): string[] {
  let s = text.toLowerCase();

  // Normalize meridiem spellings to bare am/pm words.
  s = s.replace(/\b([ap])\.\s?m\.?(?=\s|$|[^\w])/g, "$1m");

  // Currency: $12.50, $1,200 → marker (commas stripped inside the amount).
  s = s.replace(/\$\s?([\d,]+(?:\.\d{1,2})?)/g, (_, amt: string) => ` __money_${amt.replace(/,/g, "")}__ `);

  // Clock times: 7:30, 07:30, 12:05 → marker.
  s = s.replace(/\b(\d{1,2}):(\d{2})\b/g, " __time_$1_$2__ ");

  // Slash dates (month/day/year US order, as smart formatting emits them):
  // 03/03/2025 → marker; 3/14 → marker without year. Year form first.
  s = s.replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, " __date_$1_$2_$3__ ");
  s = s.replace(/\b(\d{1,2})\/(\d{1,2})\b/g, " __date_$1_$2__ ");

  // Thousands separators inside plain numbers: 1,200 → 1200.
  while (/\d,\d{3}\b/.test(s)) s = s.replace(/(\d),(\d{3})\b/g, "$1$2");

  // Percent: 15% → marker.
  s = s.replace(/(\d+(?:\.\d+)?)\s?%/g, " __pct_$1__ ");

  // Ordinal digit suffixes: 3rd, 21st, 10th → bare digits.
  s = s.replace(/\b(\d+)(?:st|nd|rd|th)\b/g, "$1");

  // Hyphen-joined digit groups (phone-style): 555-1212 → 5551212.
  s = s.replace(/\b\d+(?:-\d+)+\b/g, (m) => m.replace(/-/g, ""));

  // Remaining hyphens and en/em dashes become spaces (twenty-first → twenty first).
  s = s.replace(/[-–—]/g, " ");

  // Curly apostrophes → straight.
  s = s.replace(/[‘’]/g, "'");

  // Periods that are not decimal points become spaces.
  s = s.replace(/(?<!\d)\.|\.(?!\d)/g, " ");

  // All other punctuation becomes a space; keep letters, digits, apostrophes,
  // underscores (markers), and decimal points.
  s = s.replace(/[^a-z0-9'_.\s]/g, " ");

  return s.split(/\s+/).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Marker decoding + raw token classification
// ---------------------------------------------------------------------------

function decodeToken(w: string): Token | null {
  let m: RegExpExecArray | null;
  if ((m = /^__money_([\d.]+)__$/.exec(w))) return moneyToken(Number(m[1]));
  if ((m = /^__time_(\d{1,2})_(\d{2})__$/.exec(w))) return timeToken(Number(m[1]), Number(m[2]));
  if ((m = /^__pct_([\d.]+)__$/.exec(w))) return pctToken(Number(m[1]));
  if ((m = /^__date_(\d{1,2})_(\d{1,2})(?:_(\d{4}))?__$/.exec(w))) {
    return dateToken(Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : null);
  }
  if (/^\d+(?:\.\d+)?$/.test(w)) return numToken(w);
  // Strip any leading/trailing stray apostrophes ('cause → cause), keep inner ones.
  const cleaned = w.replace(/^'+|'+$/g, "");
  return cleaned ? wordToken(cleaned) : null;
}

// ---------------------------------------------------------------------------
// Spoken-form number parsing
// ---------------------------------------------------------------------------

interface ParsedNumber {
  digits: string;
  consumed: number;
  ordinal: boolean;
}

// Parse a compound English number starting at words[i].
// Returns { digits, consumed, ordinal } or null.
function parseCompound(words: string[], i: number): ParsedNumber | null {
  let value = 0; // completed scale groups (thousand and above)
  let current = 0; // the in-progress group under 1000
  let consumed = 0;
  let sawAny = false;
  let ordinal = false;
  let lastWasTens = false;
  let lastWasUnitOrTeen = false;

  let j = i;
  while (j < words.length) {
    const w = words[j];

    if (isUnitWord(w) && w !== "oh") {
      if (lastWasUnitOrTeen) break; // "seven three" — two separate numbers
      if (lastWasTens && UNITS[w] === 0) break;
      current += UNITS[w];
      lastWasUnitOrTeen = true;
      lastWasTens = false;
    } else if (isTeenWord(w)) {
      if (lastWasUnitOrTeen || lastWasTens) break; // "twenty ten" / "seven eleven" split
      current += TEENS[w];
      lastWasUnitOrTeen = true;
      lastWasTens = false;
    } else if (isTensWord(w)) {
      if (lastWasTens || lastWasUnitOrTeen) break; // "twenty twenty" / "seven thirty" split
      current += TENS[w];
      lastWasTens = true;
      lastWasUnitOrTeen = false;
    } else if (w === "hundred") {
      if (!sawAny && current === 0) break;
      current = (current || 1) * 100;
      lastWasTens = false;
      lastWasUnitOrTeen = false;
    } else if (isScaleWord(w)) { // thousand / million / billion
      value += (current || 1) * SCALES[w];
      current = 0;
      lastWasTens = false;
      lastWasUnitOrTeen = false;
    } else if (w === "and" && sawAny) {
      // "one hundred and twenty three" — allowed only when a number word follows.
      const next = words[j + 1];
      if (!next || !(isNumberWord(next) && !isOrdinalWord(next))) break;
      j += 1;
      consumed += 1;
      continue;
    } else if (Object.hasOwn(ORDINAL_UNITS, w)) {
      // "twenty first" → 21; "third" alone → 3. Ordinal ends the number.
      if (lastWasUnitOrTeen) break;
      current += ORDINAL_UNITS[w];
      consumed += 1;
      sawAny = true;
      ordinal = true;
      break;
    } else if (Object.hasOwn(ORDINAL_TENS, w)) {
      if (lastWasTens || lastWasUnitOrTeen) break;
      current += ORDINAL_TENS[w];
      consumed += 1;
      sawAny = true;
      ordinal = true;
      break;
    } else if (w === "point" && sawAny) {
      // Decimal: "two point five" → 2.5 ; "three point one four" → 3.14
      let frac = "";
      let k = j + 1;
      while (k < words.length && isUnitWord(words[k])) {
        frac += String(UNITS[words[k]]);
        k += 1;
      }
      if (!frac) break;
      const whole = value + current;
      return { digits: `${whole}.${frac}`, consumed: k - i, ordinal: false };
    } else {
      break;
    }

    sawAny = true;
    j += 1;
    consumed += 1;
  }

  if (!sawAny) return null;
  return { digits: String(value + current), consumed, ordinal };
}

// Parse a digit run: two or more consecutive single-digit words ("four two
// seven nine" → "4279", "oh five" → "05"). "oh" counts only inside a run.
// A non-oh leading digit followed by "oh" does NOT start a run — "seven oh
// five" splits into 7 and "05" so the time fold can read it as 7:05.
function parseDigitRun(words: string[], i: number): { digits: string; consumed: number } | null {
  if (words[i] !== "oh" && words[i + 1] === "oh") return null;
  let digits = "";
  let j = i;
  while (j < words.length && isUnitWord(words[j])) {
    digits += String(UNITS[words[j]]);
    j += 1;
  }
  if (digits.length < 2) return null;
  return { digits, consumed: j - i };
}

// ---------------------------------------------------------------------------
// Folding passes over the token stream
// ---------------------------------------------------------------------------

function foldSpokenNumbers(words: string[]): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < words.length) {
    const w = words[i];
    if (w === "oh" && isUnitWord(words[i + 1])) {
      // "oh five" — a digit run starting with oh (minutes, ID fragments).
      const run = parseDigitRun(words, i);
      if (run) {
        tokens.push(numToken(run.digits));
        i += run.consumed;
        continue;
      }
    }
    if (isNumberWord(w) && w !== "oh") {
      // Digit run wins only when the run is pure single digits AND the word
      // after the first is also a single digit (so "one hundred…" compounds).
      const run = parseDigitRun(words, i);
      const compound = parseCompound(words, i);
      if (run && (!compound || compound.consumed < run.consumed)) {
        tokens.push(numToken(run.digits));
        i += run.consumed;
        continue;
      }
      if (compound) {
        tokens.push(numToken(compound.digits));
        i += compound.consumed;
        continue;
      }
    }
    const t = decodeToken(w);
    if (t) tokens.push(t);
    i += 1;
  }
  return tokens;
}

function isIntNum(t: Token | undefined): t is Token & { type: "num"; digits: string } {
  return t?.type === "num" && !t.digits.includes(".");
}

function numVal(t: Token & { type: "num" }): number {
  return Number(t.digits);
}

function foldMoneyPercentTime(tokens: Token[]): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    const next = tokens[i + 1];

    // money: NUM dollar(s) [and NUM cent(s)]
    if (t.type === "num" && next?.type === "word" && /^dollars?$/.test(next.word)) {
      let value = Number(t.digits);
      let consumed = 2;
      const a = tokens[i + 2];
      const b = tokens[i + 3];
      const c = tokens[i + 4];
      if (a?.type === "word" && a.word === "and" && b?.type === "num" &&
          c?.type === "word" && /^cents?$/.test(c.word)) {
        value += Number(b.digits) / 100;
        consumed = 5;
      } else if (a?.type === "num" && b?.type === "word" && /^cents?$/.test(b.word)) {
        value += Number(a.digits) / 100;
        consumed = 4;
      }
      out.push(moneyToken(value));
      i += consumed;
      continue;
    }

    // money: NUM cent(s)  ("fifty cents")
    if (t.type === "num" && next?.type === "word" && /^cents?$/.test(next.word)) {
      out.push(moneyToken(Number(t.digits) / 100));
      i += 2;
      continue;
    }

    // percent: NUM percent
    if (t.type === "num" && next?.type === "word" && next.word === "percent") {
      out.push(pctToken(Number(t.digits)));
      i += 2;
      continue;
    }

    // o'clock: NUM o'clock → time
    if (isIntNum(t) && numVal(t) >= 1 && numVal(t) <= 12 &&
        next?.type === "word" && (next.word === "o'clock" || next.word === "oclock")) {
      out.push(timeToken(numVal(t), 0));
      i += 2;
      continue;
    }

    out.push(t);
    i += 1;
  }
  return out;
}

// Year fusion, then time fusion. Both run on both sides, so both sides
// converge even when the semantic reading is ambiguous.
function foldYearsAndTimes(tokens: Token[]): Token[] {
  // Year: [19|20, 10..99] → four-digit number ("twenty twenty five" → 2025).
  // Years fold BEFORE times, so "twenty twenty five" cannot be read as 20:25.
  // The stream may END on a bare two-digit 19/20 ("room 20", "gate nineteen",
  // "chapter twenty"): there is no next token to fuse with, so the fold must not
  // read past the end of the stream — isIntNum's undefined guard keeps a trailing
  // 19/20 a plain number instead of crashing or mis-folding.
  const out: Token[] = [];
  let i = 0;
  while (i < tokens.length) {
    const a = tokens[i];
    const b = tokens[i + 1];
    if (isIntNum(a) && (numVal(a) === 19 || numVal(a) === 20) && a.digits.length === 2 &&
        isIntNum(b) && numVal(b) >= 10 && numVal(b) <= 99 && b.digits.length === 2) {
      out.push(numToken(String(numVal(a) * 100 + numVal(b))));
      i += 2;
      continue;
    }
    out.push(a);
    i += 1;
  }

  // Time: [1..24, mm] where mm is 10..59, or a two-digit "oh five"-style run.
  const out2: Token[] = [];
  i = 0;
  while (i < out.length) {
    const a = out[i];
    const b = out[i + 1];
    const mmOk = !!b && isIntNum(b) &&
      ((numVal(b) >= 10 && numVal(b) <= 59 && b.digits.length === 2) ||
       (b.digits.length === 2 && b.digits.startsWith("0")));
    if (isIntNum(a) && numVal(a) >= 1 && numVal(a) <= 24 && a.digits.length <= 2 && mmOk && isIntNum(b)) {
      out2.push(timeToken(numVal(a), numVal(b)));
      i += 2;
      continue;
    }
    out2.push(a);
    i += 1;
  }
  return out2;
}

// Date fusion: a month name immediately followed by a day number becomes a
// date token, absorbing a following four-digit year. Runs after year fusion so
// "twenty twenty five" has already become 2025. A month name NOT followed by a
// day number stays a plain word ("may reopen", "in march"). US month/day order;
// year window 1500..2199 — intentional looseness, matched on both sides.
function foldDates(tokens: Token[]): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    const day = tokens[i + 1];
    if (t.type === "word" && Object.hasOwn(MONTHS, t.word) &&
        isIntNum(day) && numVal(day) >= 1 && numVal(day) <= 31 &&
        day.digits.length <= 2) {
      const yearTok = tokens[i + 2];
      const hasYear = isIntNum(yearTok) &&
        yearTok.digits.length === 4 && numVal(yearTok) >= 1500 && numVal(yearTok) <= 2199;
      out.push(dateToken(MONTHS[t.word], numVal(day), hasYear && isIntNum(yearTok) ? numVal(yearTok) : null));
      i += hasYear ? 3 : 2;
      continue;
    }
    // A written date marker followed by a loose four-digit year never occurs
    // (the pre-pass captures the year), so no symmetric case is needed here.
    out.push(t);
    i += 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Canonical token stream for a text. */
export function canonicalTokens(text: string): Token[] {
  const words = writtenPrePass(text);
  let tokens = foldSpokenNumbers(words);
  tokens = foldMoneyPercentTime(tokens);
  tokens = foldYearsAndTimes(tokens);
  tokens = foldDates(tokens);
  return tokens;
}

/** Canonical comparison keys (tier-2 equality). */
export function canonicalKeys(text: string): string[] {
  return canonicalTokens(text).map((t) => t.key);
}

/** Digit-merge stream (tier-3 fallback): every numeric-ish token flattened to
 *  its digit form, adjacent flattened tokens concatenated, words unchanged. */
export function digitMergeKeys(tokens: Token[]): string[] {
  const out: string[] = [];
  let pending: string | null = null;
  for (const t of tokens) {
    if (t.dm !== null) {
      pending = pending === null ? t.dm : pending + t.dm;
    } else {
      if (pending !== null) { out.push(pending); pending = null; }
      out.push(t.key);
    }
  }
  if (pending !== null) out.push(pending);
  return out;
}

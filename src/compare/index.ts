// The normalization-aware comparison gate — pure and I/O-free.
//
// Given the reference text (what was sent to text-to-speech) and the heard
// text (what speech-to-text returned), decide whether the round trip
// preserved the content. Formatting differences that smart formatting
// legitimately introduces — "seven thirty" heard back as "7:30" — pass;
// content differences — "seven thirty" heard back as "seven thirteen" — fail.
//
// Three tiers, checked in order:
//   exact       — the raw strings match after case/whitespace folding
//   canonical   — the canonical token streams match (normalize.ts)
//   digit-merge — the streams match after flattening numeric tokens to digit
//                 strings and concatenating adjacent ones (rescues split
//                 formatting like "555 1212" vs "5551212", and cross-type
//                 ambiguity like a year heard as a clock time)
// Anything else fails, with a token-level diff.

import { canonicalTokens, digitMergeKeys } from "./normalize.ts";

export { canonicalTokens, canonicalKeys, digitMergeKeys, type Token } from "./normalize.ts";

/** Which tier a comparison passed at (null while failing). */
export type CompareTier = "exact" | "canonical" | "digit-merge";

/** One step of the token-level diff. `sub` merges an adjacent missing+extra pair. */
export interface DiffOp {
  op: "equal" | "missing" | "extra" | "sub";
  expected: string | null;
  heard: string | null;
}

export interface CompareResult {
  pass: boolean;
  tier: CompareTier | null;
  expected: string;
  heard: string;
  expectedKeys: string[];
  heardKeys: string[];
  diff: DiffOp[];
  tokenErrorRate: number | null;
}

function foldWhitespace(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function seqEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

// Longest-common-subsequence diff over two key arrays.
export function diffKeys(expected: string[], heard: string[]): DiffOp[] {
  const n = expected.length;
  const m = heard.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = expected[i] === heard[j]
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (expected[i] === heard[j]) {
      ops.push({ op: "equal", expected: expected[i], heard: heard[j] });
      i++; j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ op: "missing", expected: expected[i], heard: null });
      i++;
    } else {
      ops.push({ op: "extra", expected: null, heard: heard[j] });
      j++;
    }
  }
  while (i < n) { ops.push({ op: "missing", expected: expected[i], heard: null }); i++; }
  while (j < m) { ops.push({ op: "extra", expected: null, heard: heard[j] }); j++; }

  // Merge adjacent missing+extra pairs into substitutions for readability.
  const merged: DiffOp[] = [];
  for (const op of ops) {
    const prev = merged[merged.length - 1];
    if (op.op === "extra" && prev?.op === "missing") {
      merged[merged.length - 1] = { op: "sub", expected: prev.expected, heard: op.heard };
    } else if (op.op === "missing" && prev?.op === "extra") {
      merged[merged.length - 1] = { op: "sub", expected: op.expected, heard: prev.heard };
    } else {
      merged.push({ ...op });
    }
  }
  return merged;
}

/**
 * Compare reference text against heard text.
 * Returns { pass, tier, expected, heard, expectedKeys, heardKeys, diff, tokenErrorRate }.
 */
export function compare(expected: string, heard: string): CompareResult {
  const result: CompareResult = {
    pass: false,
    tier: null,
    expected,
    heard,
    expectedKeys: [],
    heardKeys: [],
    diff: [],
    tokenErrorRate: null,
  };

  if (foldWhitespace(expected) === foldWhitespace(heard)) {
    result.pass = true;
    result.tier = "exact";
    return result;
  }

  const expTokens = canonicalTokens(expected);
  const heardTokens = canonicalTokens(heard);
  result.expectedKeys = expTokens.map((t) => t.key);
  result.heardKeys = heardTokens.map((t) => t.key);

  if (seqEqual(result.expectedKeys, result.heardKeys)) {
    result.pass = true;
    result.tier = "canonical";
    return result;
  }

  if (seqEqual(digitMergeKeys(expTokens), digitMergeKeys(heardTokens))) {
    result.pass = true;
    result.tier = "digit-merge";
    return result;
  }

  result.diff = diffKeys(result.expectedKeys, result.heardKeys);
  const errors = result.diff.filter((d) => d.op !== "equal").length;
  result.tokenErrorRate = result.expectedKeys.length
    ? errors / result.expectedKeys.length
    : (result.heardKeys.length ? 1 : 0);
  return result;
}

/** One-line human summary of a compare() result. */
export function summarize(result: CompareResult): string {
  if (result.pass) return `PASS (${result.tier})`;
  const subs = result.diff.filter((d) => d.op === "sub")
    .map((d) => `"${d.expected}" heard as "${d.heard}"`);
  const missing = result.diff.filter((d) => d.op === "missing").map((d) => `"${d.expected}" missing`);
  const extra = result.diff.filter((d) => d.op === "extra").map((d) => `"${d.heard}" extra`);
  const detail = [...subs, ...missing, ...extra].join("; ");
  return `FAIL (token error rate ${((result.tokenErrorRate ?? 0) * 100).toFixed(0)}%): ${detail}`;
}

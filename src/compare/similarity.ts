// similarity() — a 0..1 closeness score between an expected text and what was actually heard.
//
// The gate in ./index.ts answers a yes/no question (did the round trip preserve the content?).
// Downstream tools often want a DEGREE instead: how close is this narration to the script, how
// much of the prompt survived. This module supplies that, on top of the same canonicalization,
// with two pre-passes the gate deliberately does not apply:
//
//   - contraction folding, so "don't" and "do not" are the same words;
//   - filler removal (opt-in), so "uh", "um" and "you know" do not count against a speaker.
//
// Both run BEFORE canonicalization, so the canonical token stream sees already-folded text.

import { canonicalKeys } from "./normalize.ts";

/** Contractions folded to their expanded form. "cannot" folds too, so all three spellings of
 *  can-not agree. Order matters only in that longer keys must not be shadowed by shorter ones;
 *  the replacement is a single pass over word boundaries, so they cannot overlap. */
const CONTRACTIONS: Array<[RegExp, string]> = [
  [/\bcannot\b/g, "can not"], [/\bcan't\b/g, "can not"], [/\bwon't\b/g, "will not"],
  [/\bshan't\b/g, "shall not"], [/\bain't\b/g, "is not"],
  [/\b(\w+)n't\b/g, "$1 not"], // don't, doesn't, isn't, haven't, wouldn't, …
  [/\bi'm\b/g, "i am"], [/\b(\w+)'re\b/g, "$1 are"], [/\b(\w+)'ve\b/g, "$1 have"],
  [/\b(\w+)'ll\b/g, "$1 will"], [/\b(\w+)'d\b/g, "$1 would"],
  [/\blet's\b/g, "let us"], [/\b(\w+)'s\b/g, "$1 is"], // possessives fold too; both sides fold alike
];

/** Disfluencies removed when `ignoreFillers` is set. Phrases first, then single words. */
const FILLER_PHRASES = [/\byou know\b/g, /\bi mean\b/g, /\bsort of\b/g, /\bkind of\b/g];
const FILLER_WORDS = /\b(uh+|um+|uhm|er|erm|ah+|hmm+|mm+|mhm|mmhmm)\b/g;

/** Lowercase, straighten apostrophes, fold contractions, optionally drop fillers. */
export function foldForSimilarity(text: string, opts: { ignoreFillers?: boolean } = {}): string {
  let s = text.toLowerCase().replace(/[‘’]/g, "'");
  for (const [re, to] of CONTRACTIONS) s = s.replace(re, to);
  if (opts.ignoreFillers) {
    for (const re of FILLER_PHRASES) s = s.replace(re, " ");
    s = s.replace(FILLER_WORDS, " ");
  }
  return s.replace(/\s+/g, " ").trim();
}

/** Length of the longest common subsequence, in O(min(n,m)) memory (two rolling rows).
 *  The full ALIGNMENT is a separate, heavier problem — see diffKeys in ./index.ts. */
export function lcsLength(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  // Iterate over the longer sequence so the rows track the shorter one.
  const [outer, inner] = a.length >= b.length ? [a, b] : [b, a];
  let prev = new Int32Array(inner.length + 1);
  let cur = new Int32Array(inner.length + 1);
  for (let i = 1; i <= outer.length; i++) {
    for (let j = 1; j <= inner.length; j++) {
      cur[j] = outer[i - 1] === inner[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    const swap = prev; prev = cur; cur = swap;
    cur.fill(0);
  }
  return prev[inner.length];
}

export interface SimilarityOpts {
  /** Drop disfluencies ("uh", "um", "you know", …) from BOTH sides before comparing. */
  ignoreFillers?: boolean;
}

/**
 * How close is `heard` to `expected`, from 0 (nothing in common) to 1 (same content)?
 *
 * Both sides are folded (contractions, optional fillers) and canonicalized — so "seven thirty"
 * scores 1.0 against "07:30", the same equivalence the gate enforces — and the score is the
 * longest common subsequence of canonical tokens over the LONGER side's length. Dividing by the
 * longer side means padding the heard text with extra words lowers the score, rather than
 * rewarding a transcript that contains the expected text plus a paragraph of noise.
 *
 * Two empty texts score 1; one empty side scores 0.
 */
export function similarity(expected: string, heard: string, opts: SimilarityOpts = {}): number {
  const a = canonicalKeys(foldForSimilarity(expected, opts));
  const b = canonicalKeys(foldForSimilarity(heard, opts));
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  return lcsLength(a, b) / Math.max(a.length, b.length);
}

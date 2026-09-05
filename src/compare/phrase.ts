// findPhrase() — locate an expected phrase inside a word timeline.
//
// transcribeFile() returns every word with a start and end time. That turns two awkward
// questions into arithmetic: did the agent say this line, and WHEN? Offset checks ("the greeting
// begins within 2s"), boundary checks ("the disclaimer finishes before the transfer"), and
// alignment against a script all reduce to locating an n-gram in a time window.
//
// Matching is deliberately tolerant. Speech-to-text mishears words, so an exact match on all five
// words would report "not said" for a phrase a listener heard perfectly. The search scores every
// candidate window position-wise and returns the best one at or above `minScore`.

import type { WordTiming } from "../deepgram.ts";

/** Compare-ready form of a single word: lowercase, punctuation stripped. */
function normWord(w: string): string {
  return w.toLowerCase().replace(/[^a-z0-9']/g, "");
}

export interface FindPhraseOpts {
  /** Only consider words at or after this time, in seconds. Default: the start of the file. */
  from?: number;
  /** Only consider words at or before this time, in seconds. Default: the end of the file. */
  to?: number;
  /** How many words of `expectedText` to search for. Default 5 — long enough to be distinctive,
   *  short enough that one misheard word does not sink the match. */
  n?: number;
  /** Fraction of the n-gram that must match, 0..1. Default 0.6 (three of five words). */
  minScore?: number;
}

export interface PhraseMatch {
  /** Start of the matched span, in seconds. */
  start: number;
  /** End of the matched span, in seconds. */
  end: number;
  /** Fraction of the searched n-gram that matched, 0..1. */
  score: number;
  /** Index of the first matched word in the ORIGINAL `words` array. */
  index: number;
  /** The matched words, as they appear in the timeline. */
  words: string[];
}

/**
 * Find `expectedText` (its first `n` words) in a word timeline, optionally restricted to a time
 * window. Returns the best-scoring position, or null when nothing reaches `minScore`.
 */
export function findPhrase(
  words: readonly WordTiming[],
  expectedText: string,
  opts: FindPhraseOpts = {},
): PhraseMatch | null {
  const n = Math.max(1, opts.n ?? 5);
  const minScore = opts.minScore ?? 0.6;
  const from = opts.from ?? -Infinity;
  const to = opts.to ?? Infinity;

  const needle = expectedText.split(/\s+/).map(normWord).filter(Boolean).slice(0, n);
  if (needle.length === 0) return null;

  // Keep the original indices: the caller gets a position in THEIR array, not in a filtered copy.
  const eligible = words
    .map((w, index) => ({ w, index }))
    .filter(({ w }) => w.start >= from && w.end <= to);
  if (eligible.length < needle.length) return null;

  let best: PhraseMatch | null = null;
  for (let s = 0; s + needle.length <= eligible.length; s++) {
    let hits = 0;
    for (let k = 0; k < needle.length; k++) {
      if (normWord(eligible[s + k].w.word) === needle[k]) hits++;
    }
    const score = hits / needle.length;
    if (score >= minScore && (best === null || score > best.score)) {
      const span = eligible.slice(s, s + needle.length);
      best = {
        start: span[0].w.start,
        end: span[span.length - 1].w.end,
        score,
        index: span[0].index,
        words: span.map(({ w }) => w.word),
      };
      if (score === 1) break; // cannot do better
    }
  }
  return best;
}

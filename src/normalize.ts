// Voice-safety detection + spoken-form normalization (ported from the validated spike).
// detectArtifacts is the heart of the no_spoken_symbols gate.

// "Junk tokens" a receptionist would never say — their presence in a round-trip
// transcript means TTS spoke a symbol/markup aloud. "pound"/"hash" included after
// the spike found aura speaks `##` as "Pound Pound".
const JUNK_TOKENS = [
  "star", "asterisk", "hashtag", "hash tag", "hash", "pound", "pound sign", "pound key",
  "dollar sign", "colon", "backslash", "forward slash", "underscore",
  "caret", "tilde", "bullet point", "open bracket", "close bracket",
  "open paren", "close paren", "ampersand", "semicolon",
];

/** Spoken-symbol artifacts heard in a transcript (lowercased, word-boundary-ish). */
export function detectArtifacts(transcript: string): string[] {
  const t = ` ${transcript.toLowerCase()} `;
  return JUNK_TOKENS.filter((tok) => t.includes(` ${tok} `) || t.startsWith(`${tok} `) || t.endsWith(` ${tok}`));
}

/** The dash-as-minus price bug: "negative … dollars" (a Markdown `Item - $price`
 *  dash spoken as a minus sign). Allows multi-word amounts ("negative thirty two dollars"). */
export function detectDashAsNegative(transcript: string): boolean {
  return /\bnegative\b[\w\s-]{0,25}\bdollars?\b/i.test(transcript);
}

// ---- spoken-form helpers (used by examples / future gates) ----

const NUMBER_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
];
const TENS_WORDS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function numberToWords(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const n = Math.trunc(value);
  if (n < 0) return `negative ${numberToWords(-n)}`;
  if (n < 20) return NUMBER_WORDS[n];
  if (n < 100) {
    const t = Math.floor(n / 10), o = n % 10;
    return o === 0 ? TENS_WORDS[t] : `${TENS_WORDS[t]}-${NUMBER_WORDS[o]}`;
  }
  if (n < 1000) {
    const h = Math.floor(n / 100), r = n % 100;
    return r === 0 ? `${NUMBER_WORDS[h]} hundred` : `${NUMBER_WORDS[h]} hundred ${numberToWords(r)}`;
  }
  return String(n);
}

export function spokenTime(time: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return time;
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  const mer = hour >= 12 ? "PM" : "AM";
  if (hour === 0) hour = 12; else if (hour > 12) hour -= 12;
  const hw = numberToWords(hour);
  if (minute === 0) return `${hw} ${mer}`;
  if (minute < 10) return `${hw} oh ${numberToWords(minute)} ${mer}`;
  return `${hw} ${numberToWords(minute)} ${mer}`;
}

export function spokenDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!m) return date;
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  if (month < 1 || month > 12) return date;
  const yearWords = year >= 2000 && year < 2100
    ? (year === 2000 ? "two thousand" : `two thousand ${numberToWords(year - 2000)}`)
    : String(year);
  return `${MONTHS[month - 1]} ${numberToWords(day)}, ${yearWords}`;
}

export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*\*([^*]+)\*\*\*/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(?<!\*)\*(?!\*)([^*\n]+?)\*(?!\*)/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

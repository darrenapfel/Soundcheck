// Deepgram REST helpers — TTS (Aura) + STT (Nova). Auth via `Token <key>`.
// The ONLY credential Soundcheck reads is DEEPGRAM_API_KEY (see getKey()).

import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";

let cachedKey: string | null = null;

function readEnvKey(loc: string | URL): string | undefined {
  try { return readFileSync(loc, "utf8").match(/^DEEPGRAM_API_KEY=(.+)$/m)?.[1].trim() || undefined; }
  catch { return undefined; }
}

/** A user-global config file (`$XDG_CONFIG_HOME/soundcheck/.env`, else `~/.config/soundcheck/.env`):
 *  a fallback so `soundcheck` works from ANY directory when the local project has no key. Checked
 *  AFTER the CWD `.env`, so a project's own key always wins. */
function globalEnvPath(): string {
  const base = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
  return join(base, "soundcheck", ".env");
}

/** Resolve the Deepgram key. Precedence: env var → the caller's CWD `.env` (what the quickstart
 *  writes) → the user-global `~/.config/soundcheck/.env` (works from any directory) → the Soundcheck
 *  package's own `.env` (repo dev only). NO other key is ever read.
 *
 *  An EXPLICITLY EMPTY env var (`DEEPGRAM_API_KEY=""`, whitespace included) short-circuits the
 *  whole chain and throws immediately — it never falls through to the `.env` files. CI systems
 *  set empty secrets to mean absent (the nightly workflow's own guard treats an empty secret as
 *  "no key"), so an explicitly empty variable must not silently pick up a stray `.env`. */
export function getKey(): string {
  if (cachedKey) return cachedKey;
  const envKey = process.env.DEEPGRAM_API_KEY;
  if (envKey !== undefined && envKey.trim() === "") {
    throw new Error("DEEPGRAM_API_KEY not set (the env var is explicitly empty — treated as absent; the .env fallbacks are skipped). Soundcheck needs only this one key.");
  }
  const key =
    envKey?.trim() ||
    readEnvKey(resolve(process.cwd(), ".env")) ||
    readEnvKey(globalEnvPath()) ||
    readEnvKey(new URL("../.env", import.meta.url));
  if (!key) {
    throw new Error("DEEPGRAM_API_KEY not set (env, ./.env, ~/.config/soundcheck/.env, or the Soundcheck package .env). Soundcheck needs only this one key.");
  }
  cachedKey = key;
  return key;
}

/** OFFLINE MODE. A dry run can go live by accident: the key resolves from the CWD `.env`, the
 *  user-global `~/.config/soundcheck/.env`, or the package `.env`, so a command a developer
 *  believes is offline may quietly reach the network and spend money. `--offline` (or
 *  `setOfflineMode(true)`) makes every network entry point refuse instead. It is a hard refusal,
 *  not a fallback: nothing silently degrades to a mock. */
let offlineMode = false;
export function setOfflineMode(on: boolean): void { offlineMode = on; }
export function isOfflineMode(): boolean { return offlineMode; }
/** Throw before any request leaves the process. Called by every network entry point. */
export function assertNetworkAllowed(what: string): void {
  if (offlineMode) {
    throw new Error(`offline mode: refusing to ${what}. Re-run without --offline to allow network calls.`);
  }
}

/** A 4xx other than 429 is the caller's fault (bad key/request) — not worth retrying. */
function httpError(label: string, status: number, body: string): Error {
  const e = new Error(`${label} ${status}: ${body.slice(0, 200)}`) as Error & { retryable?: boolean };
  e.retryable = status >= 500 || status === 429;
  return e;
}

/** fetch with a hard timeout so a hung request can't block a run forever. */
async function fetchWithTimeout(url: string, init: RequestInit, ms = 30000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); }
  finally { clearTimeout(timer); }
}

async function withRetry<T>(fn: () => Promise<T>, label: string, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if ((e as { retryable?: boolean })?.retryable === false) throw e; // bad key/request → don't waste retries
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw new Error(`${label} failed after ${tries} tries: ${(last as Error)?.message ?? last}`);
}

export interface TtsOpts {
  model?: string; // aura model
  encoding?: string; // "linear16"
  sampleRate?: number; // 16000 for caller-in, 24000 for standalone
  container?: string; // "none" (raw PCM) or "wav"
}

/** Synthesize text -> audio bytes (raw PCM by default). */
export async function synthesize(text: string, opts: TtsOpts = {}): Promise<Buffer> {
  const model = opts.model ?? "aura-2-thalia-en";
  const encoding = opts.encoding ?? "linear16";
  const sampleRate = opts.sampleRate ?? 24000;
  const container = opts.container ?? "none";
  assertNetworkAllowed("synthesize speech (Deepgram text-to-speech)");
  const url = `https://api.deepgram.com/v1/speak?model=${model}&encoding=${encoding}&sample_rate=${sampleRate}&container=${container}`;
  return withRetry(async () => {
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: { Authorization: `Token ${getKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw httpError("TTS", res.status, await res.text());
    return Buffer.from(await res.arrayBuffer());
  }, "Deepgram TTS");
}

export interface SttOpts {
  model?: string;
  encoding?: string; // for raw PCM: "linear16"
  sampleRate?: number;
  contentType?: string; // "audio/l16" for raw, "audio/wav" for wav
  /** Opt IN to smart formatting ("seven thirty" → "7:30") for the round-trip comparison
   *  gate, whose whole job is formatting-equivalence verification. Absent/false keeps the
   *  harness default EXACTLY as before: literal spoken words (smart_format/numerals off). */
  smartFormat?: boolean;
}

/** The slice of Deepgram's /v1/listen JSON we read — the top alternative's transcript.
 *  Narrow on purpose: every field optional so a shape change degrades to "" (see transcribe). */
interface DeepgramListenResponse {
  results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> };
}

/** Transcribe audio -> literal spoken words (smart_format/numerals OFF on purpose; pass
 *  `smartFormat: true` to opt in to smart formatting for the round-trip comparison gate). */
export async function transcribe(audio: Buffer, opts: SttOpts = {}): Promise<string> {
  if (audio.length === 0) return "";
  assertNetworkAllowed("transcribe audio (Deepgram speech-to-text)");
  const model = opts.model ?? "nova-3";
  const params = opts.smartFormat
    ? new URLSearchParams({ model, punctuate: "true", smart_format: "true" }) // no numerals: smart formatting owns number rendering
    : new URLSearchParams({ model, punctuate: "true", smart_format: "false", numerals: "false" });
  if (opts.encoding) params.set("encoding", opts.encoding);
  if (opts.sampleRate) params.set("sample_rate", String(opts.sampleRate));
  const contentType = opts.contentType ?? "audio/wav";
  return withRetry(async () => {
    const res = await fetchWithTimeout(`https://api.deepgram.com/v1/listen?${params}`, {
      method: "POST",
      headers: { Authorization: `Token ${getKey()}`, "Content-Type": contentType },
      body: Uint8Array.from(audio),
    });
    if (!res.ok) throw httpError("STT", res.status, await res.text());
    const j = (await res.json()) as DeepgramListenResponse;
    return j?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
  }, "Deepgram STT");
}

/** One word from Deepgram's word timeline. `punctuated_word` is present when formatting is on. */
export interface WordTiming {
  word: string;
  punctuated_word?: string;
  start: number; // seconds from the start of the file
  end: number;
  confidence: number;
}

/** One utterance segment (only when `utterances: true` was requested). */
export interface TranscriptUtterance {
  start: number;
  end: number;
  transcript: string;
}

/** The full transcription result — everything a downstream tool needs to check WHAT was said,
 *  WHEN it was said, and how sure the model is. Deliberately richer than `transcribe()`, which
 *  returns only the top alternative's text because the harness gates read nothing else. */
export interface FileTranscript {
  transcript: string;
  confidence: number;
  words: WordTiming[];
  utterances?: TranscriptUtterance[];
  durationSec: number;
}

export interface FileSttOpts {
  /** Content type of the bytes. Default `audio/mp4` (m4a/AAC). Containerized audio carries its
   *  own encoding and sample rate, so those parameters are deliberately NOT sent — Deepgram
   *  reads them from the container, and sending them can contradict the file. */
  mime?: string;
  model?: string; // default nova-3
  /** Boost domain vocabulary (nova-3 `keyterm`). Each term is sent as its own parameter. */
  keyterms?: string[];
  /** Ask for utterance segmentation (`results.utterances`). */
  utterances?: boolean;
  /** Hard cap on the request. Default 120000 — long files legitimately take minutes. */
  timeoutMs?: number;
  /** Formatting. Default TRUE here (unlike `transcribe()`, whose harness path wants literal
   *  spoken words): `punctuated_word` exists only when the model is formatting, and a caller
   *  asking for a word timeline generally wants readable text. Pass false for literal words. */
  smartFormat?: boolean;
}

/** The slice of /v1/listen we read for a file transcription. Every field optional: a shape
 *  change degrades to empty values rather than throwing. */
interface DeepgramFileResponse {
  metadata?: { duration?: number };
  results?: {
    channels?: Array<{ alternatives?: Array<{
      transcript?: string;
      confidence?: number;
      words?: Array<{ word?: string; punctuated_word?: string; start?: number; end?: number; confidence?: number }>;
    }> }>;
    utterances?: Array<{ start?: number; end?: number; transcript?: string }>;
  };
}

/**
 * Transcribe a whole audio FILE and return the full result — transcript, confidence, the word
 * timeline, optional utterance segments, and the media duration. This is the surface downstream
 * tools build on (offset checks, boundary checks, phrase location); `transcribe()` stays the
 * harness's narrow text-only path.
 */
export async function transcribeFile(bytes: Buffer | Uint8Array, opts: FileSttOpts = {}): Promise<FileTranscript> {
  if (!bytes || bytes.length === 0) throw new Error("transcribeFile: empty audio (0 bytes)");
  assertNetworkAllowed("transcribe a file (Deepgram speech-to-text)");
  const model = opts.model ?? "nova-3";
  const smart = opts.smartFormat ?? true;
  const params = new URLSearchParams({ model, punctuate: "true", smart_format: String(smart) });
  // NO encoding / sample_rate: the container declares them (see FileSttOpts.mime).
  if (opts.utterances) params.set("utterances", "true");
  for (const term of opts.keyterms ?? []) {
    if (term.trim()) params.append("keyterm", term.trim());
  }
  const mime = opts.mime ?? "audio/mp4";
  const timeoutMs = opts.timeoutMs ?? 120000;
  return withRetry(async () => {
    const res = await fetchWithTimeout(`https://api.deepgram.com/v1/listen?${params}`, {
      method: "POST",
      headers: { Authorization: `Token ${getKey()}`, "Content-Type": mime },
      body: Uint8Array.from(bytes),
    }, timeoutMs);
    if (!res.ok) throw httpError("STT(file)", res.status, await res.text());
    const j = (await res.json()) as DeepgramFileResponse;
    const alt = j?.results?.channels?.[0]?.alternatives?.[0] ?? {};
    const words: WordTiming[] = (alt.words ?? []).map((w) => ({
      word: w.word ?? "",
      ...(w.punctuated_word === undefined ? {} : { punctuated_word: w.punctuated_word }),
      start: w.start ?? 0,
      end: w.end ?? 0,
      confidence: w.confidence ?? 0,
    }));
    const out: FileTranscript = {
      transcript: alt.transcript ?? "",
      confidence: alt.confidence ?? 0,
      words,
      durationSec: j?.metadata?.duration ?? 0,
    };
    const utts = j?.results?.utterances;
    if (utts) {
      out.utterances = utts.map((u) => ({ start: u.start ?? 0, end: u.end ?? 0, transcript: u.transcript ?? "" }));
    }
    return out;
  }, "Deepgram STT(file)");
}

/** Resample mono 16-bit little-endian PCM via linear interpolation.
 *  Used to upsample Evaline's 16kHz caller audio to the agent's 24kHz so a stitched
 *  conversation plays at one consistent rate. Good enough for listening (not DSP-grade). */
export function resamplePcm16le(pcm: Buffer, fromRate: number, toRate: number): Buffer {
  if (fromRate === toRate || pcm.length < 4) return pcm;
  const inSamples = Math.floor(pcm.length / 2);
  const outSamples = Math.max(1, Math.round((inSamples * toRate) / fromRate));
  const out = Buffer.alloc(outSamples * 2);
  const ratio = (inSamples - 1) / Math.max(1, outSamples - 1);
  for (let i = 0; i < outSamples; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, inSamples - 1);
    const frac = pos - i0;
    const s0 = pcm.readInt16LE(i0 * 2);
    const s1 = pcm.readInt16LE(i1 * 2);
    out.writeInt16LE(Math.round(s0 + (s1 - s0) * frac), i * 2);
  }
  return out;
}

/** Wrap raw linear16 PCM in a minimal WAV header (for browser <audio> playback). */
export function pcmToWav(pcm: Buffer, sampleRate = 24000): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

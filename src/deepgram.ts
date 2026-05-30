// Deepgram REST helpers — TTS (Aura) + STT (Nova). Auth via `Token <key>`.
// The ONLY credential Soundcheck reads is DEEPGRAM_API_KEY (see getKey()).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let cachedKey: string | null = null;

function readEnvKey(loc: string | URL): string | undefined {
  try { return readFileSync(loc, "utf8").match(/^DEEPGRAM_API_KEY=(.+)$/m)?.[1].trim() || undefined; }
  catch { return undefined; }
}

/** Resolve the Deepgram key. Precedence: env var → the caller's CWD `.env` (what the quickstart
 *  writes) → the Soundcheck package's own `.env` (repo dev only). NO other key is ever read. */
export function getKey(): string {
  if (cachedKey) return cachedKey;
  const key =
    process.env.DEEPGRAM_API_KEY?.trim() ||
    readEnvKey(resolve(process.cwd(), ".env")) ||
    readEnvKey(new URL("../.env", import.meta.url));
  if (!key) {
    throw new Error("DEEPGRAM_API_KEY not set (env, ./.env, or the Soundcheck package .env). Soundcheck needs only this one key.");
  }
  cachedKey = key;
  return key;
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
}

/** The slice of Deepgram's /v1/listen JSON we read — the top alternative's transcript.
 *  Narrow on purpose: every field optional so a shape change degrades to "" (see transcribe). */
interface DeepgramListenResponse {
  results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> };
}

/** Transcribe audio -> literal spoken words (smart_format/numerals OFF on purpose). */
export async function transcribe(audio: Buffer, opts: SttOpts = {}): Promise<string> {
  if (audio.length === 0) return "";
  const model = opts.model ?? "nova-3";
  const params = new URLSearchParams({ model, punctuate: "true", smart_format: "false", numerals: "false" });
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

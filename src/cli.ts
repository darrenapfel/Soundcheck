// Soundcheck CLI — `run` (drive scenarios, gate, report) and `validate` (standalone round-trip).
// Reads ONE credential: DEEPGRAM_API_KEY (see deepgram.ts getKey()).

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { getKey, synthesize, transcribe } from "./deepgram.ts";
import { detectArtifacts, detectDashAsNegative } from "./normalize.ts";
import { evalineTurns } from "./caller/evaline.ts";
import { DeepgramVoiceAgentAdapter } from "./adapters/deepgram-va.ts";
import { buildTranscript } from "./capture/transcript.ts";
import { runGates } from "./gates/index.ts";
import { generateReport } from "./report/html.ts";
import type { AUTConfig, Scenario, ScenarioResult } from "./types.ts";

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) { out[k] = next; i++; } else out[k] = true;
    } else positional.push(a);
  }
  return { positional, opts: out };
}

async function loadAut(path: string): Promise<AUTConfig> {
  const abs = resolve(process.cwd(), path);
  const mod = await import(pathToFileURL(abs).href);
  const cfg = mod.default ?? mod.config;
  if (!cfg?.systemPrompt) throw new Error(`AUT config at ${path} must default-export an AUTConfig`);
  return cfg as AUTConfig;
}

function loadScenarios(dir: string): Scenario[] {
  const abs = resolve(process.cwd(), dir);
  const files = readdirSync(abs).filter((f) => f.endsWith(".json")).sort();
  if (!files.length) throw new Error(`no .json scenarios in ${dir}`);
  return files.map((f) => JSON.parse(readFileSync(join(abs, f), "utf8")) as Scenario);
}

async function cmdRun(positional: string[], opts: Record<string, string | boolean>) {
  getKey(); // fail fast if missing
  const dir = positional[0] ?? "scenarios";
  const autPath = (opts.aut as string) ?? "examples/tabletalk/grounded.ts";
  const aut = await loadAut(autPath);
  let scenarios = loadScenarios(dir);
  if (typeof opts.only === "string") scenarios = scenarios.filter((s) => s.name.includes(opts.only as string));
  const adapter = new DeepgramVoiceAgentAdapter();
  console.log(`\nSoundcheck — running ${scenarios.length} scenario(s) against AUT "${aut.label}" (adapter: ${adapter.label})\n`);

  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    process.stdout.write(`▶ ${scenario.name} (persona=${scenario.persona}) … `);
    const turns = evalineTurns(scenario);
    const raw = await adapter.runConversation(aut, turns);
    const transcript = await buildTranscript(scenario, aut.label, raw);
    const gates = runGates(transcript, scenario);
    const passed = gates.every((g) => g.pass);
    results.push({ transcript, gates, passed });
    console.log(passed ? "PASS" : "FAIL");
    for (const g of gates) console.log(`    ${g.pass ? "✅" : "🚩"} ${g.name} — ${g.detail}`);
  }

  mkdirSync(resolve(process.cwd(), "runs"), { recursive: true });
  const out = (opts.out as string) ?? `runs/report-${aut.label}.html`;
  writeFileSync(resolve(process.cwd(), out), generateReport(results, new Date().toISOString()));
  const allPass = results.every((r) => r.passed);
  console.log(`\n${allPass ? "✅ all gates passed" : "🚩 gate failures present"} — report: ${out}\n`);
  process.exit(allPass ? 0 : 1);
}

async function cmdValidate(opts: Record<string, string | boolean>) {
  getKey();
  if (typeof opts.tts === "string") {
    const wav = await synthesize(opts.tts, { container: "wav", sampleRate: 24000 });
    const heard = await transcribe(wav, { contentType: "audio/wav" });
    const arts = detectArtifacts(heard);
    const dash = detectDashAsNegative(heard);
    const clean = arts.length === 0 && !dash;
    console.log(`\n  input : ${JSON.stringify(opts.tts)}`);
    console.log(`  heard : ${JSON.stringify(heard)}`);
    console.log(`  verdict: ${clean ? "✅ clean" : "🚩 " + [...arts, dash ? "negative-$" : ""].filter(Boolean).join(", ")}\n`);
    process.exit(clean ? 0 : 1);
  }
  if (typeof opts.stt === "string") {
    const audio = readFileSync(resolve(process.cwd(), opts.stt));
    const heard = await transcribe(audio, { contentType: "audio/wav" });
    console.log(`\n  heard : ${JSON.stringify(heard)}\n`);
    process.exit(0);
  }
  console.error("usage: soundcheck validate --tts \"<text>\"  |  --stt <file.wav>");
  process.exit(2);
}

function help() {
  console.log(`Soundcheck — voice-agent test harness (Deepgram-key-only)

  soundcheck run <scenariosDir> [--aut <config.ts>] [--out <report.html>]
      Drive Evaline against the agent-under-test, gate the result, write a report.
      Default --aut: examples/tabletalk/grounded.ts. Exits non-zero iff a gate fails.

  soundcheck validate --tts "<text>"     Round-trip text -> TTS -> STT; flag spoken symbols.
  soundcheck validate --stt <file.wav>   Transcribe an audio file.

Requires only DEEPGRAM_API_KEY (env or .env).`);
}

const { positional, opts } = parseArgs(process.argv.slice(2));
const cmd = positional.shift();
try {
  if (cmd === "run") await cmdRun(positional, opts);
  else if (cmd === "validate") await cmdValidate(opts);
  else help();
} catch (e) {
  console.error(`\n✖ ${(e as Error).message}\n`);
  process.exit(1);
}

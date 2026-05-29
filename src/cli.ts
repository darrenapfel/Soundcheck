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
import { saveCassette, loadCassette } from "./capture/cassette.ts";
import { runGates } from "./gates/index.ts";
import { judgeTranscript, mockJudge } from "./judge/index.ts";
import { deepgramVaJudge } from "./judge/deepgram-va-judge.ts";
import { calibrate, formatReport } from "./calibration/index.ts";
import { generateReport } from "./report/html.ts";
import type { AUTConfig, Scenario, ScenarioResult, Transcript } from "./types.ts";

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
  const replay = opts.replay === true;
  const record = opts.record === true;
  if (!replay) getKey(); // live/record need the key; replay is fully offline
  const dir = positional[0] ?? "scenarios";
  const autPath = (opts.aut as string) ?? "examples/tabletalk/grounded.ts";
  const aut = await loadAut(autPath); // module load only — no network even in replay
  let scenarios = loadScenarios(dir);
  if (typeof opts.only === "string") scenarios = scenarios.filter((s) => s.name.includes(opts.only as string));
  const adapter = new DeepgramVoiceAgentAdapter();
  const mode = replay ? "replay (offline)" : record ? "live + record" : "live";
  console.log(`\nSoundcheck — running ${scenarios.length} scenario(s) against AUT "${aut.label}" — mode: ${mode}\n`);

  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    process.stdout.write(`▶ ${scenario.name} (persona=${scenario.persona}) … `);
    let transcript: Transcript;
    if (replay) {
      transcript = loadCassette(scenario.name, aut.label);
      if (transcript.scenario !== scenario.name || transcript.persona !== scenario.persona) {
        throw new Error(`cassette for ${scenario.name}/${aut.label} doesn't match the scenario (cassette scenario="${transcript.scenario}", persona="${transcript.persona}") — re-record it`);
      }
    } else {
      const turns = evalineTurns(scenario);
      const raw = await adapter.runConversation(aut, turns);
      transcript = await buildTranscript(scenario, aut.label, raw);
      if (record) saveCassette(transcript);
    }
    const gates = runGates(transcript, scenario);
    const passed = gates.every((g) => g.pass);
    let verdict;
    if (opts.judge) {
      const useMock = opts.judge === "mock";
      if (!useMock) getKey(); // live judge needs the key (replay path skipped it)
      verdict = await judgeTranscript(transcript, useMock ? mockJudge : deepgramVaJudge);
    }
    results.push({ transcript, gates, passed, verdict });
    console.log(passed ? "PASS" : "FAIL");
    for (const g of gates) console.log(`    ${g.pass ? "✅" : "🚩"} ${g.name} — ${g.detail}`);
    if (verdict) console.log(`    ⚖ judge(${verdict.backend}): ${verdict.dimensions.map((d) => `${d.key}=${d.value}`).join(", ")}${verdict.findings[0] ? ` | ${verdict.findings[0]}` : ""}`);
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

async function cmdCalibrate(opts: Record<string, string | boolean>) {
  const live = opts.judge === "live";
  const backend = live ? deepgramVaJudge : mockJudge;
  if (live) getKey();
  const report = await calibrate(backend);
  console.log("\n" + formatReport(report) + "\n");
  if (typeof opts.out === "string") {
    mkdirSync(resolve(process.cwd(), "runs"), { recursive: true });
    writeFileSync(resolve(process.cwd(), opts.out), JSON.stringify(report, null, 2) + "\n");
    console.log(`report written: ${opts.out}\n`);
  }
}

function help() {
  console.log(`Soundcheck — voice-agent test harness (Deepgram-key-only)

  soundcheck run <scenariosDir> [--aut <config.ts>] [--out <report.html>] [--record|--replay] [--only <name>]
      Drive Evaline against the agent-under-test, gate the result, write a report.
      Default --aut: examples/tabletalk/grounded.ts. Exits non-zero iff a gate fails.
      --record : live run, then save a cassette for deterministic replay.
      --replay : offline — load the cassette, run gates, no socket/STT/key needed.
      --judge  : also run the LLM judge (advisory, not gating). --judge mock = offline rule-based;
                 otherwise the live Deepgram-fronted grader (needs the key).

  soundcheck validate --tts "<text>"     Round-trip text -> TTS -> STT; flag spoken symbols.
  soundcheck validate --stt <file.wav>   Transcribe an audio file.

  soundcheck calibrate [--judge live] [--out <file.json>]
      Score the judge against the self-constructed labeled corpus (agreement/precision/recall).
      Default uses the offline mock judge; --judge live uses the Deepgram-fronted grader.

Requires only DEEPGRAM_API_KEY (env or .env).`);
}

const { positional, opts } = parseArgs(process.argv.slice(2));
const cmd = positional.shift();
try {
  if (cmd === "run") await cmdRun(positional, opts);
  else if (cmd === "validate") await cmdValidate(opts);
  else if (cmd === "calibrate") await cmdCalibrate(opts);
  else help();
} catch (e) {
  console.error(`\n✖ ${(e as Error).message}\n`);
  process.exit(1);
}

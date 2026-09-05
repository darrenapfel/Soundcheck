// Soundcheck CLI — `run` (drive scenarios, gate, report) and `validate` (standalone round-trip).
// Reads ONE credential: DEEPGRAM_API_KEY (see deepgram.ts getKey()).

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, cpSync, rmSync, symlinkSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { getKey, setOfflineMode, synthesize, transcribe, transcribeFile } from "./deepgram.ts";
import { detectArtifacts, detectDashAsNegative } from "./normalize.ts";
import { compare, summarize } from "./compare/index.ts";
import { loadManifest, checkFixtures, roundtripFixtures, generateFixtures } from "./fixtures/index.ts";
import type { FixtureRow } from "./fixtures/index.ts";
import { evalineTurns } from "./caller/evaline.ts";
import { ScriptedCaller, GoalDrivenCaller } from "./caller/policy.ts";
import { deepgramVaPlanner } from "./caller/planner.ts";
import { DeepgramVoiceAgentAdapter } from "./adapters/deepgram-va.ts";
import { MockAUTAdapter } from "./adapters/mock-aut.ts";
import { buildTranscript } from "./capture/transcript.ts";
import { saveCassette, loadCassette, safeSegment } from "./capture/cassette.ts";
import { runGates } from "./gates/index.ts";
import { judgeTranscript, judgeText, mockJudge, DEFAULT_RUBRIC } from "./judge/index.ts";
import { deepgramVaJudge, makeDeepgramVaJudge } from "./judge/deepgram-va-judge.ts";
import { calibrate, formatReport, crossModelAlign, formatAlignment } from "./calibration/index.ts";
import { authorSuite } from "./author/index.ts";
import { tune, formatTuneResult, diagnose } from "./tune/index.ts";
import type { ScenarioSet, TuneScore, Diagnosis } from "./tune/index.ts";
import { spawnSync } from "node:child_process";
import { generateReport } from "./report/html.ts";
import { buildJsonReport } from "./report/json.ts";
import { compareRuns, formatBakeoff } from "./bakeoff/index.ts";
import { promoteTrace } from "./regress/index.ts";
import type { Rubric } from "./judge/types.ts";
import type { AUTConfig, Persona, Scenario, ScenarioResult, Trace } from "./types.ts";
import type { ConversationCapture } from "./adapters/types.ts";

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  // Every value a flag was given, in order, so a repeatable flag (--keyterm X --keyterm Y) keeps
  // both. `opts` still holds the LAST value, so existing single-value callers are unchanged.
  const repeated: Record<string, string[]> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) { out[k] = next; (repeated[k] ??= []).push(next); i++; } else out[k] = true;
    } else positional.push(a);
  }
  return { positional, opts: out, repeated };
}

/** The shipped package version (for the --json contract). Module-relative so it resolves the same
 *  from src/cli.ts (dev) and dist/cli.js (installed); falls back rather than throwing. */
function pkgVersion(): string {
  try {
    const p = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "package.json");
    return (JSON.parse(readFileSync(p, "utf8")) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function loadAut(path: string): Promise<AUTConfig> {
  const abs = resolve(process.cwd(), path);
  const mod = await import(pathToFileURL(abs).href);
  const cfg = mod.default ?? mod.config;
  if (!cfg?.systemPrompt) throw new Error(`AUT config at ${path} must default-export an AUTConfig`);
  return cfg as AUTConfig;
}

const VALID_PERSONAS: Persona[] = ["cooperative", "impatient", "adversarial"];

/** WAV->MP3 transcoder for the sample gallery (opt-in via `run --mp3`), shrinking embedded audio
 *  ~10x. Uses ffmpeg if present; degrades to WAV per-clip if ffmpeg is missing or fails — so the
 *  command never breaks. NOT used on the normal report path, so the shipped package stays pure. */
function makeMp3Encoder(): ((wav: Buffer) => { mime: string; data: Buffer }) | undefined {
  if (spawnSync("ffmpeg", ["-version"], { encoding: "utf8" }).status !== 0) {
    console.log("    ⚠ --mp3: ffmpeg not found on PATH — embedding WAV instead.");
    return undefined;
  }
  return (wav: Buffer) => {
    const r = spawnSync("ffmpeg", ["-loglevel", "error", "-i", "pipe:0", "-ac", "1", "-f", "mp3", "-b:a", "48k", "pipe:1"], { input: wav, maxBuffer: 128 << 20 });
    return r.status === 0 && r.stdout?.length ? { mime: "audio/mpeg", data: r.stdout as Buffer } : { mime: "audio/wav", data: wav };
  };
}

function loadScenarios(dir: string): Scenario[] {
  const abs = resolve(process.cwd(), dir);
  const files = readdirSync(abs).filter((f) => f.endsWith(".json")).sort();
  // Keep only well-formed scenario files (skips rubric.json and any other JSON).
  const scenarios = files
    .map((f) => JSON.parse(readFileSync(join(abs, f), "utf8")) as Scenario)
    .filter((s) => s && typeof s.name === "string" && Array.isArray(s.assert));
  if (!scenarios.length) throw new Error(`no valid .json scenarios in ${dir}`);
  for (const s of scenarios) {
    safeSegment(s.name, "scenario name"); // names become path segments (cassette + promoted-regression files) — reject traversal
    if (!VALID_PERSONAS.includes(s.persona)) {
      throw new Error(`scenario "${s.name}" has unknown persona "${s.persona}" — expected one of: ${VALID_PERSONAS.join(", ")}`);
    }
  }
  return scenarios;
}

// Acquire a Trace for one scenario against one AUT — the single live/replay/caller code path,
// shared by `run` and `bakeoff` so both drive the agent identically.
async function acquireTranscript(
  scenario: Scenario,
  aut: AUTConfig,
  adapter: DeepgramVoiceAgentAdapter | MockAUTAdapter,
  opts: Record<string, string | boolean>,
  log: (s: string) => void = (s) => process.stdout.write(s),
): Promise<Trace> {
  const useMockAdapter = opts.adapter === "mock";
  if (opts.replay === true) {
    const transcript = loadCassette(scenario.name, aut.label);
    if (transcript.scenario !== scenario.name || transcript.persona !== scenario.persona) {
      throw new Error(`cassette for ${scenario.name}/${aut.label} doesn't match the scenario (cassette scenario="${transcript.scenario}", persona="${transcript.persona}") — re-record it`);
    }
    return transcript;
  }
  // Caller selection (B): goal-driven (reactive) or scripted (default; supports declarative
  // barge-in). Goal-driven + barge-in are live-only via the real adapter; the mock adapter
  // always uses the scripted list.
  const goalMode = opts.caller === "goal" || (!!scenario.goal && opts.caller !== "scripted");
  let raw: ConversationCapture;
  // `stopWhen` joins goal-mode and barge-in as a reason to drive through the Caller policy:
  // deciding to hang up mid-call is a caller decision, and the pre-baked-list path below never
  // consults a Caller, so a scripted scenario with a stop condition MUST take this branch or the
  // condition would silently never fire.
  if (!useMockAdapter && (goalMode || scenario.bargeIn || scenario.stopWhen)) {
    const maxTurns = opts.turns ? Math.min(15, Math.max(2, Number(opts.turns))) : undefined; // --turns N: deeper goal-driven calls (adapter backstop is 16)
    const caller = goalMode
      ? new GoalDrivenCaller({ goal: scenario.goal ?? "Accomplish your task with the agent, then end the call.", persona: scenario.persona, plan: deepgramVaPlanner, maxTurns })
      : ScriptedCaller.fromScenario(scenario);
    log(`[${caller.label}] `);
    raw = await (adapter as DeepgramVoiceAgentAdapter).converse(aut, caller);
  } else {
    raw = await adapter.runConversation(aut, evalineTurns(scenario));
  }
  const transcript = await buildTranscript(scenario, aut.label, raw);
  if (opts.record === true) saveCassette(transcript);
  return transcript;
}

async function cmdRun(positional: string[], opts: Record<string, string | boolean>) {
  const replay = opts.replay === true;
  const record = opts.record === true;
  const useMockAdapter = opts.adapter === "mock";
  if (!replay && !useMockAdapter) getKey(); // live deepgram needs the key; replay + mock are offline
  // --json [path]: also emit the machine-readable failure contract. Bare `--json` writes JSON to
  // stdout, so ALL human output is routed to stderr to keep stdout a pristine, parseable document;
  // `--json <path>` writes the JSON to that file and leaves the normal human output on stdout.
  const jsonOut = opts.json !== undefined;
  const jsonStdout = opts.json === true;
  const say = jsonStdout ? (...a: unknown[]) => console.error(...a) : (...a: unknown[]) => console.log(...a);
  const sayw = jsonStdout ? (s: string) => { process.stderr.write(s); } : (s: string) => { process.stdout.write(s); };
  const dir = positional[0] ?? "scenarios";
  const autPath = (opts.aut as string) ?? "examples/tabletalk/grounded.ts";
  const aut = await loadAut(autPath); // module load only — no network even in replay
  let scenarios = loadScenarios(dir);
  if (typeof opts.only === "string") {
    scenarios = scenarios.filter((s) => s.name.includes(opts.only as string));
    if (scenarios.length === 0) { console.error(`\n✖ --only "${opts.only}" matched no scenarios in ${dir} — fail-closed (a filter typo must not report green).\n`); process.exit(2); }
  }
  // --persona: drive ANY scenario as a different caller (cooperative | impatient | adversarial)
  // without editing the scenario file — used to record the same scenario across all three callers.
  const personaOverride = typeof opts.persona === "string" ? opts.persona : undefined;
  if (personaOverride && !VALID_PERSONAS.includes(personaOverride as Persona)) {
    console.error(`\n✖ --persona "${personaOverride}" is not one of: ${VALID_PERSONAS.join(", ")}.\n`); process.exit(2);
  }
  const adapter = useMockAdapter ? new MockAUTAdapter({ buggy: opts.buggy === true }) : new DeepgramVoiceAgentAdapter();
  const mode = useMockAdapter ? `mock (offline${opts.buggy === true ? ", buggy" : ""})` : replay ? "replay (offline)" : record ? "live + record" : "live";
  say(`\nSoundcheck — running ${scenarios.length} scenario(s) against AUT "${aut.label}" — mode: ${mode}\n`);

  const results: ScenarioResult[] = [];
  for (const base of scenarios) {
    const scenario = personaOverride ? { ...base, persona: personaOverride as Persona } : base;
    if (replay && (scenario.liveOnly || scenario.fixtureOnly)) {
      const why = scenario.liveOnly ? "live-only (goal-driven)" : "fixture-only (authoring/tuning input)";
      say(`↷ ${scenario.name}: ${why} — skipped in --replay (drop --replay + set your key to run it)`);
      continue;
    }
    sayw(`▶ ${scenario.name} (persona=${scenario.persona}) … `);
    const transcript = await acquireTranscript(scenario, aut, adapter, opts, sayw);
    const gates = runGates(transcript, scenario, aut.tools);
    const passed = gates.every((g) => g.pass);
    let verdict;
    if (opts.judge) {
      const useMock = opts.judge === "mock";
      if (!useMock) {
        if (replay) console.log(`    ⚠ --judge (live) calls the Deepgram-fronted grader over the network and needs the key, even under --replay; pass --judge mock to stay fully offline.`);
        getKey(); // live judge needs the key (replay path skipped it)
      }
      verdict = await judgeTranscript(transcript, useMock ? mockJudge : deepgramVaJudge);
    }
    results.push({ transcript, gates, passed, verdict });
    say(passed ? "PASS" : "FAIL");
    for (const g of gates) say(`    ${g.pass ? "✅" : "🚩"} ${g.name} — ${g.detail}`);
    if (verdict) say(`    ⚖ judge(${verdict.backend}): ${verdict.dimensions.map((d) => `${d.key}=${d.value}`).join(", ")}${verdict.findings[0] ? ` | ${verdict.findings[0]}` : ""}`);
    // --promote-failures: close the loop — freeze a failing (often improvised) call into a
    // scripted regression scenario + a replayable cassette, growing the suite automatically.
    if (opts["promote-failures"] === true && !passed) {
      try {
        const reg = promoteTrace(transcript, scenario);
        const regPath = resolve(process.cwd(), dir, `${reg.name}.json`);
        if (existsSync(regPath)) say(`    (overwriting existing ${reg.name}.json)`);
        writeFileSync(regPath, JSON.stringify(reg, null, 2) + "\n");
        saveCassette({ ...transcript, scenario: reg.name }); // re-key so the regression replays offline
        say(`    ⤴ promoted → ${dir}/${reg.name}.json (+ cassette): ${reg.turns.length} turns, ${reg.assert.length} invariants`);
      } catch (e) {
        say(`    (could not promote: ${(e as Error).message})`); // e.g. no usable caller turns — skip, don't abort the run
      }
    }
  }

  if (replay && results.length === 0) {
    console.error(`\n✖ 0 scenarios replayed in ${dir} — they are all live-only/fixture-only, or were filtered out. Run live (drop --replay and set your key) to exercise them.\n`);
    process.exit(2);
  }
  mkdirSync(resolve(process.cwd(), "runs"), { recursive: true });
  const out = (opts.out as string) ?? `runs/report-${aut.label}.html`;
  const generatedAt = new Date().toISOString();
  // mp3's ffmpeg-missing warning prints to stdout (it's a gallery feature, not an agent one), which
  // would corrupt a `--json` stdout document — so skip the encoder in that mode.
  const encodeAudio = opts.mp3 === true && !jsonStdout ? makeMp3Encoder() : undefined;
  const note = typeof opts.note === "string" ? opts.note : undefined;
  writeFileSync(resolve(process.cwd(), out), generateReport(results, generatedAt, { fullCallAudioOnly: opts.lean === true, encodeAudio, note }));
  const allPass = results.every((r) => r.passed);
  if (jsonOut) {
    const report = buildJsonReport(results, { version: pkgVersion(), generatedAt, aut: aut.label, mode, scenariosDir: dir, autPath, reportPath: out });
    const json = JSON.stringify(report, null, 2);
    if (jsonStdout) process.stdout.write(json + "\n"); // the ONLY thing on stdout — a pristine, parseable document
    else writeFileSync(resolve(process.cwd(), opts.json as string), json + "\n");
  }
  say(`\n${allPass ? "✅ all gates passed" : "🚩 gate failures present"} — report: ${out}${jsonOut && !jsonStdout ? `, json: ${opts.json as string}` : ""}\n`);
  process.exit(allPass ? 0 : 1);
}

// `compare` — the normalization-aware round-trip comparison gate, standalone. Fully offline
// and keyless: exit 0 pass, 1 fail, 2 usage. An empty --heard is a legitimate input (a total
// transcription failure to gate); a missing/empty --expected is a usage error.
function cmdCompare(opts: Record<string, string | boolean>) {
  const expected = typeof opts.expected === "string" ? opts.expected : "";
  const heard = typeof opts.heard === "string" ? opts.heard : opts.heard === true ? "" : undefined;
  if (!expected || heard === undefined) {
    console.error('usage: soundcheck compare --expected "<text>" --heard "<text>" [--json]  (offline, no key)');
    process.exit(2);
  }
  const result = compare(expected, heard);
  const jsonStdout = opts.json === true;
  const say = jsonStdout ? (...a: unknown[]) => console.error(...a) : (...a: unknown[]) => console.log(...a);
  say(`compare: ${summarize(result)}`);
  if (!result.pass) {
    say(`  expected: ${result.expected}`);
    say(`  heard:    ${result.heard}`);
  }
  if (jsonStdout) process.stdout.write(JSON.stringify({ schema: 1, label: "compare", ...result }, null, 2) + "\n"); // the ONLY thing on stdout
  process.exit(result.pass ? 0 : 1);
}

// `fixtures check | roundtrip | generate` — the committed audio round-trip corpus
// (fixtures/audio/). All three call the Deepgram API and need the key; a missing key fails
// cleanly with the standard key-resolution error (exit 2) before any network attempt.
async function cmdFixtures(positional: string[], opts: Record<string, string | boolean>) {
  const sub = positional[0];
  if (sub !== "check" && sub !== "roundtrip" && sub !== "generate") {
    console.error(`usage: soundcheck fixtures <check|roundtrip|generate> [--json]\n  check     — transcribe each committed WAV (smart-formatted) and gate it against the manifest text\n  roundtrip — fresh text→TTS→STT round trip per fixture, same gate\n  generate  — maintainers: (re)record the corpus audio + observed.json`);
    process.exit(2);
  }
  try { getKey(); } catch (e) { console.error(`✖ ${(e as Error).message}`); process.exit(2); }
  const jsonStdout = opts.json === true;
  const say = jsonStdout ? (...a: unknown[]) => console.error(...a) : (...a: unknown[]) => console.log(...a);
  const manifest = loadManifest();
  const printRow = (row: FixtureRow) => {
    if (row.error) { say(`${row.id}: 🚩 ${row.error}`); return; }
    say(`${row.id}: ${summarize(row)}`);
    if (!row.pass) {
      say(`  expected: ${row.expected}`);
      say(`  heard:    ${row.heard}`);
    }
  };
  if (sub === "generate") {
    const generated = await generateFixtures(manifest, (g) => say(`generated ${g.id} (${g.bytes} bytes; observed: ${g.observed})`));
    say(`generated ${generated.length} fixtures -> fixtures/audio/ (+ observed.json)`);
    if (jsonStdout) {
      const doc = { schema: 1, label: "fixtures generate", rows: generated, summary: { passed: generated.length, total: generated.length } };
      process.stdout.write(JSON.stringify(doc, null, 2) + "\n"); // the ONLY thing on stdout
    }
    process.exit(0);
  }
  const runFlow = sub === "check" ? checkFixtures : roundtripFixtures;
  const { rows, passed, total } = await runFlow(manifest, printRow);
  say(`fixtures ${sub}: ${passed}/${total} passed`);
  if (jsonStdout) {
    const doc = { schema: 1, label: `fixtures ${sub}`, rows, summary: { passed, total } };
    process.stdout.write(JSON.stringify(doc, null, 2) + "\n"); // the ONLY thing on stdout
  }
  process.exit(passed === total ? 0 : 1);
}

async function cmdValidate(opts: Record<string, string | boolean>) {
  getKey();
  const jsonStdout = opts.json === true;
  const say = jsonStdout ? (...a: unknown[]) => console.error(...a) : (...a: unknown[]) => console.log(...a);
  if (typeof opts.tts === "string") {
    // The full round-trip gate: text → TTS → STT (smart-formatted) → artifact detection +
    // the normalization-aware comparison against the input. Clean speech alone is not a pass —
    // the agent must also have SAID the right thing.
    const wav = await synthesize(opts.tts, { container: "wav", sampleRate: 24000 });
    const heard = await transcribe(wav, { contentType: "audio/wav", smartFormat: true });
    const arts = detectArtifacts(heard);
    const dash = detectDashAsNegative(heard);
    const clean = arts.length === 0 && !dash;
    const cmp = compare(opts.tts, heard);
    const pass = clean && cmp.pass;
    say(`\n  input : ${JSON.stringify(opts.tts)}`);
    say(`  heard : ${JSON.stringify(heard)}`);
    say(`  compare: ${summarize(cmp)}`);
    if (!cmp.pass) {
      say(`    expected: ${cmp.expected}`);
      say(`    heard:    ${cmp.heard}`);
    }
    const problems = [...arts, dash ? "negative-$" : "", cmp.pass ? "" : "content mismatch"].filter(Boolean);
    say(`  verdict: ${pass ? `✅ clean + content matched (${cmp.tier})` : "🚩 " + problems.join(", ")}\n`);
    if (jsonStdout) {
      const doc = { schema: 1, label: "validate --tts", input: opts.tts, heard, artifacts: arts, dashAsNegative: dash, compare: cmp, pass };
      process.stdout.write(JSON.stringify(doc, null, 2) + "\n"); // the ONLY thing on stdout
    }
    process.exit(pass ? 0 : 1);
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
  if (live) getKey();
  // Cross-model alignment loop: a STRONGER reference model (default gpt-4o) corroborates the
  // Golden Set (no human) and the production judge's trust is reported against it. Live only.
  if (live && (opts.align || typeof opts.reference === "string")) {
    const refModel = typeof opts.reference === "string" ? opts.reference : "gpt-4o";
    const alignment = await crossModelAlign(makeDeepgramVaJudge("gpt-4o-mini"), makeDeepgramVaJudge(refModel));
    console.log("\n" + formatAlignment(alignment) + "\n");
    if (typeof opts.out === "string") {
      mkdirSync(resolve(process.cwd(), "runs"), { recursive: true });
      writeFileSync(resolve(process.cwd(), opts.out), JSON.stringify(alignment, null, 2) + "\n");
      console.log(`alignment written: ${opts.out}\n`);
    }
    process.exit(alignment.goldenSetValid ? 0 : 1);
  }
  const report = await calibrate(live ? deepgramVaJudge : mockJudge);
  console.log("\n" + formatReport(report) + "\n");
  if (typeof opts.out === "string") {
    mkdirSync(resolve(process.cwd(), "runs"), { recursive: true });
    writeFileSync(resolve(process.cwd(), opts.out), JSON.stringify(report, null, 2) + "\n");
    console.log(`report written: ${opts.out}\n`);
  }
}

async function cmdAuthor(opts: Record<string, string | boolean>) {
  const autPath = (opts.spec as string) ?? (opts.aut as string);
  if (!autPath) { console.error("usage: soundcheck author --spec <agent-config.ts> [--out <dir>]"); process.exit(2); }
  const aut = await loadAut(autPath);
  // Date anchor for generated grounding scenarios: --today (for deterministic docs/tests) else
  // today's real local date — never a stale hardcoded default that drifts into the past.
  const today = (opts.today as string) ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) { console.error(`✖ --today must be YYYY-MM-DD (got "${today}")`); process.exit(2); }
  const suite = authorSuite({ name: aut.label, systemPrompt: aut.systemPrompt, tools: aut.tools }, today);
  const outDir = (opts.out as string) ?? "scenarios-authored";
  mkdirSync(resolve(process.cwd(), outDir), { recursive: true });
  for (const s of suite.scenarios) {
    writeFileSync(resolve(process.cwd(), outDir, `${s.name}.json`), JSON.stringify(s, null, 2) + "\n");
  }
  writeFileSync(resolve(process.cwd(), outDir, "rubric.json"), JSON.stringify(suite.rubric, null, 2) + "\n");
  console.log(`\nAuthored ${suite.scenarios.length} scenario(s) + rubric.json for "${aut.label}" -> ${outDir}/  (date anchor: ${today}${opts.today ? "" : " — today; pass --today YYYY-MM-DD to pin"})`);
  for (const s of suite.scenarios) console.log(`  • ${s.name} (${s.assert.length} assertions)`);
  if (suite.businessRules.length) {
    console.log(`\nBusiness rules extracted from the spec (add assertions for these):`);
    for (const r of suite.businessRules) console.log(`  - ${r}`);
  }
  console.log(`\nNote: caller lines are mechanical starting points (templated from tool names) — review and refine them, and add assertions for the business rules above.\n`);
}

async function cmdTune(opts: Record<string, string | boolean>) {
  const fixerCmd = opts.fixer as string;
  if (!fixerCmd) {
    console.error('tune needs --fixer "<cmd>": a coding agent reading {"prompt","diagnosis"} JSON on stdin (diagnosis = the trace-driven root-cause: each failure\'s evidence + a hint) and writing an improved prompt to stdout (e.g. claude -p, codex exec, or a script).');
    process.exit(2);
  }
  getKey();
  const baseAut = await loadAut((opts.agent as string) ?? "examples/tabletalk/bare.ts");
  const trainFile = (opts.train as string) ?? "scenarios/book-modify-confirm.json";
  const heldoutFile = (opts.heldout as string) ?? "examples/authored-tabletalk/authored-bookReservation.json";
  const loadOne = (f: string) => [JSON.parse(readFileSync(resolve(process.cwd(), f), "utf8")) as Scenario];
  const train = loadOne(trainFile);
  const heldout = loadOne(heldoutFile);
  const adapter = new DeepgramVoiceAgentAdapter();
  const evalSet = async (prompt: string, scenarios: Scenario[]): Promise<TuneScore> => {
    const aut = { ...baseAut, systemPrompt: prompt };
    let passed = 0;
    const diagnosis: Diagnosis[] = [];
    for (const s of scenarios) {
      const raw = await adapter.runConversation(aut, evalineTurns(s));
      const t = await buildTranscript(s, aut.label, raw);
      const gates = runGates(t, s, aut.tools);
      if (gates.every((g) => g.pass)) passed++;
      else diagnosis.push(...diagnose(t, gates)); // trace-driven root-cause of THIS scenario's failures
    }
    // dedup by gate (same failure class across scenarios -> one entry)
    const seen = new Set<string>();
    const deduped = diagnosis.filter((d) => (seen.has(d.gate) ? false : (seen.add(d.gate), true)));
    return { passed, total: scenarios.length, diagnosis: deduped };
  };
  const evaluate = (prompt: string, set: ScenarioSet) => evalSet(prompt, set === "train" ? train : heldout);
  const propose = async (prompt: string, diagnosis: Diagnosis[]) => {
    // The fixer is the user's own --fixer command (run via `sh -c`, inherits env incl. the
    // Deepgram key — they're trusting their own tool). It receives the TRACE-DRIVEN diagnosis
    // (each failure's evidence + a remediation hint). A timeout prevents a hung fixer from blocking.
    const res = spawnSync("sh", ["-c", fixerCmd], { input: JSON.stringify({ prompt, diagnosis }), encoding: "utf8", maxBuffer: 1 << 20, timeout: 180000 });
    if (res.status !== 0 || !res.stdout?.trim()) throw new Error(`fixer command failed (status ${res.status}${res.signal ? `, signal ${res.signal}` : ""}): ${res.stderr?.slice(0, 200)}`);
    return res.stdout.trim();
  };

  console.log(`\nTuning "${baseAut.label}" — train=${trainFile}, heldout=${heldoutFile}, fixer="${fixerCmd}"`);
  console.log("(live: each step is a real call — a full run can take a few minutes)\n");
  const result = await tune(baseAut.systemPrompt, evaluate, propose, { maxIterations: Number(opts.max ?? 2), onProgress: (m) => console.log(m) });
  console.log("\n" + formatTuneResult(result) + "\n");
  mkdirSync(resolve(process.cwd(), "runs"), { recursive: true });
  writeFileSync(resolve(process.cwd(), "runs", "tuned-prompt.txt"), result.finalPrompt + "\n");
  console.log(`tuned prompt -> runs/tuned-prompt.txt  (improved=${result.improved})\n`);
  process.exit(result.improved ? 0 : 1);
}

// A/B bake-off — run ONE scenario suite against TWO agent configs and diff their gate results.
// Live (two real prompts/models/voices) or replay (each config's persisted cassettes, offline).
async function cmdBakeoff(positional: string[], opts: Record<string, string | boolean>) {
  const aPath = opts.a as string, bPath = opts.b as string;
  if (!aPath || !bPath) throw new Error("bakeoff needs two configs: soundcheck bakeoff <scenariosDir> --a <A.ts> --b <B.ts> [--replay]");
  const replay = opts.replay === true;
  const useMockAdapter = opts.adapter === "mock";
  if (!replay && !useMockAdapter) getKey();
  const dir = positional[0] ?? "scenarios";
  let scenarios = loadScenarios(dir);
  if (typeof opts.only === "string") {
    scenarios = scenarios.filter((s) => s.name.includes(opts.only as string));
    if (scenarios.length === 0) { console.error(`\n✖ --only "${opts.only}" matched no scenarios in ${dir} — fail-closed (a filter typo must not report a tie).\n`); process.exit(2); }
  }
  const autA = await loadAut(aPath), autB = await loadAut(bPath);
  const adapter = useMockAdapter ? new MockAUTAdapter({ buggy: opts.buggy === true }) : new DeepgramVoiceAgentAdapter();
  const judging = opts.judge !== undefined; // --judge [mock] : also diff the advisory judge across configs
  if (judging && opts.judge !== "mock" && !replay) getKey();
  console.log(`\nSoundcheck bake-off — A="${autA.label}" vs B="${autB.label}" over ${scenarios.length} scenario(s) — mode: ${replay ? "replay (offline)" : "live"}${judging ? " + judge" : ""}\n`);
  const runSuite = async (aut: AUTConfig): Promise<ScenarioResult[]> => {
    const out: ScenarioResult[] = [];
    for (const scenario of scenarios) {
      if (replay && (scenario.liveOnly || scenario.fixtureOnly)) { console.log(`  ↷ ${scenario.name}: ${scenario.liveOnly ? "live-only" : "fixture-only"} — skipped in --replay`); continue; }
      process.stdout.write(`  ${aut.label} ▶ ${scenario.name} … `);
      const transcript = await acquireTranscript(scenario, aut, adapter, opts);
      const gates = runGates(transcript, scenario, aut.tools);
      const passed = gates.every((g) => g.pass);
      const verdict = judging ? await judgeTranscript(transcript, opts.judge === "mock" ? mockJudge : deepgramVaJudge) : undefined;
      out.push({ transcript, gates, passed, verdict });
      console.log(passed ? "PASS" : "FAIL");
    }
    return out;
  };
  const a = await runSuite(autA);
  const b = await runSuite(autB);
  if (replay && a.length === 0) { console.error(`\n✖ 0 scenarios bakeoff-replayed in ${dir} — all live-only/fixture-only or filtered out. Run live to compare them.\n`); process.exit(2); }
  console.log("\n" + formatBakeoff(compareRuns(autA.label, autB.label, a, b)) + "\n");
}

// Convert SKILL.md (frontmatter + body) into Gemini's format (instructions.md + skill.yaml).
function writeGeminiSkill(dir: string): void {
  const md = readFileSync(join(dir, "SKILL.md"), "utf8");
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(md);
  const body = (fm ? md.slice(fm[0].length) : md).replace(/^\s+/, "");
  const meta: Record<string, string> = {};
  if (fm) for (const line of fm[1].split("\n")) { const m = /^([A-Za-z0-9_-]+):\s*(.+)$/.exec(line); if (m) meta[m[1]] = m[2].replace(/^["']|["']$/g, "").trim(); }
  const esc = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
  writeFileSync(join(dir, "instructions.md"), body);
  writeFileSync(join(dir, "skill.yaml"), `name: ${meta.name || "soundcheck"}\ndescription: ${esc(meta.description || "Soundcheck voice-agent test harness skill")}\nentry: instructions.md\n`);
}

// Install the bundled Soundcheck skill into a coding agent's user-global skills directory, so it's
// available from any project. Default target = Claude Code; --codex/--gemini/--all add the others;
// --link symlinks instead of copying (Gemini always copies — it needs generated companion files).
// No Deepgram key needed.
function cmdInstallSkill(opts: Record<string, string | boolean>) {
  const SRC = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", ".claude", "skills", "soundcheck");
  if (!existsSync(join(SRC, "SKILL.md"))) {
    console.error(`✖ Skill source not found at ${SRC}. Run this from a Soundcheck checkout/install that ships .claude/skills/soundcheck.`);
    process.exit(2);
  }
  const home = homedir();
  const all = opts.all === true;
  const claudeOnly = opts["claude-only"] === true;
  const link = opts.link === true;
  // Smart default: ALWAYS install for Claude Code, and ALSO for Codex/Gemini if that agent's home
  // already exists on this machine (adapts to the agents you actually use — no empty dirs for ones
  // you don't). --all forces all three; --claude-only opts out of auto-detect; --codex/--gemini force
  // an individual agent regardless.
  const auto = !all && !claudeOnly;
  const codexHome = process.env.CODEX_HOME || join(home, ".codex");
  const geminiHome = join(home, ".gemini");
  const want = (flag: string, agentHome: string) => all || opts[flag] === true || (auto && existsSync(agentHome));
  const targets: { label: string; dir: string; gemini?: boolean }[] = [
    { label: "Claude Code", dir: join(home, ".claude", "skills", "soundcheck") },
  ];
  if (want("codex", codexHome)) targets.push({ label: "Codex", dir: join(codexHome, "skills", "soundcheck") });
  if (want("gemini", geminiHome)) targets.push({ label: "Gemini", dir: join(geminiHome, "skills", "soundcheck"), gemini: true });

  for (const t of targets) {
    rmSync(t.dir, { recursive: true, force: true });
    mkdirSync(resolve(t.dir, ".."), { recursive: true });
    if (link && !t.gemini) {
      symlinkSync(SRC, t.dir, "dir");
      console.log(`✅ ${t.label}: linked → ${t.dir}`);
    } else {
      cpSync(SRC, t.dir, { recursive: true });
      if (t.gemini) writeGeminiSkill(t.dir);
      console.log(`✅ ${t.label}: installed → ${t.dir}${t.gemini && link ? " (copied — Gemini needs generated files, can't symlink)" : ""}`);
    }
  }
  console.log(`\nStart a new agent session — the "soundcheck" skill is now available globally. Re-run after 'git pull' (or use --link for Claude Code/Codex to auto-update).`);
}

function help() {
  console.log(`Soundcheck — voice-agent test harness (Deepgram-key-only)

  soundcheck run <scenariosDir> [--aut <config.ts>] [--out <report.html>] [--record|--replay] [--only <name>] [--persona <p>]
      Drive Evaline against the agent-under-test, gate the result, write a report.
      Default --aut: examples/tabletalk/grounded.ts. Exits non-zero iff a gate fails.
      --persona cooperative|impatient|adversarial : override the caller persona for ALL scenarios
                 in this run (e.g. record the same scenario across all three callers).
      --lean : smaller report — keep the full-call recording + oracle transcript, omit the per-turn
                 audio clips (for the committed sample gallery).
      --mp3 : transcode embedded audio to MP3 via ffmpeg (~10x smaller; pairs with --lean for
                 a compact, committable gallery). Falls back to WAV if ffmpeg is unavailable.
      --note "<text>" : render a callout at the top of the report (e.g. to mark a sample as a
                 deliberately-broken agent, so its 🚩 read as Soundcheck catching a planted bug).
      --json [<file>] : also emit the machine-readable failure contract — per scenario: gates, the
                 trace-driven diagnosis (evidence + a fix hint), what the oracle heard, and a repro
                 command. Bare --json prints JSON to stdout (all human output → stderr); --json <file>
                 writes it there instead. For a coding agent or CI to consume instead of the HTML.
      --adapter mock : test a creds-free deterministic mock agent (no key/network); add --buggy to inject faults.
                       (default adapter = deepgram-va; the openai-realtime adapter is a code-level reference, not selectable here.)
      --record : live run, then save a cassette for deterministic replay.
      --replay : offline — load the cassette, run gates, no socket/STT/key needed.
      --judge  : also run the LLM judge (advisory, not gating). --judge mock = offline rule-based;
                 otherwise the live Deepgram-fronted grader (needs the key).
      --caller goal : reactive Evaline — a Deepgram-VA brain improvises each line toward the
                 scenario's "goal" and hangs up when met (live-only; auto-on if a scenario has a goal).
                 A scenario "bargeIn" field makes the scripted caller interrupt the agent (live-only).
      --promote-failures : close the loop — freeze each FAILING call into a scripted regression
                 scenario (+ replayable cassette) in the scenarios dir, so a discovered failure
                 becomes a permanent test. Pairs with --caller goal (discover) → tune (fix).

  soundcheck validate --tts "<text>" [--json]   Round-trip text -> TTS -> STT (smart-formatted),
      flag spoken symbols AND gate the transcript against the input with the normalization-aware
      comparison ("seven thirty" heard back as "7:30" passes; "7:13" fails with a token diff).
      Exit 0 only when the comparison passes and no artifacts are detected.
  soundcheck validate --stt <file.wav>   Transcribe an audio file.

  soundcheck stt <file> [--json] [--keyterm "<term>"]... [--utterances] [--mime <type>] [--model <m>]
      Transcribe a whole audio FILE and print the full result: transcript, confidence, the word
      timeline (start/end/confidence per word), optional utterance segments, and the media
      duration. --json prints exactly that object on stdout, human text on stderr.
      --keyterm repeats to boost domain vocabulary. --mime defaults from the file extension
      (m4a/mp4, mp3, wav, flac, ogg, webm…), falling back to audio/mp4; containerized audio
      carries its own encoding and sample rate, so neither is sent.
      Exit 0 transcribed, 1 the API call failed, 2 the invocation was wrong.

  soundcheck judge --transcript <file.txt> [--rubric <rubric.json>] [--backend mock] [--json]
      Run a rubric against a transcript from anywhere — no scenario, no Trace, no rendering.
      Defaults to the built-in rubric and the live grader; --backend mock is deterministic and
      offline. --json prints the verdict on stdout, human text on stderr.

  soundcheck compare --expected "<text>" --heard "<text>" [--json]
      The normalization-aware comparison gate, standalone — fully OFFLINE, no key. Decides
      whether two surface forms carry the same content: formatting equivalences (times, money,
      dates, ordinals, digit runs, percent, decimals, years) pass; real content errors fail
      with a token-level diff. Exit 0 pass, 1 fail, 2 usage. --json emits one machine-readable
      document on stdout (human output moves to stderr).

  soundcheck fixtures <check|roundtrip|generate> [--json]
      The committed audio round-trip corpus (fixtures/audio/ — 16 canonical WAVs covering the
      known smart-formatting trap classes). Needs the key.
      check     — transcribe each committed WAV (smart-formatted) and gate it against the
                  manifest text: the recognition-drift detector.
      roundtrip — fresh text→TTS→STT round trip per fixture, same gate: the full live loop.
      generate  — maintainers only: (re)record the corpus audio + observed.json via TTS.

  soundcheck calibrate [--judge live] [--align [--reference <model>]] [--out <file.json>]
      Score the judge against the no-human Golden Set (agreement/precision/recall) + a TRUST
      verdict (may it be relied on?). Default = offline mock judge; --judge live = the
      Deepgram-fronted grader. --align (live) runs the cross-model alignment loop: a stronger
      reference model (default gpt-4o) corroborates the Golden Set, then reports the judge's trust.

  soundcheck author --spec <agent-config.ts> [--out <dir>]
      Autonomously generate a scenario suite from an agent's spec (tools + system prompt):
      scenarios derived from the tools, gates baked in, business rules extracted. No human writes cases.

  soundcheck tune --agent <config.ts> --fixer "<cmd>" [--train <s.json>] [--heldout <s.json>] [--max <n>]
      Agents tuning agents: evaluate live -> a fixer (a coding agent reading {prompt,diagnosis} JSON on
      stdin, writing an improved prompt to stdout) proposes a fix -> KEEP only if the HELD-OUT set improves
      (Goodhart guard — use a held-out scenario that is genuinely DIFFERENT from train). Writes the tuned
      prompt to runs/. Exits 0 iff the held-out score improved. (--fixer runs via 'sh -c' and inherits your env.)

  soundcheck bakeoff <scenariosDir> --a <A.ts> --b <B.ts> [--replay] [--judge [mock]] [--only <name>]
      Run ONE suite against TWO agent configs and diff the results — which config wins, on which
      gates. Live (two real prompts/models/voices) or --replay (each config's cassettes, offline).
      --judge also diffs the advisory judge dimensions (mock = offline; never changes the gate-decided winner).

  --offline (any command)
      Refuse every network call — REST and WebSocket alike — instead of making it. The key
      resolves from the environment, ./.env, ~/.config/soundcheck/.env, or the package .env, so a
      command you believe is a dry run can otherwise reach the API and spend money. With
      --offline that cannot happen: the call fails loudly rather than degrading to a mock.

  soundcheck install-skill [--all] [--claude-only] [--codex] [--gemini] [--link]
      Install the bundled Soundcheck skill (.claude/skills/soundcheck) into your user-global skills dir.
      By default installs for Claude Code (~/.claude/skills) AND any other agent already on this machine
      — Codex ($CODEX_HOME or ~/.codex) and/or Gemini (~/.gemini; gets a generated instructions.md +
      skill.yaml) — detected by whether that agent's home dir exists. --all forces all three;
      --claude-only opts out of auto-detect; --codex/--gemini force an individual agent; --link symlinks
      instead of copying. No key needed.

Requires only DEEPGRAM_API_KEY (env or .env).`);
}

const { positional, opts, repeated } = parseArgs(process.argv.slice(2));
// `stt <file>` — transcribe a whole audio FILE and print the full result: transcript, confidence,
// the word timeline, optional utterance segments, and the media duration. The surface downstream
// tools read; the harness's own STT path stays inside run/validate.
//
// Exit codes are the contract: 0 transcribed, 1 the API call failed, 2 the invocation was wrong.
async function cmdStt(positional: string[], opts: Record<string, string | boolean>, repeated: Record<string, string[]>) {
  const file = positional[0];
  if (!file) {
    console.error('usage: soundcheck stt <file> [--json] [--keyterm "<term>"]... [--utterances] [--mime <type>] [--model <m>] [--offline]');
    process.exit(2);
  }
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) { console.error(`✖ no such file: ${path}`); process.exit(2); }
  let bytes: Buffer;
  try { bytes = readFileSync(path); } catch (e) { console.error(`✖ cannot read ${path}: ${(e as Error).message}`); process.exit(2); return; }
  if (bytes.length === 0) { console.error(`✖ empty file: ${path}`); process.exit(2); }
  // Key resolution up front (the same door every live command uses), skipped when offline —
  // there is no call to authenticate, and the network guard refuses before any request.
  if (opts.offline !== true) {
    try { getKey(); } catch (e) { console.error(`✖ ${(e as Error).message}`); process.exit(2); }
  }

  const jsonStdout = opts.json === true;
  const say = jsonStdout ? (...a: unknown[]) => console.error(...a) : (...a: unknown[]) => console.log(...a);
  const mime = typeof opts.mime === "string" ? opts.mime : mimeForFile(path);
  const keyterms = repeated.keyterm ?? [];
  try {
    const result = await transcribeFile(bytes, {
      mime,
      ...(typeof opts.model === "string" ? { model: opts.model } : {}),
      ...(keyterms.length ? { keyterms } : {}),
      ...(opts.utterances === true ? { utterances: true } : {}),
    });
    say(`stt: ${result.words.length} words, ${result.durationSec.toFixed(2)}s, confidence ${result.confidence.toFixed(3)} (${mime})`);
    if (!jsonStdout) say(result.transcript);
    else process.stdout.write(JSON.stringify(result, null, 2) + "\n"); // the ONLY thing on stdout
    process.exit(0);
  } catch (e) {
    console.error(`✖ ${(e as Error).message}`);
    process.exit(1);
  }
}

/** Content type from the file extension. Containerized audio declares its own encoding and sample
 *  rate, so the type is all Deepgram needs; unknown extensions fall back to the documented
 *  audio/mp4 default, and --mime overrides everything. */
function mimeForFile(path: string): string {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  const known: Record<string, string> = {
    m4a: "audio/mp4", mp4: "audio/mp4", aac: "audio/aac", mp3: "audio/mpeg", wav: "audio/wav",
    flac: "audio/flac", ogg: "audio/ogg", opus: "audio/ogg", webm: "audio/webm", amr: "audio/amr",
  };
  return known[ext] ?? "audio/mp4";
}

// `judge --transcript <file.txt>` — run the rubric against a transcript that came from anywhere,
// with no Trace and no rendering. The library door is judgeText().
async function cmdJudge(opts: Record<string, string | boolean>) {
  const transcriptPath = typeof opts.transcript === "string" ? opts.transcript : undefined;
  if (!transcriptPath) {
    console.error('usage: soundcheck judge --transcript <file.txt> [--rubric <rubric.json>] [--backend mock] [--json] [--offline]');
    process.exit(2);
  }
  const tPath = resolve(process.cwd(), transcriptPath);
  if (!existsSync(tPath)) { console.error(`✖ no such transcript: ${tPath}`); process.exit(2); }
  const transcript = readFileSync(tPath, "utf8");
  if (!transcript.trim()) { console.error(`✖ empty transcript: ${tPath}`); process.exit(2); }

  let rubric: Rubric = DEFAULT_RUBRIC;
  if (typeof opts.rubric === "string") {
    const rPath = resolve(process.cwd(), opts.rubric);
    if (!existsSync(rPath)) { console.error(`✖ no such rubric: ${rPath}`); process.exit(2); }
    try {
      const parsed = JSON.parse(readFileSync(rPath, "utf8")) as Rubric;
      if (!parsed || !Array.isArray(parsed.dimensions) || parsed.dimensions.length === 0) {
        throw new Error("a rubric needs a non-empty `dimensions` array");
      }
      rubric = parsed;
    } catch (e) { console.error(`✖ bad rubric ${rPath}: ${(e as Error).message}`); process.exit(2); }
  }
  const useMock = opts.backend === "mock";
  if (!useMock && opts.offline !== true) {
    try { getKey(); } catch (e) { console.error(`✖ ${(e as Error).message}`); process.exit(2); }
  }

  const jsonStdout = opts.json === true;
  const say = jsonStdout ? (...a: unknown[]) => console.error(...a) : (...a: unknown[]) => console.log(...a);
  try {
    const verdict = useMock
      ? await judgeText(transcript, rubric, mockJudge)
      : await judgeText(transcript, rubric);
    say(`judge (${verdict.backend}):`);
    for (const d of verdict.dimensions) say(`  ${d.key}: ${d.value}${d.why ? ` — ${d.why}` : ""}`);
    for (const f of verdict.findings) say(`  🚩 ${f}`);
    if (jsonStdout) process.stdout.write(JSON.stringify(verdict, null, 2) + "\n"); // the ONLY thing on stdout
    process.exit(0);
  } catch (e) {
    console.error(`✖ ${(e as Error).message}`);
    process.exit(1);
  }
}

const cmd = positional.shift();
// --offline is a HARD refusal, checked at every network entry point (REST and WebSocket alike).
// The key resolves from several files, so a command a developer believes is a dry run can reach
// the network and spend money; this makes that impossible rather than unlikely.
if (opts.offline === true) setOfflineMode(true);
try {
  if (cmd === "run") await cmdRun(positional, opts);
  else if (cmd === "validate") await cmdValidate(opts);
  else if (cmd === "compare") cmdCompare(opts);
  else if (cmd === "stt") await cmdStt(positional, opts, repeated);
  else if (cmd === "judge") await cmdJudge(opts);
  else if (cmd === "fixtures") await cmdFixtures(positional, opts);
  else if (cmd === "calibrate") await cmdCalibrate(opts);
  else if (cmd === "author") await cmdAuthor(opts);
  else if (cmd === "tune") await cmdTune(opts);
  else if (cmd === "bakeoff") await cmdBakeoff(positional, opts);
  else if (cmd === "install-skill") cmdInstallSkill(opts);
  else help();
} catch (e) {
  console.error(`\n✖ ${(e as Error).message}\n`);
  process.exit(1);
}

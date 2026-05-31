// Soundcheck CLI — `run` (drive scenarios, gate, report) and `validate` (standalone round-trip).
// Reads ONE credential: DEEPGRAM_API_KEY (see deepgram.ts getKey()).

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { getKey, synthesize, transcribe } from "./deepgram.ts";
import { detectArtifacts, detectDashAsNegative } from "./normalize.ts";
import { evalineTurns } from "./caller/evaline.ts";
import { ScriptedCaller, GoalDrivenCaller } from "./caller/policy.ts";
import { deepgramVaPlanner } from "./caller/planner.ts";
import { DeepgramVoiceAgentAdapter } from "./adapters/deepgram-va.ts";
import { MockAUTAdapter } from "./adapters/mock-aut.ts";
import { buildTranscript } from "./capture/transcript.ts";
import { saveCassette, loadCassette, safeSegment } from "./capture/cassette.ts";
import { runGates } from "./gates/index.ts";
import { judgeTranscript, mockJudge } from "./judge/index.ts";
import { deepgramVaJudge, makeDeepgramVaJudge } from "./judge/deepgram-va-judge.ts";
import { calibrate, formatReport, crossModelAlign, formatAlignment } from "./calibration/index.ts";
import { authorSuite } from "./author/index.ts";
import { tune, formatTuneResult, diagnose } from "./tune/index.ts";
import type { ScenarioSet, TuneScore, Diagnosis } from "./tune/index.ts";
import { spawnSync } from "node:child_process";
import { generateReport } from "./report/html.ts";
import { compareRuns, formatBakeoff } from "./bakeoff/index.ts";
import { promoteTrace } from "./regress/index.ts";
import type { AUTConfig, Persona, Scenario, ScenarioResult, Trace } from "./types.ts";
import type { ConversationCapture } from "./adapters/types.ts";

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

const VALID_PERSONAS: Persona[] = ["cooperative", "impatient", "adversarial"];

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
  if (!useMockAdapter && (goalMode || scenario.bargeIn)) {
    const maxTurns = opts.turns ? Math.min(15, Math.max(2, Number(opts.turns))) : undefined; // --turns N: deeper goal-driven calls (adapter backstop is 16)
    const caller = goalMode
      ? new GoalDrivenCaller({ goal: scenario.goal ?? "Accomplish your task with the agent, then end the call.", persona: scenario.persona, plan: deepgramVaPlanner, maxTurns })
      : ScriptedCaller.fromScenario(scenario);
    process.stdout.write(`[${caller.label}] `);
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
  console.log(`\nSoundcheck — running ${scenarios.length} scenario(s) against AUT "${aut.label}" — mode: ${mode}\n`);

  const results: ScenarioResult[] = [];
  for (const base of scenarios) {
    const scenario = personaOverride ? { ...base, persona: personaOverride as Persona } : base;
    if (replay && (scenario.liveOnly || scenario.fixtureOnly)) {
      const why = scenario.liveOnly ? "live-only (goal-driven)" : "fixture-only (authoring/tuning input)";
      console.log(`↷ ${scenario.name}: ${why} — skipped in --replay (drop --replay + set your key to run it)`);
      continue;
    }
    process.stdout.write(`▶ ${scenario.name} (persona=${scenario.persona}) … `);
    const transcript = await acquireTranscript(scenario, aut, adapter, opts);
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
    console.log(passed ? "PASS" : "FAIL");
    for (const g of gates) console.log(`    ${g.pass ? "✅" : "🚩"} ${g.name} — ${g.detail}`);
    if (verdict) console.log(`    ⚖ judge(${verdict.backend}): ${verdict.dimensions.map((d) => `${d.key}=${d.value}`).join(", ")}${verdict.findings[0] ? ` | ${verdict.findings[0]}` : ""}`);
    // --promote-failures: close the loop — freeze a failing (often improvised) call into a
    // scripted regression scenario + a replayable cassette, growing the suite automatically.
    if (opts["promote-failures"] === true && !passed) {
      try {
        const reg = promoteTrace(transcript, scenario);
        const regPath = resolve(process.cwd(), dir, `${reg.name}.json`);
        if (existsSync(regPath)) console.log(`    (overwriting existing ${reg.name}.json)`);
        writeFileSync(regPath, JSON.stringify(reg, null, 2) + "\n");
        saveCassette({ ...transcript, scenario: reg.name }); // re-key so the regression replays offline
        console.log(`    ⤴ promoted → ${dir}/${reg.name}.json (+ cassette): ${reg.turns.length} turns, ${reg.assert.length} invariants`);
      } catch (e) {
        console.log(`    (could not promote: ${(e as Error).message})`); // e.g. no usable caller turns — skip, don't abort the run
      }
    }
  }

  if (replay && results.length === 0) {
    console.error(`\n✖ 0 scenarios replayed in ${dir} — they are all live-only/fixture-only, or were filtered out. Run live (drop --replay and set your key) to exercise them.\n`);
    process.exit(2);
  }
  mkdirSync(resolve(process.cwd(), "runs"), { recursive: true });
  const out = (opts.out as string) ?? `runs/report-${aut.label}.html`;
  writeFileSync(resolve(process.cwd(), out), generateReport(results, new Date().toISOString(), { fullCallAudioOnly: opts.lean === true }));
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

function help() {
  console.log(`Soundcheck — voice-agent test harness (Deepgram-key-only)

  soundcheck run <scenariosDir> [--aut <config.ts>] [--out <report.html>] [--record|--replay] [--only <name>] [--persona <p>]
      Drive Evaline against the agent-under-test, gate the result, write a report.
      Default --aut: examples/tabletalk/grounded.ts. Exits non-zero iff a gate fails.
      --persona cooperative|impatient|adversarial : override the caller persona for ALL scenarios
                 in this run (e.g. record the same scenario across all three callers).
      --lean : smaller report — keep the full-call recording + oracle transcript, omit the per-turn
                 audio clips (~10x smaller; for the committed sample gallery).
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

  soundcheck validate --tts "<text>"     Round-trip text -> TTS -> STT; flag spoken symbols.
  soundcheck validate --stt <file.wav>   Transcribe an audio file.

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

Requires only DEEPGRAM_API_KEY (env or .env).`);
}

const { positional, opts } = parseArgs(process.argv.slice(2));
const cmd = positional.shift();
try {
  if (cmd === "run") await cmdRun(positional, opts);
  else if (cmd === "validate") await cmdValidate(opts);
  else if (cmd === "calibrate") await cmdCalibrate(opts);
  else if (cmd === "author") await cmdAuthor(opts);
  else if (cmd === "tune") await cmdTune(opts);
  else if (cmd === "bakeoff") await cmdBakeoff(positional, opts);
  else help();
} catch (e) {
  console.error(`\n✖ ${(e as Error).message}\n`);
  process.exit(1);
}

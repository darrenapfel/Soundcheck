# Soundcheck commands

After `npm install -g soundcheck-cli` the command is `soundcheck <command>`, run against your own agent from any directory; from a source checkout, use `soundcheck` (after `npm link`) or `npm run soundcheck -- <command>`. Scenario/agent paths are relative to the working directory, so the bundled `examples/` paths assume a source checkout; the key is read from `DEEPGRAM_API_KEY` / `.env` / `~/.config/soundcheck/.env`. Live commands need `DEEPGRAM_API_KEY`; `--replay` and `--adapter mock` are fully offline.

---

## `run` — drive the caller, gate the result, write a report
```
soundcheck run <scenariosDir> [--aut <config.ts>] [--out <report.html>] [flags]
```
Drives the synthetic caller (Evaline) against the agent-under-test for each scenario in `<scenariosDir>`, runs the deterministic gates over the resulting Trace, and writes a self-contained HTML report (playable audio + the oracle transcript + the gate table). **Exits non-zero iff any gate fails** (CI-usable).

| Flag | Effect |
|---|---|
| `--aut <config.ts>` | The agent-under-test config. Default `examples/tabletalk/grounded.ts`. |
| `--only <name>` | Run just the named scenario. |
| `--persona cooperative\|impatient\|adversarial` | Override the caller persona for ALL scenarios this run (e.g. record one scenario across all three callers). |
| `--record` | Live run, then save a cassette for deterministic replay. |
| `--replay` | Offline — load the cassette and run gates. No socket/STT/key. Skips `liveOnly`/`fixtureOnly` scenarios. |
| `--caller goal` | Reactive caller — a Deepgram-VA brain improvises each line toward the scenario's `goal` and hangs up when met (live-only; auto-on if the scenario has a `goal`). |
| `--promote-failures` | Freeze each FAILING call into a scripted regression scenario (+ cassette) in the dir — a discovered failure becomes a permanent test. Pairs with `--caller goal` (discover) → `tune` (fix). |
| `--judge` / `--judge mock` | Also run the LLM judge (advisory, never gating). `mock` = offline rule-based; otherwise the live Deepgram-fronted grader (needs key). |
| `--lean` | Smaller report: keep the full-call recording + oracle transcript, drop per-turn audio clips. |
| `--mp3` | Transcode embedded audio to MP3 via ffmpeg (~10× smaller; pairs with `--lean`). Falls back to WAV if ffmpeg is missing. |
| `--note "<text>"` | Render a callout banner atop the report (e.g. to mark a deliberately-broken sample). |
| `--json` / `--json <file>` | Also emit the machine-readable failure contract — per scenario: gate results, the trace-driven diagnosis (evidence + a fix hint), what the oracle heard, and a `reproduce` command. Bare `--json` prints JSON to stdout (all human output → stderr, so stdout stays parseable); `--json <file>` writes it there. Consume THIS instead of scraping the HTML/stdout when driving Soundcheck programmatically. |
| `--adapter mock` | Test a creds-free deterministic mock agent (no key/network); add `--buggy` to inject faults. |

---

## `author` — generate a scenario suite from an agent
```
soundcheck author --spec <agent-config.ts> [--out <dir>]
```
Reads the agent's tools + system prompt and emits a scenario suite: one scenario per tool with universal quality gates baked in (`no_spoken_symbols`, `required_tool`, `tool_args_match_schema`, date `grounding`, `latency`), destructive tools skipped, identity-gated tools given a proactive caller, and business rules extracted from the prompt as hints. No human writes the cases. Output is the same scenario JSON a human would write.

---

## `tune` — agents tuning agents (the Refine loop)
```
soundcheck tune --agent <config.ts> --fixer "<cmd>" [--train <s.json>] [--heldout <s.json>] [--max <n>]
```
Live loop: evaluate the agent → a **fixer** proposes a better system prompt → re-evaluate → **keep the edit only if a HELD-OUT set (the fixer never sees) improves** (the Goodhart guard). Writes the tuned prompt to `runs/tuned-prompt.txt`. **Exits 0 iff the held-out score improved.**

- `--fixer "<cmd>"` (required): your coding agent, run via `sh -c` (inherits your env). It receives `{"prompt","diagnosis"}` JSON on **stdin** (the diagnosis = each failing gate's trace evidence + a remediation hint) and must write the **improved system prompt to stdout**. Examples: `claude -p`, `codex exec`, or a script. A 180 s timeout guards a hung fixer.
- `--train <s.json>` / `--heldout <s.json>`: the optimize-against set and the unseen validation set. Make them **genuinely different** (the guard depends on it — e.g. train "this Saturday", held-out "this Sunday").
- `--max <n>`: max iterations (default 2). Stops early when training is 100% or the fixer proposes no change.

---

## `bakeoff` — compare two agents on one suite
```
soundcheck bakeoff <scenariosDir> --a <A.ts> --b <B.ts> [--replay] [--judge [mock]] [--only <name>]
```
Runs ONE suite against TWO agent configs and diffs the results — which config wins, on which gates (e.g. `forbidden_tool:deleteAccount: A=✅ B=🚩`). Live (two real prompts/models/voices) or `--replay` (each config's cassettes, offline). `--judge` also diffs the advisory judge dimensions (never changes the gate-decided winner).

---

## `calibrate` — trust the judge
```
soundcheck calibrate [--judge live] [--align [--reference <model>]] [--out <file.json>]
```
Scores the LLM judge against a no-human **Golden Set** (agreement / precision / recall) and prints a **TRUST verdict** (may it be relied on?). Default = offline mock judge; `--judge live` = the Deepgram-fronted grader. `--align` (live) runs the cross-model alignment loop: a stronger reference model (default `gpt-4o`) corroborates the Golden Set, then reports the judge's trust. Use this before relying on any judge dimension.

---

## `validate` — one-shot audio round-trips (debugging)
```
soundcheck validate --tts "<text>" [--json]   # text → TTS → STT → compare; flags spoken symbols AND content changes
soundcheck validate --stt <file.wav>          # transcribe an audio file
```
`--tts` runs the full round trip and gates BOTH cleanliness and content: it transcribes smart-formatted, flags spoken symbols/artifacts, and compares the transcript against the input with the normalization-aware compare — "seven thirty" heard back as "7:30" passes (tier printed), "7:13" fails with a token-level diff. Exit 0 only when the comparison passes and no artifacts are detected. `--json` emits one schema-versioned JSON document alone on stdout (human output → stderr).

---

## `compare` — offline content comparison (no key)
```
soundcheck compare --expected "<text>" --heard "<text>" [--json]
```
The normalization-aware comparison gate standalone — **fully offline, keyless**. Both texts reduce to canonical tokens (times, money, dates, ordinals, digit runs, percent, decimals, years); three tiers are tried in order (exact → canonical → digit-merge). A pass names its tier; a failure prints a token-level diff with a token error rate. Exit 0 pass, 1 fail, 2 usage. An empty `--heard` is a legitimate failing input (a total transcription failure); a missing/empty `--expected` is a usage error. `--json` emits one schema-versioned document alone on stdout. Inside a scenario, the same comparator is the `spoken_matches_text` gate (see `reference/gates.md`).

---

## `fixtures` — the committed audio round-trip corpus (needs the key)
```
soundcheck fixtures <check|roundtrip|generate> [--json]
```
16 canonical WAV fixtures (`fixtures/audio/` + `manifest.json`) covering the known smart-formatting trap classes — times, currency, compound numbers, digit identifiers, dates, ordinals, years, percent, decimals, punctuation, plus a trap-free control.

| Subcommand | Effect |
|---|---|
| `check` | Transcribe each **committed** WAV (smart-formatted) and gate it against the manifest text. The audio bytes never change, so a new failure = the recognition model's formatting behavior drifted. |
| `roundtrip` | Fresh text→TTS→STT round trip per fixture, same gate — the full live loop, synthesis included. |
| `generate` | Maintainers only: (re)record the corpus audio + `observed.json` (re-record via a reviewed PR, never silently). |

`--json` emits `{ schema: 1, label, rows, summary: { passed, total } }` alone on stdout. Exit 0 all passed, 1 a fixture failed, 2 usage or no key (the key check fails fast, before any network attempt).

---

## `install-skill` — install this skill for your coding agent
```
soundcheck install-skill [--all] [--claude-only] [--codex] [--gemini] [--link]
```
Copies the bundled Soundcheck skill (`.claude/skills/soundcheck/`) into your user-global skill directory so any coding agent can use it from any project. **Smart default:** always installs for Claude Code, and *also* for Codex and/or Gemini **if that agent's home dir already exists** on the machine — so it adapts to the agents you actually use.

| Flag | Effect |
|---|---|
| (default) | **Claude Code** (`~/.claude/skills/soundcheck/`) + any of Codex/Gemini whose home dir exists. |
| `--all` | Force all three (Claude Code, Codex, Gemini) regardless of what's installed. |
| `--claude-only` | Claude Code only — skip auto-detect. |
| `--codex` | Force Codex → `$CODEX_HOME/skills/soundcheck/` (else `~/.codex/skills/`). |
| `--gemini` | Force Gemini → `~/.gemini/skills/soundcheck/` (generates `instructions.md` + `skill.yaml` from `SKILL.md`). |
| `--link` | Symlink instead of copy (auto-updates with the repo; Gemini still copies — it needs generated files). |

Re-run after `git pull` to refresh (or use `--link` once). No Deepgram key needed.

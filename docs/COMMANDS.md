# Commands

Every Soundcheck command and flag. After `npm install -g soundcheck-cli` the command is `soundcheck <command>`, run against your own agent from any directory; from a source checkout, use `soundcheck` (after `npm link`) or `npm run soundcheck -- <command>`. Scenario/agent paths are relative to the working directory, so the bundled `examples/` paths in this doc assume a source checkout; the key is read from `DEEPGRAM_API_KEY` / `.env` / `~/.config/soundcheck/.env`. Live commands need `DEEPGRAM_API_KEY`; `--replay` and `--adapter mock` are fully offline. See also [`GUIDE.md`](GUIDE.md) and [`GATES.md`](GATES.md).

---

## `run`
```
soundcheck run <scenariosDir> [--aut <config.ts>] [--out <report.html>] [flags]
```
Drives the synthetic caller against the agent-under-test for each scenario, runs the gates over the resulting Trace, and writes a self-contained HTML report (playable audio + the oracle transcript + the gate table). **Exits non-zero iff any gate fails** — so it gates CI directly.

| Flag | Effect |
|---|---|
| `--aut <config.ts>` | The agent-under-test config (default `examples/tabletalk/grounded.ts`). |
| `--only <name>` | Run just the named scenario. |
| `--persona cooperative\|impatient\|adversarial` | Override the caller persona for all scenarios this run (e.g. record one scenario across all three callers). |
| `--record` | Live run, then save a cassette for deterministic replay. |
| `--replay` | Offline — load the cassette and run gates. No socket/STT/key. Skips `liveOnly`/`fixtureOnly` scenarios; fails closed if everything is skipped. |
| `--caller goal` | Reactive caller — a Deepgram-VA brain improvises each line toward the scenario's `goal` and hangs up when met (live-only; auto-on if the scenario has a `goal`). |
| `--promote-failures` | Freeze each failing call into a scripted regression scenario (+ cassette) in the dir — a discovered failure becomes a permanent test. Pairs with `--caller goal` (discover) → `tune` (fix). |
| `--judge` / `--judge mock` | Also run the LLM judge (advisory, never gating). `mock` = offline rule-based; otherwise the live Deepgram-fronted grader. |
| `--lean` | Smaller report: keep the full-call recording + oracle transcript, drop the per-turn audio clips. |
| `--mp3` | Transcode embedded audio to MP3 via ffmpeg (~10× smaller; pairs with `--lean`). Falls back to WAV if ffmpeg is missing. |
| `--note "<text>"` | Render a callout banner atop the report (e.g. to mark a deliberately-broken sample). |
| `--json` / `--json <file>` | Also emit the machine-readable failure contract — per scenario: gate results, the trace-driven diagnosis (evidence + a fix hint), what the oracle heard, and a `reproduce` command — for a coding agent or CI to consume instead of the HTML. Bare `--json` prints JSON to stdout (all human output → stderr, so stdout stays parseable); `--json <file>` writes it there. |
| `--adapter mock` | Test a creds-free deterministic mock agent (no key/network); add `--buggy` to inject faults. |

---

## `author`
```
soundcheck author --spec <agent-config.ts> [--out <dir>]
```
Reads the agent's tools + system prompt and emits a scenario suite — one scenario per tool with universal quality gates baked in (`no_spoken_symbols`, `required_tool`, `tool_args_match_schema`, date `grounding`, `latency`), destructive tools skipped, identity-gated tools given a proactive caller, and business rules extracted from the prompt as hints. The agent writes its own test cases; the output is the same scenario JSON a human would write, ready to tighten.

---

## `tune`
```
soundcheck tune --agent <config.ts> --fixer "<cmd>" [--train <s.json>] [--heldout <s.json>] [--max <n>]
```
The Refine loop: evaluate the agent → a **fixer** proposes a better system prompt → re-evaluate → **keep the edit only if a held-out set (the fixer never sees) improves** (the Goodhart guard). Writes the tuned prompt to `runs/tuned-prompt.txt`; **exits 0 iff the held-out score improved**.

- `--fixer "<cmd>"` (required) — your coding agent, run via `sh -c` (inherits your env). It receives `{"prompt","diagnosis"}` JSON on **stdin** (the diagnosis = each failing gate's trace evidence + a remediation hint) and must write the **improved system prompt to stdout**. Examples: `claude -p`, `codex exec`, or a script (see `examples/tune-demo/`). A 180 s timeout guards a hung fixer.
- `--train` / `--heldout` — the optimize-against set and the unseen validation set. Make them **genuinely different** (e.g. train "this Saturday", held-out "this Sunday") — the guard depends on it.
- `--max <n>` — max iterations (default 2). Stops early when training is 100% or the fixer proposes no change.

---

## `bakeoff`
```
soundcheck bakeoff <scenariosDir> --a <A.ts> --b <B.ts> [--replay] [--judge [mock]] [--only <name>]
```
Runs one suite against two agent configs and diffs the results — which config wins, on which gates (e.g. `forbidden_tool:deleteAccount: A=✅ B=🚩`). Live (two real prompts/models/voices) or `--replay` (each config's cassettes, offline). `--judge` also diffs the advisory judge dimensions (never changes the gate-decided winner).

---

## `calibrate`
```
soundcheck calibrate [--judge live] [--align [--reference <model>]] [--out <file.json>]
```
Scores the LLM judge against a no-human **Golden Set** (agreement / precision / recall) and prints a **TRUST verdict**. Default = offline mock judge; `--judge live` = the Deepgram-fronted grader. `--align` (live) runs the cross-model alignment loop: a stronger reference model (default `gpt-4o`) corroborates the Golden Set, then reports the judge's trust. Run this before relying on any judge dimension. See [`CALIBRATION.md`](CALIBRATION.md) for current numbers.

---

## `validate`
```
soundcheck validate --tts "<text>"     # text → TTS → STT; flags spoken symbols
soundcheck validate --stt <file.wav>   # transcribe an audio file
```
One-shot Deepgram round-trips — confirm a phrase (a price, a date) is spoken cleanly outside a full scenario.

---

## `install-skill`
```
soundcheck install-skill [--all] [--claude-only] [--codex] [--gemini] [--link]
```
Installs the bundled coding-agent skill (`.claude/skills/soundcheck/`) into your user-global skills dir. **Smart default:** always Claude Code (`~/.claude/skills`), plus Codex and/or Gemini if that agent's home dir already exists on the machine (Gemini gets a generated `instructions.md` + `skill.yaml`). `--all` forces all three; `--claude-only` skips auto-detect; `--codex`/`--gemini` force an individual agent; `--link` symlinks instead of copying. No key needed. (`npm run skill:install` from a fresh clone.)

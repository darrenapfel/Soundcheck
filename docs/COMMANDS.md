# Commands

Every Soundcheck command and flag. After `npm install -g soundcheck-cli` the command is `soundcheck <command>`, run against your own agent from any directory; from a source checkout, use `soundcheck` (after `npm link`) or `npm run soundcheck -- <command>`. Scenario/agent paths are relative to the working directory, so the bundled `examples/` paths in this doc assume a source checkout; the key is read from `DEEPGRAM_API_KEY` / `.env` / `~/.config/soundcheck/.env`. Live commands need `DEEPGRAM_API_KEY`; `--replay`, `--adapter mock`, and the `compare` command are fully offline. See also [`GUIDE.md`](GUIDE.md) and [`GATES.md`](GATES.md).

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
soundcheck validate --tts "<text>" [--json]   # text → TTS → STT → compare; flags spoken symbols AND content changes
soundcheck validate --stt <file.wav>          # transcribe an audio file
```
One-shot Deepgram round-trips. `--tts` runs the full **text → TTS → STT → compare** loop: it transcribes smart-formatted, flags spoken symbols/artifacts, and gates the transcript against the input with the normalization-aware comparison — so "seven thirty" heard back as "7:30" passes (the tier is printed) while "7:13" fails with a token-level diff plus the expected/heard pair. **Exit 0 only when the comparison passes and no artifacts are detected.** Use it to confirm a phrase (a price, a date, a confirmation number) survives the loop, outside a full scenario.

| Flag | Effect |
|---|---|
| `--tts "<text>"` | Synthesize the text, transcribe it back (smart-formatted), detect artifacts, and compare against the input. |
| `--stt <file.wav>` | Transcribe an audio file (literal spoken words), print what was heard. |
| `--json` | (with `--tts`) Emit one schema-versioned JSON document alone on stdout — input, heard, artifacts, the full compare result, and the verdict; human output moves to stderr. |

---

## `compare`
```
soundcheck compare --expected "<text>" --heard "<text>" [--json]
```
The normalization-aware comparison gate, standalone — **fully offline, no key, no network.** Decides whether two surface forms carry the same content: both texts reduce to canonical tokens (times, money, dates, ordinals, digit runs, percent, decimals, years), then three tiers are checked in order — **exact** (case/whitespace-folded string equality), **canonical** (token streams match), **digit-merge** (numeric tokens flattened and concatenated, rescuing split formatting like "555 1212" vs "5551212"). A pass names its tier; a failure prints a token-level diff with a token error rate.

```
$ soundcheck compare --expected "The meeting starts at seven thirty." --heard "The meeting starts at 07:30."
compare: PASS (canonical)
$ soundcheck compare --expected "The meeting starts at seven thirty." --heard "The meeting starts at 07:13."
compare: FAIL (token error rate 20%): "time:7:30" heard as "time:7:13"
```

| Flag | Effect |
|---|---|
| `--expected "<text>"` | The reference text (what was sent to TTS). Required and non-empty — missing/empty is a usage error. |
| `--heard "<text>"` | The transcript to gate (what STT returned). Required, but **an empty string is a legitimate input** — a total transcription failure that must gate as FAIL, not error out. |
| `--json` | Emit one schema-versioned JSON document alone on stdout (`{ schema, label, pass, tier, expectedKeys, heardKeys, diff, tokenErrorRate, … }`); human output moves to stderr. |

**Exit codes:** 0 pass, 1 fail, 2 usage. The same comparator is available as the [`spoken_matches_text` gate](GATES.md) inside scenarios, and as `compare()`/`summarize()` from the library.

---

## `stt`
```
soundcheck stt <file> [--json] [--keyterm "<term>"]... [--utterances] [--mime <type>] [--model <m>] [--offline]
```
Transcribe a whole audio **file** and return the full result, not just the text: the transcript, the model's confidence, the **word timeline** (each word with its start, end, and confidence), optional **utterance** segments, and the media duration. This is the surface downstream tools build on — offset checks, boundary checks, aligning a recording against a script. The harness's own speech-to-text path (`run`, `validate`) is unchanged and still returns text alone.

| Flag | Effect |
|---|---|
| `--json` | Print **exactly** the result object on stdout; all human output moves to stderr. |
| `--keyterm "<term>"` | Boost domain vocabulary. Repeatable — pass it once per term. |
| `--utterances` | Also return utterance segments (`start`, `end`, `transcript`). |
| `--mime <type>` | Override the content type. The default comes from the file extension (`.m4a`/`.mp4` → `audio/mp4`, `.mp3` → `audio/mpeg`, `.wav`, `.flac`, `.ogg`, `.webm`, `.aac`, `.amr`), falling back to `audio/mp4`. |
| `--model <m>` | Recognition model. Default `nova-3`. |

Containerized audio declares its own encoding and sample rate, so neither parameter is sent — Deepgram reads them from the container, and sending them can contradict the file.

```jsonc
{
  "transcript": "Your appointment on April 10 at 09:15 will cost $40.",
  "confidence": 0.999,
  "words": [{ "word": "your", "punctuated_word": "Your", "start": 0, "end": 0.32, "confidence": 0.985 }],
  "utterances": [{ "start": 0, "end": 4.4, "transcript": "Your appointment on April 10 at 09:15 will cost $40." }],
  "durationSec": 4.4
}
```

**A note on duration.** `durationSec` is what Deepgram measured. For WAV and m4a/AAC it matches the file exactly (verified: a 4.40 s fixture reads 4.40). MP3 can read slightly longer — the same fixture encoded as MP3 reads 4.46 s — because the format carries encoder padding that Deepgram counts and most decoders strip. If you are checking offsets to the millisecond, prefer a lossless or AAC source.

**Exit codes:** 0 transcribed, 1 the API call failed, 2 the invocation was wrong (no file, missing file, empty file, no key). Library door: `transcribeFile(bytes, opts)`.

---

## `judge`
```
soundcheck judge --transcript <file.txt> [--rubric <rubric.json>] [--backend mock] [--json] [--offline]
```
Run a rubric against a transcript that came from **anywhere** — a file transcription, another vendor's recording, a support ticket. No scenario, no Trace, no rendering: the text is passed to the judge verbatim. `--rubric` defaults to the built-in rubric; `--backend mock` uses the deterministic offline grader instead of the live one. `--json` prints the verdict alone on stdout.

**Exit codes:** 0 judged, 1 the judge call failed, 2 the invocation was wrong. Library door: `judgeText(transcript, rubric, backend?)`. The judge stays **advisory** here as everywhere — it never gates.

---

## `--offline` (any command)
Refuse every network call — REST and WebSocket alike — instead of making it. The key resolves from the environment, `./.env`, `~/.config/soundcheck/.env`, or the package's own `.env`, so a command you believe is a dry run can otherwise reach the API and spend money. With `--offline` that cannot happen: the call fails loudly rather than degrading to a mock, and no key is required to run the command at all.

---

## `fixtures`
```
soundcheck fixtures <check|roundtrip|generate> [--json]
```
Drive the committed audio round-trip corpus — [`fixtures/audio/`](../fixtures/audio/manifest.json): 16 canonical WAV recordings covering the known smart-formatting trap classes (times, currency, compound numbers, digit identifiers, dates, ordinals, years, percent, decimals, punctuation, plus a trap-free control), each with its reference text in the manifest. All three subcommands call the Deepgram API and need the key; without one they fail cleanly with the standard key-resolution error (exit 2) **before any network attempt**.

| Subcommand | Effect |
|---|---|
| `check` | Transcribe each **committed** WAV (smart-formatted) and gate it against the manifest text with the normalization-aware compare. The cheap drift detector: the audio bytes never change, so a new failure means the *recognition model's formatting behavior* changed. Runs nightly in CI when the key secret exists. |
| `roundtrip` | A **fresh** text→TTS→STT round trip per fixture, gated the same way — verifies the full live loop, synthesis included. |
| `generate` | Maintainers only: (re)synthesize every fixture's audio into `fixtures/audio/` and record what smart formatting returned at generation time in `observed.json` (documentation — never read by code). Re-record via a reviewed PR, never silently. |

| Flag | Effect |
|---|---|
| `--json` | Emit one schema-versioned JSON document alone on stdout: `{ schema: 1, label, rows: [...], summary: { passed, total } }` — per-fixture transcript + full compare result; human output moves to stderr. |

**Exit codes:** 0 all fixtures passed, 1 at least one failed, 2 usage or no key.

---

## `install-skill`
```
soundcheck install-skill [--all] [--claude-only] [--codex] [--gemini] [--link]
```
Installs the bundled coding-agent skill (`.claude/skills/soundcheck/`) into your user-global skills dir. **Smart default:** always Claude Code (`~/.claude/skills`), plus Codex and/or Gemini if that agent's home dir already exists on the machine (Gemini gets a generated `instructions.md` + `skill.yaml`). `--all` forces all three; `--claude-only` skips auto-detect; `--codex`/`--gemini` force an individual agent; `--link` symlinks instead of copying. No key needed. (`npm run skill:install` from a fresh clone.)

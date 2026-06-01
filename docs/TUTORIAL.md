# Tutorial: zero to a well-tuned voice agent

A worked example — start with nothing, end with a gated, tuned agent and a self-growing offline regression suite. Run from the Soundcheck repo with `DEEPGRAM_API_KEY` set (env, `./.env`, or `~/.config/soundcheck/.env`). `soundcheck` assumes you've run `npm link`; otherwise prefix `npm run soundcheck --`. See [`COMMANDS.md`](COMMANDS.md) for every flag and [`GATES.md`](GATES.md) for the invariants.

## 0. Write a minimal agent
Create `./my-agent.ts` exporting an `AUTConfig` — a `systemPrompt`, a few `tools` with JSON schemas, and `toolStubs` that return canned results. Don't over-polish the prompt; Soundcheck will find what's wrong and `tune` will fix it. (The bundled `examples/` agents — `tabletalk`, `support`, `healthcare`, `travel`, `banking` — are templates to copy. The skill's `reference/agents.md` documents every field.)

## 1. Author a suite from the agent
```bash
soundcheck author --spec ./my-agent.ts --out scenarios
```
This reads the agent's tools + prompt and writes one scenario per tool into `scenarios/`, with universal gates baked in (`no_spoken_symbols`, `required_tool`, `tool_args_match_schema`, date `grounding`, `latency`) and business rules extracted as hints. Open the files and tighten the `assert` lists for invariants you care about — `forbidden_tool` for anything destructive, `tool_sequence` for verify-before-act, `spoken_consistent_with_tool` for dated confirmations.

## 2. Run it live and read the report
```bash
soundcheck run scenarios --aut ./my-agent.ts --out runs/first.html
open runs/first.html
```
The exit code is non-zero if any gate fails. In the report, read **what the oracle (STT) actually heard**, play the audio, and study the gate table — each failure shows the agent's real recorded behavior (e.g. `grounding — date="2023-…" stale year`, or `no_spoken_symbols — "star star" spoken`). Push harder callers without new files:
```bash
soundcheck run scenarios --aut ./my-agent.ts --only <scenario> --persona adversarial
```

## 3. (Optional) Bake off against a baseline
If you have a previous build, compare them on the same suite:
```bash
soundcheck bakeoff scenarios --a ./baseline.ts --b ./my-agent.ts --replay
```
You get a per-gate diff and a winner — proof an edit helped without eyeballing two reports.

## 4. Tune the prompt until it generalizes
```bash
soundcheck tune --agent ./my-agent.ts --fixer "claude -p" \
  --train scenarios/<one>.json --heldout scenarios/<a-different-one>.json
```
The loop hands each failure's **trace evidence + a hint** to your fixer (which rewrites the system prompt and prints it back), re-runs, and **keeps the edit only if the held-out set improves** — the Goodhart guard, so the fix must *generalize*, not just patch the trained case (pick a held-out scenario that's genuinely different, e.g. a different relative date). The winning prompt lands in `runs/tuned-prompt.txt`; exit 0 means it generalized. Paste that prompt back into `my-agent.ts` (the one manual step), then re-run step 2 — the failures should be gone.

## 5. Trust the judge (only if you use it)
If you rely on the advisory LLM judge for subjective dimensions (naturalness, conciseness), verify it first:
```bash
soundcheck calibrate --judge live --align
```
This scores the judge against a no-human Golden Set, corroborates with a stronger reference model, and prints a TRUST verdict. Gates are the hard pass/fail; the judge only ever informs.

## 6. Close the loop — discover and freeze regressions
Let an adversarial caller hunt for failures nobody scripted, and freeze any it finds into permanent tests:
```bash
soundcheck run scenarios --aut ./my-agent.ts --caller goal --persona adversarial --promote-failures
```
Each failing call becomes a scripted regression scenario (+ a replayable cassette) in `scenarios/`. Your suite grows itself from real discovered failures.

## 7. Gate it in CI — deterministic and offline
The promoted regressions (and any `--record`ed cassettes) replay with no key or network:
```bash
soundcheck run scenarios --aut ./my-agent.ts --replay   # exits non-zero iff a gate fails
```
Wire that into CI — the repo ships `action.yml` for GitHub Actions. Live scenarios are skipped under `--replay`; the recorded ones gate every PR.

## The result
You went from a rough agent to: a suite authored from its own tools, a prompt tuned until it provably generalizes, a calibrated judge, and an offline regression suite that grows as new failures are discovered — every result backed by the oracle over real audio, nothing staged. To hear what good and bad look like, browse the [sample gallery](../samples/#readme).

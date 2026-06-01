# Tune demo — the Refine loop (agents fixing agents)

This folder supplies the **fixers** and **scenarios** for `soundcheck tune`, the *Refine* stage of
Scenario → Trace → Assess → Refine. `tune` runs an agent against scenarios, finds where it fails,
hands a coding agent the **trace-driven evidence** of each failure, lets it rewrite the agent's
**system prompt**, and keeps the rewrite **only if a held-out set the fixer never saw improves**
(the Goodhart guard). For the full discover → promote → refine flywheel, see
[`../self-improving-loop`](../self-improving-loop).

## The fixer contract

A `--fixer` is any program that:
- reads `{"prompt": "<current system prompt>", "diagnosis": [...]}` JSON on **stdin**, and
- writes **only** the improved system prompt to **stdout**.

`diagnosis` is Soundcheck's trace-driven root-cause — a list of `{gate, problem, hint}`, where
`problem` is evidence from the recorded call (the agent's actual spoken text, tool args, and
call order) and `hint` is the remediation. The fixer edits *from the evidence*, not from a gate name.

## Two reference fixers

| File | What it is | Use it for |
|---|---|---|
| [`fixer-demo.mjs`](fixer-demo.mjs) | Rule-based, deterministic (appends the diagnosis hints; reads the real date out of the evidence) | Showing the loop **offline / reproducibly**, with no external CLI |
| [`codex-fixer.sh`](codex-fixer.sh) | A real coding agent — the **Codex CLI** (gpt-5.5), run **read-only** so it can't touch your files | A genuine self-improvement run that *reasons* over the evidence |

Any stdin→stdout coding agent works — `claude -p`, a script, etc. `codex-fixer.sh` is the Codex variant.

## Run it with Codex

```bash
# needs a live DEEPGRAM_API_KEY (env, ./.env, or ~/.config/soundcheck/.env) and `codex login`
soundcheck tune \
  --agent   examples/tabletalk/bare.ts \
  --train   examples/self-improving-loop/scenarios/book-this-saturday-regression.json \
  --heldout examples/self-improving-loop/heldout-book-sunday.json \
  --fixer   examples/tune-demo/codex-fixer.sh \
  --max 1
```

It is **live** (each evaluation is a real Deepgram call) and prints per-step progress. The tuned
prompt is written to `runs/tuned-prompt.txt`; the command exits `0` only if the held-out set improved.

## A real run — what actually happened

The agent under test, [`examples/tabletalk/bare.ts`](../tabletalk/bare.ts), is a restaurant booker
whose prompt lacks a date anchor, so it hallucinates the year. Driven by the command above with
**Codex (gpt-5.5, reasoning `xhigh`)** as the fixer:

```
evaluating the baseline on the training set…
  baseline train 0/1; baseline held-out 0/1
iteration 1/1: running the fixer…
  training improved — evaluating the held-out set (Goodhart guard)…
  → kept: held-out improved

Tuning IMPROVED the agent ✅
  training : 0/1 -> 1/1
  held-out : 0/1 -> 1/1   (the Goodhart guard)
```

The bare agent failed `grounding` on **both** the trained "this Saturday" call and the unseen
"this Sunday" held-out call. From the trace evidence (`bookReservation.date="…" stale year (now
2026-06-01)`), Codex rewrote the prompt to add a general date resolver — the meaningful part it
produced:

> Use today's date, 2026-06-01… Resolve relative dates such as today, tomorrow, this Saturday,
> next Friday… to the correct absolute calendar date before confirming or using any tool. For
> example, "this Saturday" means 2026-06-06. Pass dates to reservation tools only in ISO format,
> YYYY-MM-DD.

The improvement is real because it **generalized**: the fixer only ever saw the *training*
diagnosis ("this Saturday"), yet the rewrite also fixed the held-out "this Sunday" call it never
saw. Had Codex hard-coded a Saturday patch, the held-out would have stayed red and the
Goodhart guard would have **rejected** the edit. Because the held-out went green, it was kept —
a fix that demonstrably transfers, not one memorized to the test.

## Notes

- **Read-only by design.** `codex-fixer.sh` runs `codex exec -s read-only`, so Codex only reasons
  and prints text — it cannot edit files in your project.
- **Prompt only.** `tune` rewrites the agent's system prompt; wiring the result back into a deployed
  agent config is a manual step (you stay the reviewer).
- **Train ≠ held-out.** The guard depends on the held-out scenario being genuinely *different* from
  the trained one (here, a different relative date).

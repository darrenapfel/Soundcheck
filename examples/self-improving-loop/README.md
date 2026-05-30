# Self-improving loop — discover → promote → refine

This example runs the whole [coSTAR](https://www.databricks.com/blog/costar-how-we-ship-ai-agents-databricks-fast-without-breaking-things)-for-voice flywheel end to end: a synthetic caller **discovers** a failure nobody scripted, Soundcheck **promotes** it into a permanent regression (the suite grows itself), and a coding agent **refines** the voice agent until the regression — and a held-out check — go green (the agent improves itself). Discovery, promotion, and refinement are automated; re-deploying the tuned prompt is the one manual step (see Honest scope). You stay the reviewer.

The weak agent here is `examples/tabletalk/bare.ts` — a restaurant booker whose prompt lacks a date anchor, so it hallucinates the year.

## Phase 1 — Discover & promote (the suite grows)

```bash
npm run soundcheck -- run examples/self-improving-loop/scenarios \
  --aut examples/tabletalk/bare.ts --record --promote-failures --only book-this-saturday
```

`book-this-saturday.json` is **goal-driven**: Evaline improvises toward "book a table for *this Saturday*" — no scripted lines. Against the bare agent, the `grounding` gate (oracle-checked against the real audio + tool calls) caught a hallucinated date, and `--promote-failures` froze the call into a regression:

```
▶ book-this-saturday (persona=cooperative) … [goal-driven] FAIL
    🚩 grounding — bookReservation.date="2023-10-14" stale year (now 2026-06-01); != expected 2026-06-06
    ⤴ promoted → …/book-this-saturday-regression.json (+ cassette): 1 turns, 5 invariants
```

`book-this-saturday-regression.json` (committed here) is the result: the caller's *actual improvised line* frozen as a scripted, replayable scenario carrying the same invariants. It now reproduces the bug deterministically, offline:

```bash
npm run soundcheck -- run examples/self-improving-loop/scenarios \
  --aut examples/tabletalk/bare.ts --replay --only book-this-saturday-regression   # 🚩 grounding fails
```

## Phase 2 — Refine (the agent improves), held-out-guarded

```bash
npm run soundcheck -- tune \
  --agent   examples/tabletalk/bare.ts \
  --train   examples/self-improving-loop/scenarios/book-this-saturday-regression.json \
  --heldout examples/self-improving-loop/heldout-book-sunday.json \
  --fixer   "node examples/tune-demo/fixer-demo.mjs"
```

A coding agent (here a tiny rule-based demo fixer; swap in `--fixer "claude -p ..."` for the real thing) reads Soundcheck's **trace-driven diagnosis** — the gate's evidence *and* a hint — and patches the prompt. The edit is kept **only if a held-out check improves** (the Goodhart guard): the held-out books a *different* relative date ("this Sunday") the fixer never saw.

```
Tuning IMPROVED the agent ✅
  training : 0/1 -> 1/1
  held-out : 0/1 -> 1/1  (the Goodhart guard)   ← generalized to an unseen date
```

The fix the agent wrote (`runs/tuned-prompt.txt`) — extracted from the trace evidence, not a canned string:

> `TODAY'S DATE is 2026-06-01. Resolve any relative date the caller mentions ("this Saturday") to the correct absolute calendar date…`

## Why this is the loop, not a demo trick

- **The suite grew on its own.** A failure no human scripted became a permanent, replayable regression — coSTAR's "every bug becomes a new scenario," automated for voice.
- **The agent improved on its own**, against that grown suite, with a held-out guard so the fix had to *generalize* (it did — to an unseen date) rather than overfit.
- **Every verdict is oracle-grounded** (gates over the real recording + tool trace), so neither half is taken on faith.

## CI proof (deterministic, offline)

`test/regress.test.ts` pins the closure without any live call: `promoteTrace` freezes a failing call into a scripted regression that **reproduces** the failure on the broken agent and **goes green** on the fixed one; and the committed `book-this-saturday-regression` cassette replays to reproduce the discovered stale-date bug.

## Honest scope

The discovery and tune steps are **live and stochastic** (the committed scenario/cassette/numbers are one real run). Phase 2 emits an improved *prompt*; wiring that prompt back into a deployable agent config is the one manual step. Auto-discovering failures on *production* traffic (vs. an adversarial caller) is future work — see the repo's gap table.

# Acme IT Support — the non-restaurant example (genericity proof)

A second agent-under-test in a totally different domain (IT helpdesk), to prove Soundcheck's
gates are **domain-agnostic** — the same registry gates that test the TableTalk restaurant
agent also test this one, with no gate code changes.

It declares invariants via the generic gates (`scenarios/*.json`): `tool_sequence` (verifyAccount
**before** resetPassword), `grounding` (resolve "this Saturday" for the callback),
`spoken_matches_tool` (read the callback date back), `tool_args_match_schema` (scheduleCallback's
date/time formats), `forbidden_tool` (never `deleteAccount`), plus `no_spoken_symbols`,
`required_tool`, `latency`.

Three agent variants, so each gate is shown both PASSING when correct and CATCHING when violated:

These commands replay the recorded cassettes — **offline, no key** (drop `--replay` and set
`DEEPGRAM_API_KEY` to run them live instead):

```bash
# grounded (clean) — passes every gate (skips the goal-driven adversarial-discovery)
soundcheck run examples/support/scenarios --aut examples/support/grounded.ts --replay

# bare (buggy) — reset-and-callback fails no_spoken_symbols (Markdown aloud) + grounding (stale date)
soundcheck run examples/support/scenarios --aut examples/support/bare.ts --replay --only reset-and-callback

# insecure — frustrated-reset fails tool_sequence (resets before verifying) + forbidden_tool (deletes)
soundcheck run examples/support/scenarios --aut examples/support/insecure.ts --replay --only frustrated-reset
```

Which gate each variant exercises (all gates *evaluate* on every run; this is where each is shown
*discriminating*):

| gate | passes (correct) | catches (violated) |
|---|---|---|
| no_spoken_symbols, grounding | grounded | **bare** (reset-and-callback) |
| tool_sequence, forbidden_tool | grounded | **insecure** (frustrated-reset) |
| tool_args_match_schema, spoken_matches_tool, required_tool | grounded | (unit-tested in `test/gates.test.ts`) |

`test/replay-support.test.ts` pins all four cassettes' full gate vectors, so this genericity proof
runs offline in CI alongside the restaurant ladder.

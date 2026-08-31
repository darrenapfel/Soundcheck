# Scenario schema

A scenario is a declarative JSON test case in a scenarios directory. `run`/`bakeoff` load every `*.json` in the dir (each must be a scenario, a `rubric.json`, or other recognized JSON). `author` generates these for you; you can also hand-write them.

## Fields
| Field | Type | Meaning |
|---|---|---|
| `name` | string (required) | Unique scenario id; also the cassette filename stem. Use slug chars only (`[A-Za-z0-9._-]`). |
| `persona` | `"cooperative" \| "impatient" \| "adversarial"` (required) | The caller's disposition. Drives the goal-driven caller's behavior and its voice. Override per-run with `--persona`. |
| `turns` | string[] (required) | The caller's scripted lines, in order. Used by the **scripted** caller (deterministic, replayable). For a goal-driven scenario these are the opening line(s); the brain improvises the rest. |
| `assert` | AssertSpec[] (required) | The invariants the gates enforce. See `reference/gates.md` for every spec shape. |
| `goal` | string (optional) | When set, a **goal-driven** caller improvises toward this goal and hangs up when met. Auto-selects the goal-driven caller (force with `--caller goal`, opt out with `--caller scripted`). Live-only — can't be replayed deterministically. |
| `bargeIn` | `{ afterTurn, text, afterMs }` (optional) | The scripted caller interrupts the agent: after `afterTurn`, it speaks `text` over the agent `afterMs` after the agent starts replying — tests interruption handling. Live-only. |
| `redTeam` | boolean (optional) | The `goal` is an ATTACK (make the agent do something it must not). Inverts the synthetic goal gate: the attacker's planner declaring the goal met becomes a failing `attack_succeeded` row; an unmet attack goal adds no synthetic row, so a defended call can end all-green at the turn cap. |
| `liveOnly` | boolean (optional) | This scenario can't be replayed (goal-driven/improv). `run --replay` skips it (and says so). |
| `fixtureOnly` | boolean (optional) | An authoring/tuning input or generated demo that ships without a cassette. `run --replay` skips it. |

The example-contract test requires every scenario to be replay-backed (has a cassette), `liveOnly`, or `fixtureOnly` — no holes. So don't commit a scenario with no cassette unless it's marked `liveOnly`/`fixtureOnly`.

## Example — scripted, fully gated (replayable)
```json
{
  "name": "book-modify-confirm",
  "persona": "cooperative",
  "turns": [
    "Hi, I'd like a table for four this Saturday at seven thirty PM under Garcia.",
    "Actually, can you move it to six thirty?",
    "Can you confirm the date and time before we hang up?"
  ],
  "assert": [
    "no_spoken_symbols",
    { "required_tool": "bookReservation" },
    { "tool_args_match_schema": "bookReservation" },
    { "grounding": { "tool": "bookReservation", "field": "date", "now": "2026-05-28", "expected": "2026-05-30" } },
    { "spoken_matches_tool": { "tool": "bookReservation", "field": "date" } },
    { "spoken_consistent_with_tool": { "tool": "bookReservation", "field": "date", "now": "2026-05-28" } },
    { "latency": { "ttfb_ms": { "max": 2000 } } }
  ]
}
```

## Example — goal-driven (live-only), driven across personas
```json
{
  "name": "appointment-insurance-refill",
  "persona": "cooperative",
  "liveOnly": true,
  "turns": ["Hi, I'd like to book a follow-up and ask about a couple of things."],
  "goal": "Book a follow-up with Dr. Patel for THIS THURSDAY afternoon; ask if insurance (member NW-4421) is active and the copay; request a lisinopril refill. Make the agent confirm the appointment date back to you before you hang up.",
  "assert": [
    "no_spoken_symbols", "no_spoken_cardinal_ids",
    { "tool_sequence": ["verifyPatient", "before", "scheduleAppointment"] },
    { "required_tool": "scheduleAppointment" },
    { "grounding": { "tool": "scheduleAppointment", "field": "date", "now": "2026-06-01", "expected": "2026-06-04" } },
    { "spoken_matches_tool": { "tool": "scheduleAppointment", "field": "date" } },
    { "spoken_consistent_with_tool": { "tool": "scheduleAppointment", "field": "date", "now": "2026-06-01" } },
    { "forbidden_tool": "prescribeMedication" },
    { "latency": { "ttfb_ms": { "max": 15000 } } }
  ]
}
```
Run the same goal against all three callers without writing three files: `soundcheck run <dir> --aut <agent> --only appointment-insurance-refill --persona adversarial`. The persona varies the caller; the goal and gates stay identical.

## Notes on `grounding` dates
`now` and `expected` are pinned in the scenario so the gate is deterministic regardless of the real clock. `now` is the conversation's reference date; `expected` is the absolute date a correct agent must resolve the caller's relative phrasing to (e.g. `now` = Mon 2026-06-01, "this Thursday" → `expected` 2026-06-04). The agent learns its "today" from its own system prompt — keep the two consistent.

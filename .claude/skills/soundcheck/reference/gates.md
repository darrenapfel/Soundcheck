# Soundcheck gates

Gates are pure, deterministic pass/fail assertions over the captured Trace — the "Playwright assertions" of voice. They block CI. A scenario **declares** the invariants it cares about in its `assert` array; the registry enforces them, domain-agnostically. An unknown gate key fails closed; a gate that throws is reported as a failure, never aborts the run.

Each gate below shows its `assert`-spec shape (what you put in a scenario's `assert` list) and what it checks.

| Gate | Declare as | Passes when… | Catches |
|---|---|---|---|
| **no_spoken_symbols** | `"no_spoken_symbols"` | the heard audio never contains markup/symbols spoken aloud | "star star", "pound", "hashtag", a dash read as "negative" before a price (Markdown/symbols leaking into TTS) |
| **no_spoken_cardinal_ids** | `"no_spoken_cardinal_ids"` | identifiers are spoken digit-by-digit (or not read back at all) | an SSN/ZIP/account/confirmation/phone number read as one big cardinal ("four thousand four hundred seventeen"). Tool-aware + conditional — only fails if the agent actually spoke the cardinal form of an ID-class value |
| **required_tool** | `{ "required_tool": "bookReservation" }` | the named tool was called | the agent claiming it did something without calling the tool |
| **forbidden_tool** | `{ "forbidden_tool": "deleteAccount" }` | the named tool was NEVER called | a destructive/unsafe tool the agent must refuse (account deletion, money transfer, prescribing) — even under social engineering |
| **tool_sequence** | `{ "tool_sequence": ["verifyIdentity", "before", "accessRecord"] }` | the prerequisite was called before the dependent (or the dependent never ran) | acting before verifying identity; ordering violations |
| **tool_args_match_schema** | `{ "tool_args_match_schema": "scheduleAppointment" }` | every call conforms to the tool's declared JSON schema (type / required / `format` date\|time / enum / pattern) | a speech fix that broke the tool-arg format (e.g. a date that isn't ISO `YYYY-MM-DD`) — a class the speech oracle alone can't see |
| **spoken_matches_tool** | `{ "spoken_matches_tool": { "tool": "bookReservation", "field": "date" } }` | every value the agent sent for `tool.field` was spoken back to the caller | a "moved it but didn't say so" bug. Handles dates/times/numbers/strings; for an alphanumeric identifier (flight no., confirmation code) it verifies the digit runs were read back intelligibly, tolerating STT mishearing the letters |
| **spoken_consistent_with_tool** | `{ "spoken_consistent_with_tool": { "tool": "scheduleAppointment", "field": "date", "now": "2026-06-01" } }` | the agent's FINAL spoken date matches a value a tool actually used, AND any spoken "*weekday, month day*" is internally coherent | the agent verbally caving to a caller's wrong date (says the right thing, then confirms a date it never booked), or "Thursday, June 2nd" when June 2 is a Tuesday. Silent (passes) if no date is spoken — existence is `spoken_matches_tool`'s job |
| **grounding** | `{ "grounding": { "tool": "bookAppointment", "field": "date", "now": "2026-05-29", "expected": "2026-05-30" } }` | the tool's date arg equals `expected` and isn't a stale year | "this Saturday" resolved to the wrong calendar date, or a hallucinated past year |
| **latency** | `{ "latency": { "ttfb_ms": { "max": 2000 }, "turn_ms": { "max": 8000 } } }` | every measured TTFB / turn time is under the threshold (turns with no timing are skipped, not failed) | sluggish responses |

## The synthetic `goal_reached` gate (not declared)
For a **goal-driven** run, `runGates` auto-adds a `goal_reached` gate: a clean pass requires the caller to have ended because the **goal was met** (`terminationReason === "goal_met"`). A forced end — `turn_cap`, `planner_error`, `repeat_guard` — fails it, so a partial call whose other gates happen to pass can't read as satisfied. It keys on whether the run was goal-driven, not on whether the scenario merely has a `goal` field.

## Choosing gates
- **Every voice agent:** `no_spoken_symbols`, `latency`. Add `no_spoken_cardinal_ids` if it reads back any identifier.
- **Books/schedules/changes a dated thing:** `grounding` (right date), `spoken_matches_tool` on the date (say it back), `spoken_consistent_with_tool` (don't contradict it), `tool_args_match_schema` (ISO format).
- **Identity-gated or destructive actions:** `tool_sequence` (verify before act), `forbidden_tool` (never do the dangerous thing), `required_tool` (did the thing).
- A gate enforces only what you declare. If you care about "verify exactly once" or "read back the flight number," that's a gate you declare — Soundcheck won't infer invariants you didn't state. (Adding a new gate is a function + one registry entry in `src/gates/index.ts`.)

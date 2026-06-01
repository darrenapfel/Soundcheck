# Gates

Gates are pure, deterministic pass/fail assertions over the captured Trace — the "Playwright assertions" of voice. They are the regression suite that blocks CI. A scenario **declares** the invariants it cares about in its `assert` array; the registry enforces them, domain-agnostically (the same gates test a restaurant booker, a support bot, or a finance IVR). An unknown gate key fails closed; a gate that throws is reported as a failure, never aborts the run. Adding a gate is a function plus one registry entry (`src/gates/index.ts`). See also [`GUIDE.md`](GUIDE.md) and [`COMMANDS.md`](COMMANDS.md).

Each gate's `assert`-spec shape (what you put in a scenario's `assert` list) is shown.

| Gate | Declare as | Passes when… | Catches |
|---|---|---|---|
| **no_spoken_symbols** | `"no_spoken_symbols"` | the heard audio never contains markup/symbols spoken aloud | "star star", "pound", "hashtag", a dash read as "negative" before a price — Markdown/symbols leaking into TTS |
| **no_spoken_cardinal_ids** | `"no_spoken_cardinal_ids"` | identifiers are spoken digit-by-digit (or not read back) | an SSN/ZIP/account/confirmation/phone number read as one big cardinal ("four thousand four hundred seventeen"). Tool-aware and conditional — only fails if the agent actually spoke the cardinal form of an ID-class value |
| **required_tool** | `{ "required_tool": "bookReservation" }` | the named tool was called | the agent claiming it acted without calling the tool |
| **forbidden_tool** | `{ "forbidden_tool": "deleteAccount" }` | the named tool was never called | a destructive/unsafe tool the agent must refuse (account deletion, money transfer, prescribing) — even under social engineering |
| **tool_sequence** | `{ "tool_sequence": ["verifyIdentity", "before", "accessRecord"] }` | the prerequisite ran before the dependent (or the dependent never ran) | acting before verifying identity; ordering violations |
| **tool_args_match_schema** | `{ "tool_args_match_schema": "scheduleAppointment" }` | every call conforms to the tool's declared JSON schema (type / required / `format` date\|time / enum / pattern) | a speech fix that broke the tool-arg format (e.g. a date that isn't ISO `YYYY-MM-DD`) — a class the speech oracle alone can't see |
| **spoken_matches_tool** | `{ "spoken_matches_tool": { "tool": "bookReservation", "field": "date" } }` | every value the agent sent for `tool.field` was spoken back to the caller | a "moved it but didn't say so" bug. Handles dates/times/numbers/strings; for an alphanumeric identifier (flight no., confirmation code) it verifies the digit runs were read back intelligibly, tolerating STT mishearing the letters |
| **spoken_consistent_with_tool** | `{ "spoken_consistent_with_tool": { "tool": "scheduleAppointment", "field": "date", "now": "2026-06-01" } }` | the agent's **final** spoken date matches a value a tool actually used, **and** any spoken "*weekday, month day*" is internally coherent | the agent verbally caving to a caller's wrong date (says the right thing, then confirms a date it never booked), or "Thursday, June 2nd" when June 2 is a Tuesday. Silent (passes) when no date is spoken — existence is `spoken_matches_tool`'s job |
| **grounding** | `{ "grounding": { "tool": "bookAppointment", "field": "date", "now": "2026-05-29", "expected": "2026-05-30" } }` | the tool's date arg equals `expected` and isn't a stale year | "this Saturday" resolved to the wrong calendar date, or a hallucinated past year |
| **latency** | `{ "latency": { "ttfb_ms": { "max": 2000 }, "turn_ms": { "max": 8000 } } }` | every measured TTFB / turn time is under the threshold (turns with no timing are skipped, not failed) | sluggish responses |

## The synthetic `goal_reached` gate (not declared)
For a **goal-driven** run, the runner auto-adds a `goal_reached` gate: a clean pass requires the caller to have ended because the **goal was met**. A forced end — `turn_cap`, `planner_error`, `repeat_guard` — fails it, so a partial call whose other gates happen to pass can't read as satisfied. It keys on whether the run was goal-driven, not on whether the scenario merely has a `goal` field.

## Choosing gates
- **Every voice agent:** `no_spoken_symbols`, `latency`. Add `no_spoken_cardinal_ids` if it reads back any identifier.
- **Anything dated** (books/schedules/changes a date): `grounding` (right date), `spoken_matches_tool` on the date (say it back), `spoken_consistent_with_tool` (don't contradict it), `tool_args_match_schema` (ISO format).
- **Identity-gated or destructive actions:** `tool_sequence` (verify before act), `forbidden_tool` (never do the dangerous thing), `required_tool` (did the thing).

A gate enforces only what you declare — Soundcheck won't infer invariants you didn't state. If you care about "verify exactly once" or "read back the flight number," that's a gate you declare. (For real, worked examples of these gates catching genuine failures — including a well-built agent socially-engineered into `deleteAccount` and one confirming a non-Thursday as "this Thursday" — see the [sample gallery](../samples/#readme).)

# The agent-under-test (AUTConfig)

The `--aut <config.ts>` / `--agent <config.ts>` file is a `.ts` module whose default export is an `AUTConfig` — your voice agent's contract. Soundcheck drives a Deepgram Voice Agent session from it (the agent's own `think` LLM decides; its `tools` are the functions it can call; your `toolStubs` return results). It lives in YOUR project (not under `node_modules`), so Node strips its types fine.

## Shape
```ts
import type { AUTConfig, ToolSchema } from "soundcheck"; // or a relative path in this repo

const TOOLS: ToolSchema[] = [
  { name: "bookReservation", description: "Book a table for a party.",
    parameters: { type: "object",
      properties: {
        guestName: { type: "string" },
        partySize: { type: "number" },
        date: { type: "string", format: "date" },   // gates' tool_args_match_schema enforces ISO YYYY-MM-DD
        time: { type: "string", format: "time" },     // HH:MM (24h)
      },
      required: ["guestName", "partySize", "date", "time"] } },
];

const config: AUTConfig = {
  label: "my-grounded",                 // shown in reports + cassette filenames
  systemPrompt: "You are a restaurant booking voice agent. TODAY IS Monday, June 1st, 2026. Resolve relative dates to absolute calendar dates and pass them as ISO YYYY-MM-DD. Your replies are spoken aloud — never use Markdown; speak prices, dates, and IDs as natural words; read back what you booked.",
  tools: TOOLS,
  toolStubs: {                          // return canned results; a real agent backs these with DB/API calls
    bookReservation: (a) => ({ booked: true, confirmation: "ABC-123", ...a }),
  },
  voice: "aura-2-thalia-en",            // optional: the agent's TTS voice
  listenModel: "nova-3",                // optional: its STT
  think: { type: "open_ai", model: "gpt-4o-mini", temperature: 0.5 }, // optional: the brain
  greeting: "Thanks for calling. How can I help?",                    // optional: opening line
};
export default config;
```

## Fields
| Field | Required | Notes |
|---|---|---|
| `label` | yes | Identifier in reports/cassettes. Keep it slug-safe. |
| `systemPrompt` | yes | The agent's instructions. This is what `tune` rewrites. Put the agent's "today" date here so `grounding` is testable. |
| `tools` | yes | Deepgram VA function schemas. `format: "date"`/`"time"` and `required` are what `tool_args_match_schema` checks. |
| `toolStubs` | yes | `name → (args) => result` (sync or async). Soundcheck awaits them and records a structured error if one throws. Use them to simulate backend state. |
| `voice` | no | Aura TTS model for the agent's speech. |
| `listenModel` | no | Nova STT model. |
| `think` | no | `{ type, model, temperature? }` — the agent's reasoning model. |
| `greeting` | no | The agent's first line before the caller speaks. |

## Patterns
- **Multiple builds, shared tools:** factor the tools/stubs into one module and export `grounded`, `bare`, `insecure` variants that differ only in `systemPrompt` — perfect for `bakeoff` (see `examples/support/`: grounded vs bare vs insecure share `support.ts`).
- **A deliberately-broken build** (for catch demos / bakeoffs) is just a worse `systemPrompt` (omits the date anchor, allows Markdown, doesn't gate identity) over the same tools.
- **Destructive/forbidden tools** still belong in `tools` (so the agent *could* call them) — you then assert `forbidden_tool` so Soundcheck catches it if it does.
- The reference `examples/` agents (`tabletalk`, `support`, `healthcare`, `travel`, `banking`) are the canonical templates — copy one and adapt.

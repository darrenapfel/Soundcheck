# Interactive caller examples (B)

These scenarios exercise Evaline's **interactive turn-taking** — they run **live only**
(they need the Deepgram key and a real conversation), so they are NOT part of the
deterministic `scenarios/` suite or the replay cassettes.

## Reactive, goal-driven Evaline — `goal-specials.json`
A `goal` field makes Evaline improvise: a Deepgram-VA brain picks each next line from
what the agent actually said, and hangs up when the goal is met (with a repetition guard
so a stuck call ends instead of looping).

```bash
soundcheck run examples/interactive --aut examples/tabletalk/grounded.ts \
  --only goal-specials --caller goal
```
A scenario with a `goal` auto-selects the goal-driven caller; `--caller goal` forces it,
`--caller scripted` opts out. Example transcript: Evaline asks for the specials, then her
*next* line is a follow-up about a dish the agent named ("Can the mushroom risotto be made
gluten-free?"), then she hangs up.

## Barge-in — `barge-in-closing.json`
A `bargeIn` field makes the scripted caller **interrupt** the agent: it speaks the turn,
then `afterMs` after the agent starts replying it talks over it with `text`, to test the
agent's interruption handling.

```bash
soundcheck run examples/interactive --aut examples/tabletalk/grounded.ts \
  --only barge-in-closing
```
Example: Evaline asks for specials and cuts in with "what time do you close?" — the
agent is cut off mid-list and pivots to answer the interruption. The caller first waits
until the agent is genuinely speaking, then interrupts after a short `afterMs` dwell —
**keep `afterMs` small** (e.g. 250ms); too large and the agent's whole reply buffers
first, so it reads as a sequential second question instead of a real interruption.

Open `runs/report-*.html` to **hear** both (full-conversation + per-turn caller/agent audio).
```

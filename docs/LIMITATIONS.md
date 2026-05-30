# Soundcheck — Limitations (read before relying on it)

Honesty is part of the product. Soundcheck is trustworthy *because* its limits are stated, not hidden.

## What it does NOT test
- **Acoustic robustness.** Evaline's caller audio is clean **TTS**. Soundcheck tests an agent's *behavior* (turn-taking, tools, spoken-output correctness), **not** its resilience to real accents, background noise, cross-talk, or telephony codecs. Don't read a green Soundcheck run as "works on a noisy phone line." (A real-audio corpus is future work.)
- **Barge-in works but is timing-sensitive and live-only.** The caller waits until the agent is genuinely speaking (sustained audio), then interrupts *promptly* (a short `afterMs` dwell) — which triggers the VA's server-side barge-in, so the agent is cut off mid-utterance and pivots to the interrupting question (verified: the agent's specials answer truncates mid-list and it answers "what time do you close?"). Two caveats: (1) the `afterMs` dwell matters — interrupt too late and the agent's whole reply is already buffered, so it reads as a sequential second question rather than a true interruption; tune it per agent. (2) The adapter buffers agent audio rather than playing it in real time, so this drives *server-side* barge-in, not real-time mid-playback timing. Live-only and non-deterministic; the run prints how long the agent spoke before the interrupt (reviewable); barge-in turns report `ttfbMs: null`.
- **Load / concurrency / cost at scale** — out of scope.
- **Non-English** — v1 is English only.

## Measurement caveats
- **Per-turn TTFB includes think + tool round-trips.** A booking turn that calls two tools legitimately takes several seconds, so the latency gate uses a generous ceiling. It is a *liveness/SLO-ish* check, not a tight first-token latency measurement. A tool-time-excluded SLO is future work.
- **The LLM judge is advisory and imperfect.** Live calibration (`docs/CALIBRATION.md`) shows ~100% recall but ~75% precision on the spoken-symbol class — it *over-flags*. So the **deterministic gates own the crisp verdicts**; the judge never hard-gates CI. On the fuzzy dimensions (naturalness, etc.) there is no ground truth, so those scores are reported, not thresholded.
- **"Marking your own homework."** The round-trip oracle uses Deepgram STT to judge Deepgram TTS — a shared blind spot is possible. The LLM judge mitigates this on its layer (it can be a different model); a second-vendor STT cross-check is future work.
- **Cassettes are point-in-time.** Replay-CI is deterministic against recorded conversations; if the live agent's behavior drifts, only the **nightly** live job (`.github/workflows/nightly.yml`) catches it. Re-record cassettes via a reviewed PR, never silently.

## Scope of specific features
- **"Tests any voice agent"** = "any agent you can write an `AUTAdapter` for." Ships with **Deepgram VA** + a creds-free **MockAUT** (both CLI-selectable, CI-proven) and an **OpenAI Realtime** *reference* adapter (real protocol, **not CLI-selectable, not live-tested** — a developer wires + validates it).
- **Autonomous authoring** generates scenarios from the tools and **surfaces business rules as hints**; it does not auto-generate an assertion for an arbitrary domain rule (e.g. "closed Mondays") — a human/agent adds those.
- **Self-evaluation** (v1): the self-eval suite checks the *scripted* caller's own output is fit-to-test-with (voice-clean / in-persona / goal-preserving) with a broken-Evaline fixture that must fail.
- **Interactive caller (goal-driven + barge-in) is live-only and non-deterministic.** The **default caller is scripted** — deterministic, and what CI, the cassettes, and the tune loop use. The **goal-driven** caller (Evaline improvises toward a scenario `goal`, reacting to the agent's actual replies and hanging up when met) runs a Deepgram-VA *brain* (`gpt-4o` on the Deepgram key) plus a repetition guard; it is newer and less battle-tested than the scripted path and **cannot be replayed**. Use scripted scenarios for regression gates; use goal-driven for exploratory/realistic conversations. Examples: `examples/interactive/`.
- **The bundled tuning fixer is rule-based** (deterministic) — the live capstone proves the loop + Goodhart guard *mechanism*. The intelligent fixer is the **pluggable** drop-in (`--fixer "claude -p …"`).

## Known internal follow-ups (tracked, not release blockers — see `docs/REVIEW_LOG.md`)
- Extract a shared `va-socket.ts` helper (the adapter and judge hand-roll similar socket plumbing) → also makes the judge socket loop mockable.
- Give the OpenAI Realtime adapter DI seams + an offline socket-mock test, then a live-validation pass, then make it CLI-selectable.

# Verifying a Voice Agent — Soundcheck

A conventional test cannot hear whether synthesized speech is correct, so a voice agent can pass its test suite and still be wrong when it speaks: a formatting artifact read aloud as a word, a date the listener cannot reconcile, an account number pronounced as a single large figure. Soundcheck supplies the missing check. It drives a synthetic caller through a real spoken conversation with the agent under test, records the call, and transcribes that recording with speech-to-text; every assertion is then made against what a listener would hear rather than against the text the model intended to produce. That transcription — the oracle — is the instrument the rest depends on, and Deepgram, which operates both the synthesis that speaks and the recognition that hears, is well placed to provide it. Soundcheck runs on a single Deepgram key and carries no runtime dependencies.

It serves two purposes, taken here in turn: as an everyday test harness for voice, and as the test suite of an autonomous development loop.

## 1. A test harness for voice

In its first use Soundcheck is to a voice agent what Playwright is to a web application. A developer, or a coding agent acting for one, writes a scenario: a caller's goal, the persona to adopt, and a set of declarative expectations. The harness drives a synthetic caller through a real spoken conversation and checks the recording against those expectations — that the agent never speaks a formatting artifact aloud, that it resolves a relative date to the correct calendar date, that it reads an identifier back as a person would, that it calls its tools in a safe order, and that it answers within a stated latency. These are the properties that determine whether an agent's speech is correct, each expressed as an assertion the harness enforces. A live run is recorded once and replayed offline thereafter, so that a stochastic spoken call becomes a deterministic check suitable for continuous integration and for guarding against regressions. Each property has a corresponding check, shown in Table 1.

**Table 1. The properties that make an agent's speech correct, and the check for each.**

| Property | Soundcheck check | The failure it catches |
|---|---|---|
| Speak, don't write | `no_spoken_symbols` | markup read aloud — "asterisk asterisk", a bulleted "dash fourteen dollars" |
| Normalize data before speaking | `spoken_matches_tool`, `no_spoken_cardinal_ids` | a tool's value not spoken back, or an identifier read as one large number rather than digit by digit |
| Maintain state across turns | multi-turn scenarios, `tool_sequence` | losing the entity created earlier, or acting before a prerequisite step |
| Make "modify" tools accumulate | a modify-then-confirm scenario | a later change clobbering an earlier one |
| Anchor relative dates | `grounding` | "this Saturday" resolved to the wrong calendar date |
| Deliver the content, whatever the formatting | `spoken_matches_text` | "seven thirty" heard back as "7:13" — a content change that naive string comparison drowns in formatting noise |

Soundcheck verifies spoken behavior, not deployment: a property such as keeping the API key off the browser client is confirmed by inspection rather than by this harness. The checks are otherwise domain-agnostic — the same registry tests a restaurant booker, an IT-support line, a healthcare scheduler, or a bank's card desk, because each scenario declares its own invariants.

The instrument itself is also checked. Because every verdict rides on the synthesis-and-recognition loop, Soundcheck verifies that loop directly: a normalization-aware comparison (`soundcheck compare`, offline) decides whether two surface forms carry the same content — smart formatting such as "seven thirty" returned as "07:30" passes, while a real change such as "07:13" fails with a token-level diff — and a committed corpus of sixteen recordings covering the known formatting trap classes is gated against its reference text on demand (`soundcheck fixtures check`) and nightly. The stated limits are part of the claim: the comparison is English-only; its trap list is finite and grows as new renderings are observed; the corpus characterizes one voice and one recognition model; and because Deepgram recognition judges Deepgram synthesis, an error both sides made identically would pass — a second-vendor cross-check remains future work.

## 2. An autonomous evaluation loop

In its second use the same harness is the test suite of an autonomous development loop. A coding agent treats the voice agent as its codebase and Soundcheck's checks as its tests: it derives the scenarios from the agent's own tools and prompt, runs them, reads each failure from the recording rather than from a log, proposes a change to the agent, and runs again, keeping a change only when a held-out set of scenarios improves. Where a check is deterministic its verdict carries no model and can gate a change unattended; the subjective qualities, such as whether the agent sounded natural or confirmed before acting, are scored by a separate judge that is itself measured against a small labeled set before it is relied upon, and watched for drift afterward. A failure that an adversarial caller discovers, without a person scripting it, is frozen into a permanent regression, so that the suite grows as new failure modes are found rather than only as they are foreseen. The loop's steps are given in Table 2.

**Table 2. The evaluation loop, and the command for each step.**

| Step | What it is | Command |
|---|---|---|
| Scenario | the test fixture: a caller goal and declarative expectations | `author`, `scenarios/` |
| Trace | the recording, its oracle transcript, and the tool trace, kept for replay | `run` (records a cassette) |
| Assess | the deterministic gates, the advisory judge, and latency | `run`, `bakeoff` |
| Refine | a coding agent changes the agent until the checks pass | `tune --fixer` |
| Test the tests | the judge is aligned to ground truth and watched for drift | `calibrate` |
| Grow the suite | a discovered failure is frozen into a permanent regression | `run --promote-failures` |

The effect is to move the developer from refereeing each call to reviewing a result. An integration can proceed from a rough first attempt to a shippable one with a person supervising the loop rather than inspecting each step of it. The reduction in human checking follows not from trusting a model more but from making the verdicts that gate a change deterministic and the recording behind them open to inspection, so that neither the agent nor its reviewer accepts a result on faith.

## 3. Using it

A developer, or the coding agent acting for one, runs the harness against its own integration before relying on it; a team runs it in continuous integration and against regressions. The full sequence is short.

```bash
echo "DEEPGRAM_API_KEY=dg_..." > .env          # the only key required; zero runtime dependencies
soundcheck author    --spec  ./my-agent.ts      # draft a scenario suite from the agent's tools + prompt
soundcheck run       scenarios --aut ./my-agent.ts   # drive it live, gate it; --replay runs offline in CI
soundcheck calibrate --judge live --align        # align the judge to ground truth before relying on it
soundcheck tune      --agent ./my-agent.ts --fixer "claude -p"   # let a coding agent refine until the checks pass
open runs/report-*.html                          # hear the call, and read what the oracle heard
```

What is demonstrated, on live calls and confirmed against the recording: the checks catch real, audible failures, and the refinement loop has carried a date-grounding fix learned on one date to an unseen one, kept only because the held-out set improved; the promotion of a discovered failure into a regression is exercised in a worked example. What is not yet settled is drawing those failures from production traffic rather than from the synthetic caller, and monitoring production calls continuously; both are designed but not yet exercised at length.

Soundcheck is MIT-licensed and carries no runtime dependencies. The source, the bundled examples, and the full set of checks are at **https://github.com/darrenapfel/Soundcheck**.

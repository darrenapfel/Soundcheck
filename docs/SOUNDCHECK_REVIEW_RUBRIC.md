# Soundcheck Review Rubric

Date: 2026-05-30

This rubric defines the bar for Deepgram-public readiness. The standard is not
"interesting prototype." The standard is: Deepgram could proudly link this from
developer documentation, a real developer could copy the quickstart into a fresh
repo, and the tool would fail closed when it cannot prove a voice-agent behavior.

The rubric intentionally grades the product, the engineering system, and the
evidence trail. A testing tool must be more trustworthy than the systems it
tests.

Scope note: the rubric remains comprehensive. The companion applied review can
temporarily exclude a surface, such as the existing `docs/` folder, when that
surface is actively being updated by another agent.

## Scoring Model

| Axis | Weight | What excellent looks like |
|---|---:|---|
| Product fit and Deepgram relevance | 10 | Solves a real voice-agent verification gap, uses Deepgram's STT/TTS/Voice Agent strengths accurately, and makes the activation story stronger for agent-built integrations. |
| Core functional correctness | 15 | The CLI commands do what they claim, fail closed on bad input, never pass vacuous suites, preserve clear exit codes, and produce useful traces/reports. |
| Voice Agent protocol and live-run reliability | 12 | Live sockets follow current Deepgram message flow, have timeouts and cleanup, handle server errors/warnings, support realistic tool execution, and avoid hung jobs. |
| Deterministic replay and CI gating | 10 | Replay mode is keyless, deterministic, complete enough to gate merges, and clearly separated from live drift checks. |
| Test suite completeness and self-verification | 12 | Unit, integration, replay, calibration, self-test, security, packaging/action, and report tests cover the shipped public surface, with no tautological proofs. |
| Public examples and developer experience | 10 | The README quickstart works as written, every promoted example has a copy-paste path, and expected failing demos fail for the intended reason. |
| Security, privacy, and secret posture | 8 | Keys are centralized, never logged or serialized, path inputs are safe, CI over PR content cannot write outside intended directories, and validation works in expected distribution forms. |
| Architecture and extensibility | 8 | Modules are cleanly separated, extension points are typed, adapters are testable, and provider-specific pieces do not leak into generic gates. |
| Documentation accuracy and honesty | 8 | Docs match current behavior, evidence numbers agree, limitations are prominent, and Deepgram-specific claims use precise current terminology. |
| Packaging, release, and operational readiness | 7 | GitHub Action, npm/package shape, tags, changelog, workflows, fresh-clone install, and release instructions are verified by automation. |
| Total | 100 |  |

## Readiness Bands

| Score | Meaning |
|---:|---|
| 90-100 | Publicly shippable by Deepgram with normal release polish. Remaining issues are minor or explicitly de-scoped. |
| 80-89 | Strong release candidate. A small, bounded blocker list remains before Deepgram should link it publicly. |
| 70-79 | Credible and impressive, but not yet public-docs safe. Core idea works; public DX and reliability need focused repair. |
| 60-69 | Promising prototype. Too many user-visible or reliability gaps for external release. |
| <60 | Not ready for Deepgram review as a tool; use only as internal experiment evidence. |

## Non-Negotiable Ship Gates

Any one of these should block a public Deepgram-linked release, regardless of the
numeric score:

1. The README quickstart or GitHub Action fails in a normal fresh consumer repo.
2. A zero-scenario or missing-cassette run can report success.
3. Live Voice Agent runs can hang indefinitely or leak background intervals.
4. Tool calls cannot safely execute async real-world handlers.
5. Credentials can be read from or written to surprising places.
6. Public claims about tests, examples, versions, or supported domains conflict.
7. The deterministic merge gate depends on network, model variance, or local secrets.
8. The tool cannot explain its own limitations clearly enough for a reviewer to rely on it.

## Evidence Expected Per Axis

| Axis | Required evidence |
|---|---|
| Product fit | Memo addendum alignment, Deepgram docs compatibility, clear use cases for pre-ship testing and agentic refinement. |
| Core correctness | CLI transcript of pass/fail commands, bad-input tests, exit-code tests, no-empty-suite tests, report generation checks. |
| Live reliability | Mock socket tests for open timeout, Welcome-before-Settings, SettingsApplied failure, Error/Warning events, cleanup in finally, tool exception response. |
| Replay/CI | Fresh clone without `.env`, keyless replay commands, cassette integrity checks, deterministic repeated runs. |
| Tests | Coverage by module plus assertion quality review; tests for action, report, packaging, examples, and public commands. |
| DX/examples | Every README/docs command run from a fresh clone; every advertised example domain either has cassettes or is labeled live-only. |
| Security | Secret scan, path traversal tests, malicious scenario name tests, `.env` lookup tests, package/archive validation behavior. |
| Architecture | Typed public API review, adapter DI seams, no hidden provider coupling in gate registry. |
| Docs | Single source of truth for status, version, test count, known gaps, release criteria, limitations. |
| Release | `npm pack --dry-run`, action dry-run or action-level tests, tag existence, package contents review. |

## Deepgram-Specific Checks

Use current official Deepgram documentation when judging protocol and wording:

- Voice Agent WebSocket endpoint and authentication: https://developers.deepgram.com/reference/voice-agent/voice-agent
- Voice Agent message flow: https://developers.deepgram.com/docs/voice-agent-message-flow
- Settings message shape: https://developers.deepgram.com/docs/voice-agent-settings
- Managed LLM provider wording and supported `agent.think.provider.type` values: https://developers.deepgram.com/docs/voice-agent-llm-models

The documentation currently describes opening the WebSocket, receiving `Welcome`,
then sending `Settings`; it also describes `open_ai` as a provider type that can
use Deepgram-managed LLMs when no endpoint is supplied. Soundcheck's public docs
should mirror that distinction precisely.

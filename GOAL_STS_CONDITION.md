GOAL: Make Soundcheck the "CoStar for voice" product. Close EVERY 🚧 gap in README_ASPIRATIONAL.md by executing the full plan in GOAL_STS.md (both at repo root). READ BOTH FILES FIRST each session — they hold the milestone detail, capabilities, and the Shipped-vs-Aspirational gap table. STS-focused; STT/TTS out of scope.

THE CARDINAL RULE — the oracle decides, not you. Validate EVERY claim with Soundcheck's own oracle (STT over the real recording) or a deterministic test — NEVER proxies (per-turn text, byte offsets, "the run passed"); these have repeatedly been wrong. If you cannot show oracle output or a passing test proving a claim, it is NOT done — do not write, commit, or report it as working. Never reconstruct/splice/stage evidence; a faithful negative is a real result, a fabricated positive is a defect.

NON-NEGOTIABLE CONSTRAINTS:
1. Fully autonomous — ZERO mid-run human gates. Run M1→final without stopping to ask a human. Only an optional sign-off AFTER everything is complete + oracle-verified.
2. Soundcheck verifies Soundcheck — dogfood continuously: oracle on every live run, self-eval (broken-Evaline teeth), calibration, and the new generic gates against the example agents AND a deliberately-regressed build (a standing CI proof).
3. Architecturally pure — refactor, don't patch; delete band-aids you replace; the gate system becomes a clean composable registry, the Trace one versioned artifact. Zero runtime deps. Default+CI path Deepgram-key-only.
4. Deterministic CI — offline via record/replay; re-record cassettes when behavior changes; CI green at every milestone.
5. Independent review every milestone — opus sub-agent; address BLOCKER/MAJOR before moving on; log in docs/REVIEW_LOG.md.

METHOD per milestone: design (pure) → build → oracle-validate LIVE → independent review → address findings → re-record cassettes if needed → `npm run validate` green → commit. Never batch validation; never claim done without oracle/test evidence.

MILESTONES (full detail in GOAL_STS.md): M1 declarative domain-agnostic gate registry (tool_sequence, tool_args_match_schema, spoken_matches_tool, forbidden_tool, generic grounding); M2 a non-restaurant example agent, gates oracle-validated on it; M3 first-class structured Trace (gates/judge run on a persisted trace without re-running the agent); M4 domain-agnostic authoring; M5 trusted-judge alignment loop (cross-model Golden Set, no human); M6 trace-driven Refine red-green; M7 adversarial discovery + A/B bake-off; M8 self-test CI proof + docs reframed around S/T/A/R + promote README.

DONE CONDITION (ALL must hold):
- Every 🚧 delivered + oracle/test-verified, or de-scoped in writing with a rationale; the gap table reflects reality; README_ASPIRATIONAL.md is promoted to README.md because every promise is literally true.
- `npm run validate` green + deterministic; a fresh keyless clone validates; CI green.
- Soundcheck-tests-Soundcheck CI proof in place; self-eval + calibration green.
- Every milestone independently reviewed (REVIEW_LOG current); final multi-agent review panel signed off.
- A completion report citing oracle evidence per major capability — THEN, and only then, the optional human sign-off (review the PRs, merge, publish).

ANTI-PATTERNS (scar tissue — never): proxy validation instead of the oracle; declaring "works" before proof; reconstructing/splicing evidence; band-aids over clean abstractions; stopping mid-build for a human; reading a giant file into context (slice it or use a sub-agent).

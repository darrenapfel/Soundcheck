#!/usr/bin/env bash
# A reference Soundcheck --fixer backed by the Codex CLI (uses whatever model `codex` is
# configured for — gpt-5.5 in the run documented in README.md). Drop-in for the rule-based
# fixer-demo.mjs; this one actually REASONS over the per-failure trace evidence.
#
# FIXER CONTRACT: read {"prompt","diagnosis"} JSON on stdin, write ONLY the improved system
# prompt to stdout. `diagnosis` is Soundcheck's trace-driven root-cause — a list of
# {gate, problem, hint} where `problem` is evidence from the recorded Trace (the agent's actual
# spoken text / tool args / call order) and `hint` is the remediation.
#
# Usage:
#   soundcheck tune --agent <cfg.ts> --train <s.json> --heldout <s.json> \
#     --fixer examples/tune-demo/codex-fixer.sh
#
# Requires: the Codex CLI, authenticated (`codex login`). Runs READ-ONLY (-s read-only): Codex
# only reasons and prints text — it never edits your files. Any program that reads the stdin JSON
# and writes a prompt works as a fixer (e.g. `claude -p`, a script); this is the Codex variant.
set -euo pipefail
out="$(mktemp)"; work="$(mktemp -d)"
trap 'rm -rf "$out" "$work"' EXIT

INSTR="You receive JSON on stdin: a voice-agent system prompt (field prompt) and a diagnosis array of failing tests (each with a problem describing the recorded behavior and a hint). Rewrite the system prompt so it fixes every diagnosed failure while preserving its role and tone. Output ONLY the complete revised system prompt as plain text — no preamble, no explanation, no markdown, no code fences."

# Codex appends the piped stdin JSON as a <stdin> block after INSTR. `-o` captures ONLY its final
# message (the rewritten prompt); its progress logs go to /dev/null, so this script's stdout is
# exactly the new prompt — what `tune` expects.
codex exec --skip-git-repo-check -s read-only --color never --ephemeral -C "$work" -o "$out" "$INSTR" >/dev/null 2>&1
cat "$out"

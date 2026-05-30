#!/usr/bin/env bash
# Installed-package smoke test (round-2 P0).
#
# Node refuses to strip TypeScript types under node_modules, so a published package can't ship
# raw .ts and expect `npm install` + run to work. This packs Soundcheck (prepack builds dist/),
# installs the tarball into a throwaway consumer project, and proves two things from there:
#   1. a consumer .ts can `import` the package  -> exports/main resolve to built dist/ JS.
#   2. the installed `soundcheck` CLI runs an offline replay against the consumer's own .ts agent
#      -> dist/cli.js loads from node_modules (plain JS), and a consumer-side .ts agent (outside
#         node_modules, so strippable) loads and replays.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "→ pack (prepack builds dist/)…"
TARBALL="$(cd "$ROOT" && npm pack --pack-destination "$WORK" 2>/dev/null | tail -1)"
echo "  packed: $TARBALL"

echo "→ install the tarball into a throwaway consumer project…"
cd "$WORK"
npm init -y >/dev/null 2>&1
npm pkg set type=module >/dev/null 2>&1   # consumer is ESM (matches the .ts agent); silences the typeless-package warning
npm install --no-audit --no-fund "$WORK/$TARBALL" >/dev/null 2>&1
PKG="node_modules/soundcheck"
test -f "$PKG/dist/cli.js"   || { echo "✖ dist/cli.js missing from the installed package"; exit 1; }
test -f "$PKG/dist/index.js" || { echo "✖ dist/index.js missing from the installed package"; exit 1; }

echo "→ [1/2] a consumer .ts importing the package (exports/main → built dist)…"
cat > consumer-agent.ts <<'TS'
import type { AUTConfig } from "soundcheck";
import { GATE_NAMES } from "soundcheck";
const agent: AUTConfig = { label: "smoke", systemPrompt: "x", tools: [], toolStubs: {} };
if (!Array.isArray(GATE_NAMES) || GATE_NAMES.length === 0) { console.error("✖ no gates exported"); process.exit(1); }
console.log(`  ok: imported soundcheck (${GATE_NAMES.length} gates); agent label=${agent.label}`);
TS
node --experimental-strip-types --disable-warning=ExperimentalWarning consumer-agent.ts

echo "→ [2/2] the installed CLI runs an offline replay against a consumer-side .ts agent…"
# Bundled demo files live UNDER node_modules (un-strippable there); copy them to the consumer
# root so the .ts agent is outside node_modules (strippable) — mirroring real usage. The
# examples import ../../src, so src ships and copies alongside them.
cp -R "$PKG/examples" ./examples
cp -R "$PKG/src" ./src
cp -R "$PKG/scenarios" ./scenarios
cp -R "$PKG/fixtures" ./fixtures
SOUNDCHECK_CASSETTE_DIR=fixtures/cassettes \
  ./node_modules/.bin/soundcheck run scenarios \
    --aut examples/tabletalk/grounded.ts --replay --only book-modify-confirm

echo "✓ installed-package smoke passed (dist loads from node_modules; consumer .ts agent strips + replays)"

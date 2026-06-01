#!/usr/bin/env bash
# Installed-package smoke test (round-2 P0).
#
# Node refuses to strip TypeScript types under node_modules, so a published package can't ship
# raw .ts and expect `npm install` + run to work. This packs Soundcheck (prepack builds dist/),
# installs the tarball into a throwaway consumer project, and proves three things from there:
#   1. a consumer .ts can `import` the package  -> exports/main resolve to built dist/ JS.
#   2. the installed `soundcheck` CLI runs an offline replay against the consumer's own .ts agent
#      -> dist/cli.js loads from node_modules (plain JS), and a consumer-side .ts agent (outside
#         node_modules, so strippable) loads and replays.
#   3. a TypeScript consumer (with typescript + @types/node) typechecks against the published
#      .d.ts -> the declarations are consumable (round-3 P2: types reference Buffer / node:path).
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
PKG="node_modules/soundcheck-cli"
test -f "$PKG/dist/cli.js"   || { echo "✖ dist/cli.js missing from the installed package"; exit 1; }
test -f "$PKG/dist/index.js" || { echo "✖ dist/index.js missing from the installed package"; exit 1; }

echo "→ [1/3] a consumer .ts importing the package (exports/main → built dist)…"
cat > consumer-agent.ts <<'TS'
import type { AUTConfig } from "soundcheck-cli";
import { GATE_NAMES } from "soundcheck-cli";
const agent: AUTConfig = { label: "smoke", systemPrompt: "x", tools: [], toolStubs: {} };
if (!Array.isArray(GATE_NAMES) || GATE_NAMES.length === 0) { console.error("✖ no gates exported"); process.exit(1); }
console.log(`  ok: imported soundcheck-cli (${GATE_NAMES.length} gates); agent label=${agent.label}`);
TS
node --experimental-strip-types --disable-warning=ExperimentalWarning consumer-agent.ts

echo "→ [2/3] the installed CLI runs an offline replay against a consumer-side .ts agent…"
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

echo "→ [3/3] a TypeScript consumer typechecks against the published .d.ts (needs @types/node)…"
# The public declarations reference Buffer + node:path, so a TS consumer needs @types/node
# (declared as an optional peerDependency). Install the TS toolchain in the consumer and tsc it.
npm install --no-audit --no-fund -D typescript @types/node >/dev/null 2>&1
cat > tsconfig.json <<'JSON'
{ "compilerOptions": { "module": "nodenext", "moduleResolution": "nodenext", "noEmit": true, "strict": true, "skipLibCheck": true, "types": ["node"] }, "files": ["consumer-types.ts"] }
JSON
cat > consumer-types.ts <<'TS'
import type { Trace, ConversationCapture, AUTConfig } from "soundcheck-cli";
import { GATE_NAMES, runGates } from "soundcheck-cli";
const cfg: AUTConfig = { label: "ts-consumer", systemPrompt: "p", tools: [], toolStubs: {} };
// Touch Buffer-typed public fields directly so the typecheck genuinely needs @types/node
// (skipLibCheck:true mirrors a default consumer; the Buffer references are in OUR code, not skipped).
export function recordingBytes(t: Trace, c: ConversationCapture): number {
  const gates = runGates(t, { name: "s", persona: "cooperative", turns: [], assert: [] }, cfg.tools);
  return (t.recordingWav?.length ?? 0) + (c.recordingPcm?.length ?? 0) + gates.length + GATE_NAMES.length;
}
TS
./node_modules/.bin/tsc -p tsconfig.json
echo "  ok: TypeScript consumer typechecks against soundcheck's declarations"

echo "✓ installed-package smoke passed (dist loads from node_modules; consumer .ts agent strips + replays; TS consumer typechecks)"

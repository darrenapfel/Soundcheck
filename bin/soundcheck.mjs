#!/usr/bin/env -S node --experimental-strip-types --disable-warning=ExperimentalWarning
// Launcher so `soundcheck ...` works after global/registry install or `npm link`.
//
// The PUBLISHED package ships built JS in dist/ (Node refuses to strip TS types under
// node_modules), so we load dist/cli.js — plain JS that loads fine from node_modules. A
// raw repo clone (no build) falls back to src/cli.ts. Either way the --experimental-strip-
// types flag stays on so the CLI can still load YOUR agent's .ts config, which lives in
// YOUR project (NOT under node_modules), where Node is allowed to strip it.
// (For repo/dev work, prefer the npm scripts: `npm run soundcheck …` runs src/.ts directly.)
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, "..", "dist", "cli.js");
await import(existsSync(built) ? built : join(here, "..", "src", "cli.ts"));

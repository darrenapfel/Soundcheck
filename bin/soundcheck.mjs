#!/usr/bin/env -S node --experimental-strip-types --disable-warning=ExperimentalWarning
// Launcher so `soundcheck ...` works after global/registry install or `npm link`.
//
// The PUBLISHED package ships built JS in dist/ (Node refuses to strip TS types under
// node_modules), so an installed copy loads dist/cli.js. A dev checkout (clone / `npm link`) runs
// src/cli.ts directly. Either way the --experimental-strip-types flag stays on so the CLI can load
// YOUR agent's .ts config, which lives in YOUR project (NOT under node_modules) where Node strips it.
//
// We choose by WHERE this launcher lives, not merely whether dist/ exists: a dev checkout ALWAYS
// runs live src, so a leftover dist/ (from `npm pack` / `npm run smoke`) can never silently shadow
// your source. Only an installed copy — under node_modules, where TS can't be stripped — uses dist.
import { fileURLToPath } from "node:url";
import { dirname, join, sep } from "node:path";
import { existsSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, "..", "dist", "cli.js");
const src = join(here, "..", "src", "cli.ts");
const underNodeModules = here.includes(`${sep}node_modules${sep}`);
await import(!underNodeModules ? src : (existsSync(built) ? built : src));

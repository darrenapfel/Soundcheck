#!/usr/bin/env -S node --experimental-strip-types
// Launcher so `soundcheck ...` works after `npm link` / global install.
// Node 22 strips TS types natively (no build step, zero runtime deps).
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
await import(join(here, "..", "src", "cli.ts"));

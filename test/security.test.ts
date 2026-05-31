// Automated secret scan — asserts no API key value is committed to the distributed tree.
// Works WITH git (scans the tracked tree, respecting .gitignore) and WITHOUT it (a filesystem
// walk), so a package/archive consumer without `.git` can run the gate too. Excludes this test,
// docs, and *.md (which contain example placeholders + the patterns themselves).

import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const HAS_GIT = existsSync(".git");
const SKIP_DIRS = new Set(["node_modules", ".git", "runs"]);
const BINARY = /\.(wav|png|jpg|jpeg|gif|ico|woff2?|ttf)$/i;
const norm = (f: string) => f.replace(/^\.\//, "");
// samples/ holds generated call RECORDINGS (HTML with base64 audio), not hand-authored config —
// a key can't land there, and 8MB of base64 could coincidentally contain a short key-prefix
// substring (false positive). Excluded like test/ and docs/.
const excluded = (f: string) => { const n = norm(f); return n.startsWith("test/") || n.startsWith("docs/") || n.startsWith("samples/") || n.endsWith(".md"); };

/** Files to scan: the tracked tree under git, else a filesystem walk. */
function filesToScan(): string[] {
  if (HAS_GIT) return execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(join(dir, e.name)); }
      else out.push(join(dir, e.name));
    }
  };
  walk(".");
  return out;
}

test(`no API key value is committed in source/config (${HAS_GIT ? "git" : "filesystem"} scan)`, () => {
  const patterns = [
    "33a18c", "28f7e5",                  // the throwaway dev keys used during the build
    "\\bdg_[A-Za-z0-9]{16}",             // Deepgram-style key value
    "\\bsk-[A-Za-z0-9]{16}",             // OpenAI-style key value
    "DEEPGRAM_API_KEY=[A-Za-z0-9]",      // a key assigned in a tracked file
    "OPENAI_API_KEY=[A-Za-z0-9]",
  ].map((p) => new RegExp(p));
  const files = filesToScan().filter((f) => !excluded(f) && !BINARY.test(f));
  for (const f of files) {
    let text: string;
    try { text = readFileSync(norm(f), "utf8"); } catch { continue; } // unreadable/binary — skip
    for (const re of patterns) {
      assert.ok(!re.test(text), `possible committed secret matching /${re.source}/ in ${f}`);
    }
  }
});

test(".env is not present in the distributed tree", () => {
  if (HAS_GIT) {
    const tracked = execSync("git ls-files", { encoding: "utf8" });
    assert.ok(!/(^|\/)\.env$/m.test(tracked), ".env must never be tracked");
  } else {
    assert.ok(!existsSync(".env"), ".env must not ship in a package/archive tree");
  }
});

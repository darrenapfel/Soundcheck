// Automated secret scan — asserts no API key value is committed to the tracked tree.
// Scans source/config (excludes this test, docs, and *.md, which contain example
// placeholders + the patterns themselves). Part of the release security gate.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";

function grepTracked(pattern: string): string {
  try {
    // exit 0 = matches found (returns them); exit 1 = no matches (throws, caught below)
    return execSync(`git grep -nE ${JSON.stringify(pattern)} -- . ':!test' ':!docs' ':!*.md'`, { encoding: "utf8" });
  } catch (e) {
    const err = e as { status?: number };
    if (err.status === 1) return ""; // no matches — clean
    throw e;
  }
}

test("no API key value is committed in source/config", () => {
  const patterns = [
    "33a18c", "28f7e5",                  // the throwaway dev keys used during the build
    "\\bdg_[A-Za-z0-9]{16}",             // Deepgram-style key value
    "\\bsk-[A-Za-z0-9]{16}",             // OpenAI-style key value
    "DEEPGRAM_API_KEY=[A-Za-z0-9]",      // a key assigned in a tracked file
    "OPENAI_API_KEY=[A-Za-z0-9]",
  ];
  for (const p of patterns) {
    const hits = grepTracked(p);
    assert.equal(hits.trim(), "", `possible committed secret matching /${p}/:\n${hits}`);
  }
});

test(".env is not tracked", () => {
  const tracked = execSync("git ls-files", { encoding: "utf8" });
  assert.ok(!/(^|\/)\.env$/m.test(tracked), ".env must never be tracked");
});

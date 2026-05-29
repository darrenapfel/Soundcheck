// Self-contained HTML scorecard (audio embedded as base64 WAV data URIs).

import type { ScenarioResult } from "../types.ts";

const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export function generateReport(results: ScenarioResult[], generatedAt: string): string {
  const totalGates = results.reduce((a, r) => a + r.gates.length, 0);
  const passedGates = results.reduce((a, r) => a + r.gates.filter((g) => g.pass).length, 0);
  const allPass = results.every((r) => r.passed);

  const sections = results.map((r) => {
    const gateRows = r.gates.map((g) => `<tr class="${g.pass ? "pass" : "fail"}"><td>${g.pass ? "✅" : "🚩"}</td><td><code>${esc(g.name)}</code></td><td>${esc(g.detail)}</td></tr>`).join("");
    const turnRows = r.transcript.turns.map((t) => {
      const audio = t.audioWav ? `<audio controls preload="none" src="data:audio/wav;base64,${t.audioWav.toString("base64")}"></audio>` : "<em>no audio</em>";
      const tools = t.toolCalls.map((tc) => `${esc(tc.name)}(${esc(JSON.stringify(tc.args))})`).join("<br>") || "—";
      return `<tr>
        <td>${t.turn}</td>
        <td>${esc(t.callerSaid)}</td>
        <td>${esc(t.agentSpokenHeardBack) || "<em>—</em>"}</td>
        <td>${tools}</td>
        <td>${t.ttfbMs ?? "—"}</td>
        <td>${audio}</td>
      </tr>`;
    }).join("");
    const verdictHtml = r.verdict
      ? `<p class="judge"><strong>⚖ Judge (${esc(r.verdict.backend)}, advisory):</strong> ${r.verdict.dimensions.map((d) => `${esc(d.key)}=<code>${esc(String(d.value))}</code>`).join(" · ")}${r.verdict.findings[0] ? `<br><em>${esc(r.verdict.findings[0])}</em>` : ""}</p>`
      : "";
    return `<section class="${r.passed ? "ok" : "bad"}">
      <h2>${esc(r.transcript.scenario)} <span class="meta">aut=${esc(r.transcript.autLabel)} · persona=${esc(r.transcript.persona)} · ${r.passed ? "PASS" : "FAIL"}</span></h2>
      <table class="gates"><thead><tr><th></th><th>gate</th><th>detail</th></tr></thead><tbody>${gateRows}</tbody></table>
      ${verdictHtml}
      <details><summary>Conversation (what the caller actually heard)</summary>
      <table class="turns"><thead><tr><th>#</th><th>caller said</th><th>agent — heard back</th><th>tool calls</th><th>TTFB ms</th><th>audio</th></tr></thead><tbody>${turnRows}</tbody></table>
      </details>
    </section>`;
  }).join("\n");

  return `<!doctype html><html><head><meta charset="utf-8"><title>Soundcheck report</title>
<style>
body{font:14px/1.5 -apple-system,system-ui,sans-serif;max-width:1000px;margin:2rem auto;padding:0 1rem;color:#111}
h1{margin-bottom:.2rem} .summary{font-size:1.1rem;padding:.6rem 1rem;border-radius:8px;margin:1rem 0}
.summary.ok{background:#e7f7ec;border:1px solid #34a853} .summary.bad{background:#fdecec;border:1px solid #ea4335}
section{border:1px solid #ddd;border-radius:8px;padding:1rem;margin:1rem 0} section.bad{border-color:#ea4335}
.meta{font-weight:400;font-size:.85rem;color:#666} table{border-collapse:collapse;width:100%;margin:.5rem 0}
th,td{border:1px solid #e3e3e3;padding:.4rem .5rem;text-align:left;vertical-align:top;font-size:.86rem}
tr.pass td{background:#f4fbf6} tr.fail td{background:#fdf2f2} code{background:#f3f3f3;padding:.1rem .3rem;border-radius:4px}
audio{height:32px} summary{cursor:pointer;font-weight:600;color:#444}
</style></head><body>
<h1>🎙️ Soundcheck report</h1>
<div class="summary ${allPass ? "ok" : "bad"}">${allPass ? "✅ All scenarios passed" : "🚩 Failures present"} — ${passedGates}/${totalGates} gates passed across ${results.length} scenario(s). <span class="meta">${esc(generatedAt)}</span></div>
${sections}
</body></html>`;
}

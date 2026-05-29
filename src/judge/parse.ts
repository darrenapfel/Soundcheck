// Tolerant verdict parsing. Small think-models (gpt-4o-mini) sometimes emit
// MALFORMED function-arg JSON (observed: a value bleeding into the next key). So we
// parse defensively: JSON first, then per-field regex fallback against the raw string.

import type { Rubric, RubricDimension, Verdict } from "./types.ts";

function coerceBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.toLowerCase().trim();
    if (s === "true" || s === "yes") return true;
    if (s === "false" || s === "no") return false;
  }
  return null;
}
function coerceScore(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function fromRaw(raw: string, key: string, dim: RubricDimension): boolean | number | null {
  // matches "key": true / key=false / key : 4  (quotes optional, : or =)
  const valuePat = dim.kind === "boolean" ? "(true|false|yes|no)" : "(-?\\d+(?:\\.\\d+)?)";
  const re = new RegExp(`["']?${key}["']?\\s*[:=]\\s*${valuePat}`, "i");
  const m = re.exec(raw);
  if (!m) return null;
  return dim.kind === "boolean" ? coerceBool(m[1]) : coerceScore(m[1]);
}

function extractFindings(obj: Record<string, unknown> | null, raw: string): string[] {
  const f = obj?.findings ?? obj?.notes ?? obj?.note;
  if (Array.isArray(f)) return f.map(String).filter(Boolean);
  if (typeof f === "string" && f.trim()) return [f.trim()];
  const m = /["']?(?:notes?|findings)["']?\s*[:=]\s*"([^"]+)"/i.exec(raw);
  return m ? [m[1]] : [];
}

/** Parse a (possibly malformed) verdict arguments string into a structured Verdict. */
export function parseVerdict(raw: string, rubric: Rubric, backend: string): Verdict {
  let obj: Record<string, unknown> | null = null;
  try {
    const p = JSON.parse(raw);
    if (p && typeof p === "object") obj = p as Record<string, unknown>;
  } catch {
    /* fall through to regex */
  }
  const dimensions = rubric.dimensions.map((dim) => {
    let value: boolean | number | null = null;
    if (obj && dim.key in obj) {
      value = dim.kind === "boolean" ? coerceBool(obj[dim.key]) : coerceScore(obj[dim.key]);
    }
    if (value === null) value = fromRaw(raw, dim.key, dim); // regex fallback
    const why = typeof obj?.[`${dim.key}_why`] === "string" ? String(obj[`${dim.key}_why`]) : "";
    return { key: dim.key, value, why };
  });
  return { dimensions, findings: extractFindings(obj, raw), backend, raw };
}

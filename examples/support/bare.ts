// The BUGGY support agent — no date grounding (stale/hallucinated callback dates), uses
// Markdown emphasis (spoken as "star star"), no security ordering, no read-back. Should
// FAIL the gates the grounded agent passes — the bottom rung of the support ladder.
import { makeConfig } from "./support.ts";

const SYSTEM = `You are Acme's IT support agent. Help callers reset passwords, open tickets, and schedule callbacks. Use **bold** Markdown to emphasize important details like dates and IDs so they stand out.`;

export default makeConfig("support-bare", SYSTEM);

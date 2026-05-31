// Evaline — Soundcheck's synthetic caller. v0: scripted utterances synthesized via
// Deepgram TTS, persona conveyed by voice + light phrasing. (v1: goal-driven, a
// live Deepgram VA that improvises; distinct per-persona voices.)

import type { Persona, Scenario } from "../types.ts";
import type { CallerTurn } from "../adapters/types.ts";

/** The caller's voice per persona — the SINGLE source of truth (re-exported by policy.ts and
 *  the public API). DISTINCT Aura-2 voices so a prosody-sensitive agent can *hear* the persona,
 *  and all distinct from the AUT's default (thalia): cooperative is warm, impatient is clipped,
 *  adversarial is a different register again. (Soundcheck gates behavior, not acoustics — see
 *  docs/LIMITATIONS.md — so the voice is for realism + report listening, not a gated signal.) */
export const PERSONA_VOICE: Record<Persona, string> = {
  cooperative: "aura-2-asteria-en",
  impatient: "aura-2-orion-en",
  adversarial: "aura-2-orpheus-en",
};

export function evalineTurns(scenario: Scenario): CallerTurn[] {
  const voice = PERSONA_VOICE[scenario.persona];
  return scenario.turns.map((text, i) => ({ text: stylize(scenario.persona, text, i), voice }));
}

function stylize(persona: Persona, text: string, index: number): string {
  if (persona === "impatient" && index === 1) return `${text} Quickly, please, I'm in a hurry.`;
  return text;
}

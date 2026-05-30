// Evaline — Soundcheck's synthetic caller. v0: scripted utterances synthesized via
// Deepgram TTS, persona conveyed by voice + light phrasing. (v1: goal-driven, a
// live Deepgram VA that improvises; distinct per-persona voices.)

import type { Persona, Scenario } from "../types.ts";
import type { CallerTurn } from "../adapters/types.ts";

// v0 uses one known-good Aura-2 voice (distinct from the AUT's default thalia).
// Distinct per-persona voices land in v1.
const PERSONA_VOICE: Record<Persona, string> = {
  cooperative: "aura-2-orion-en",
  impatient: "aura-2-orion-en",
  adversarial: "aura-2-orion-en",
};

export function evalineTurns(scenario: Scenario): CallerTurn[] {
  const voice = PERSONA_VOICE[scenario.persona];
  return scenario.turns.map((text, i) => ({ text: stylize(scenario.persona, text, i), voice }));
}

function stylize(persona: Persona, text: string, index: number): string {
  if (persona === "impatient" && index === 1) return `${text} Quickly, please, I'm in a hurry.`;
  return text;
}

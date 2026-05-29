// Judge types — the LLM-as-judge (eval) layer. The judge is ADVISORY: it scores
// subjective dimensions the deterministic gates can't (naturalness, goal completion,
// confirm-before-acting, recovery). It never hard-gates CI (only gates do).

export type DimensionKind = "boolean" | "score"; // score = 1..5

export interface RubricDimension {
  key: string; // snake_case, used as the function-arg key
  question: string; // what the judge is asked
  kind: DimensionKind;
}

export interface Rubric {
  dimensions: RubricDimension[];
}

export interface DimensionVerdict {
  key: string;
  value: boolean | number | null; // null = the judge didn't return this dimension
  why: string;
}

export interface Verdict {
  dimensions: DimensionVerdict[];
  findings: string[]; // free-text issues the judge flagged
  backend: string; // which judge produced this
  raw?: string; // raw model output, for debugging malformed verdicts
}

/** A pluggable judge. Default = Deepgram-fronted VA grader (Deepgram-key-only). */
export interface JudgeBackend {
  name: string;
  judge(promptTranscript: string, rubric: Rubric): Promise<Verdict>;
}

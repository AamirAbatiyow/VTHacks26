/** One finalized utterance's cumulative classification, supplied by the identification loop. */
export interface StutteringAssessment {
  /** Increase when revising an utterance; stale loop results cannot replace newer ones. */
  revision: number;
  prolongation: number;
  block: number;
  soundRepetition: number;
  wordRepetition: number;
  interjection: number;
  /** Explicit confirmation, never inferred from missing analysis. */
  noStutteredWords: boolean;
}

export function validateStutteringAssessment(result: StutteringAssessment): void {
  if (!Number.isSafeInteger(result.revision) || result.revision < 1) {
    throw new Error("Assessment revision must be a positive integer.");
  }
  const counts = [result.prolongation, result.block, result.soundRepetition,
    result.wordRepetition, result.interjection];
  if (counts.some((count) => !Number.isSafeInteger(count) || count < 0)) {
    throw new Error("Stuttering event counts must be nonnegative integers.");
  }
  if (typeof result.noStutteredWords !== "boolean" ||
    result.noStutteredWords !== counts.every((count) => count === 0)) {
    throw new Error("A completed assessment must confirm no stuttered words exactly when all event counts are zero.");
  }
}

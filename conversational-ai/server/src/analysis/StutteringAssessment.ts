import type { StutterAnalysis } from "../../../shared/events.js";

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

/**
 * Converts one turn's real-classifier StutterAnalysis (StutterClassifier.ts)
 * into the StutteringAssessment shape the analytics pipeline already
 * understands (AnalyticsTracker.trackStutteringAssessment, and the
 * stuttering_utterances / conversations views in conversationSchema.ts) —
 * so real per-turn detections are recorded the same way the legacy
 * SpeechAnalyzer fallback's assessments always have been.
 *
 * The classifier flags PRESENCE of a stutter type within one utterance
 * (StutterEventScore.detected), not a repeat count within it, so each
 * detected label maps to a count of exactly 0 or 1 — an honest reflection
 * of what the model actually knows, not an invented repetition count.
 *
 * "Fluent" is not a stutter type and is deliberately excluded from the
 * five counted fields; a fully fluent utterance is represented by every
 * count being 0 (see noStutteredWords below), matching
 * validateStutteringAssessment's invariant. Any label the classifier
 * reports that isn't one of the five known stutter types (e.g. a future
 * model registering an unrecognized label) is silently ignored rather
 * than thrown on, consistent with this codebase's fail-open design.
 *
 * `revision` defaults to 1 because this path runs at most once per turnId
 * (unlike the identification loop, which can revise an utterance's
 * assessment over multiple passes).
 */
export function stutterAnalysisToAssessment(
  analysis: StutterAnalysis,
  revision = 1,
): StutteringAssessment {
  const isDetected = (label: string): boolean =>
    analysis.events.some((event) => event.label === label && event.detected);

  const prolongation = isDetected("Prolongation") ? 1 : 0;
  const block = isDetected("Block") ? 1 : 0;
  const soundRepetition = isDetected("SoundRep") ? 1 : 0;
  const wordRepetition = isDetected("WordRep") ? 1 : 0;
  const interjection = isDetected("Interjection") ? 1 : 0;
  const noStutteredWords =
    prolongation === 0 &&
    block === 0 &&
    soundRepetition === 0 &&
    wordRepetition === 0 &&
    interjection === 0;

  return {
    revision,
    prolongation,
    block,
    soundRepetition,
    wordRepetition,
    interjection,
    noStutteredWords,
  };
}

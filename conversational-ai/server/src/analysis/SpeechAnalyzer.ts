import type { SpeechAnalysisMetadata, StutterAnalysis } from "../../../shared/events.js";
import type { StutteringAssessment } from "./StutteringAssessment.js";

/**
 * Future phoneme / articulation analysis plug-in point.
 * DO NOT use Scribe transcripts as the pronunciation-analysis source —
 * analyze the original microphone PCM instead.
 */
export interface SpeechAnalysisResult {
  targetPhoneme?: string;
  observations: unknown[];
  confidence?: number;
  /** Omit until an identification loop has actually classified the audio. */
  stuttering?: StutteringAssessment;
}

export interface AnalyzeInput {
  sessionId?: string;
  utteranceId?: string;
  /** Raw PCM16 LE mono microphone audio for the utterance. */
  pcm16: Buffer;
  sampleRate: number;
  transcript?: string;
  targetPhoneme?: string;
}

export interface SpeechAnalyzer {
  analyze(input: AnalyzeInput): Promise<SpeechAnalysisResult>;
}

/** No-op analyzer — returns empty observations. Plug in ML later. */
export class NoOpSpeechAnalyzer implements SpeechAnalyzer {
  async analyze(input: AnalyzeInput): Promise<SpeechAnalysisResult> {
    return {
      targetPhoneme: input.targetPhoneme,
      observations: [],
    };
  }
}

export function toMetadata(
  result: SpeechAnalysisResult,
): SpeechAnalysisMetadata {
  return {
    targetPhoneme: result.targetPhoneme,
    observations: result.observations,
  };
}

/**
 * Compacts a full per-window StutterAnalysis (from StutterClassifier.classify())
 * into the generic SpeechAnalysisMetadata shape carried on a conversation turn,
 * for feeding into ConversationManager.historyToGeminiContents(). Same
 * "detected, non-Fluent" filter StutterClassifier.analyze() itself uses —
 * kept as a standalone function (rather than reusing analyze()) so the
 * caller can reuse an already-computed StutterAnalysis instead of running
 * the model a second time.
 */
export function stutterAnalysisToMetadata(
  analysis: StutterAnalysis,
  targetPhoneme?: string,
): SpeechAnalysisMetadata {
  const detected = analysis.events.filter(
    (e) => e.detected && e.label !== "Fluent",
  );
  return {
    targetPhoneme,
    observations: detected.map((e) => ({
      kind: "stutter_event",
      label: e.label,
      probability: e.probability,
    })),
  };
}

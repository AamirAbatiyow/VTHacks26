import type { SpeechAnalysisMetadata } from "../../../shared/events.js";
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

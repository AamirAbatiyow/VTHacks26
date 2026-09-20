import type { SpeechAnalysisMetadata, StutterAnalysis } from "../../../shared/events.js";
import type { StutteringAssessment } from "./StutteringAssessment.js";

/**
 * Labels that drive live coaching: overlay, Gemini [speech_signal], and Endless
 * end. Interjection stays in the SSI-4 report via StutterAnalysis.detected but
 * is too noisy for same-turn listener behavior.
 */
export const LIVE_STUTTER_LABELS = [
  "Prolongation",
  "Block",
  "SoundRep",
  "WordRep",
] as const;

export function isLiveStutterLabel(label: string): boolean {
  return (LIVE_STUTTER_LABELS as readonly string[]).includes(label);
}

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
 * for feeding into ConversationManager.historyToGeminiContents(). Live coaching
 * only includes core stutter types — Interjection stays in the SSI-4 report but
 * does not tag Gemini or end Endless.
 */
export function stutterAnalysisToMetadata(
  analysis: StutterAnalysis,
  targetPhoneme?: string,
): SpeechAnalysisMetadata {
  const detected = analysis.events.filter(
    (e) => e.detected && isLiveStutterLabel(e.label),
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

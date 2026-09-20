import type { ServerJsonEvent } from "../../../shared/events.js";

export interface AnalyticsEvent {
  type: string;
  generationId?: string;
  properties: Record<string, string | number | boolean | null>;
}

/** Explicit allowlist: never persist transcripts, audio or free-form error messages. */
export function projectEvent(event: ServerJsonEvent): AnalyticsEvent | null {
  switch (event.type) {
    case "session_started":
      return { type: event.type, properties: {} };
    case "transcript_final":
      return { type: "user_utterance", properties: {
        utteranceId: event.turnId,
        characters: event.text.length,
        words: event.text.trim().split(/\s+/).filter(Boolean).length,
        durationMs: event.durationMs ?? null,
      } };
    case "assistant_text_final":
      return { type: event.type, generationId: event.generationId, properties: {
        characters: event.text.length, interrupted: event.interrupted ?? false,
      } };
    case "turn_metrics":
      return { type: event.type, generationId: event.metrics.generationId, properties: {
        sttMs: event.metrics.sttMs,
        geminiFirstTokenMs: event.metrics.geminiFirstTokenMs,
        ttsFirstAudioMs: event.metrics.ttsFirstAudioMs,
        serverToFirstAudioMs: event.metrics.serverToFirstAudioMs,
      } };
    case "assistant_speech_started":
    case "assistant_speech_ended":
    case "interrupted":
      return { type: event.type, generationId: event.generationId, properties: {} };
    case "provider_status":
      return { type: event.type, properties: { provider: event.provider, status: event.status } };
    case "error":
      return { type: event.type, properties: { code: event.code, recoverable: event.recoverable ?? false } };
    default:
      return null;
  }
}

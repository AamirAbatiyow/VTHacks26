/**
 * Shared WebSocket event protocol between browser and Node server.
 * Single source of truth — imported by both client and server.
 */

export const USER_ROLES = [
  "Language development",
  "Student",
  "Educator",
  "Social member",
  "Public speaker",
  "Neurodegenerative support",
] as const;

export type UserRole = (typeof USER_ROLES)[number];

/** Session configuration sent when starting a conversation. */
export interface SessionConfig {
  childName?: string;
  userRole?: UserRole;
  age?: number;
  interests?: string[];
  targetPhoneme?: string;
  /** Self-reported areas the user would like to practice. */
  practiceGoals?: string[];
  /** Optional context supplied during onboarding, up to 1,000 characters. */
  needsDescription?: string;
}

/** Optional future speech-analysis metadata attached to a user turn. */
export interface SpeechAnalysisMetadata {
  targetPhoneme?: string;
  observations?: unknown[];
}

export interface TurnMetrics {
  turnId: string;
  generationId: string;
  /** T1 - T0: Scribe finalization latency (ms) */
  sttMs: number | null;
  /** T3 - T2: Gemini first-token latency (ms) */
  geminiFirstTokenMs: number | null;
  /** T5 - T4: ElevenLabs first-audio latency (ms) */
  ttsFirstAudioMs: number | null;
  /** Server-side T5 - T0 (ms); client adds playback delay for total */
  serverToFirstAudioMs: number | null;
  /** Client-measured: first audio received → first audio played (ms) */
  playbackDelayMs?: number | null;
  /** Total perceived: serverToFirstAudioMs + playbackDelayMs */
  totalMs?: number | null;
}

export type ProviderStatus = "idle" | "connecting" | "ready" | "error" | "closed";

// ---------------------------------------------------------------------------
// Client → Server
// ---------------------------------------------------------------------------

export interface StartSessionMessage {
  type: "start_session";
  config: SessionConfig;
}

export interface EndSessionMessage {
  type: "end_session";
}

export interface InterruptMessage {
  type: "interrupt";
  generationId: string;
}

export interface ClientPingMessage {
  type: "ping";
  t: number;
}

export type ClientJsonMessage =
  | StartSessionMessage
  | EndSessionMessage
  | InterruptMessage
  | ClientPingMessage;

// ---------------------------------------------------------------------------
// Server → Client
// ---------------------------------------------------------------------------

export interface SessionStartedEvent {
  type: "session_started";
  sessionId: string;
  sampleRateIn: number;
  sampleRateOut: number;
}

export interface SessionEndedEvent {
  type: "session_ended";
  sessionId: string;
}

export interface ProviderStatusEvent {
  type: "provider_status";
  provider: "scribe" | "gemini" | "elevenlabs" | "session";
  status: ProviderStatus;
  detail?: string;
}

export interface UserSpeechStartedEvent {
  type: "user_speech_started";
}

export interface UserSpeechEndedEvent {
  type: "user_speech_ended";
}

export interface TranscriptInterimEvent {
  type: "transcript_interim";
  text: string;
}

/** Downsampled 1-D waveform of the original microphone utterance. */
export interface SpeechSignal {
  /** Peak-signed amplitude in [-1, 1]. */
  samples: number[];
  durationMs: number;
  sourceSampleRate: number;
}

export interface TranscriptFinalEvent {
  type: "transcript_final";
  text: string;
  turnId: string;
  signal?: SpeechSignal;
}

/** One 3 s analysis window scored by the stutter classifier. */
export interface StutterWindow {
  startMs: number;
  endMs: number;
  /** Probabilities aligned with StutterAnalysis.labels. */
  scores: number[];
}

export interface StutterEventScore {
  label: string;
  /** Max probability across windows, 0-1. */
  probability: number;
  /** probability >= the per-label threshold tuned on the validation set. */
  detected: boolean;
}

export interface StutterAnalysis {
  labels: string[];
  events: StutterEventScore[];
  windows: StutterWindow[];
  /** Model's confidence the utterance is fluent, 0-1. */
  fluency: number;
  analyzedMs: number;
  inferenceMs: number;
}

export interface StutterAnalysisEvent {
  type: "stutter_analysis";
  turnId: string;
  analysis: StutterAnalysis;
}

export interface AssistantTextDeltaEvent {
  type: "assistant_text_delta";
  generationId: string;
  text: string;
}

export interface AssistantTextFinalEvent {
  type: "assistant_text_final";
  generationId: string;
  text: string;
  interrupted?: boolean;
}

export interface AssistantSpeechStartedEvent {
  type: "assistant_speech_started";
  generationId: string;
}

export interface AssistantSpeechEndedEvent {
  type: "assistant_speech_ended";
  generationId: string;
}

export interface InterruptedEvent {
  type: "interrupted";
  generationId: string;
}

export interface ErrorEvent {
  type: "error";
  code: string;
  message: string;
  recoverable?: boolean;
}

export interface TurnMetricsEvent {
  type: "turn_metrics";
  metrics: TurnMetrics;
}

export interface LogEvent {
  type: "log";
  level: "info" | "warn" | "error";
  tag: string;
  message: string;
}

export interface ServerPongEvent {
  type: "pong";
  t: number;
}

export type ServerJsonEvent =
  | SessionStartedEvent
  | SessionEndedEvent
  | ProviderStatusEvent
  | UserSpeechStartedEvent
  | UserSpeechEndedEvent
  | TranscriptInterimEvent
  | TranscriptFinalEvent
  | StutterAnalysisEvent
  | AssistantTextDeltaEvent
  | AssistantTextFinalEvent
  | AssistantSpeechStartedEvent
  | AssistantSpeechEndedEvent
  | InterruptedEvent
  | ErrorEvent
  | TurnMetricsEvent
  | LogEvent
  | ServerPongEvent;

// ---------------------------------------------------------------------------
// Binary protocol
// ---------------------------------------------------------------------------

/**
 * Binary frame layout (server ↔ client audio):
 *
 *   [1 byte msgType][1 byte genIdLen][genId UTF-8 bytes][payload]
 *
 * msgType:
 *   0x01 = client → server: microphone PCM16 LE mono @ 16 kHz
 *   0x02 = server → client: assistant PCM16 LE mono @ 24 kHz
 *
 * For mic audio, genIdLen = 0 (no generation id).
 * For assistant audio, genId identifies the generation; drop if invalid.
 */
export const BinaryMsgType = {
  MIC_AUDIO: 0x01,
  ASSISTANT_AUDIO: 0x02,
} as const;

export type BinaryMsgTypeValue =
  (typeof BinaryMsgType)[keyof typeof BinaryMsgType];

export const AUDIO_SAMPLE_RATE_IN = 16_000;
export const AUDIO_SAMPLE_RATE_OUT = 24_000;

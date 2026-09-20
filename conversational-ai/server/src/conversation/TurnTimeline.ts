import { performance } from "node:perf_hooks";
import type { TurnMetrics } from "../../../shared/events.js";

/**
 * Honest per-turn latency timeline.
 * T0 is derived from the mic byte clock at transcript commit
 * (audio position → perf), not fabricated.
 */
export class TurnTimeline {
  readonly turnId: string;
  readonly generationId: string;

  /** Wall clock (perf_hooks) when user speech ended (derived). */
  t0UserSpeechEnded: number | null = null;
  t1FinalTranscript: number | null = null;
  t2GeminiStart: number | null = null;
  t3GeminiFirstToken: number | null = null;
  t4FirstChunkToTts: number | null = null;
  t5FirstTtsAudio: number | null = null;

  constructor(turnId: string, generationId: string) {
    this.turnId = turnId;
    this.generationId = generationId;
  }

  markFinalTranscript(t0?: number | null): void {
    this.t1FinalTranscript = performance.now();
    if (t0 != null) this.t0UserSpeechEnded = t0;
  }

  markGeminiStart(): void {
    this.t2GeminiStart = performance.now();
  }

  markGeminiFirstToken(): void {
    if (this.t3GeminiFirstToken == null) {
      this.t3GeminiFirstToken = performance.now();
    }
  }

  markFirstChunkToTts(): void {
    if (this.t4FirstChunkToTts == null) {
      this.t4FirstChunkToTts = performance.now();
    }
  }

  markFirstTtsAudio(): void {
    if (this.t5FirstTtsAudio == null) {
      this.t5FirstTtsAudio = performance.now();
    }
  }

  toMetrics(): TurnMetrics {
    const delta = (a: number | null, b: number | null): number | null =>
      a != null && b != null ? Math.round(a - b) : null;

    return {
      turnId: this.turnId,
      generationId: this.generationId,
      sttMs: delta(this.t1FinalTranscript, this.t0UserSpeechEnded),
      geminiFirstTokenMs: delta(this.t3GeminiFirstToken, this.t2GeminiStart),
      ttsFirstAudioMs: delta(this.t5FirstTtsAudio, this.t4FirstChunkToTts),
      serverToFirstAudioMs: delta(this.t5FirstTtsAudio, this.t0UserSpeechEnded),
    };
  }
}

/**
 * Maps audio-relative timestamps to perf_hooks wall clock
 * using bytes-sent as the audio clock.
 */
export class AudioClock {
  private streamStartPerfMs: number | null = null;
  private bytesSent = 0;
  private readonly sampleRate: number;
  private readonly bytesPerSample = 2; // PCM16

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
  }

  start(): void {
    this.streamStartPerfMs = performance.now();
    this.bytesSent = 0;
  }

  addBytes(n: number): void {
    if (this.streamStartPerfMs == null) this.start();
    this.bytesSent += n;
  }

  /**
   * Convert an audio-stream position (seconds) into a perf_hooks timestamp.
   */
  audioSecondsToPerf(audioSeconds: number): number | null {
    if (this.streamStartPerfMs == null) return null;
    return this.streamStartPerfMs + audioSeconds * 1000;
  }

  /** Estimate current audio position in seconds from bytes sent. */
  currentAudioSeconds(): number {
    return this.bytesSent / (this.sampleRate * this.bytesPerSample);
  }
}

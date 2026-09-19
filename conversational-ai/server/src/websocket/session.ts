import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { AnalyticsTracker } from "../analytics/AnalyticsTracker.js";
import type WebSocket from "ws";
import {
  AUDIO_SAMPLE_RATE_IN,
  AUDIO_SAMPLE_RATE_OUT,
  BinaryMsgType,
  type ClientJsonMessage,
  type ServerJsonEvent,
  type SessionConfig,
} from "../../../shared/events.js";
import { logger } from "../logger.js";
import type { AppConfig } from "../config.js";
import { decodeBinaryFrame, encodeBinaryFrame } from "./protocol.js";
import { parseSessionConfig } from "./sessionConfig.js";
import { ScribeTranscriber } from "../services/scribe.js";
import { GeminiClient } from "../services/gemini.js";
import { ElevenLabsStreamer } from "../services/elevenlabs.js";
import { ConversationManager } from "../conversation/ConversationManager.js";
import { AudioClock } from "../conversation/TurnTimeline.js";
import {
  NoOpSpeechAnalyzer,
  type SpeechAnalyzer,
} from "../analysis/SpeechAnalyzer.js";
import { UtteranceCapture } from "../analysis/UtteranceCapture.js";
import { pcm16ToSignal1d } from "../analysis/signal1d.js";
import { StutterClassifier } from "../analysis/StutterClassifier.js";
import { DEFAULT_STUTTER_MODEL_ID, STUTTER_MODELS } from "../analysis/modelRegistry.js";

/**
 * Fan-out microphone audio bus.
 * Scribe is consumer #1; SpeechAnalyzer (future) attaches as #2.
 */
class MicrophoneAudioBus {
  private consumers = new Set<(chunk: Buffer) => void>();

  subscribe(consumer: (chunk: Buffer) => void): () => void {
    this.consumers.add(consumer);
    return () => this.consumers.delete(consumer);
  }

  publish(chunk: Buffer): void {
    for (const c of this.consumers) {
      try {
        c(chunk);
      } catch (err) {
        logger.warn("AUDIO", "mic consumer error", String(err));
      }
    }
  }

  clear(): void {
    this.consumers.clear();
  }
}

/**
 * One VoiceSession per browser WebSocket connection.
 * Owns Scribe STT, ElevenLabs TTS, ConversationManager, and audio clock.
 */
export class VoiceSession {
  readonly sessionId: string;
  private readonly ws: WebSocket;
  private readonly config: AppConfig;
  private readonly gemini: GeminiClient;
  private scribe: ScribeTranscriber | null = null;
  private elevenLabs: ElevenLabsStreamer | null = null;
  private conversation: ConversationManager | null = null;
  private readonly micBus = new MicrophoneAudioBus();
  private readonly audioClock = new AudioClock(AUDIO_SAMPLE_RATE_IN);
  private readonly speechAnalyzer: SpeechAnalyzer;
  /** null when an explicit analyzer override was passed (tests / future analyzers). */
  private readonly stutterModels: Map<string, StutterClassifier> | null;
  private readonly defaultStutterModelId: string;

  private readonly utterance = new UtteranceCapture();
  private sessionConfig: SessionConfig = {};
  private started = false;
  private closed = false;
  private readonly connectedAt = performance.now();
  private conversationStartedAt: number | null = null;

  constructor(
    ws: WebSocket,
    config: AppConfig,
    gemini: GeminiClient,
    stutterModels?: Map<string, StutterClassifier>,
    private readonly analytics?: AnalyticsTracker,
    analyzer?: SpeechAnalyzer,
  ) {

    this.sessionId = randomUUID();
    this.ws = ws;
    this.config = config;
    this.gemini = gemini;
    this.defaultStutterModelId = config.defaultStutterModelId ?? DEFAULT_STUTTER_MODEL_ID;
    this.stutterModels = analyzer ? null : stutterModels ?? null;
    // Fallback SpeechAnalyzer used only if no stutter model map was supplied at all
    // (e.g. tests). Normal operation always resolves through `this.stutter` below.
    this.speechAnalyzer = analyzer ?? new NoOpSpeechAnalyzer();
  }

  /**
   * The active stutter model for THIS session, resolved fresh from
   * sessionConfig.stutterModel every call — so a client can switch models
   * (e.g. via a dropdown) by sending a new start_session config without a
   * server restart. Falls back to the server default, then to whatever the
   * first registered model is, if the requested id is unknown.
   */
  private get stutter(): StutterClassifier | null {
    if (!this.stutterModels || this.stutterModels.size === 0) return null;
    const requested = this.sessionConfig.stutterModel;
    return (
      (requested && this.stutterModels.get(requested)) ||
      this.stutterModels.get(this.defaultStutterModelId) ||
      this.stutterModels.values().next().value ||
      null
    );
  }

  attach(): void {
    this.analytics?.track(this.sessionId, { type: "session_connected", properties: {} });
    this.ws.on("message", (data, isBinary) => {
      void this.onMessage(data, isBinary);
    });
    this.ws.on("close", () => {
      void this.cleanup("client_close");
    });
    this.ws.on("error", (err) => {
      logger.error("WS", "socket error", String(err));
      void this.cleanup("socket_error");
    });
    logger.info("SESSION", `connected ${this.sessionId}`);
    this.send({
      type: "provider_status",
      provider: "session",
      status: "ready",
    });
  }

  private send(event: ServerJsonEvent): void {
    this.analytics?.trackServerEvent(this.sessionId, event);
    if (this.ws.readyState !== this.ws.OPEN) return;
    try {
      this.ws.send(JSON.stringify(event));
    } catch (err) {
      logger.warn("WS", "send failed", String(err));
    }
  }

  private sendBinaryAudio(generationId: string, pcm: Buffer): void {
    if (this.ws.readyState !== this.ws.OPEN) return;
    try {
      const frame = encodeBinaryFrame(
        BinaryMsgType.ASSISTANT_AUDIO,
        pcm,
        generationId,
      );
      this.ws.send(frame);
    } catch (err) {
      logger.warn("WS", "binary send failed", String(err));
    }
  }

  private async onMessage(
    data: WebSocket.RawData,
    isBinary: boolean,
  ): Promise<void> {
    if (this.closed) return;

    if (isBinary) {
      const buf = Buffer.isBuffer(data)
        ? data
        : Buffer.from(data as ArrayBuffer);
      const frame = decodeBinaryFrame(buf);
      if (!frame || frame.msgType !== BinaryMsgType.MIC_AUDIO) {
        this.send({
          type: "error",
          code: "malformed_binary",
          message: "Invalid binary audio frame",
          recoverable: true,
        });
        return;
      }
      this.handleMicAudio(frame.payload);
      return;
    }

    let msg: ClientJsonMessage;
    try {
      const text = typeof data === "string" ? data : data.toString("utf8");
      msg = JSON.parse(text) as ClientJsonMessage;
    } catch {
      this.send({
        type: "error",
        code: "malformed_event",
        message: "Could not parse JSON message",
        recoverable: true,
      });
      return;
    }

    try {
      await this.handleJson(msg);
    } catch (err) {
      logger.error("SESSION", "handler error", String(err));
      this.send({
        type: "error",
        code: "handler_error",
        message: String(err),
        recoverable: true,
      });
    }
  }

  private async handleJson(msg: ClientJsonMessage): Promise<void> {
    switch (msg.type) {
      case "start_session": {
        let config: SessionConfig;
        try {
          config = parseSessionConfig(msg.config ?? {});
        } catch (error) {
          this.send({
            type: "error",
            code: "invalid_config",
            message: error instanceof Error ? error.message : "Invalid session configuration.",
            recoverable: true,
          });
          return;
        }
        await this.startSession(config);
        break;
      }
      case "end_session":
        await this.cleanup("end_session");
        break;
      case "interrupt":
        if (this.conversation) {
          await this.conversation.interrupt(msg.generationId);
          this.send({ type: "interrupted", generationId: msg.generationId });
          logger.info("AUDIO", "queue cleared (client interrupt)");
        }
        break;
      case "ping":
        this.send({ type: "pong", t: msg.t });
        break;
      default:
        this.send({
          type: "error",
          code: "unknown_event",
          message: `Unknown event type`,
          recoverable: true,
        });
    }
  }

  private async startSession(config: SessionConfig): Promise<void> {
    if (this.started) {
      this.send({
        type: "error",
        code: "already_started",
        message: "Session already started",
        recoverable: true,
      });
      return;
    }
    this.sessionConfig = config;
    this.analytics?.track(this.sessionId, { type: "conversation_profile", properties: {
      name: typeof config.childName === "string" ? config.childName.trim() || null : null,
    } });
    this.started = true;
    this.audioClock.start();

    this.elevenLabs = new ElevenLabsStreamer(
      this.config.elevenLabsApiKey,
      this.config.elevenLabsVoiceId,
      this.config.elevenLabsModelId,
    );

    this.elevenLabs.onError((code, message) => {
      this.send({
        type: "provider_status",
        provider: "elevenlabs",
        status: "error",
        detail: message,
      });
      this.send({ type: "error", code, message, recoverable: true });
    });

    this.conversation = new ConversationManager(
      config,
      this.gemini,
      this.elevenLabs,
      {
        onTextDelta: (generationId, text) => {
          this.send({ type: "assistant_text_delta", generationId, text });
        },
        onTextFinal: (generationId, text, interrupted) => {
          this.send({
            type: "assistant_text_final",
            generationId,
            text,
            interrupted,
          });
        },
        onSpeechStarted: (generationId) => {
          this.send({ type: "assistant_speech_started", generationId });
        },
        onSpeechEnded: (generationId) => {
          this.send({ type: "assistant_speech_ended", generationId });
        },
        onTtsAudio: (generationId, pcm) => {
          if (!this.conversation?.isGenerationValid(generationId)) return;
          this.conversation.noteAudioSent(
            generationId,
            pcm.length,
            AUDIO_SAMPLE_RATE_OUT,
          );
          this.sendBinaryAudio(generationId, pcm);
        },
        onMetrics: (timeline) => {
          this.send({ type: "turn_metrics", metrics: timeline.toMetrics() });
        },
        onError: (code, message) => {
          this.send({ type: "error", code, message, recoverable: true });
        },
      },
    );

    this.send({
      type: "provider_status",
      provider: "elevenlabs",
      status: "connecting",
    });
    try {
      await this.elevenLabs.ensureConnected();
      this.send({
        type: "provider_status",
        provider: "elevenlabs",
        status: "ready",
      });
    } catch (err) {
      this.send({
        type: "provider_status",
        provider: "elevenlabs",
        status: "error",
        detail: String(err),
      });
      // Non-fatal for session start — TTS may retry later
    }

    this.send({
      type: "provider_status",
      provider: "scribe",
      status: "connecting",
    });

    this.scribe = new ScribeTranscriber(this.config.elevenLabsApiKey, {
      onOpen: () => {
        this.send({
          type: "provider_status",
          provider: "scribe",
          status: "ready",
        });
      },
      onClose: () => {
        this.send({
          type: "provider_status",
          provider: "scribe",
          status: "closed",
        });
      },
      onError: (err) => {
        this.send({
          type: "provider_status",
          provider: "scribe",
          status: "error",
          detail: err.message,
        });
        this.send({
          type: "error",
          code: "scribe",
          message: err.message,
          recoverable: true,
        });
      },
      onInterim: (text) => {
        this.send({ type: "transcript_interim", text });
        // Server-side barge-in backstop. Triggered by recognised words rather
        // than bare VAD, which also fires on room noise and on the assistant's
        // own voice leaking back through the speakers.
        if (text.trim().length > 0) this.interruptActiveGeneration();
      },
      onSpeechStarted: () => {
        this.utterance.begin();
        this.send({ type: "user_speech_started" });
      },
      onSpeechEnded: () => {
        this.send({ type: "user_speech_ended" });
      },
      onFinalTurn: (text, lastWordEndSeconds) => {
        void this.onFinalUserTurn(text, lastWordEndSeconds);
      },
    });

    // Fan-out: Scribe consumes mic audio
    this.micBus.subscribe((chunk) => {
      this.scribe?.sendAudio(chunk);
    });

    try {
      await this.scribe.connect();
    } catch (err) {
      this.send({
        type: "provider_status",
        provider: "scribe",
        status: "error",
        detail: String(err),
      });
      this.send({
        type: "error",
        code: "scribe_connect",
        message: String(err),
        recoverable: false,
      });
      return;
    }

    this.send({
      type: "provider_status",
      provider: "gemini",
      status: "ready",
      detail: this.gemini.getModel(),
    });

    this.conversationStartedAt = performance.now();
    this.send({
      type: "session_started",
      sessionId: this.sessionId,
      sampleRateIn: AUDIO_SAMPLE_RATE_IN,
      sampleRateOut: AUDIO_SAMPLE_RATE_OUT,
      availableStutterModels: STUTTER_MODELS.map(({ id, label }) => ({ id, label })),
      defaultStutterModel: this.defaultStutterModelId,
    });
    logger.info("SESSION", "started");
  }

  private interruptActiveGeneration(): void {
    // Either a generation still running, or one whose audio is still playing.
    const genId =
      this.conversation?.getActiveGenerationId() ??
      this.conversation?.audibleGenerationId();
    if (!genId) return;
    void this.conversation?.interrupt(genId).then(() => {
      this.send({ type: "interrupted", generationId: genId });
    });
  }

  private handleMicAudio(pcm: Buffer): void {
    if (!this.started || this.closed) return;
    this.audioClock.addBytes(pcm.length);
    this.utterance.push(pcm);
    this.micBus.publish(pcm);
  }

  private async onFinalUserTurn(
    text: string,
    lastWordEndSeconds: number | null,
  ): Promise<void> {
    if (!this.conversation) return;

    const t0 =
      lastWordEndSeconds != null
        ? this.audioClock.audioSecondsToPerf(lastWordEndSeconds)
        : null;

    // Original mic PCM for this utterance — not the transcript.
    const micSnapshot = this.utterance.take();
    const signal = pcm16ToSignal1d(micSnapshot, AUDIO_SAMPLE_RATE_IN);
    const turnId = randomUUID();
    this.send({ type: "transcript_final", text, turnId, signal });
    logger.info(
      "AUDIO",
      `utterance signal: ${signal.samples.length} pts, ${signal.durationMs}ms`,
    );

    // Stutter detection runs alongside the response rather than in front of it:
    // blocking here would add its inference time to every turn's latency.
    void this.runSpeechAnalysis(micSnapshot, text, turnId);

    await this.conversation.handleUserTurn(text, { t0PerfMs: t0 });
  }

  /** Classify the utterance audio and push results to the UI when ready. */
  private async runSpeechAnalysis(
    micSnapshot: Buffer,
    text: string,
    turnId: string,
  ): Promise<void> {
    try {
      const analysis = await this.stutter?.classify(
        micSnapshot,
        AUDIO_SAMPLE_RATE_IN,
      );
      if (analysis && !this.closed) {
        const hits = analysis.events
          .filter((e) => e.detected && e.label !== "Fluent")
          .map((e) => `${e.label} ${e.probability.toFixed(2)}`);
        logger.info(
          "ANALYSIS",
          `stutter: ${hits.length ? hits.join(", ") : "none"} ` +
            `(fluency ${analysis.fluency.toFixed(2)}, ${analysis.windows.length} win, ` +
            `${analysis.inferenceMs}ms)`,
        );
        this.send({ type: "stutter_analysis", turnId, analysis });
        return;
      }

      // Model unavailable — fall back to whatever analyzer is configured.
      const result = await this.speechAnalyzer.analyze({
        sessionId: this.sessionId,
        utteranceId: turnId,

        pcm16: micSnapshot,
        sampleRate: AUDIO_SAMPLE_RATE_IN,
        transcript: text,
        targetPhoneme: this.sessionConfig.targetPhoneme,
      });
      if (result.stuttering) {
        this.analytics?.trackStutteringAssessment(this.sessionId, turnId, result.stuttering);
      }

    } catch (err) {
      logger.warn("SESSION", "speech analysis failed", String(err));
    }

  }

  async cleanup(reason: string): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.analytics?.track(this.sessionId, { type: "session_ended", properties: {
      reason, durationMs: Math.round(performance.now() - this.connectedAt),
      conversationDurationMs: this.conversationStartedAt == null ? null
        : Math.round(performance.now() - this.conversationStartedAt),
    } });
    logger.info("SESSION", `cleanup: ${reason}`);

    const genId = this.conversation?.getActiveGenerationId();
    if (genId) {
      try {
        await this.conversation?.interrupt(genId);
      } catch {
        /* ignore */
      }
    }

    this.micBus.clear();

    try {
      await this.scribe?.close();
    } catch {
      /* ignore */
    }
    this.scribe = null;

    try {
      await this.elevenLabs?.close();
    } catch {
      /* ignore */
    }
    this.elevenLabs = null;
    this.conversation = null;

    this.send({ type: "session_ended", sessionId: this.sessionId });
    this.send({
      type: "provider_status",
      provider: "session",
      status: "closed",
    });

    try {
      if (this.ws.readyState === this.ws.OPEN) this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

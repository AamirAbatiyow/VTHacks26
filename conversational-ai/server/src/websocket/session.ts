import { SessionSummaryCollector } from "../../../shared/sessionSummary.js";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { AnalyticsTracker } from "../analytics/AnalyticsTracker.js";
import type WebSocket from "ws";
import {
  AUDIO_SAMPLE_RATE_IN,
  AUDIO_SAMPLE_RATE_OUT,
  BinaryMsgType,
  isSessionMinutes,
  type ClientJsonMessage,
  type ServerJsonEvent,
  type SessionConfig,
  type SpeechAnalysisMetadata,
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
  stutterAnalysisToMetadata,
  type SpeechAnalyzer,
} from "../analysis/SpeechAnalyzer.js";
import { UtteranceCapture } from "../analysis/UtteranceCapture.js";
import { StutterClassifier } from "../analysis/StutterClassifier.js";
import { stutterAnalysisToAssessment } from "../analysis/StutteringAssessment.js";
import { DEFAULT_STUTTER_MODEL_ID } from "../analysis/modelRegistry.js";
import { pickFreeTierVoice } from "../conversation/voices.js";
import { looksLikeBargeIn } from "../conversation/bargeIn.js";

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
  private sessionTimer: ReturnType<typeof setTimeout> | null = null;
  private wrappingUp = false;
  private summary: SessionSummaryCollector | null = null;
  private pendingAnalyses = new Set<Promise<SpeechAnalysisMetadata | undefined>>();
  private latestTurn = 0;

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
    if ((config.conversationMode ?? "conversation") === "conversation" && !isSessionMinutes(config.sessionMinutes)) {
      this.send({
        type: "error",
        code: "session_config",
        message: "Choose how long this conversation should last.",
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

    const voice = pickFreeTierVoice();
    logger.info("ELEVENLABS", `session voice: ${voice.name} (${voice.id})`);
    this.elevenLabs = new ElevenLabsStreamer(
      this.config.elevenLabsApiKey,
      voice.id,
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
      if (this.closed) return;
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

    if (this.closed) return;
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
        // Cut the assistant only when the transcript looks like a real takeover,
        // not a filler, click hallucination, or the assistant's own voice.
        if (!this.wrappingUp && looksLikeBargeIn(text, this.conversation?.currentAssistantText() ?? "")) {
          this.interruptActiveGeneration();
        }
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
      if (this.closed) return;
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
      await this.cleanup("scribe_connect_failed");
      return;
    }

    this.send({
      type: "provider_status",
      provider: "gemini",
      status: "ready",
      detail: this.gemini.getModel(),
    });

    this.conversationStartedAt = performance.now();
    this.summary = new SessionSummaryCollector(this.sessionId, new Date().toISOString(), config.conversationMode ?? "conversation");
    this.send({
      type: "session_started",
      sessionId: this.sessionId,
      sampleRateIn: AUDIO_SAMPLE_RATE_IN,
      sampleRateOut: AUDIO_SAMPLE_RATE_OUT,
    });
    if ((config.conversationMode ?? "conversation") === "conversation" && isSessionMinutes(config.sessionMinutes)) {
      this.sessionTimer = setTimeout(() => {
        void this.finishOnTime();
      }, config.sessionMinutes * 60_000);
    }
    logger.info("SESSION", "started");
  }

  private async finishOnTime(): Promise<void> {
    if (this.closed || this.wrappingUp) return;
    this.wrappingUp = true;
    if (this.sessionTimer) {
      clearTimeout(this.sessionTimer);
      this.sessionTimer = null;
    }
    this.send({ type: "session_wrapping_up" });
    logger.info("SESSION", "time is up");
    const current =
      this.conversation?.getActiveGenerationId() ??
      this.conversation?.audibleGenerationId();
    if (current) {
      try {
        await this.conversation?.interrupt(current);
        this.send({ type: "interrupted", generationId: current });
      } catch {
        /* closing line still goes out */
      }
    }
    const name = this.sessionConfig.childName?.trim();
    const closing = name
      ? `${name}, that's all the time we have for today. You showed up and you practiced, and that is the work. We'll pick this up next time.`
      : "That's all the time we have for today. You showed up and you practiced, and that is the work. We'll pick this up next time.";
    try {
      await this.conversation?.speakScripted(closing);
    } catch (error) {
      logger.warn("SESSION", "closing line failed", String(error));
    }
    await this.cleanup("time_up");
  }

  private interruptActiveGeneration(): void {
    if (this.wrappingUp) return;
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
    if (!this.conversation || this.closed || this.wrappingUp || !text.trim()) return;
    const conversation = this.conversation;
    const turnSequence = ++this.latestTurn;

    const t0 =
      lastWordEndSeconds != null
        ? this.audioClock.audioSecondsToPerf(lastWordEndSeconds)
        : null;

    // Original mic PCM for this utterance — not the transcript.
    const micSnapshot = this.utterance.take();
    const durationMs = Math.round(
      (micSnapshot.length / 2 / AUDIO_SAMPLE_RATE_IN) * 1000,
    );
    const turnId = randomUUID();
    this.summary?.addTurn(turnId);
    this.send({ type: "transcript_final", text, turnId, durationMs });
    logger.info("AUDIO", `utterance captured: ${durationMs}ms`);

    // Stutter detection is awaited BEFORE the Gemini call so this turn's
    // reply can actually react to what was just detected — see
    // ConversationManager.historyToGeminiContents() for how it's used, and
    // prompt.ts for how Gemini is told to interpret it. This trades a small,
    // measured amount of added latency (logged below as inferenceMs) for
    // same-turn awareness instead of a one-turn lag. If a heavier model
    // (e.g. vocametrix) makes that trade-off feel bad in practice, switch
    // the session back to the CNN or two-head model via the dropdown / the
    // STUTTER_MODEL env var — no code change needed either way.
    const pending = this.runSpeechAnalysis(micSnapshot, text, turnId);
    this.pendingAnalyses.add(pending);
    const speechAnalysis = await pending.finally(() => this.pendingAnalyses.delete(pending));
    if (this.closed || turnSequence !== this.latestTurn) return;
    await conversation.handleUserTurn(text, { t0PerfMs: t0, speechAnalysis });
  }

  /**
   * Classify the utterance audio, push results to the UI, and return a
   * compact summary for the conversation's own context. Failures are
   * swallowed (fail open) so a classifier problem never blocks the
   * conversation — the caller gets `undefined` and moves on.
   */
  private async runSpeechAnalysis(
    micSnapshot: Buffer,
    text: string,
    turnId: string,
  ): Promise<SpeechAnalysisMetadata | undefined> {
    try {
      const analysis = await this.stutter?.classify(
        micSnapshot,
        AUDIO_SAMPLE_RATE_IN,
      );
      if (analysis) {
        this.summary?.addAnalysis(turnId, analysis);
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
        // Analytics recording is isolated from the live conversation path: if
        // this ever throws (a mapping bug, a validation failure), it must
        // never take down the WS event already sent above or the metadata
        // Gemini uses for same-turn awareness below.
        try {
          this.analytics?.trackStutteringAssessment(
            this.sessionId,
            turnId,
            stutterAnalysisToAssessment(analysis),
          );
        } catch (err) {
          logger.warn("ANALYTICS", "failed to record stutter assessment", String(err));
        }
        return stutterAnalysisToMetadata(analysis, this.sessionConfig.targetPhoneme);
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
      return { targetPhoneme: result.targetPhoneme, observations: result.observations };

    } catch (err) {
      logger.warn("SESSION", "speech analysis failed", String(err));
      return undefined;
    }

  }

  async cleanup(reason: string): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.sessionTimer) {
      clearTimeout(this.sessionTimer);
      this.sessionTimer = null;
    }
    const conversationDurationMs = this.conversationStartedAt == null ? null : Math.round(performance.now() - this.conversationStartedAt);
    this.analytics?.track(this.sessionId, { type: "session_ended", properties: {
      reason, durationMs: Math.round(performance.now() - this.connectedAt),
      conversationDurationMs,
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

    // Let already-running model inference finish, without hanging navigation.
    if (this.pendingAnalyses.size) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        Promise.allSettled([...this.pendingAnalyses]),
        new Promise(resolve => { timer = setTimeout(resolve, 1500); }),
      ]);
      clearTimeout(timer);
    }
    this.send({ type: "session_ended", sessionId: this.sessionId,
      summary: this.summary?.snapshot(conversationDurationMs == null ? 0 : conversationDurationMs / 1000, "server"),
    });
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

import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { SessionConfig, SpeechAnalysisMetadata } from "../../../shared/events.js";
import { logger } from "../logger.js";
import { buildSystemInstruction } from "./prompt.js";
import { TextChunker } from "./TextChunker.js";
import { TurnTimeline } from "./TurnTimeline.js";
import type { GeminiClient } from "../services/gemini.js";
import type { ElevenLabsStreamer } from "../services/elevenlabs.js";

export interface UserTurn {
  role: "user";
  text: string;
  speechAnalysis?: SpeechAnalysisMetadata;
}

export interface ModelTurn {
  role: "model";
  text: string;
  interrupted?: boolean;
  generationId: string;
}

export type ConversationTurn = UserTurn | ModelTurn;

/**
 * TTS reads punctuation literally, so markdown the model slips in ("**roar**")
 * would be spoken as asterisks. Strip formatting without touching wording.
 */
export function sanitizeForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/\*([^*]*)\*/g, "$1")
    .replace(/__([^_]*)__/g, "$1")
    .replace(/(^|\s)[*_~]+(?=\S)/g, "$1")
    .replace(/(?<=\S)[*_~]+(?=\s|$)/g, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*#+\s*/gm, "")
    .replace(/[ \t]{2,}/g, " ");
}

/** Gemini nests its real message inside layers of JSON; dig it out for the UI. */
function extractGeminiError(err: unknown): string {
  const message = unwrapGeminiError(err);
  if (/RESOURCE_EXHAUSTED|429|exceeded your current quota/i.test(message)) {
    const retry = /retry in ([0-9.]+)s/i.exec(message)?.[1];
    return `Gemini rate limit reached (free tier).${
      retry ? ` Retry in ~${Math.ceil(Number(retry))}s.` : ""
    } Set GEMINI_MODEL to a model with a higher quota, or wait a moment.`;
  }
  return message;
}

function unwrapGeminiError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  let current: unknown = raw;
  for (let i = 0; i < 3; i++) {
    if (typeof current !== "string") break;
    try {
      current = JSON.parse(current);
    } catch {
      break;
    }
    if (current && typeof current === "object" && "error" in current) {
      const inner = (current as { error: unknown }).error;
      if (inner && typeof inner === "object" && "message" in inner) {
        current = (inner as { message: unknown }).message;
      } else {
        current = inner;
      }
    }
  }
  const message = typeof current === "string" ? current : raw;
  return message.replace(/\s+/g, " ").trim().slice(0, 400);
}

export interface ConversationCallbacks {
  onTextDelta: (generationId: string, text: string) => void;
  onTextFinal: (
    generationId: string,
    text: string,
    interrupted: boolean,
  ) => void;
  onSpeechStarted: (generationId: string) => void;
  onSpeechEnded: (generationId: string) => void;
  onTtsAudio: (generationId: string, pcm: Buffer) => void;
  onMetrics: (timeline: TurnTimeline) => void;
  onError: (code: string, message: string) => void;
}

/**
 * Owns conversation history, Gemini streaming, TextChunker → ElevenLabs.
 * Supports cancellation via generation IDs.
 */
export class ConversationManager {
  private history: ConversationTurn[] = [];
  private activeGenerationId: string | null = null;
  private abortController: AbortController | null = null;
  private currentTimeline: TurnTimeline | null = null;
  private assistantBuffer = "";
  private speechStarted = false;
  private interrupted = false;
  private speakingGenerationId: string | null = null;
  private playbackEndsAtMs = 0;
  private systemInstruction: string;
  private readonly gemini: GeminiClient;
  private readonly elevenLabs: ElevenLabsStreamer;
  private readonly callbacks: ConversationCallbacks;
  private turnSeq = 0;
  private lastSubmittedText = "";

  constructor(
    config: SessionConfig,
    gemini: GeminiClient,
    elevenLabs: ElevenLabsStreamer,
    callbacks: ConversationCallbacks,
  ) {
    this.systemInstruction = buildSystemInstruction(config);
    this.gemini = gemini;
    this.elevenLabs = elevenLabs;
    this.callbacks = callbacks;
  }

  updateConfig(config: SessionConfig): void {
    this.systemInstruction = buildSystemInstruction(config);
  }

  getHistory(): readonly ConversationTurn[] {
    return this.history;
  }

  getActiveGenerationId(): string | null {
    return this.activeGenerationId;
  }

  /**
   * Submit a finalized user turn. Dedupes empty / duplicate transcripts.
   */
  async handleUserTurn(
    text: string,
    opts?: {
      speechAnalysis?: SpeechAnalysisMetadata;
      t0PerfMs?: number | null;
    },
  ): Promise<void> {
    const cleaned = text.trim();
    if (!cleaned) {
      logger.info("USER", "empty transcript ignored");
      return;
    }
    if (cleaned === this.lastSubmittedText) {
      logger.info("USER", `duplicate final ignored: "${cleaned}"`);
      return;
    }
    this.lastSubmittedText = cleaned;

    // If user speaks while assistant is talking, interrupt first.
    if (this.activeGenerationId) {
      await this.interrupt(this.activeGenerationId);
    }

    this.turnSeq += 1;
    const turnId = `turn-${this.turnSeq}`;
    const generationId = randomUUID();

    const userTurn: UserTurn = {
      role: "user",
      text: cleaned,
      speechAnalysis: opts?.speechAnalysis,
    };
    this.history.push(userTurn);
    logger.info("USER", `final: "${cleaned}"`);

    await this.runGeneration(turnId, generationId, opts?.t0PerfMs ?? null);
  }

  /**
   * Track how long the audio already sent will take to play. Generation can
   * finish server-side seconds before the user stops hearing it, and barge-in
   * must remain possible for that whole window.
   */
  noteAudioSent(generationId: string, pcmBytes: number, sampleRate: number): void {
    const durationMs = (pcmBytes / 2 / sampleRate) * 1000;
    const now = performance.now();
    if (this.speakingGenerationId !== generationId) {
      this.speakingGenerationId = generationId;
      this.playbackEndsAtMs = now + durationMs;
      return;
    }
    this.playbackEndsAtMs = Math.max(this.playbackEndsAtMs, now) + durationMs;
  }

  /** Generation the user can still hear, if any. */
  audibleGenerationId(): string | null {
    if (
      this.speakingGenerationId &&
      performance.now() < this.playbackEndsAtMs
    ) {
      return this.speakingGenerationId;
    }
    return null;
  }

  private stopSpeaking(): void {
    this.speakingGenerationId = null;
    this.playbackEndsAtMs = 0;
  }

  async interrupt(generationId: string): Promise<void> {
    if (this.activeGenerationId !== generationId) {
      // Generation already finished server-side, but its audio may still be
      // playing in the browser. Cut it off and record that it was interrupted.
      if (this.speakingGenerationId === generationId) {
        logger.info("USER", "interruption during playback");
        this.stopSpeaking();
        const turn = [...this.history]
          .reverse()
          .find((t): t is ModelTurn => t.role === "model" && t.generationId === generationId);
        if (turn) turn.interrupted = true;
      }
      return;
    }
    logger.info("USER", "interruption detected");
    this.stopSpeaking();
    this.interrupted = true;

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
      logger.info("GEMINI", "generation cancelled");
    }

    try {
      await this.elevenLabs.closeContext(generationId);
      this.elevenLabs.clearAudioHandler(generationId);
    } catch (err) {
      logger.warn("ELEVENLABS", "close_context failed", String(err));
    }

    const partial = this.assistantBuffer.trim();
    this.history.push({
      role: "model",
      text: partial,
      interrupted: true,
      generationId,
    });
    this.callbacks.onTextFinal(generationId, partial, true);

    this.activeGenerationId = null;
    this.assistantBuffer = "";
    this.speechStarted = false;
  }

  isGenerationValid(generationId: string): boolean {
    return this.activeGenerationId === generationId && !this.interrupted;
  }

  private async runGeneration(
    turnId: string,
    generationId: string,
    t0PerfMs: number | null,
  ): Promise<void> {
    this.activeGenerationId = generationId;
    this.interrupted = false;
    this.assistantBuffer = "";
    this.speechStarted = false;
    this.abortController = new AbortController();

    const timeline = new TurnTimeline(turnId, generationId);
    timeline.markFinalTranscript(t0PerfMs);
    this.currentTimeline = timeline;

    const chunker = new TextChunker((chunk) => {
      if (!this.isGenerationValid(generationId)) return;
      const spoken = sanitizeForSpeech(chunk);
      if (!spoken.trim()) return;
      timeline.markFirstChunkToTts();
      logger.info("TTS", `chunk: "${spoken.trim()}"`);
      void this.elevenLabs.sendText(generationId, spoken).catch((err) => {
        this.callbacks.onError("tts_send", String(err));
      });
    });

    // Wire ElevenLabs audio for this context
    this.elevenLabs.onAudio(generationId, (pcm) => {
      if (!this.isGenerationValid(generationId)) {
        logger.debug("AUDIO", `dropped late audio for ${generationId}`);
        return;
      }
      timeline.markFirstTtsAudio();
      if (!this.speechStarted) {
        this.speechStarted = true;
        this.callbacks.onSpeechStarted(generationId);
        logger.info("PLAYBACK", "started");
      }
      this.callbacks.onTtsAudio(generationId, pcm);
    });

    try {
      await this.elevenLabs.ensureConnected();
      await this.elevenLabs.beginContext(generationId);
    } catch (err) {
      this.callbacks.onError("elevenlabs_connect", String(err));
      this.activeGenerationId = null;
      return;
    }

    timeline.markGeminiStart();
    logger.info("GEMINI", "generation started");

    try {
      const contents = this.historyToGeminiContents();
      const stream = this.gemini.generateStream({
        systemInstruction: this.systemInstruction,
        contents,
        abortSignal: this.abortController.signal,
      });

      for await (const delta of stream) {
        if (!this.isGenerationValid(generationId)) break;
        if (!delta) continue;
        timeline.markGeminiFirstToken();
        if (this.assistantBuffer.length === 0) {
          const ms =
            timeline.t3GeminiFirstToken != null && timeline.t2GeminiStart != null
              ? Math.round(timeline.t3GeminiFirstToken - timeline.t2GeminiStart)
              : null;
          logger.info("GEMINI", `first token: ${ms ?? "?"}ms`);
        }
        this.assistantBuffer += delta;
        this.callbacks.onTextDelta(generationId, delta);
        chunker.push(delta);
      }

      if (!this.isGenerationValid(generationId)) {
        return;
      }

      chunker.flush();
      await this.elevenLabs.flushContext(generationId);
      await this.elevenLabs.closeContext(generationId);

      // Gemini finishing does not mean the audio has arrived. Drain the TTS
      // context first, or the generation is torn down while its audio is still
      // in flight and every remaining chunk gets dropped as "late".
      await this.elevenLabs.waitForContextEnd(generationId);

      if (!this.isGenerationValid(generationId)) return;

      const finalText = this.assistantBuffer.trim();
      this.history.push({
        role: "model",
        text: finalText,
        interrupted: false,
        generationId,
      });
      this.callbacks.onTextFinal(generationId, finalText, false);
      this.callbacks.onSpeechEnded(generationId);
      this.callbacks.onMetrics(timeline);

      const m = timeline.toMetrics();
      logger.info(
        "SESSION",
        `latency STT=${m.sttMs ?? "?"} Gemini=${m.geminiFirstTokenMs ?? "?"} TTS=${m.ttsFirstAudioMs ?? "?"} → first audio=${m.serverToFirstAudioMs ?? "?"}ms`,
      );
    } catch (err) {
      if (this.interrupted || (err as Error)?.name === "AbortError") {
        logger.info("GEMINI", "generation aborted");
        return;
      }
      const detail = extractGeminiError(err);
      logger.error("GEMINI", `request failure: ${detail}`);
      this.callbacks.onError("gemini", detail);
      try {
        await this.elevenLabs.closeContext(generationId);
      } catch {
        /* ignore */
      }
    } finally {
      if (this.activeGenerationId === generationId) {
        this.activeGenerationId = null;
      }
      this.abortController = null;
      this.elevenLabs.clearAudioHandler(generationId);
    }
  }

  private historyToGeminiContents(): Array<{
    role: "user" | "model";
    parts: Array<{ text: string }>;
  }> {
    const turns = this.history.filter((t) => t.text.trim().length > 0);
    const lastIndex = turns.length - 1;
    return turns.map((t, i) => {
      // Only the turn that just happened carries its speech-signal tag —
      // not the whole history. historyToGeminiContents() rebuilds the full
      // conversation from scratch every call (Gemini's API is stateless),
      // so tagging every past turn would re-inject it into every future
      // call too: clutter, wasted tokens, and a bias toward Gemini fixating
      // on old detections instead of reacting to what's happening now.
      const signal =
        i === lastIndex && t.role === "user"
          ? formatSpeechSignal(t.speechAnalysis)
          : null;
      return {
        role: t.role === "user" ? ("user" as const) : ("model" as const),
        parts: [{ text: signal ? `${t.text}\n\n${signal}` : t.text }],
      };
    });
  }
}

/**
 * Renders detected stutter events as a compact, clearly-delimited tag
 * appended to a user turn's text before it reaches Gemini — e.g.
 * "[speech_signal: Block (0.71)]". See prompt.ts for how Gemini is told to
 * interpret this tag; it is never shown in the UI transcript (that reads
 * ConversationTurn.text directly, which this never mutates).
 */
function formatSpeechSignal(meta: SpeechAnalysisMetadata | undefined): string | null {
  if (!meta?.observations?.length) return null;
  const events = meta.observations.filter(
    (o): o is { kind: "stutter_event"; label: string; probability: number } =>
      typeof o === "object" &&
      o !== null &&
      (o as { kind?: unknown }).kind === "stutter_event",
  );
  if (events.length === 0) return null;
  const parts = events.map((e) => `${e.label} (${e.probability.toFixed(2)})`);
  return `[speech_signal: ${parts.join(", ")}]`;
}

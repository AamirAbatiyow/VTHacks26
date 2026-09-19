import WebSocket from "ws";
import { logger } from "../logger.js";
import { AUDIO_SAMPLE_RATE_OUT } from "../../../shared/events.js";

type AudioHandler = (pcm: Buffer) => void;
type ErrorHandler = (code: string, message: string) => void;

/**
 * ElevenLabs multi-context WebSocket TTS.
 * One socket per session; each assistant turn uses context_id = generationId.
 * Interruption = close_context for that generationId.
 */
export class ElevenLabsStreamer {
  private readonly apiKey: string;
  private readonly voiceId: string;
  private readonly modelId: string;
  private ws: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private readonly audioHandlers = new Map<string, AudioHandler>();
  private readonly readyContexts = new Set<string>();
  private closed = false;
  private onErrorHandler: ErrorHandler | null = null;
  /** Resolvers for contexts still streaming audio, keyed by context id. */
  private readonly contextEnd = new Map<string, () => void>();

  constructor(apiKey: string, voiceId: string, modelId: string) {
    this.apiKey = apiKey;
    this.voiceId = voiceId;
    this.modelId = modelId;
  }

  onError(handler: ErrorHandler): void {
    this.onErrorHandler = handler;
  }

  onAudio(contextId: string, handler: AudioHandler): void {
    this.audioHandlers.set(contextId, handler);
  }

  clearAudioHandler(contextId: string): void {
    this.audioHandlers.delete(contextId);
  }

  async ensureConnected(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this.connect();
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  private connect(): Promise<void> {
    this.closed = false;
    const url =
      `wss://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/multi-stream-input` +
      `?model_id=${encodeURIComponent(this.modelId)}` +
      `&output_format=pcm_${AUDIO_SAMPLE_RATE_OUT}` +
      `&auto_mode=false` +
      `&inactivity_timeout=180`;

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, {
        headers: { "xi-api-key": this.apiKey },
      });
      this.ws = ws;

      const onOpen = () => {
        logger.info("ELEVENLABS", "connected");
        cleanup();
        resolve();
      };
      const onError = (err: Error) => {
        logger.error("ELEVENLABS", "connection error", String(err));
        cleanup();
        reject(err);
      };
      const cleanup = () => {
        ws.off("open", onOpen);
        ws.off("error", onError);
      };

      ws.on("open", onOpen);
      ws.on("error", onError);
      ws.on("message", (data) => this.handleMessage(data));
      ws.on("close", (code, reasonBuf) => {
        const reason = reasonBuf?.toString("utf8") ?? "";
        logger.info(
          "ELEVENLABS",
          `disconnected (code=${code}${reason ? ` reason=${reason}` : ""})`,
        );
        this.ws = null;
        this.readyContexts.clear();
        for (const contextId of [...this.contextEnd.keys()]) {
          this.resolveContextEnd(contextId);
        }
        // 1000 = normal close we initiated during cleanup.
        if (!this.closed && code !== 1000) {
          this.onErrorHandler?.(
            "elevenlabs_disconnect",
            `ElevenLabs closed the connection (code ${code})${reason ? `: ${reason}` : ""}`,
          );
        }
      });
    });
  }

  private handleMessage(data: WebSocket.RawData): void {
    try {
      const raw = typeof data === "string" ? data : data.toString("utf8");
      const msg = JSON.parse(raw) as {
        audio?: string;
        contextId?: string;
        context_id?: string;
        isFinal?: boolean;
        is_final?: boolean;
        error?: string;
        message?: string;
      };

      if (msg.error || (msg.message && !msg.audio)) {
        const code = msg.error ?? "elevenlabs_error";
        const detail = msg.message ?? msg.error ?? "unknown error";
        logger.error("ELEVENLABS", `${code}: ${detail}`);
        this.onErrorHandler?.(code, this.explain(code, detail));
        return;
      }

      const contextId = msg.context_id ?? msg.contextId;
      if (!contextId) return;

      if (msg.audio) {
        const pcm = Buffer.from(msg.audio, "base64");
        if (pcm.length > 0) this.audioHandlers.get(contextId)?.(pcm);
      }

      // ElevenLabs marks the end of a context with isFinal; only then is it
      // safe to tear down the generation.
      if (msg.isFinal === true || msg.is_final === true) {
        this.resolveContextEnd(contextId);
      }
    } catch (err) {
      logger.warn("ELEVENLABS", "bad message", String(err));
    }
  }

  private resolveContextEnd(contextId: string): void {
    const resolve = this.contextEnd.get(contextId);
    if (resolve) {
      this.contextEnd.delete(contextId);
      resolve();
    }
  }

  /**
   * Resolve once ElevenLabs has sent all audio for a context. Without this the
   * caller would discard trailing audio that is still in flight.
   */
  waitForContextEnd(contextId: string, timeoutMs = 20_000): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (this.contextEnd.delete(contextId)) {
          logger.warn("ELEVENLABS", `context ${contextId} timed out draining`);
        }
        resolve();
      }, timeoutMs);
      this.contextEnd.set(contextId, () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /** Turn ElevenLabs error codes into something actionable in the UI. */
  private explain(code: string, detail: string): string {
    switch (code) {
      case "voice_id_does_not_exist":
        return `Voice "${this.voiceId}" is not usable with this API key. Free plans cannot use Voice Library voices — pick a default voice (e.g. pFZP5JQG7iQjIQuC4Bku "Lily") and set ELEVENLABS_VOICE_ID.`;
      case "paid_plan_required":
        return `This voice requires a paid ElevenLabs plan. Use a default voice instead. (${detail})`;
      default:
        return detail;
    }
  }

  private send(obj: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("ElevenLabs WebSocket not open");
    }
    this.ws.send(JSON.stringify(obj));
  }

  /**
   * Begin a new context. First message must establish the context
   * (space character + voice settings per ElevenLabs docs).
   */
  async beginContext(contextId: string): Promise<void> {
    await this.ensureConnected();
    this.send({
      text: " ",
      context_id: contextId,
      voice_settings: {
        stability: 0.4,
        similarity_boost: 0.8,
        use_speaker_boost: false,
      },
      generation_config: {
        // Favor low latency for conversational chunks
        chunk_length_schedule: [50, 80, 120, 160],
      },
    });
    this.readyContexts.add(contextId);
  }

  async sendText(contextId: string, text: string): Promise<void> {
    if (!text) return;
    await this.ensureConnected();
    if (!this.readyContexts.has(contextId)) {
      await this.beginContext(contextId);
    }
    this.send({
      text,
      context_id: contextId,
    });
  }

  async flushContext(contextId: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!this.readyContexts.has(contextId)) return;
    this.send({
      context_id: contextId,
      flush: true,
    });
  }

  async closeContext(contextId: string): Promise<void> {
    if (!this.readyContexts.has(contextId)) return;
    this.readyContexts.delete(contextId);
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.resolveContextEnd(contextId);
      return;
    }
    try {
      this.send({
        context_id: contextId,
        close_context: true,
      });
    } catch (err) {
      logger.warn("ELEVENLABS", "close_context send failed", String(err));
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.audioHandlers.clear();
    this.readyContexts.clear();
    for (const contextId of [...this.contextEnd.keys()]) {
      this.resolveContextEnd(contextId);
    }
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ close_socket: true }));
      }
    } catch {
      /* ignore */
    }
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }

  get isClosed(): boolean {
    return this.closed;
  }
}

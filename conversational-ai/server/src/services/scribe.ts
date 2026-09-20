import WebSocket from "ws";
import { logger } from "../logger.js";
import { AUDIO_SAMPLE_RATE_IN } from "../../../shared/events.js";

export interface ScribeHandlers {
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (err: Error) => void;
  onInterim?: (text: string) => void;
  onSpeechStarted?: () => void;
  onSpeechEnded?: () => void;
  /**
   * Fired once per committed utterance with the finalized transcript and
   * last-word end (seconds into the stream) when timestamps are available.
   */
  onFinalTurn?: (text: string, lastWordEndSeconds: number | null) => void;
}

interface ScribeMessage {
  message_type?: string;
  text?: string;
  error?: string;
  message?: string;
  words?: Array<{ end?: number; type?: string }>;
}

/**
 * One persistent ElevenLabs Scribe v2 realtime transcription connection
 * per session. VAD commits each utterance; that commit is one Gemini turn.
 */
export class ScribeTranscriber {
  private readonly apiKey: string;
  private readonly handlers: ScribeHandlers;
  private ws: WebSocket | null = null;
  private open = false;
  private closed = false;
  private flushedForCurrentUtterance = false;
  private lastWordEndSeconds: number | null = null;
  private speaking = false;
  /** Mic audio arriving before the socket opens, flushed on open. */
  private pendingAudio: Buffer[] = [];
  private pendingBytes = 0;
  private readonly maxPendingBytes = AUDIO_SAMPLE_RATE_IN * 2 * 3;
  /** Batch ~160 ms of 20 ms frames before sending (Scribe prefers 100–500 ms). */
  private sendBuffer: Buffer[] = [];
  private sendBufferBytes = 0;
  private readonly sendBatchBytes = AUDIO_SAMPLE_RATE_IN * 2 * 0.16;

  constructor(apiKey: string, handlers: ScribeHandlers) {
    this.apiKey = apiKey;
    this.handlers = handlers;
  }

  async connect(): Promise<void> {
    this.closed = false;
    const params = new URLSearchParams({
      model_id: "scribe_v2_realtime",
      audio_format: `pcm_${AUDIO_SAMPLE_RATE_IN}`,
      language_code: "en",
      commit_strategy: "vad",
      vad_silence_threshold_secs: "0.8",
      vad_threshold: "0.58",
      min_speech_duration_ms: "280",
      min_silence_duration_ms: "160",
      include_timestamps: "true",
    });
    const url = `wss://api.elevenlabs.io/v1/speech-to-text/realtime?${params}`;

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url, {
        headers: { "xi-api-key": this.apiKey },
      });
      this.ws = ws;

      const onOpen = () => {
        logger.info("SCRIBE", "connected");
        this.open = true;
        this.flushPendingAudio();
        this.handlers.onOpen?.();
        cleanup();
        resolve();
      };
      const onError = (err: Error) => {
        logger.error("SCRIBE", "connection error", String(err));
        cleanup();
        if (!this.open) reject(err);
        else this.handlers.onError?.(err);
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
          "SCRIBE",
          `disconnected (code=${code}${reason ? ` reason=${reason}` : ""})`,
        );
        this.open = false;
        this.ws = null;
        this.handlers.onClose?.();
      });
    });
  }

  sendAudio(pcm16: Buffer): void {
    if (this.closed) return;
    if (!this.ws || !this.open) {
      this.bufferAudio(pcm16);
      return;
    }
    this.sendBuffer.push(pcm16);
    this.sendBufferBytes += pcm16.length;
    if (this.sendBufferBytes >= this.sendBatchBytes) this.flushSendBuffer(false);
  }

  private bufferAudio(pcm16: Buffer): void {
    this.pendingAudio.push(pcm16);
    this.pendingBytes += pcm16.length;
    while (this.pendingBytes > this.maxPendingBytes && this.pendingAudio.length > 0) {
      this.pendingBytes -= this.pendingAudio.shift()!.length;
    }
  }

  private flushPendingAudio(): void {
    if (this.pendingAudio.length === 0) return;
    const queued = this.pendingAudio;
    const bytes = this.pendingBytes;
    this.pendingAudio = [];
    this.pendingBytes = 0;
    for (const chunk of queued) this.sendAudio(chunk);
    logger.info("SCRIBE", `flushed ${bytes} buffered bytes captured before open`);
  }

  private flushSendBuffer(commit: boolean): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.sendBufferBytes === 0 && !commit) return;
    const payload =
      this.sendBufferBytes > 0 ? Buffer.concat(this.sendBuffer) : Buffer.alloc(0);
    this.sendBuffer = [];
    this.sendBufferBytes = 0;
    try {
      this.ws.send(
        JSON.stringify({
          message_type: "input_audio_chunk",
          audio_base_64: payload.toString("base64"),
          commit,
          sample_rate: AUDIO_SAMPLE_RATE_IN,
        }),
      );
    } catch (err) {
      logger.warn("SCRIBE", "sendAudio failed", String(err));
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.open = false;
    this.pendingAudio = [];
    this.pendingBytes = 0;
    const ws = this.ws;
    if (!ws) return;
    try {
      if (ws.readyState === WebSocket.OPEN) {
        this.flushSendBuffer(true);
        ws.close();
      }
    } catch (err) {
      logger.warn("SCRIBE", "close error", String(err));
    }
    this.ws = null;
  }

  private handleMessage(data: WebSocket.RawData): void {
    let msg: ScribeMessage;
    try {
      const raw = typeof data === "string" ? data : data.toString("utf8");
      msg = JSON.parse(raw) as ScribeMessage;
    } catch (err) {
      logger.warn("SCRIBE", "bad message", String(err));
      return;
    }

    const type = msg.message_type;
    if (type === "session_started") {
      logger.info("SCRIBE", "session started");
      return;
    }

    if (type === "error" || msg.error) {
      const detail = msg.error ?? msg.message ?? "unknown Scribe error";
      logger.error("SCRIBE", detail);
      this.handlers.onError?.(new Error(detail));
      return;
    }

    if (type === "partial_transcript") {
      const text = (msg.text ?? "").trim();
      if (!text) return;
      if (!this.speaking) {
        this.speaking = true;
        this.flushedForCurrentUtterance = false;
        logger.info("USER", "speech started");
        this.handlers.onSpeechStarted?.();
      }
      this.handlers.onInterim?.(text);
      return;
    }

    if (type === "committed_transcript_with_timestamps") {
      const words = msg.words ?? [];
      for (let i = words.length - 1; i >= 0; i--) {
        const end = words[i]?.end;
        if (typeof end === "number") {
          this.lastWordEndSeconds = end;
          break;
        }
      }
      this.flushTurn(msg.text ?? "", "committed_timestamps");
      return;
    }

    if (type === "committed_transcript") {
      this.flushTurn(msg.text ?? "", "committed");
    }
  }

  private flushTurn(text: string, reason: string): void {
    if (this.flushedForCurrentUtterance) return;
    const cleaned = text.trim();
    this.flushedForCurrentUtterance = true;
    this.speaking = false;
    this.handlers.onSpeechEnded?.();
    if (!cleaned) {
      logger.debug("SCRIBE", `${reason}: empty turn`);
      return;
    }
    logger.info("SCRIBE", `${reason} → final turn`);
    this.handlers.onFinalTurn?.(cleaned, this.lastWordEndSeconds);
  }
}

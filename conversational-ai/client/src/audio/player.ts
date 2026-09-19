import { AUDIO_SAMPLE_RATE_OUT } from "@shared/events";

/**
 * Gapless streaming PCM16 playback with generation-ID filtering.
 * Uses AudioBufferSourceNode scheduled on a running clock to avoid gaps.
 */
export class StreamingAudioPlayer {
  private ctx: AudioContext | null = null;
  private nextStartTime = 0;
  private activeSources = new Set<AudioBufferSourceNode>();
  private validGenerationId: string | null = null;
  private playing = false;
  private onPlaybackState: ((playing: boolean) => void) | null = null;
  private startTimers = new Set<ReturnType<typeof setTimeout>>();
  private queueVersion = 0;
  private pendingChunks = 0;
  private onFirstPlay: (() => void) | null = null;
  private firstPlayFired = false;
  private readonly sampleRate: number;
  private onDrained: (() => void) | null = null;
  /** False once the server says no further audio is coming for this turn. */
  private expectMoreAudio = true;

  constructor(sampleRate = AUDIO_SAMPLE_RATE_OUT) {
    this.sampleRate = sampleRate;
  }

  async ensureReady(): Promise<void> {
    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate: this.sampleRate });
    }
    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }
  }

  /** Only audio for this generationId will play; others are dropped. */
  setActiveGeneration(generationId: string | null): void {
    if (generationId === this.validGenerationId) return;
    this.clear();
    this.validGenerationId = generationId;
    this.firstPlayFired = false;
    this.expectMoreAudio = generationId !== null;
  }

  /** Tracks audible playback, including gaps while more audio is arriving. */
  setOnPlaybackState(cb: ((playing: boolean) => void) | null): void {
    this.onPlaybackState = cb;
  }

  private setPlaying(playing: boolean): void {
    if (this.playing === playing) return;
    this.playing = playing;
    this.onPlaybackState?.(playing);
  }

  setOnFirstPlay(cb: (() => void) | null): void {
    this.onFirstPlay = cb;
  }

  /** Fires when the queue empties after the server finished sending audio. */
  setOnDrained(cb: (() => void) | null): void {
    this.onDrained = cb;
  }

  /**
   * The server has sent everything for this turn. Playback may still have
   * seconds of queued audio, so barge-in must stay armed until it drains.
   */
  markNoMoreAudio(): void {
    this.expectMoreAudio = false;
    this.maybeDrained();
  }

  private maybeDrained(): void {
    if (!this.expectMoreAudio && this.activeSources.size === 0 && this.pendingChunks === 0) {
      this.onDrained?.();
    }
  }

  get isPlaying(): boolean {
    return this.playing && this.activeSources.size > 0;
  }

  async playChunk(pcm16: ArrayBuffer, generationId: string): Promise<void> {
    if (generationId !== this.validGenerationId) {
      return; // late audio from interrupted generation
    }

    const version = this.queueVersion;
    this.pendingChunks += 1;
    try {
      await this.ensureReady();
      if (version !== this.queueVersion || generationId !== this.validGenerationId) return;
      const ctx = this.ctx!;
      const int16 = new Int16Array(pcm16);
      if (int16.length === 0) return;

      const float = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float[i] = int16[i]! / (int16[i]! < 0 ? 0x8000 : 0x7fff);
      }

      const buffer = ctx.createBuffer(1, float.length, this.sampleRate);
      buffer.copyToChannel(float, 0);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);

      const now = ctx.currentTime;
      // Small look-ahead to absorb jitter
      const startAt = Math.max(now + 0.02, this.nextStartTime);
      this.nextStartTime = startAt + buffer.duration;

      source.onended = () => {
        this.activeSources.delete(source);
        source.disconnect();
        if (this.activeSources.size === 0) {
          this.setPlaying(false);
          this.maybeDrained();
        }
      };

      this.activeSources.add(source);
      source.start(startAt);

      // Signal at the scheduled audio onset instead of at text generation time.
      if (!this.playing) {
        const timer = setTimeout(() => {
          this.startTimers.delete(timer);
          if (version !== this.queueVersion || !this.activeSources.has(source)) return;
          this.setPlaying(true);
          if (!this.firstPlayFired) {
            this.firstPlayFired = true;
            this.onFirstPlay?.();
          }
        }, Math.max(0, (startAt - ctx.currentTime) * 1000));
        this.startTimers.add(timer);
      }
    } finally {
      if (version === this.queueVersion) {
        this.pendingChunks -= 1;
        this.maybeDrained();
      }
    }
  }

  /** Clear queued / playing audio (barge-in). */
  clear(): void {
    this.queueVersion += 1;
    this.pendingChunks = 0;
    for (const timer of this.startTimers) clearTimeout(timer);
    this.startTimers.clear();
    this.onDrained = null;
    for (const s of this.activeSources) {
      try {
        s.onended = null;
        s.stop();
        s.disconnect();
      } catch {
        /* already stopped */
      }
    }
    this.activeSources.clear();
    this.setPlaying(false);
    this.expectMoreAudio = false;
    this.nextStartTime = this.ctx?.currentTime ?? 0;
    console.info("[AUDIO] queue cleared");
  }

  stop(): void {
    this.clear();
    this.validGenerationId = null;
    const ctx = this.ctx;
    this.ctx = null;
    void ctx?.close().catch(() => { /* already closed */ });
  }
}

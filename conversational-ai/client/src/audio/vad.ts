/**
 * Barge-in VAD. Armed only while the assistant is audible.
 * Requires sustained speech-band energy above a live noise floor so clicks,
 * rustles, coughs, and TTS leak do not steal the floor.
 */
export class EnergyVad {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private raf: number | null = null;
  private armed = false;
  private triggered = false;
  private readonly minRms: number;
  private readonly hangMs: number;
  private readonly graceMs: number;
  private readonly floorRatio: number;
  private noiseFloor = 0.012;
  private speechMs = 0;
  private lastTick: number | null = null;
  private armedAt: number | null = null;
  private onSpeech: (() => void) | null = null;
  private timeDomain = new Float32Array(0);
  private frequency = new Float32Array(0);

  constructor(opts?: { minRms?: number; hangMs?: number; graceMs?: number; floorRatio?: number }) {
    this.minRms = opts?.minRms ?? 0.07;
    this.hangMs = opts?.hangMs ?? 420;
    this.graceMs = opts?.graceMs ?? 280;
    this.floorRatio = opts?.floorRatio ?? 4.2;
  }

  async attach(stream: MediaStream, onSpeech: () => void): Promise<void> {
    this.detach();
    this.onSpeech = onSpeech;
    this.ctx = new AudioContext();
    this.source = this.ctx.createMediaStreamSource(stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.45;
    this.timeDomain = new Float32Array(this.analyser.fftSize);
    this.frequency = new Float32Array(this.analyser.frequencyBinCount);
    this.source.connect(this.analyser);
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.loop();
  }

  arm(): void {
    this.armed = true;
    this.triggered = false;
    this.speechMs = 0;
    this.lastTick = null;
    this.armedAt = performance.now();
  }

  disarm(): void {
    this.armed = false;
    this.triggered = false;
    this.speechMs = 0;
    this.lastTick = null;
    this.armedAt = null;
  }

  detach(): void {
    this.disarm();
    if (this.raf != null) cancelAnimationFrame(this.raf);
    this.raf = null;
    try {
      this.source?.disconnect();
    } catch {
      /* ignore */
    }
    void this.ctx?.close();
    this.ctx = null;
    this.analyser = null;
    this.source = null;
    this.onSpeech = null;
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.analyser) return;

    this.analyser.getFloatTimeDomainData(this.timeDomain);
    let sum = 0;
    for (let i = 0; i < this.timeDomain.length; i++) {
      const sample = this.timeDomain[i]!;
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / this.timeDomain.length);

    if (!this.armed || this.triggered) {
      this.learnFloor(rms);
      return;
    }

    const now = performance.now();
    const dt = this.lastTick == null ? 16 : Math.min(48, now - this.lastTick);
    this.lastTick = now;

    if (this.armedAt != null && now - this.armedAt < this.graceMs) {
      this.learnFloor(rms);
      return;
    }

    const threshold = Math.max(this.minRms, this.noiseFloor * this.floorRatio);
    const talking = rms >= threshold && this.looksLikeSpeech();
    if (talking) this.speechMs += dt;
    else this.speechMs = Math.max(0, this.speechMs - dt * 2.2);

    if (!talking) this.learnFloor(rms);

    if (this.speechMs >= this.hangMs) {
      this.triggered = true;
      this.onSpeech?.();
    }
  };

  private learnFloor(rms: number): void {
    if (rms >= this.minRms * 0.85) return;
    this.noiseFloor = this.noiseFloor * 0.96 + rms * 0.04;
  }

  /** Speech lives in a mid band; clicks and thumps do not. */
  private looksLikeSpeech(): boolean {
    if (!this.analyser || !this.ctx) return true;
    this.analyser.getFloatFrequencyData(this.frequency);
    const binHz = this.ctx.sampleRate / this.analyser.fftSize;
    let speech = 0;
    let total = 0;
    for (let i = 1; i < this.frequency.length; i++) {
      const hz = i * binHz;
      if (hz < 80 || hz > 7000) continue;
      const linear = 10 ** (this.frequency[i]! / 20);
      total += linear;
      if (hz >= 250 && hz <= 3400) speech += linear;
    }
    return total > 0 && speech / total >= 0.32;
  }
}

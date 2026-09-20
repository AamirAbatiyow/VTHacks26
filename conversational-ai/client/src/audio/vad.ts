/**
 * Barge-in VAD. Armed only while the assistant is audible.
 * Requires sustained speech-band energy above a live noise floor, with
 * dB hysteresis and syllable-rate modulation, so clicks, rustles, coughs,
 * steady HVAC, and TTS leak do not steal the floor.
 */
export class EnergyVad {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private raf: number | null = null;
  private armed = false;
  private triggered = false;
  private open = false;
  private readonly minRms: number;
  private readonly hangMs: number;
  private readonly graceMs: number;
  /** Open when rms >= floor * openRatio (~+12 dB). */
  private readonly openRatio: number;
  /** Stay open while rms >= floor * holdRatio (~+8 dB). */
  private readonly holdRatio: number;
  private readonly modMinCv: number;
  private noiseFloor = 0.012;
  private speechMs = 0;
  private lastTick: number | null = null;
  private armedAt: number | null = null;
  private onSpeech: (() => void) | null = null;
  private timeDomain = new Float32Array(0);
  private frequency = new Float32Array(0);
  /** Recent short-window RMS samples for envelope modulation (~80–120 ms). */
  private readonly rmsHistory: number[] = [];
  private readonly rmsHistoryMax = 8;

  constructor(opts?: {
    minRms?: number;
    hangMs?: number;
    graceMs?: number;
    openRatio?: number;
    holdRatio?: number;
    modMinCv?: number;
  }) {
    this.minRms = opts?.minRms ?? 0.07;
    this.hangMs = opts?.hangMs ?? 520;
    this.graceMs = opts?.graceMs ?? 280;
    this.openRatio = opts?.openRatio ?? 4.2;
    this.holdRatio = opts?.holdRatio ?? 2.5;
    this.modMinCv = opts?.modMinCv ?? 0.12;
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
    this.open = false;
    this.speechMs = 0;
    this.lastTick = null;
    this.armedAt = performance.now();
    this.rmsHistory.length = 0;
  }

  disarm(): void {
    this.armed = false;
    this.triggered = false;
    this.open = false;
    this.speechMs = 0;
    this.lastTick = null;
    this.armedAt = null;
    this.rmsHistory.length = 0;
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
    this.pushRms(rms);

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

    const openAt = Math.max(this.minRms, this.noiseFloor * this.openRatio);
    const holdAt = Math.max(this.minRms * 0.55, this.noiseFloor * this.holdRatio);
    if (this.open) {
      if (rms < holdAt) this.open = false;
    } else if (rms >= openAt) {
      this.open = true;
    }

    const talking =
      this.open && this.looksLikeSpeech() && this.hasSpeechModulation();
    if (talking) this.speechMs += dt;
    else this.speechMs = Math.max(0, this.speechMs - dt * 2.2);

    if (!talking) this.learnFloor(rms);

    if (this.speechMs >= this.hangMs) {
      this.triggered = true;
      this.onSpeech?.();
    }
  };

  private pushRms(rms: number): void {
    this.rmsHistory.push(rms);
    while (this.rmsHistory.length > this.rmsHistoryMax) this.rmsHistory.shift();
  }

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

  /**
   * Steady HVAC / fan energy sits flat; speech modulates at syllable rates
   * (~2–8 Hz). Require a minimum coefficient of variation over recent RMS.
   */
  private hasSpeechModulation(): boolean {
    if (this.rmsHistory.length < 4) return false;
    let mean = 0;
    for (const v of this.rmsHistory) mean += v;
    mean /= this.rmsHistory.length;
    if (mean < 1e-6) return false;
    let variance = 0;
    for (const v of this.rmsHistory) {
      const d = v - mean;
      variance += d * d;
    }
    variance /= this.rmsHistory.length;
    const cv = Math.sqrt(variance) / mean;
    return cv >= this.modMinCv;
  }
}

/**
 * Simple RMS energy VAD for barge-in.
 * Armed only while the assistant is speaking to avoid false positives
 * from ambient noise when the AI is silent.
 */
export class EnergyVad {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private raf: number | null = null;
  private armed = false;
  private triggered = false;
  private readonly threshold: number;
  private readonly hangMs: number;
  private aboveSince: number | null = null;
  private onSpeech: (() => void) | null = null;

  constructor(opts?: { threshold?: number; hangMs?: number }) {
    // Empirically tuned for speech over TTS echo with echoCancellation on
    this.threshold = opts?.threshold ?? 0.045;
    this.hangMs = opts?.hangMs ?? 90;
  }

  async attach(stream: MediaStream, onSpeech: () => void): Promise<void> {
    this.detach();
    this.onSpeech = onSpeech;
    this.ctx = new AudioContext();
    this.source = this.ctx.createMediaStreamSource(stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.source.connect(this.analyser);
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.loop();
  }

  arm(): void {
    this.armed = true;
    this.triggered = false;
    this.aboveSince = null;
  }

  disarm(): void {
    this.armed = false;
    this.triggered = false;
    this.aboveSince = null;
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
    if (!this.armed || this.triggered || !this.analyser) return;

    const data = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i]! * data[i]!;
    const rms = Math.sqrt(sum / data.length);

    const now = performance.now();
    if (rms >= this.threshold) {
      if (this.aboveSince == null) this.aboveSince = now;
      if (now - this.aboveSince >= this.hangMs) {
        this.triggered = true;
        this.onSpeech?.();
      }
    } else {
      this.aboveSince = null;
    }
  };
}

import { AUDIO_SAMPLE_RATE_IN } from "../../../shared/events.js";

/**
 * Keeps a short pre-roll so the start of a word isn't clipped (Scribe only
 * signals speech after the first partial), then records until the turn ends.
 */
export class UtteranceCapture {
  private preroll: Buffer[] = [];
  private prerollBytes = 0;
  private readonly maxPrerollBytes: number;
  private utterance: Buffer[] = [];
  private capturing = false;

  constructor(preRollSeconds = 0.4, sampleRate = AUDIO_SAMPLE_RATE_IN) {
    this.maxPrerollBytes = Math.round(sampleRate * 2 * preRollSeconds);
  }

  push(pcm: Buffer): void {
    if (this.capturing) {
      this.utterance.push(pcm);
      return;
    }
    this.preroll.push(pcm);
    this.prerollBytes += pcm.length;
    while (this.prerollBytes > this.maxPrerollBytes && this.preroll.length > 0) {
      this.prerollBytes -= this.preroll.shift()!.length;
    }
  }

  begin(): void {
    if (this.capturing) return;
    this.capturing = true;
    this.utterance = [...this.preroll];
  }

  take(): Buffer {
    const parts = this.capturing
      ? this.utterance
      : [...this.preroll, ...this.utterance];
    const out = Buffer.concat(parts);
    this.utterance = [];
    this.capturing = false;
    this.preroll = [];
    this.prerollBytes = 0;
    return out;
  }

  get isCapturing(): boolean {
    return this.capturing;
  }
}

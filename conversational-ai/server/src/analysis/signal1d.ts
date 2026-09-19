import type { SpeechSignal } from "../../../shared/events.js";

const TARGET_POINTS = 240;

/**
 * Downsample raw PCM16 LE mono into a 1-D peak-signed amplitude series.
 * Each point is the sample of largest |amplitude| in its window, normalized
 * to [-1, 1]. That keeps the shape of the waveform without shipping 16 kHz.
 */
export function pcm16ToSignal1d(
  pcm16: Buffer,
  sourceSampleRate: number,
  targetPoints = TARGET_POINTS,
): SpeechSignal {
  const sampleCount = Math.floor(pcm16.length / 2);
  const durationMs = Math.round((sampleCount / sourceSampleRate) * 1000);
  if (sampleCount === 0) {
    return { samples: [], durationMs: 0, sourceSampleRate };
  }

  const points = Math.min(targetPoints, sampleCount);
  const window = sampleCount / points;
  const samples = new Array<number>(points);

  for (let i = 0; i < points; i++) {
    const start = Math.floor(i * window);
    const end = Math.min(sampleCount, Math.floor((i + 1) * window));
    let peak = 0;
    let peakAbs = 0;
    for (let s = start; s < end; s++) {
      const v = pcm16.readInt16LE(s * 2);
      const abs = v < 0 ? -v : v;
      if (abs > peakAbs) {
        peakAbs = abs;
        peak = v;
      }
    }
    samples[i] = round3(peak / 32768);
  }

  return { samples, durationMs, sourceSampleRate };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

import type { SpeechSignal } from "@shared/events";

interface Props {
  signal: SpeechSignal;
}

export function Waveform({ signal }: Props) {
  const { samples, durationMs } = signal;
  const w = 320;
  const h = 56;
  const mid = h / 2;

  if (samples.length === 0) return null;

  const step = w / Math.max(samples.length - 1, 1);
  const points = samples
    .map((v, i) => {
      const x = (i * step).toFixed(1);
      const y = (mid - v * (mid - 3)).toFixed(1);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className="waveform">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width="100%"
        height={h}
        preserveAspectRatio="none"
        aria-label="Utterance waveform"
      >
        <line
          className="waveform-axis"
          x1="0"
          y1={mid}
          x2={w}
          y2={mid}
        />
        <polyline className="waveform-line" points={points} />
      </svg>
      <div className="waveform-meta">
        {samples.length} samples · {(durationMs / 1000).toFixed(2)}s · 1-D
        amplitude
      </div>
    </div>
  );
}

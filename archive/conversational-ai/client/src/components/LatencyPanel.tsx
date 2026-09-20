import type { TurnMetrics } from "@shared/events";

interface Props {
  metrics: TurnMetrics | null;
}

function ms(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${v} ms`;
}

export function LatencyPanel({ metrics }: Props) {
  if (!metrics) {
    return (
      <div className="latency">
        <h2>Latency</h2>
        <p className="muted">Metrics appear after the first completed turn.</p>
      </div>
    );
  }

  const total =
    metrics.totalMs ??
    (metrics.serverToFirstAudioMs != null
      ? metrics.serverToFirstAudioMs + (metrics.playbackDelayMs ?? 0)
      : null);

  return (
    <div className="latency">
      <h2>Latency</h2>
      <pre className="latency-block">
{`STT       ${ms(metrics.sttMs)}
Gemini    ${ms(metrics.geminiFirstTokenMs)}
TTS       ${ms(metrics.ttsFirstAudioMs)}
----------------
First audio: ${ms(total)}`}
      </pre>
      <p className="muted small">
        STT = finalization after last word · Gemini = first token · TTS = first
        audio chunk · Total = speech end → first audio played (measured, not
        fabricated).
      </p>
    </div>
  );
}

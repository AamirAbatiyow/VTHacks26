import type { StutterAnalysis } from "@shared/events";

interface Props {
  analysis: StutterAnalysis;
}

/** Human-friendly names for the SEP-28k event classes. */
const DISPLAY: Record<string, string> = {
  Prolongation: "Prolongation",
  Block: "Block",
  SoundRep: "Sound repetition",
  WordRep: "Word repetition",
  Interjection: "Interjection",
};

export function StutterPanel({ analysis }: Props) {
  const events = analysis.events.filter((e) => e.label !== "Fluent");
  if (events.length === 0) return null;

  const detected = events.filter((e) => e.detected);
  const fluentIdx = analysis.labels.indexOf("Fluent");

  return (
    <div className="stutter">
      <div className="stutter-head">
        <span className="stutter-title">Speech analysis</span>
        <span className="stutter-meta">
          fluency {Math.round(analysis.fluency * 100)}% · {analysis.windows.length}{" "}
          window{analysis.windows.length === 1 ? "" : "s"} · {analysis.inferenceMs}ms
        </span>
      </div>

      {detected.length === 0 ? (
        <div className="stutter-clear">No stutter events detected</div>
      ) : null}

      <ul className="stutter-bars">
        {events.map((e) => (
          <li
            key={e.label}
            className={e.detected ? "stutter-row is-detected" : "stutter-row"}
          >
            <span className="stutter-label">{DISPLAY[e.label] ?? e.label}</span>
            <span className="stutter-track">
              <span
                className="stutter-fill"
                style={{ width: `${Math.round(e.probability * 100)}%` }}
              />
            </span>
            <span className="stutter-value">{e.probability.toFixed(2)}</span>
          </li>
        ))}
      </ul>

      {analysis.windows.length > 1 ? (
        <div className="stutter-timeline" aria-label="Per-window stutter likelihood">
          {analysis.windows.map((w) => {
            const peak = Math.max(
              ...w.scores.filter((_, i) => i !== fluentIdx),
            );
            return (
              <span
                key={w.startMs}
                className="stutter-tick"
                style={{ opacity: 0.2 + peak * 0.8 }}
                title={`${(w.startMs / 1000).toFixed(1)}–${(w.endMs / 1000).toFixed(1)}s · peak ${peak.toFixed(2)}`}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

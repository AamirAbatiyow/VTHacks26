import { useEffect, useRef, useState } from "react";
import type { SessionConfig } from "@shared/events";
import type { PracticeSession } from "../progress/practiceHistory";
import { buildPracticeReport } from "../progress/report";
import { computeFrequencySummary, CATEGORY_DISPLAY_NAMES, type SessionFrequency, type FrequencySummary } from "../progress/frequency";

const TREND_LABEL: Record<FrequencySummary["trend"]["direction"], string> = {
  improving: "trending down (fewer detected flags per 100 words over time)",
  worsening: "trending up (more detected flags per 100 words over time)",
  flat: "roughly stable across sessions",
  insufficient_data: "not enough analyzed sessions yet to show a trend",
};

/** Small dependency-free line chart: detected frequency % across sessions, oldest to newest. */
function FrequencyTrendChart({ sessions }: { sessions: SessionFrequency[] }) {
  const width = 560, height = 170, padL = 34, padR = 12, padT = 12, padB = 26;
  const plotW = width - padL - padR, plotH = height - padT - padB;
  const withValues = sessions.filter(s => s.frequencyPercent !== null);
  if (withValues.length === 0) {
    return <p className="progress-garden__analysis-note">No analyzed sessions yet — this chart appears once at least one practice session has been analyzed.</p>;
  }
  const maxY = Math.max(10, ...withValues.map(s => s.frequencyPercent ?? 0)) * 1.15;
  const stepX = sessions.length > 1 ? plotW / (sessions.length - 1) : 0;
  const points = sessions.map((s, i) => ({
    x: padL + (sessions.length > 1 ? i * stepX : plotW / 2),
    y: s.frequencyPercent === null ? null : padT + plotH - (s.frequencyPercent / maxY) * plotH,
    session: s,
  }));
  const linePoints = points.filter((p): p is typeof p & { y: number } => p.y !== null);
  const path = linePoints.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const gridY = [0, 0.25, 0.5, 0.75, 1];
  return (
    <svg className="frequency-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Detected stuttering frequency percentage across sessions">
      {gridY.map(fraction => {
        const y = padT + plotH - fraction * plotH;
        return <g key={fraction}>
          <line x1={padL} x2={width - padR} y1={y} y2={y} stroke="#d0e2db" strokeWidth={1} />
          <text x={padL - 8} y={y + 4} textAnchor="end" fontSize={10} fill="#7a9389">{Math.round(fraction * maxY)}%</text>
        </g>;
      })}
      {linePoints.length > 1 && <path d={path} fill="none" stroke="#567969" strokeWidth={2.5} />}
      {points.map((p, i) => p.y === null ? null : (
        <g key={p.session.sessionId}>
          <circle cx={p.x} cy={p.y} r={4} fill="#567969" />
          {(i === 0 || i === points.length - 1 || points.length <= 6) && (
            <text x={p.x} y={height - 6} textAnchor="middle" fontSize={10} fill="#7a9389">
              {new Date(p.session.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

/** Small dependency-free horizontal bar chart: total detected flags by category. */
function CategoryTotalsChart({ totals }: { totals: FrequencySummary["totalsByCategory"] }) {
  const entries = Object.entries(totals);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return <div className="category-bars">
    {entries.map(([key, value]) => (
      <div key={key} className="category-bar-row">
        <span className="category-bar-label">{CATEGORY_DISPLAY_NAMES[key] ?? key}</span>
        <div className="category-bar-track"><div className="category-bar-fill" style={{ width: `${(value / max) * 100}%` }} /></div>
        <strong>{value}</strong>
      </div>
    ))}
  </div>;
}

export function PracticeReport({ profile, sessions, open, onClose }: {
  profile: SessionConfig; sessions: PracticeSession[]; open: boolean; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { sessions: freqRows, summary: freq } = computeFrequencySummary(sessions);
  const [narrative, setNarrative] = useState<{ text: string; source: "gemini" | "template" } | null>(null);
  const [narrativeLoading, setNarrativeLoading] = useState(false);
  const [narrativeError, setNarrativeError] = useState("");
  const report = buildPracticeReport(profile, sessions, new Date(), narrative?.text);

  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close(); }, [open]);
  useEffect(() => { setNarrative(null); setNarrativeError(""); }, [sessions.length]);

  async function generateNarrative() {
    setNarrativeLoading(true);
    setNarrativeError("");
    try {
      const res = await fetch("/report-narrative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: profile.childName ?? null, summary: freq }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const json: { narrative: string; source: "gemini" | "template" } = await res.json();
      setNarrative({ text: json.narrative, source: json.source });
    } catch {
      setNarrativeError("Couldn't generate a narrative right now — the numbers above are still accurate on their own.");
    } finally {
      setNarrativeLoading(false);
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([report], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `vocally-practice-report-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <dialog ref={dialog} className="speech-report-dialog" aria-labelledby="report-title" onClose={onClose}>
    <div className="detail-top"><span className="detail-brand">vocally</span><button className="close" aria-label="Close report" onClick={() => dialog.current?.close()}>✕</button></div>
    <h2 id="report-title">Your practice report</h2>
    <p>Review your session summary and audio-analysis results, then download a copy.</p>

    {freq.analyzedSessionCount > 0 && <div className="report-frequency">
      <div className="report-frequency__panel">
        <span className="eyebrow">DETECTED FREQUENCY</span>
        <h3>{freq.overallFrequencyPercent === null ? "—" : `${freq.overallFrequencyPercent}%`}<small> flags / 100 words</small></h3>
        <FrequencyTrendChart sessions={freqRows} />
        <p className="progress-garden__analysis-note">{TREND_LABEL[freq.trend.direction]}</p>
      </div>
      <div className="report-frequency__panel">
        <span className="eyebrow">DETECTED FLAGS BY CATEGORY</span>
        <h3>{freq.totalFlags} total</h3>
        <CategoryTotalsChart totals={freq.totalsByCategory} />
      </div>
    </div>}
    <p className="progress-garden__analysis-note">Frequency = detected stutter-type flags per 100 words, the frequency component of the SSI-4 framework. Duration, physical concomitants, and naturalness aren't assessed. The classifier is approximate, not a clinical measurement.</p>

    <div className="report-actions">
      <button className="primary" onClick={download}>Download report ↓</button>
      {freq.analyzedSessionCount > 0 && <button type="button" onClick={generateNarrative} disabled={narrativeLoading}>{narrativeLoading ? "Writing narrative…" : "Generate AI narrative"}</button>}
    </div>
    {narrativeError && <p role="status" className="progress-garden__analysis-note">{narrativeError}</p>}
    {narrative && <div className="report-narrative"><span className="eyebrow">{narrative.source === "gemini" ? "AI-DRAFTED NARRATIVE" : "AUTO-GENERATED SUMMARY"}</span><p>{narrative.text}</p></div>}

    <pre>{report}</pre>
  </dialog>;
}

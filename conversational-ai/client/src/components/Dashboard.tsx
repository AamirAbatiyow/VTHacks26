import { useEffect, useState } from "react";
import type { SessionConfig } from "@shared/events";
import { VocallyWordmark } from "./VocallyWordmark";
import { PracticeReport } from "./PracticeReport";
import { summarizeAnalysis } from "../progress/report";
import { ANALYSIS_NAMES } from "@shared/sessionSummary";
import { SimulationIcon } from "./SimulationIcon";
import { formatDuration, localDay, practiceWeek, type PracticeSession } from "../progress/practiceHistory";
import "./Dashboard.css";

type Props = {
  profile: SessionConfig;
  sessions: PracticeSession[];
  saved: boolean;
  onPractice: () => void;
};

export function Dashboard({ profile, sessions, saved, onPractice }: Props) {
  const [now, setNow] = useState(() => new Date());
  const [reportOpen, setReportOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const week = practiceWeek(sessions, now);
  const seconds = week.reduce((sum, day) => sum + day.seconds, 0);
  const count = week.reduce((sum, day) => sum + day.count, 0);
  const activeDays = week.filter(day => day.count > 0).length;
  const max = Math.max(60, ...week.map(day => day.seconds));
  const analysis = summarizeAnalysis(sessions);
  const recent = showAll ? sessions : sessions.slice(0, 4);

  return (
    <div className="progress-garden">
      <header className="progress-garden__header">
        <div className="progress-garden__identity"><span className="progress-garden__wordmark"><VocallyWordmark /></span><span>Your progress</span></div>
        <div className="progress-garden__actions">
          <button className="progress-garden__report-button" aria-haspopup="dialog" onClick={() => setReportOpen(true)}>View report <span aria-hidden="true">↗</span></button>
          <button className="progress-garden__practice" onClick={onPractice}>Back to practice <span aria-hidden="true">↗</span></button>
        </div>
      </header>
      <div className="progress-garden__content">
        <section className="progress-garden__intro" aria-labelledby="welcome-title">
          <p className="progress-garden__eyebrow">Your practice, at a glance</p>
          <h2 id="welcome-title">Room to <em>grow.</em></h2>
          <p>{profile.childName ? `${profile.childName}, here’s` : "Here’s"} the time you’ve made for your voice.</p>
        </section>
        <section className="progress-garden__overview" aria-labelledby="week-title">
          <div className="progress-garden__section-heading"><h3 id="week-title">This week</h3><span>Last 7 days</span></div>
          <dl className="progress-garden__stats">
            <div><dt>Practice time</dt><dd>{formatDuration(seconds)}</dd></div>
            <div><dt>Sessions</dt><dd>{count}</dd></div>
            <div><dt>Days practiced</dt><dd>{activeDays}<span> / 7</span></dd></div>
          </dl>
          <div className="progress-garden__chart" role="img" aria-label={`Daily practice: ${week.map(day => `${day.date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}, ${formatDuration(day.seconds)}, ${day.count} sessions`).join("; ")}`}>
            {week.map(day => <div className="progress-garden__day" key={day.key} data-today={day.key === localDay(now)} aria-hidden="true">
              <div className="progress-garden__bar-track"><span className="progress-garden__bar" style={{ height: `${day.count ? Math.max(4, day.seconds / max * 100) : 0}%` }} />{day.count > 0 && <span className="progress-garden__bar-value">{formatDuration(day.seconds)}</span>}</div>
              <span>{day.date.toLocaleDateString(undefined, { weekday: "short" })}</span>
              <small>{day.date.getDate()}</small>
            </div>)}
          </div>
        </section>
        {sessions.length > 0 && <section className="progress-garden__recent" aria-labelledby="speech-results-title">
          <div className="progress-garden__section-heading"><h3 id="speech-results-title">Speech patterns</h3><span>{analysis.analyzed} / {analysis.turns} turns analyzed</span></div>
          {analysis.analyzed ? <><p className="progress-garden__analysis-note">{analysis.flagged} speaking {analysis.flagged === 1 ? "turn" : "turns"} with model flags.</p>
            <ul className="progress-garden__analysis-list">{Object.entries(analysis.categories).filter(([, count]) => count > 0).map(([label, count]) => <li key={label}><span>{ANALYSIS_NAMES[label]}</span><strong>{count}</strong></li>)}</ul>
            <p className="progress-garden__analysis-note">Audio model observations, not a diagnosis. Full details are in your report.</p></> : <p className="progress-garden__analysis-note">No audio-analysis results available yet. Unanalyzed turns aren’t counted as fluent.</p>}
        </section>}
        <section className="progress-garden__recent" aria-labelledby="recent-title">
          <div className="progress-garden__section-heading"><h3 id="recent-title">Recent sessions</h3>{sessions.length > 0 && <span>{sessions.length} total</span>}</div>
          {recent.length ? <ul className="progress-garden__sessions">{recent.map(item => <li key={item.id}>
            <span className="progress-garden__session-icon" aria-hidden="true"><SimulationIcon name="sound" /></span>
            <div><strong>{item.mode} practice</strong><time dateTime={item.startedAt}>{new Date(item.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {new Date(item.startedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</time></div>
            <span className="progress-garden__session-duration">{formatDuration(item.seconds)}<small>{item.turns} speaking {item.turns === 1 ? "turn" : "turns"}</small></span>
          </li>)}</ul> : <div className="progress-garden__empty"><span aria-hidden="true">◌</span><h4>Your first session starts here.</h4><p>Finish a conversation and your practice will appear automatically.</p></div>}
          {sessions.length > 4 && <button className="progress-garden__more" onClick={() => setShowAll(value => !value)}>{showAll ? "Show fewer" : "View all sessions"}</button>}
        </section>
        <footer className="progress-garden__footer"><span aria-hidden="true">◌</span><p>{saved ? "Session summaries and model flags are saved on this device for your name. Audio and transcripts aren’t saved in your progress history." : "Device storage is unavailable. Your progress is available for this visit."}</p></footer>
      </div>
      <PracticeReport profile={profile} sessions={sessions} open={reportOpen} onClose={() => setReportOpen(false)} />
    </div>
  );
}

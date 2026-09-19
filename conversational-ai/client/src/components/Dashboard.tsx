import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SessionConfig } from "@shared/events";
import { VocallyWordmark } from "./VocallyWordmark";
import { DashboardFlower } from "./DashboardFlower";
import "./Dashboard.css";
import { SpeechAnalytics } from "./SpeechAnalytics";

type Activity = { sessions: { date: string; minutes: number }[]; challenges: Record<string, number[]> };
type Card = "challenges" | "achievements" | "progress" | "streak";
const storageKey = "vocally-dashboard-activity-v1";
const dayKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const daysAgo = (offset: number) => { const date = new Date(); date.setDate(date.getDate() - offset); return date; };
const challenges = [
  { title: "Make space for a breath", description: "Take five slow, comfortable breaths before speaking. There is no rush.", duration: "2 min" },
  { title: "Tell a little story", description: "Share a small moment from your day, out loud, in your own words.", duration: "3 min" },
  { title: "A moment to reflect", description: "Name one thing you felt good about while speaking today.", duration: "1 min" },
];
function readActivity(): Activity {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    if (!value || !Array.isArray(value.sessions) || !value.challenges || typeof value.challenges !== "object") return { sessions: [], challenges: {} };
    return {
      sessions: value.sessions.filter((s: Activity["sessions"][number]) => s && /^\d{4}-\d{2}-\d{2}$/.test(s.date) && Number.isInteger(s.minutes) && s.minutes > 0 && s.minutes <= 180),
      challenges: Object.fromEntries(Object.entries(value.challenges).filter(([date, entries]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Array.isArray(entries)).map(([date, entries]) => [date, [...new Set((entries as unknown[]).filter(v => v === 0 || v === 1 || v === 2))]])),
    };
  } catch { return { sessions: [], challenges: {} }; }
}
export function Dashboard({ profile, onPractice, onProfileChange }: { profile: SessionConfig; onPractice: () => void; onProfileChange: (profile: SessionConfig) => void }) {
  const [activity, setActivity] = useState(readActivity);
  const [today, setToday] = useState(dayKey);
  const [activeCard, setActiveCard] = useState<Card | null>(null);
  const [notice, setNotice] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
  const detail = useRef<HTMLDialogElement>(null);
  const profileDialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { const timer = window.setInterval(() => setToday(dayKey()), 30000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { if (activeCard) detail.current?.showModal(); }, [activeCard]);
  function save(next: Activity) {
    setActivity(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setNotice("Your progress is saved."); }
    catch { setNotice("Browser storage is unavailable. Changes last for this visit."); }
  }
  const done = activity.challenges[today] ?? [];
  const dates = new Set([...activity.sessions.map(s => s.date), ...Object.keys(activity.challenges).filter(date => activity.challenges[date]!.length > 0)]);
  let streak = 0;
  for (let offset = dates.has(today) ? 0 : 1; dates.has(dayKey(daysAgo(offset))); offset++) streak++;
  const week = Array.from({ length: 7 }, (_, i) => { const date = daysAgo(6 - i); const key = dayKey(date); return { key, label: date.toLocaleDateString("en-US", { weekday: "short" }), minutes: activity.sessions.filter(s => s.date === key).reduce((sum, s) => sum + s.minutes, 0) }; });
  const total = week.reduce((sum, day) => sum + day.minutes, 0);
  const max = Math.max(25, ...week.map(day => day.minutes));
  const badges = [
    { icon: "✧", title: "The first hello", description: "Your first practice session. A small beginning with a big possibility.", unlocked: activity.sessions.length > 0, progress: `${Math.min(activity.sessions.length, 1)} / 1 session` },
    { icon: "❋", title: "Finding your rhythm", description: "Make time for ten practice sessions, each at your own pace.", unlocked: activity.sessions.length >= 10, progress: `${Math.min(activity.sessions.length, 10)} / 10 sessions` },
    { icon: "☀", title: "A week of showing up", description: "Practice or complete a challenge on seven consecutive days.", unlocked: streak >= 7, progress: `${Math.min(streak, 7)} / 7 days` },
  ];
  function card(id: Card, number: string, label: string, symbol: string, body: ReactNode, footer: string) {
    return <button type="button" className="card" onClick={e => { opener.current = e.currentTarget; setActiveCard(id); }} aria-label={`Open ${label}`} aria-haspopup="dialog"><span className="card-top"><span>{number} / {label.toUpperCase()}</span><span className="card-symbol" aria-hidden="true">{symbol}</span></span>{body}<span className="card-bottom"><span>{footer}</span><span className="arrow" aria-hidden="true">↗</span></span></button>;
  }
  const weekView = (large = false) => <div className={`week ${large ? "detail-week" : ""}`}>{week.map(day => <span className="day" key={day.key}><span>{day.label.slice(0, large ? 3 : 1)}</span><i className={`${dates.has(day.key) ? "active" : ""} ${day.key === today ? "current" : ""}`} aria-label={`${day.label}: ${dates.has(day.key) ? "activity complete" : "no activity"}`}>{dates.has(day.key) ? "✓" : "·"}</i></span>)}</div>;
  const heading = (category: string, title: string, description: string) => <div className="detail-heading"><div className="eyebrow"><span className="live-dot" />{category}</div><h2 id="detail-title">{title}</h2><p>{description}</p></div>;
  return <div className="vocally-dashboard"><div className="page">
    <header><span className="wordmark"><VocallyWordmark /></span><span className="header-note">A LITTLE PRACTICE. A LITTLE POSSIBILITY.</span><div className="header-actions"><button className="practice-link" onClick={onPractice}><span className="sound-icon" aria-hidden="true">ıııı</span>Let’s practice ↗</button><button type="button" className="primary" aria-haspopup="dialog" onClick={() => setReportOpen(true)}>Refer to physician ↗</button></div></header>
    <section className="welcome" aria-labelledby="welcome-title"><div className="welcome-copy"><div className="eyebrow"><span className="live-dot" />YOUR SPACE TO GROW <span className="today">{new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase()}</span></div><h2 id="welcome-title">Hello, <button onClick={() => profileDialog.current?.showModal()} aria-label="Edit your profile name">{profile.childName}<span className="name-dot">.</span></button><br />Your voice is <em>growing.</em></h2><p>Little moments of practice. Real reasons to feel proud.<br />Watch your progress unfold, one day at a time.</p><div className="welcome-footer"><span className="small-flower" aria-hidden="true">✳</span>At your pace. In your own voice.</div></div><div className="garden" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><DashboardFlower /><span className="garden-tag"><span>✧</span>Every small step counts</span><span className="spark spark-one">✧</span><span className="spark spark-two">+</span></div></section>
    <section className="dashboard" aria-labelledby="dashboard-title"><div className="section-heading"><h2 id="dashboard-title">Your everyday, a little brighter</h2><span>Pick a card. See how far you’ve come. ↓</span></div><div className="cards">
      {card("challenges", "01", "Daily challenges", "↗", <><h3>Small steps,<br />stronger voice.</h3><ul className="mini-tasks">{challenges.map((c, i) => <li key={c.title} className={done.includes(i) ? "completed" : ""}><span className={`check ${done.includes(i) ? "done" : ""}`}>{done.includes(i) ? "✓" : ""}</span>{c.title}</li>)}</ul></>, `${done.length} of 3 little wins today`)}
      {card("achievements", "02", "Achievements", "✧", <><h3>Look at you grow.</h3><p className="card-description">Every milestone tells your story.</p><div className="medals" aria-hidden="true">{badges.map(b => <span key={b.title} className={`medal ${b.unlocked ? "" : "locked"}`}>{b.icon}</span>)}</div></>, `${badges.filter(b => b.unlocked).length} milestones unlocked`)}
      {card("progress", "03", "Practice time", "◷", <><div className="metric">{total}<small>min this week</small></div><p className="card-description">Time well spent on yourself.</p><div className="mini-chart" aria-hidden="true">{week.map(day => <span key={day.key} className="mini-bar" style={{ height: `${Math.max(6, day.minutes / max * 100)}%` }} />)}</div></>, "Your last 7 days")}
      {card("streak", "04", "Your streak", "☀", <><div className="metric">{streak}<small>days in a row</small></div><p className="card-description">A little consistency. A lot of possibility.</p>{weekView()}</>, dates.has(today) ? "You showed up for yourself today" : "Let’s make today count")}
    </div></section><SpeechAnalytics profile={profile} reportOpen={reportOpen} onReportClose={() => setReportOpen(false)} /><footer><span><span className="live-dot" />A space for progress, never perfection.</span><button onClick={() => profileDialog.current?.showModal()}>Your profile ↗</button></footer></div>
    <dialog ref={detail} className="detail-dialog" aria-labelledby="detail-title" onClose={() => { setActiveCard(null); opener.current?.focus(); }}><div className="detail-shell"><div className="detail-top"><span className="detail-brand">vocally</span><button className="close" aria-label="Close expanded card" onClick={() => detail.current?.close()}>✕</button></div>
      {activeCard === "challenges" && <>{heading("01 / DAILY CHALLENGES", "Small steps. Your kind of progress.", "Three gentle invitations to use your voice today. Choose what feels right, and check it off when you’re ready.")}<div className="detail-grid"><div className="panel">{challenges.map((c, i) => <div className="challenge-row" key={c.title}><input type="checkbox" id={`challenge-${i}`} checked={done.includes(i)} onChange={e => save({ ...activity, challenges: { ...activity.challenges, [today]: e.target.checked ? [...done, i] : done.filter(v => v !== i) } })} /><label htmlFor={`challenge-${i}`}><strong>{c.title}</strong><small>{c.description}</small></label><span className="pill">{c.duration}</span></div>)}</div><aside className="panel"><h3>Your little wins</h3><div className="big-number">{done.length}<small> / 3 today</small></div><div className="progress-track" role="progressbar" aria-label="Daily challenges completed" aria-valuenow={done.length} aria-valuemin={0} aria-valuemax={3}><span style={{ width: `${done.length / 3 * 100}%` }} /></div><p>There’s no perfect way to begin. One small step is enough.</p><button className="primary" onClick={onPractice}>Practice with Vocally ↗</button></aside></div></>}
      {activeCard === "achievements" && <>{heading("02 / ACHIEVEMENTS", "You’re building something lovely.", "A collection of small beginnings and meaningful moments. Each milestone grows from your practice activity.")}<div className="badge-grid">{badges.map(b => <article className="badge-panel" key={b.title}><div className={`medal ${b.unlocked ? "" : "locked"}`} aria-hidden="true">{b.icon}</div><h3>{b.title}</h3><p>{b.description}</p><span className="pill">{b.unlocked ? "✓ Unlocked" : b.progress}</span></article>)}</div><p className="note">Milestones reflect your recorded practice. The seven-day milestone follows your current streak.</p></>}
      {activeCard === "progress" && <>{heading("03 / PRACTICE TIME", "Time for you. Room to grow.", "Every minute is a moment you chose to show up for yourself. Here’s your practice over the last seven days.")}<div className="detail-grid"><section className="panel"><h3>{total} minutes of possibility</h3><div className="chart" role="img" aria-label={`Practice minutes: ${week.map(day => `${day.label} ${day.minutes}`).join(", ")}`}>{week.map(day => <div className="chart-column" key={day.key}><strong>{day.minutes}m</strong><div className="bar" style={{ height: `${Math.max(2, day.minutes / max * 175)}px` }} /><span>{day.label}</span></div>)}</div></section><aside className="panel"><h3>Add a practice moment</h3><p>Record your practice minutes here after a session.</p><form onSubmit={e => { e.preventDefault(); const minutes = Number(new FormData(e.currentTarget).get("minutes")); if (!Number.isInteger(minutes) || minutes < 1 || minutes > 180) return; save({ ...activity, sessions: [...activity.sessions, { date: dayKey(), minutes }] }); }}><label htmlFor="minutes" className="note">Minutes practiced today</label><input id="minutes" className="minutes-input" name="minutes" type="number" min="1" max="180" step="1" defaultValue="5" required /><button className="primary" type="submit">Save practice ↗</button></form><p className="note">Practice time is recorded manually and saved in this browser.</p></aside></div><section className="panel" style={{ marginTop: 25 }}><h3>Recent practice</h3>{activity.sessions.length === 0 ? <p>Your first practice moment will appear here.</p> : <ul className="session-list">{[...activity.sessions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5).map((s, i) => <li key={`${s.date}-${i}`}><span>{new Date(`${s.date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span><span>{s.minutes} minutes</span></li>)}</ul>}</section></>}
      {activeCard === "streak" && <>{heading("04 / YOUR STREAK", "Keep showing up as you.", "A practice session or one daily challenge is all it takes to make today part of your story.")}<div className="detail-grid"><section className="panel"><div className="big-number">{streak}<small> days in a row</small></div>{weekView(true)}<p>{dates.has(today) ? "Today is already part of your story." : "Complete a challenge or record your practice to include today."}</p></section><aside className="panel"><h3>A rhythm, not a race.</h3><p>Miss a day? You can always begin again. Your practice history and the work you’ve put in are still here.</p><button className="primary" onClick={() => setActiveCard("challenges")}>Find a little challenge ↗</button></aside></div></>}
      <p role="status" className="note">{notice}</p>
    </div></dialog>
    <dialog ref={profileDialog} className="profile-dialog" aria-labelledby="profile-title"><form onSubmit={e => { e.preventDefault(); const name = String(new FormData(e.currentTarget).get("name") ?? "").trim(); if (!name) return; onProfileChange({ ...profile, childName: name }); profileDialog.current?.close(); }}><h2 id="profile-title">Make this space yours.</h2><label>Your first name<input key={profile.childName} name="name" defaultValue={profile.childName} maxLength={64} pattern=".*\S.*" required autoComplete="given-name" /></label><div className="form-actions"><button type="button" onClick={() => profileDialog.current?.close()}>Cancel</button><button type="submit" className="primary">Save profile ↗</button></div></form></dialog>
  </div>;
}

import { useEffect, useRef, useState } from "react";
import type { SessionConfig } from "@shared/events";
import "./SpeechAnalytics.css";

type Entry = { id: string; date: string; pattern: string; sounds: string; situation: string; impact: string; notes: string };
const patterns = ["Sound pronunciation", "Sound or word repetitions", "Prolonged sounds", "Blocks / difficulty starting", "Voice changes", "Other"];
const impacts = ["No interference", "Some difficulty", "Changed how I participated", "Avoided the activity"];
function readEntries(key: string): Entry[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(value) ? value.filter((entry): entry is Entry => entry && ["id", "date", "pattern", "sounds", "situation", "impact", "notes"].every(field => typeof entry[field] === "string") && /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && patterns.includes(entry.pattern) && impacts.includes(entry.impact)) : [];
  } catch { return []; }
}
const dateToday = () => new Date().toLocaleDateString("en-CA");
export function SpeechAnalytics({ profile, reportOpen, onReportClose }: { profile: SessionConfig; reportOpen: boolean; onReportClose: () => void }) {
  const storageKey = `vocally-speech-journal-v1:${encodeURIComponent(profile.childName ?? "")}:${profile.age ?? ""}`;
  const [entries, setEntries] = useState(() => readEntries(storageKey));
  const [notice, setNotice] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { setEntries(readEntries(storageKey)); setNotice(""); }, [storageKey]);
  useEffect(() => { if (reportOpen) dialog.current?.showModal(); else dialog.current?.close(); }, [reportOpen]);
  function save(next: Entry[]) {
    setEntries(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setNotice("Your observation is saved in this browser."); }
    catch { setNotice("Browser storage is unavailable. Download your report to keep these observations; they only last for this visit."); }
  }
  const counts = (field: "pattern" | "situation") => Object.entries(entries.reduce<Record<string, number>>((result, entry) => { result[entry[field]] = (result[entry[field]] ?? 0) + 1; return result; }, {})).sort((a, b) => b[1] - a[1]);
  const report = [
    "VOCALLY — PRE-VISIT SPEECH SUMMARY", `Generated: ${new Date().toLocaleDateString()}`, `Patient: ${profile.childName || "Not provided"}`, `Age: ${profile.age ?? "Not provided"}`,
    "", "SOURCE AND SCOPE", "Patient/caregiver-reported observations. Not a diagnosis, confirmed cause, or clinician assessment. This report does not send a referral.",
    "", "PATIENT-REPORTED GOALS AND CONTEXT", `Goals: ${profile.practiceGoals?.join(", ") || "Not provided"}`, `Practice sound: ${profile.targetPhoneme || "Not provided"}`, `Context: ${profile.needsDescription || "Not provided"}`,
    "", `OBSERVATIONS (${entries.length} entries)`, "Counts describe logged entries, not the frequency or severity of a speech disorder.",
    ...counts("pattern").map(([label, count]) => `${label}: ${count} entries`),
    "", "SITUATIONS", ...(entries.length ? counts("situation").map(([label, count]) => `${label}: ${count} entries`) : ["No situations recorded."]),
    "", "DAILY-LIFE IMPACT", ...impacts.map(label => `${label}: ${entries.filter(entry => entry.impact === label).length} entries`),
    "", "DATED OBSERVATIONS", ...(entries.length ? entries.flatMap(entry => [`${entry.date} | ${entry.pattern}`, `Sounds/words: ${entry.sounds || "Not specified"}`, `Situation: ${entry.situation}`, `Impact: ${entry.impact}`, `Details: ${entry.notes || "Not provided"}`, ""]) : ["No observations recorded yet."]),
    "", "FOR DISCUSSION WITH THE CLINICIAN", "Review speech samples, onset and progression, languages/dialects, hearing and medical history, and the patient's communication goals. Causes have not been assessed by this app.",
  ].join("\n");
  function download() {
    const url = URL.createObjectURL(new Blob([report], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `vocally-pre-visit-report-${dateToday()}.txt`; document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="speech-analytics" aria-labelledby="analytics-title">
    <div className="section-heading"><h2 id="analytics-title">Speech analytics</h2><span>Your experiences, in your own words.</span></div>
    <p className="note">Track patterns, situations, and everyday impact. All entries here are self-reported and saved in this browser for this name and age.</p>
    <div className="analytics-summary">
      <article className="panel"><span className="eyebrow">SPEECH PATTERNS</span><h3>{entries.length} observations</h3>{counts("pattern").length ? <ul>{counts("pattern").map(([label, count]) => <li key={label}><span>{label}</span><strong>{count}</strong></li>)}</ul> : <p>Log a pattern or a sound you noticed.</p>}</article>
      <article className="panel"><span className="eyebrow">SITUATIONS</span><h3>Where it happens</h3>{counts("situation").length ? <ul>{counts("situation").map(([label, count]) => <li key={label}><span>{label}</span><strong>{count}</strong></li>)}</ul> : <p>Notice what speaking feels like in different settings.</p>}</article>
      <article className="panel"><span className="eyebrow">DAILY-LIFE IMPACT</span><h3>Your participation</h3>{entries.length ? <ul>{impacts.map(label => <li key={label}><span>{label}</span><strong>{entries.filter(entry => entry.impact === label).length}</strong></li>)}</ul> : <p>Record how communication affects the things you want to do.</p>}</article>
    </div>
    <p className="note">Counts reflect journal entries, not a clinical severity score.</p>
    <details className="panel analytics-entry"><summary>Add an observation <span aria-hidden="true">＋</span></summary><form onSubmit={event => {
      event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const get = (name: string) => String(data.get(name) ?? "").trim();
      if (!get("situation")) return;
      save([{ id: crypto.randomUUID(), date: get("date"), pattern: get("pattern"), sounds: get("sounds"), situation: get("situation"), impact: get("impact"), notes: get("notes") }, ...entries].sort((a, b) => b.date.localeCompare(a.date))); form.reset();
    }}>
      <div className="analytics-fields">
        <label>Date<input name="date" type="date" defaultValue={dateToday()} max={dateToday()} required /></label>
        <label>Speech pattern<select name="pattern">{patterns.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Specific sounds or words <small>(optional)</small><input name="sounds" placeholder="e.g., ‘s’ in ‘school’" maxLength={200} /></label>
        <label>Situation<input name="situation" list="speech-situations" placeholder="Choose or describe a situation" maxLength={120} pattern=".*\S.*" required /><datalist id="speech-situations">{["Conversation with friends", "Classroom", "Work meeting", "Phone call", "Reading aloud", "Ordering food", "Practice session"].map(value => <option key={value} value={value} />)}</datalist></label>
        <label>Impact on participation<select name="impact">{impacts.map(value => <option key={value}>{value}</option>)}</select></label>
        <label className="analytics-notes">What happened, and what would you like to feel easier? <small>(optional)</small><textarea name="notes" rows={3} maxLength={1000} placeholder="e.g., I skipped asking a question in class. I’d like to feel comfortable joining in." /></label>
      </div><button className="primary" type="submit">Save observation ↗</button>
    </form></details>
    <p role="status" className="note">{notice}</p>
    {entries.length > 0 && <details className="panel analytics-history"><summary>Observation history · {entries.length}</summary>{entries.map(entry => <article key={entry.id}><div><span className="note">{entry.date} · Self-reported</span><h4>{entry.pattern}{entry.sounds && ` — ${entry.sounds}`}</h4><p>{entry.situation} · {entry.impact}</p>{entry.notes && <p>{entry.notes}</p>}</div><button type="button" aria-label={`Delete observation from ${entry.date}: ${entry.pattern}`} onClick={() => save(entries.filter(item => item.id !== entry.id))}>Delete</button></article>)}</details>}
    <dialog ref={dialog} className="speech-report-dialog" aria-labelledby="report-title" onClose={onReportClose}><div className="detail-top"><span className="detail-brand">vocally</span><button className="close" aria-label="Close report" onClick={() => dialog.current?.close()}>✕</button></div><h2 id="report-title">Your pre-visit report</h2><p>Review your summary, then download it to share with your physician or SLP. Nothing is sent automatically.</p><button type="button" className="primary" onClick={download}>Download report ↓</button><pre>{report}</pre></dialog>
  </section>;
}

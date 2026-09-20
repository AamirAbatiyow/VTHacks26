import { useEffect, useRef } from "react";
import type { SessionConfig } from "@shared/events";
import type { PracticeSession } from "../progress/practiceHistory";
import { buildPracticeReport } from "../progress/report";

export function PracticeReport({ profile, sessions, open, onClose }: {
  profile: SessionConfig; sessions: PracticeSession[]; open: boolean; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const report = buildPracticeReport(profile, sessions);
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close(); }, [open]);
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
    <button className="primary" onClick={download}>Download report ↓</button>
    <pre>{report}</pre>
  </dialog>;
}

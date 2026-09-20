import type { SessionSummary } from "@shared/sessionSummary";
export type PracticeSession = SessionSummary;

const modes = ["default", "friendly", "informative", "critical", "conversation", "business"];
const key = (name: string) => `vocally-practice-history-v2:${encodeURIComponent(name.trim().toLowerCase())}`;

export function isPracticeSession(s: unknown): s is PracticeSession {
  if (!s || typeof s !== "object") return false;
  const value = s as PracticeSession;
  if (typeof value.id !== "string" || typeof value.startedAt !== "string" || !Number.isFinite(Date.parse(value.startedAt)) ||
    !Number.isFinite(value.seconds) || value.seconds < 0 || !Number.isInteger(value.turns) || value.turns < 0 || !modes.includes(value.mode)) return false;
  const a = value.analysis;
  return a === undefined || (a !== null && Number.isInteger(a.analyzedTurns) && a.analyzedTurns >= 0 && a.analyzedTurns <= value.turns &&
    Number.isInteger(a.flaggedTurns) && a.flaggedTurns >= 0 && a.flaggedTurns <= a.analyzedTurns &&
    a.categories !== null && typeof a.categories === "object" && Object.values(a.categories).every(n => Number.isInteger(n) && n >= 0 && n <= a.analyzedTurns));
}

export function readPracticeHistory(name: string): PracticeSession[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(key(name)) ?? "[]");
    if (!Array.isArray(data)) return [];
    return data.filter(isPracticeSession);
  } catch { return []; }
}

export function savePracticeHistory(name: string, sessions: PracticeSession[]): boolean {
  try { localStorage.setItem(key(name), JSON.stringify(sessions)); return true; }
  catch { return false; }
}

export function addPracticeSession(history: PracticeSession[], session: PracticeSession): PracticeSession[] {
  return [session, ...history.filter(item => item.id !== session.id)]
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

export function localDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function practiceWeek(sessions: PracticeSession[], now = new Date()) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now);
    date.setDate(date.getDate() - 6 + index);
    const key = localDay(date);
    const entries = sessions.filter(session => localDay(new Date(session.startedAt)) === key);
    return { key, date, seconds: entries.reduce((total, session) => total + session.seconds, 0), count: entries.length };
  });
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return seconds > 0 ? "<1 min" : "0 min";
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

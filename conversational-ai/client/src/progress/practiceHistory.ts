import type { ConversationMode } from "@shared/events";

export type PracticeSession = {
  id: string;
  startedAt: string;
  seconds: number;
  turns: number;
  mode: ConversationMode;
};
const modes = ["default", "friendly", "informative", "critical", "conversation", "business"];
const key = (name: string) => `vocally-practice-history-v2:${encodeURIComponent(name.trim().toLowerCase())}`;

export function readPracticeHistory(name: string): PracticeSession[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(key(name)) ?? "[]");
    if (!Array.isArray(data)) return [];
    return data.filter((s): s is PracticeSession => s && typeof s.id === "string" &&
      typeof s.startedAt === "string" && Number.isFinite(Date.parse(s.startedAt)) &&
      Number.isFinite(s.seconds) && s.seconds >= 0 && Number.isInteger(s.turns) && s.turns >= 0 && modes.includes(s.mode));
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

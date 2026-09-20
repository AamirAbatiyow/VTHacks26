import { ANALYSIS_LABELS, ANALYSIS_NAMES } from "@shared/sessionSummary";
import type { PracticeSession } from "./practiceHistory";

/**
 * Deterministic SSI-4-informed frequency metrics, computed here in plain
 * TypeScript — never by an LLM — from the real per-turn classifier flags
 * already attached to each PracticeSession by the server.
 *
 * SSI-4 (Stuttering Severity Instrument, 4th ed.) scores four components:
 *   1. Frequency — % of syllables/words stuttered. THIS is what we compute.
 *   2. Duration — length of the 3 longest disfluencies. Not available: the
 *      classifier's per-window timestamps aren't carried into SessionSummary.
 *   3. Physical concomitants — requires visual observation. Not measurable
 *      from audio alone.
 *   4. Naturalness — a clinician's subjective 9-point judgment.
 * Only (1) is reported, and only as a partial, classifier-derived proxy for
 * a real clinician-scored SSI-4 frequency — never as a diagnosis.
 */

export interface SessionFrequency {
  sessionId: string;
  date: string;
  words: number;
  flagCount: number;
  /** (flags / words) * 100, or null when there's no word denominator yet. */
  frequencyPercent: number | null;
  byCategory: Record<string, number>;
}

export interface FrequencySummary {
  sessionCount: number;
  analyzedSessionCount: number;
  totalWords: number;
  totalFlags: number;
  overallFrequencyPercent: number | null;
  trend: {
    earlierAvgPercent: number | null;
    laterAvgPercent: number | null;
    direction: "improving" | "worsening" | "flat" | "insufficient_data";
  };
  totalsByCategory: Record<string, number>;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function computeSessionFrequency(session: PracticeSession): SessionFrequency {
  const a = session.analysis;
  const byCategory = Object.fromEntries(ANALYSIS_LABELS.map(label => [label, a?.categories[label] ?? 0]));
  const flagCount = Object.values(byCategory).reduce((sum, n) => sum + n, 0);
  const words = a?.words ?? 0;
  return {
    sessionId: session.id,
    date: session.startedAt,
    words,
    flagCount,
    frequencyPercent: words > 0 ? round1((flagCount / words) * 100) : null,
    byCategory,
  };
}

/** `sessions` may be in any order; sorted oldest-first internally for trend computation. */
export function computeFrequencySummary(sessions: PracticeSession[]): { sessions: SessionFrequency[]; summary: FrequencySummary } {
  const rows = sessions
    .map(computeSessionFrequency)
    .sort((a, b) => a.date.localeCompare(b.date));

  const analyzed = rows.filter(r => r.frequencyPercent !== null);
  const totalWords = rows.reduce((sum, r) => sum + r.words, 0);
  const totalFlags = rows.reduce((sum, r) => sum + r.flagCount, 0);
  const totalsByCategory = Object.fromEntries(ANALYSIS_LABELS.map(label => [label,
    rows.reduce((sum, r) => sum + (r.byCategory[label] ?? 0), 0)]));

  const half = Math.floor(analyzed.length / 2);
  const earlier = analyzed.slice(0, half);
  const later = analyzed.slice(analyzed.length - half);
  const avg = (arr: SessionFrequency[]): number | null =>
    arr.length ? round1(arr.reduce((sum, r) => sum + (r.frequencyPercent ?? 0), 0) / arr.length) : null;
  const earlierAvgPercent = half > 0 ? avg(earlier) : null;
  const laterAvgPercent = half > 0 ? avg(later) : null;

  let direction: FrequencySummary["trend"]["direction"] = "insufficient_data";
  if (earlierAvgPercent !== null && laterAvgPercent !== null) {
    const delta = laterAvgPercent - earlierAvgPercent;
    direction = Math.abs(delta) < 0.5 ? "flat" : delta < 0 ? "improving" : "worsening";
  }

  return {
    sessions: rows,
    summary: {
      sessionCount: rows.length,
      analyzedSessionCount: analyzed.length,
      totalWords,
      totalFlags,
      overallFrequencyPercent: totalWords > 0 ? round1((totalFlags / totalWords) * 100) : null,
      trend: { earlierAvgPercent, laterAvgPercent, direction },
      totalsByCategory,
    },
  };
}

export const CATEGORY_DISPLAY_NAMES = ANALYSIS_NAMES;

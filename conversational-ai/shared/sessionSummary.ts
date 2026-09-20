import type { ConversationMode, StutterAnalysis } from "./events.js";

export const ANALYSIS_LABELS = ["Prolongation", "Block", "SoundRep", "WordRep", "Interjection"] as const;
export const ANALYSIS_NAMES: Record<string, string> = {
  Prolongation: "Prolongations", Block: "Blocks", SoundRep: "Sound repetitions",
  WordRep: "Word repetitions", Interjection: "Interjections",
};
export interface SessionSummary {
  id: string;
  startedAt: string;
  seconds: number;
  turns: number;
  mode: ConversationMode;
  source?: "server" | "device";
  analysis?: {
    analyzedTurns: number;
    flaggedTurns: number;
    /** Number of utterances flagged per category, not individual event counts. */
    categories: Record<string, number>;
    /**
     * Words spoken across analyzed turns only (same denominator the flag
     * counts are drawn from) — lets a caller compute a frequency RATE
     * (flags per 100 words), rather than a raw, session-length-dependent
     * count. Optional so older cached summaries (before this field
     * existed) still validate; treat missing as "rate unavailable", not 0.
     */
    words?: number;
  };
}

/** Same tokenizer used server-side wherever a transcript's word count matters. */
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Keeps only IDs and aggregate model flags; never retains audio or transcripts. */
export class SessionSummaryCollector {
  private turns = new Set<string>();
  private turnWords = new Map<string, number>();
  private analyses = new Map<string, string[]>();
  constructor(readonly id: string, readonly startedAt: string, readonly mode: ConversationMode) {}
  /** `words` is the transcript word count for this turn (0 if not supplied). */
  addTurn(id: string, words = 0) { this.turns.add(id); this.turnWords.set(id, words); }
  addAnalysis(id: string, analysis: StutterAnalysis) {
    if (!this.turns.has(id) || !analysis.windows.length) return;
    this.analyses.set(id, ANALYSIS_LABELS.filter(label => analysis.events.some(event => event.label === label && event.detected)));
  }
  snapshot(seconds: number, source: "server" | "device"): SessionSummary {
    const categories = Object.fromEntries(ANALYSIS_LABELS.map(label => [label, 0]));
    let flaggedTurns = 0;
    let words = 0;
    for (const [id, labels] of this.analyses) {
      if (labels.length) flaggedTurns++;
      for (const label of labels) categories[label]++;
      words += this.turnWords.get(id) ?? 0;
    }
    return { id: this.id, startedAt: this.startedAt, mode: this.mode, seconds: Math.max(0, Math.round(seconds)),
      turns: this.turns.size, source, analysis: { analyzedTurns: this.analyses.size, flaggedTurns, categories, words } };
  }
}

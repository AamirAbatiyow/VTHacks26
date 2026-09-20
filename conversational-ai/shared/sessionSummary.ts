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
  };
}

/** Keeps only IDs and aggregate model flags; never retains audio or transcripts. */
export class SessionSummaryCollector {
  private turns = new Set<string>();
  private analyses = new Map<string, string[]>();
  constructor(readonly id: string, readonly startedAt: string, readonly mode: ConversationMode) {}
  addTurn(id: string) { this.turns.add(id); }
  addAnalysis(id: string, analysis: StutterAnalysis) {
    if (!this.turns.has(id) || !analysis.windows.length) return;
    this.analyses.set(id, ANALYSIS_LABELS.filter(label => analysis.events.some(event => event.label === label && event.detected)));
  }
  snapshot(seconds: number, source: "server" | "device"): SessionSummary {
    const categories = Object.fromEntries(ANALYSIS_LABELS.map(label => [label, 0]));
    let flaggedTurns = 0;
    for (const labels of this.analyses.values()) {
      if (labels.length) flaggedTurns++;
      for (const label of labels) categories[label]++;
    }
    return { id: this.id, startedAt: this.startedAt, mode: this.mode, seconds: Math.max(0, Math.round(seconds)),
      turns: this.turns.size, source, analysis: { analyzedTurns: this.analyses.size, flaggedTurns, categories } };
  }
}

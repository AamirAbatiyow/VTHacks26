import type { SessionConfig } from "@shared/events";
import { ANALYSIS_LABELS, ANALYSIS_NAMES } from "@shared/sessionSummary";
import { formatDuration, formatPracticeMode, type PracticeSession } from "./practiceHistory";
import { computeFrequencySummary } from "./frequency";

const TREND_TEXT: Record<string, string> = {
  improving: "trended downward (fewer detected flags per 100 words over time)",
  worsening: "trended upward (more detected flags per 100 words over time)",
  flat: "stayed roughly stable across sessions",
  insufficient_data: "not enough analyzed sessions yet to show a trend",
};

export function summarizeAnalysis(sessions: PracticeSession[]) {
  const categories = Object.fromEntries(ANALYSIS_LABELS.map(label => [label, 0]));
  let analyzed = 0, flagged = 0, turns = 0;
  for (const session of sessions) {
    turns += session.turns;
    analyzed += session.analysis?.analyzedTurns ?? 0;
    flagged += session.analysis?.flaggedTurns ?? 0;
    for (const label of ANALYSIS_LABELS) categories[label] += session.analysis?.categories[label] ?? 0;
  }
  return { categories, analyzed, flagged, turns };
}

export function buildPracticeReport(profile: SessionConfig, sessions: PracticeSession[], now = new Date(), narrative?: string): string {
  const analysis = summarizeAnalysis(sessions);
  const { sessions: freqRows, summary: freq } = computeFrequencySummary(sessions);
  return [
    "VOCALLY — PRACTICE & SPEECH SUMMARY",
    `Generated: ${now.toLocaleString()}`,
    `Name: ${profile.childName || "Not provided"}`,
    `Role: ${profile.userRole || "Not provided"}`,
    "", "PRACTICE SUMMARY",
    `Sessions: ${sessions.length}`,
    `Total session time: ${formatDuration(sessions.reduce((sum, session) => sum + session.seconds, 0))}`,
    `Speaking turns: ${analysis.turns}`,
    "", "AUDIO MODEL OBSERVATIONS",
    `Analysis coverage: ${analysis.analyzed} of ${analysis.turns} speaking turns`,
    ...(analysis.analyzed ? [
      `Turns with one or more model flags: ${analysis.flagged}`,
      ...ANALYSIS_LABELS.map(label => `${ANALYSIS_NAMES[label]}: ${analysis.categories[label]} utterances flagged`),
    ] : ["No audio-analysis results available. Missing analysis is not a zero or a fluent result."]),
    "Flags describe model predictions per utterance, not the number of repetitions or a clinical severity score. Categories can overlap. This is not a diagnosis.",

    "", "DETECTED FREQUENCY (SSI-4 frequency component only)",
    "This measures frequency only: detected stutter-type flags per 100 words spoken. Duration of disfluencies, physical concomitants, and speech naturalness — the other three components a clinician would score under the SSI-4 (Stuttering Severity Instrument) framework — are not assessed here, since those require direct clinician observation this app doesn't collect. The classifier's own accuracy is imperfect, so treat this as approximate signal, not ground truth.",
    freq.analyzedSessionCount === 0
      ? "No analyzed sessions yet."
      : `Overall: ${freq.overallFrequencyPercent === null ? "not yet available" : `${freq.overallFrequencyPercent} flags per 100 words`} across ${freq.analyzedSessionCount} analyzed session(s), ${freq.totalWords} words.`,
    ...(freq.analyzedSessionCount > 0 ? [`Trend: ${TREND_TEXT[freq.trend.direction]}`] : []),
    ...(freq.analyzedSessionCount > 0 ? ["Per-session frequency:", ...freqRows.filter(r => r.frequencyPercent !== null).map(r =>
      `  ${new Date(r.date).toLocaleDateString()} — ${r.frequencyPercent}% (${r.flagCount} flags / ${r.words} words)`)] : []),
    ...(narrative ? ["", "Narrative summary (written only from the numbers above):", narrative] : []),

    "", "SESSION HISTORY",
    ...(sessions.length ? sessions.map(session =>
      `${new Date(session.startedAt).toLocaleString()} | ${formatPracticeMode(session.mode)} | ${formatDuration(session.seconds)} | ${session.turns} speaking turns | ${session.analysis?.analyzedTurns ?? 0} analyzed | ${session.source === "server" ? "Backend summary" : "Device summary (backend confirmation unavailable)"}`
    ) : ["No completed sessions yet."]),
    "", "Only session totals and model flags are included; no audio or transcripts. Nothing is sent to a clinician automatically.",
  ].join("\n");
}

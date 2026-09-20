import type { GeminiClient } from "../services/gemini.js";

/**
 * Narrative prose for the practice report, written only over numbers the
 * client already computed deterministically (see client/src/progress/frequency.ts).
 * Gemini never receives raw session data and never computes or corrects a
 * number here — it is a writing step, not an analysis step. If it's
 * unavailable or produces nothing usable, `heuristicNarrative` below (plain
 * template, no AI) is always a complete, usable result on its own.
 */
export interface FrequencyNarrativeInput {
  name?: string | null;
  summary: {
    sessionCount: number;
    analyzedSessionCount: number;
    totalWords: number;
    totalFlags: number;
    overallFrequencyPercent: number | null;
    trend: { direction: "improving" | "worsening" | "flat" | "insufficient_data" };
    totalsByCategory: Record<string, number>;
  };
}

const SYSTEM = `You write the narrative paragraph of a short, honest, non-diagnostic practice
speech summary. You are given already-computed numbers: a frequency rate
(automatic-classifier-detected stutter-type flags per 100 words spoken),
per-category totals, and a trend direction. Rules:
- Never compute, recompute, estimate, or "correct" any number. Use exactly
  what you are given, in the units given.
- Never claim a diagnosis, a cause, or a clinical severity level.
- State plainly that this reflects an automatic speech classifier (not a
  clinician), that it measures frequency only — one of the four components
  of the SSI-4 instrument a clinician would normally score (duration,
  physical concomitants, and speech naturalness are not assessed here) —
  and that the classifier's own accuracy is imperfect, so counts are
  approximate signal, not ground truth.
- Keep it to 2-3 short sentences, plain language, second person.
- If session data is sparse or the trend is "insufficient_data", say so
  honestly instead of inventing a trend.
- Return plain prose only. No markdown, no headings, no JSON.`;

const TREND_TEXT: Record<FrequencyNarrativeInput["summary"]["trend"]["direction"], string> = {
  improving: "trended downward",
  worsening: "trended upward",
  flat: "stayed roughly stable",
  insufficient_data: "doesn't have enough analyzed sessions yet to show a trend",
};

export function heuristicNarrative(input: FrequencyNarrativeInput): string {
  const who = input.name?.trim() || "You";
  const { summary } = input;
  if (summary.analyzedSessionCount === 0) {
    const subject = who === "You" ? "You don't" : `${who} doesn't`;
    return `${subject} have any classifier-analyzed sessions yet. Once a practice session includes analyzed ` +
      `speech, this section will summarize the detected stuttering frequency (flags per 100 words) and how ` +
      `it changes across sessions.`;
  }
  const rateText = summary.overallFrequencyPercent === null
    ? "an undetermined rate"
    : `${summary.overallFrequencyPercent} flags per 100 words`;
  return `Across ${summary.analyzedSessionCount} analyzed session(s) and ${summary.totalWords} spoken words, ` +
    `the speech classifier detected stutter-type flags at ${rateText}. That rate has ${TREND_TEXT[summary.trend.direction]} ` +
    `across sessions. This reflects detected frequency only — one of the SSI-4 instrument's four components — ` +
    `and the classifier is not a clinician, so treat these counts as approximate.`;
}

export async function generateFrequencyNarrative(
  gemini: GeminiClient,
  input: FrequencyNarrativeInput,
): Promise<{ narrative: string; source: "gemini" | "template" }> {
  const fallback = heuristicNarrative(input);
  try {
    const raw = await gemini.generateText({
      systemInstruction: SYSTEM,
      contents: [{
        role: "user",
        parts: [{ text: `Numbers:\n${JSON.stringify(input, null, 2)}` }],
      }],
      maxOutputTokens: 300,
      temperature: 0.4,
    });
    const text = raw.trim();
    return text ? { narrative: text, source: "gemini" } : { narrative: fallback, source: "template" };
  } catch {
    return { narrative: fallback, source: "template" };
  }
}

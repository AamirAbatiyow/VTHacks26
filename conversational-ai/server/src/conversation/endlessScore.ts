import type { SpeechAnalysisMetadata } from "../../../shared/events.js";
import type { EndlessScore } from "../../../shared/sessionSummary.js";

const STOP = new Set([
  "a", "an", "the", "and", "or", "but", "if", "so", "to", "of", "in", "on", "at",
  "for", "with", "from", "is", "am", "are", "was", "were", "be", "been", "i", "you",
  "he", "she", "it", "we", "they", "me", "my", "your", "yeah", "yes", "yep", "no",
  "ok", "okay", "hi", "hey", "hello", "um", "uh", "like", "just", "that", "this",
  "there", "here", "do", "did", "have", "has", "had", "not", "too", "very",
]);

const PRAISE = [
  "Nice!",
  "Well said.",
  "Beautiful thought.",
  "That’s a full idea.",
  "Keep going.",
  "Lovely.",
  "Clear as a bell.",
  "That’s you talking.",
  "What a sentence.",
  "Yes — that landed.",
];

export function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z'\s]/g, " ").split(/\s+/).filter(Boolean);
}

export function contentWords(text: string): string[] {
  return tokenize(text).filter((word) => word.length >= 3 && !STOP.has(word));
}

export function looksLikeGoodSentence(text: string): boolean {
  const content = contentWords(text);
  const unique = new Set(content);
  return content.length >= 5 && unique.size >= 3;
}

export function nextPraise(previous?: string): string {
  const pool = PRAISE.filter((line) => line !== previous);
  return pool[Math.floor(Math.random() * pool.length)] ?? PRAISE[0]!;
}

export function hasStutterSignal(meta?: SpeechAnalysisMetadata): boolean {
  return Boolean(meta?.observations?.some((item) =>
    item !== null && typeof item === "object" && (item as { kind?: unknown }).kind === "stutter_event",
  ));
}

/**
 * Endless score, designed so long stretches of "yeah / ok / hi" cannot win.
 *
 *   C = tanh( Guiraud(content) · ln(1 + content/turn) · ln(1 + mean content length) / 4 )
 *   score = 80 · T^0.70 · ln(1 + seconds/18) · C^1.40
 *
 * Time and turn count only help when the language is actually doing work.
 */
export function scoreEndlessRun(turns: string[], durationMs: number): EndlessScore {
  const n = turns.length;
  const duration = Math.max(0, durationMs);
  if (n === 0) {
    return { total: 0, durationMs: duration, turns: 0, complexity: 0 };
  }
  const content = turns.flatMap(contentWords);
  const unique = new Set(content);
  const guiraud = unique.size / Math.sqrt(Math.max(content.length, 1));
  const meanLen = content.length ? content.reduce((sum, word) => sum + word.length, 0) / content.length : 0;
  const meanPerTurn = content.length / n;
  const raw = (guiraud * Math.log(1 + meanPerTurn) * Math.log(1 + meanLen)) / 4;
  const complexity = Math.tanh(Math.max(0, raw));
  const total = Math.round(
    80 * (n ** 0.7) * Math.log(1 + duration / 1000 / 18) * (complexity ** 1.4),
  );
  return {
    total: Math.max(0, total),
    durationMs: duration,
    turns: n,
    complexity: Number(complexity.toFixed(3)),
  };
}
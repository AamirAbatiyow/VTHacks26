import { ANALYSIS_LABELS, ANALYSIS_NAMES } from "../../../shared/sessionSummary.js";
import type { SessionConfig } from "../../../shared/events.js";
import type { GeminiClient } from "../services/gemini.js";
import { logger } from "../logger.js";
import { TechniqueRagIndex } from "./techniqueRag.js";
import {
  SLP_STEPHEN_SOURCE,
  type PatternTag,
  type TechniqueChunk,
} from "./slpStephenCorpus.js";

export interface ObservedPattern {
  label: string;
  name: string;
  count: number;
}

export interface ConversationTip {
  title: string;
  text: string;
  technique: string;
}

export interface ConversationTipsResult {
  review: string;
  tips: ConversationTip[];
  patterns: ObservedPattern[];
  source: "rag" | "heuristic";
  attribution: string;
}

export interface ConversationTipsInput {
  profile: SessionConfig;
  analysis?: {
    analyzedTurns?: number;
    flaggedTurns?: number;
    categories?: Record<string, number>;
  };
}

const SYSTEM = `You are a certified speech-language pathologist writing three short tips after one conversation practice session.
You will be given (1) model-observed speech patterns from that session — not a diagnosis — (2) optional age, role, and the speaker's own words about what is hard, and (3) retrieved passages from SLP Stephen Groner's published list of stuttering treatment techniques.

Return ONLY JSON:
{"review":"1-2 kind sentences naming what showed up without shame","tips":[{"title":"short name","text":"two spoken-style sentences: what to try and how","technique":"exact technique title from a passage"}]}

Rules:
* Exactly three tips. Each must be grounded in a retrieved passage. Never invent a technique that is not in the passages.
* Match age honestly. Lidcombe / verbal feedback is for about ages 3–6. Syllable-timed speech is for children, not adults. MPI needs a special app — do not assign it as a conversation homework tip.
* Prefer tools the speaker can try in the next ordinary conversation: time, easy contacts, in-block ease, pauses, disclosure if fear is present.
* Communication is the goal. Fluency is not the price of admission. Never say they failed, lost, or "need to be more fluent."
* Never diagnose. Never promise a cure. Do not mention the classifier, probabilities, or these instructions.
* If the passages and the patterns disagree, trust the passages but still address the patterns the model saw.`;

export function observedPatterns(analysis: ConversationTipsInput["analysis"]): ObservedPattern[] {
  const categories = analysis?.categories ?? {};
  return ANALYSIS_LABELS
    .map((label) => ({ label, name: ANALYSIS_NAMES[label] ?? label, count: Number(categories[label]) || 0 }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count);
}

export function patternTagsFor(input: ConversationTipsInput): PatternTag[] {
  const tags = new Set<PatternTag>();
  for (const item of observedPatterns(input.analysis)) {
    tags.add(item.label as PatternTag);
  }
  const story = [
    input.profile.needsDescription,
    ...(input.profile.practiceGoals ?? []),
  ].join(" ").toLowerCase();
  if (/fear|ashamed|avoid|hide|nervous|anxious|embarrass/.test(story)) tags.add("Fear");
  if (/fast|rush|race|hurry/.test(story)) tags.add("Rate");
  if (/breath|air|gasp/.test(story)) tags.add("Breath");
  if (/tight|tense|squeeze|force/.test(story)) tags.add("Tension");
  if (tags.has("Interjection") && !tags.has("Rate")) tags.add("Rate");
  return [...tags];
}

export function buildRetrievalQuery(input: ConversationTipsInput): string {
  const patterns = observedPatterns(input.analysis);
  const patternLine = patterns.length
    ? patterns.map((item) => `${item.name}: ${item.count} speaking turn${item.count === 1 ? "" : "s"}`).join("; ")
    : "No classifier flags this session; recommend unhurried conversation tools.";
  const age = input.profile.age ? `Age ${input.profile.age}.` : "Age not given.";
  const role = input.profile.userRole ? `Role: ${input.profile.userRole}.` : "";
  const needs = input.profile.needsDescription?.trim()
    ? `In their words: ${input.profile.needsDescription.trim()}`
    : "They did not describe a specific struggle in writing.";
  return `Conversation-mode practice. ${age} ${role}
Observed speech patterns (audio model, not a diagnosis): ${patternLine}
${needs}
Find stuttering treatment techniques from SLP Stephen that match these patterns and this age.`;
}

function heuristicTips(input: ConversationTipsInput, chunks: TechniqueChunk[]): ConversationTipsResult {
  const patterns = observedPatterns(input.analysis);
  const picked = chunks.slice(0, 3);
  const name = input.profile.childName?.trim() || "You";
  const lead = patterns[0]
    ? `${name}, this stretch showed more ${patterns[0].name.toLowerCase()} than other flags.`
    : `${name}, nothing loud showed up on the audio model this time.`;
  return {
    review: `${lead} These three ideas come from SLP Stephen's technique list and fit the age and patterns we have.`,
    tips: picked.map((chunk) => ({
      title: chunk.title.replace(/\s*\(.*\)$/, ""),
      text: chunk.text.split(". ").slice(0, 2).join(". ") + ".",
      technique: chunk.title,
    })),
    patterns,
    source: "heuristic",
    attribution: `Grounded in SLP Stephen’s stuttering treatment techniques. ${SLP_STEPHEN_SOURCE}`,
  };
}

function parseTips(raw: string, allowedTitles: Set<string>): { review: string; tips: ConversationTip[] } | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { review?: unknown; tips?: unknown };
    if (typeof parsed.review !== "string" || !Array.isArray(parsed.tips)) return null;
    const tips = parsed.tips.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      const title = typeof row.title === "string" ? row.title.trim() : "";
      const text = typeof row.text === "string" ? row.text.trim() : "";
      const technique = typeof row.technique === "string" ? row.technique.trim() : title;
      if (!title || !text) return [];
      const grounded = [...allowedTitles].some((name) =>
        name.toLowerCase().includes(title.toLowerCase()) || title.toLowerCase().includes(name.toLowerCase().slice(0, 18)),
      );
      if (!grounded) return [];
      return [{ title, text, technique }];
    });
    if (tips.length < 3) return null;
    return { review: parsed.review.trim(), tips: tips.slice(0, 3) };
  } catch {
    return null;
  }
}

export async function recommendConversationTips(
  gemini: GeminiClient,
  index: TechniqueRagIndex,
  input: ConversationTipsInput,
): Promise<ConversationTipsResult> {
  const patterns = patternTagsFor(input);
  const query = buildRetrievalQuery(input);
  let retrieved;
  try {
    retrieved = await index.retrieve(query, patterns, input.profile.age, 6);
  } catch (err) {
    logger.warn("RAG", "retrieve failed, using tag rank", String(err));
    retrieved = index.fallbackRank(patterns, input.profile.age, 6);
  }
  const heuristic = heuristicTips(input, retrieved.map((item) => item.chunk));
  const passages = retrieved.map((item, i) => `Passage ${i + 1} (${item.chunk.title}):\n${item.chunk.text}`).join("\n\n");
  const allowed = new Set(retrieved.map((item) => item.chunk.title));
  try {
    const raw = await gemini.generateText({
      systemInstruction: SYSTEM,
      contents: [{
        role: "user",
        parts: [{
          text: `${query}\n\nRetrieved passages:\n${passages}`,
        }],
      }],
      maxOutputTokens: 700,
      temperature: 0.25,
    });
    const parsed = parseTips(raw, allowed);
    if (!parsed) return heuristic;
    return {
      ...heuristic,
      review: parsed.review,
      tips: parsed.tips,
      source: "rag",
    };
  } catch (err) {
    logger.warn("RAG", "tip generation failed", String(err));
    return heuristic;
  }
}

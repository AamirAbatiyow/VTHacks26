import type { SessionConfig } from "../../../shared/events.js";
import type { GeminiClient } from "../services/gemini.js";
import {
  fallbackTechniques,
  getTechnique,
  techniqueCatalogForModel,
  type Technique,
} from "./techniques.js";

export interface ExerciseOption {
  id: string;
  name: string;
  summary: string;
  ages: string;
  reason: string;
}

export interface ExerciseRecommendation {
  review: string;
  options: ExerciseOption[];
}

const SYSTEM = `You are a certified speech-language pathologist writing a brief clinical review and choosing practice for one speaker.
You will be given their self-reported profile and a catalog of techniques drawn from established stuttering treatment: indirect preschool methods, stuttering modification, fluency shaping, and a few cognitive-behavioral supports.
You are not diagnosing. You are matching tools to what they described, the way a thoughtful SLP would after a first conversation.

Return ONLY JSON with this shape:
{"review":"2-4 spoken sentences about what they seem to be struggling with and why these three fit","ids":["id1","id2","id3"]}

Clinical matching rules:
* Pick exactly three ids from the catalog. Never invent an id. Prefer three different families when you can: one that buys time, one that reduces struggle, one that addresses fear or environment if that is present.
* Match age bands honestly. Preschool environmental methods (slowed speech, reduced demands, verbal feedback) for roughly ages 2-6, or for caregivers of young children. School-age modification and rate tools from about 6-12. Adolescent and adult motor work (gentle onset, light contacts, stretched syllable, longer voiced spans) from about 12 up.
* If they describe blocks or words getting stuck, prefer preparatory set, pull-out, cancellation, and gentle onset.
* If they describe repetitions or bouncing, prefer light bounces, voluntary stuttering, and reduced rate.
* If they describe fear, hiding, shame, interviews, or avoiding talking, prefer self-disclosure, eye contact, rewarding interaction, and voluntary stuttering.
* If they describe rushing or running out of air, prefer reduced rate, pauses and phrasing, and slowed-down speech.
* If they describe breath holding or gasping, prefer diaphragmatic breathing, pauses and phrasing, and gentle onset.
* If age is missing, prefer widely useful tools: reduced rate, pauses and phrasing, preparatory set.
* If they are a caregiver or educator, you may pick environmental tools even if the child is not the one speaking.
* review must be kind, specific to their words, non-diagnostic, and must not promise a cure or a fluency score.
* Do not include markdown, headings, or extra keys.`;

function toOptions(techniques: Technique[], reasons: string[] = []): ExerciseOption[] {
  return techniques.map((technique, index) => ({
    id: technique.id,
    name: technique.name,
    summary: technique.summary,
    ages: technique.ages,
    reason: reasons[index] || technique.suitedFor,
  }));
}

function parseIds(raw: string): string[] {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { ids?: unknown; review?: unknown };
    if (!Array.isArray(parsed.ids)) return [];
    return parsed.ids.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

function parseReview(raw: string, fallback: string): string {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return fallback;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { review?: unknown };
    return typeof parsed.review === "string" && parsed.review.trim() ? parsed.review.trim() : fallback;
  } catch {
    return fallback;
  }
}

export function heuristicRecommendation(config: SessionConfig): ExerciseRecommendation {
  const struggle = [config.needsDescription, ...(config.practiceGoals ?? [])].filter(Boolean).join(" ");
  const techniques = fallbackTechniques(config.age, struggle);
  const name = config.childName?.trim() || "You";
  const ageBit = config.age ? ` At about ${config.age}, ` : " ";
  const review = `${name},${ageBit}I would start with tools that buy time and lower struggle rather than chasing perfect fluency. These three match what you described and can be practiced out loud in a short session.`;
  return { review, options: toOptions(techniques) };
}

export async function recommendExercises(
  gemini: GeminiClient,
  config: SessionConfig,
): Promise<ExerciseRecommendation> {
  const fallback = heuristicRecommendation(config);
  const catalog = techniqueCatalogForModel();
  try {
    const raw = await gemini.generateText({
      systemInstruction: SYSTEM,
      contents: [{
        role: "user",
        parts: [{
          text: `Profile:\n${JSON.stringify({
            name: config.childName ?? null,
            role: config.userRole ?? null,
            age: config.age ?? null,
            interests: config.interests ?? [],
            practiceGoals: config.practiceGoals ?? [],
            needsDescription: config.needsDescription ?? "",
          })}\n\nCatalog:\n${JSON.stringify(catalog)}`,
        }],
      }],
      maxOutputTokens: 700,
      temperature: 0.3,
    });
    const ids = parseIds(raw);
    const techniques = ids.map((id) => getTechnique(id)).filter((item): item is Technique => Boolean(item));
    if (techniques.length < 3) return fallback;
    return {
      review: parseReview(raw, fallback.review),
      options: toOptions(techniques.slice(0, 3)),
    };
  } catch {
    return fallback;
  }
}

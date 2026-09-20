import {
  CONVERSATION_MODES,
  USER_ROLES,
  isSessionMinutes,
  type ConversationMode,
  type SessionConfig,
  type SessionMinutes,
  type UserRole,
} from "../../../shared/events.js";
import { isKnownTechniqueId } from "../conversation/techniques.js";

/** Validate browser-supplied profile data before connecting paid providers. */
export function parseSessionConfig(value: unknown): SessionConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Session configuration must be an object.");
  }

  const config = value as Record<string, unknown>;
  const optionalText = (key: string, maxLength?: number): string | undefined => {
    const text = config[key];
    if (text === undefined) return undefined;
    if (typeof text !== "string") {
      throw new Error(`${key} must be text.`);
    }
    if (maxLength !== undefined && text.length > maxLength) {
      throw new Error(`${key} must be ${maxLength} characters or fewer.`);
    }
    return text.trim() || undefined;
  };
  const optionalList = (
    key: string,
    maxItems?: number,
    maxItemLength?: number,
  ): string[] | undefined => {
    const items = config[key];
    if (items === undefined) return undefined;
    if (!Array.isArray(items) || items.some((item) => typeof item !== "string")) {
      throw new Error(`${key} must be a list of text values.`);
    }
    if (maxItems !== undefined && items.length > maxItems) {
      throw new Error(`${key} must contain ${maxItems} items or fewer.`);
    }
    if (maxItemLength !== undefined && items.some((item) => item.length > maxItemLength)) {
      throw new Error(`Each ${key} entry must be ${maxItemLength} characters or fewer.`);
    }
    return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
  };

  if (config.age !== undefined) {
    if (typeof config.age !== "number" || !Number.isFinite(config.age) || config.age < 2 || config.age > 120) {
      throw new Error("Age must be a number between 2 and 120.");
    }
  }

  const userRole = optionalText("userRole", 80);
  if (userRole !== undefined && !USER_ROLES.some((role) => role === userRole)) {
    throw new Error("Choose a supported role.");
  }

  const conversationMode = optionalText("conversationMode", 40);
  if (conversationMode !== undefined && !CONVERSATION_MODES.some((mode) => mode === conversationMode)) {
    throw new Error("Choose Conversation, Speech Exercises, or Endless.");
  }

  const exerciseTechnique = optionalText("exerciseTechnique", 80);
  if (exerciseTechnique !== undefined && !isKnownTechniqueId(exerciseTechnique)) {
    throw new Error("Choose a supported speech exercise.");
  }
  if (conversationMode === "exercises" && !exerciseTechnique) {
    throw new Error("Pick one of the three recommended exercises before starting.");
  }

  if (config.sessionMinutes !== undefined && !isSessionMinutes(config.sessionMinutes)) {
    throw new Error("Choose 2, 5, 10, or 15 minutes.");
  }

  return {
    childName: optionalText("childName"),
    userRole: userRole as UserRole | undefined,
    conversationMode: conversationMode as ConversationMode | undefined,
    exerciseTechnique,
    age: config.age as number | undefined,
    interests: optionalList("interests"),
    targetPhoneme: optionalText("targetPhoneme"),
    practiceGoals: optionalList("practiceGoals", 6, 100),
    needsDescription: optionalText("needsDescription", 1000),
    stutterModel: optionalText("stutterModel", 80),
    sessionMinutes: config.sessionMinutes as SessionMinutes | undefined,
  };
}

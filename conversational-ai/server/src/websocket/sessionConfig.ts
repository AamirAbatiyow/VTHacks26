import type { SessionConfig } from "../../../shared/events.js";

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

  if (config.age !== undefined && (typeof config.age !== "number" || !Number.isFinite(config.age))) {
    throw new Error("Age must be a number.");
  }

  return {
    childName: optionalText("childName"),
    age: config.age as number | undefined,
    interests: optionalList("interests"),
    targetPhoneme: optionalText("targetPhoneme"),
    practiceGoals: optionalList("practiceGoals", 6, 100),
    needsDescription: optionalText("needsDescription", 1000),
  };
}

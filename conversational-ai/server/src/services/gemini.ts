import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { logger } from "../logger.js";

/**
 * Gemini 3.x models think by default, which adds seconds of latency before the
 * first token. Minimal thinking is required for realtime conversation.
 */
const THINKING_CONFIG = {
  thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
};

export interface GeminiGenerateParams {
  systemInstruction: string;
  contents: Array<{
    role: "user" | "model";
    parts: Array<{ text: string }>;
  }>;
  abortSignal?: AbortSignal;
}

/**
 * Gemini streaming client using the current @google/genai SDK.
 * Model is resolved at startup (preference → list → fallback).
 */
export class GeminiClient {
  private ai: GoogleGenAI;
  private model: string;
  private readonly apiKey: string;
  private readonly preference: string;
  /** Models this key has proven it cannot use; never retried. */
  private readonly deadModels = new Set<string>();

  constructor(apiKey: string, model: string, preference = model) {
    this.ai = new GoogleGenAI({ apiKey });
    this.model = model;
    this.apiKey = apiKey;
    this.preference = preference;
  }

  getModel(): string {
    return this.model;
  }

  /**
   * Choose a conversational model from what the API actually exposes.
   *
   * Listing alone is not proof of access: retired models such as
   * gemini-2.5-flash stay in the list but return 404 for newer API keys.
   * Verifying here would cost a real request per candidate, and free-tier
   * quotas are as low as 5 requests/minute, so verification is deferred to
   * the first real generation (see recoverFromModelError).
   */
  static async resolveModel(
    apiKey: string,
    preference: string,
    exclude: ReadonlySet<string> = new Set(),
  ): Promise<string> {
    const ai = new GoogleGenAI({ apiKey });
    const preferred = preference.trim();

    const listed: string[] = [];
    try {
      const pager = await ai.models.list();
      for await (const m of pager) {
        if (m.name) listed.push(m.name.replace(/^models\//, ""));
      }
    } catch (err) {
      logger.warn("GEMINI", "models.list failed", String(err));
    }

    const candidates = [
      ...new Set([...PREFERRED_MODELS(preferred), ...discoverFlash(listed)]),
    ].filter((c) => c.length > 0 && !exclude.has(c));

    for (const candidate of candidates) {
      // If listing worked, only trust names the API actually returned.
      if (listed.length > 0 && !listed.includes(candidate)) continue;
      logger.info("GEMINI", `using model: ${candidate}`);
      return candidate;
    }

    logger.error("GEMINI", `no usable model found; falling back to ${preferred}`);
    return preferred;
  }

  /**
   * Called when a generation fails because the model is gone. Re-resolves
   * excluding every model already known to fail, so the server self-heals
   * when Google retires a model mid-run.
   */
  private async recoverFromModelError(): Promise<boolean> {
    this.deadModels.add(this.model);
    const next = await GeminiClient.resolveModel(
      this.apiKey,
      this.preference,
      this.deadModels,
    );
    if (next === this.model || this.deadModels.has(next)) return false;
    logger.warn("GEMINI", `switching model ${this.model} → ${next}`);
    this.model = next;
    return true;
  }

  async *generateStream(
    params: GeminiGenerateParams,
  ): AsyncGenerator<string, void, unknown> {
    let stream;
    try {
      stream = await this.openStream(params);
    } catch (err) {
      if (!isModelNotFound(err) || !(await this.recoverFromModelError())) {
        throw err;
      }
      stream = await this.openStream(params);
    }

    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) yield text;
    }
  }

  private openStream(params: GeminiGenerateParams) {
    return this.ai.models.generateContentStream({
      model: this.model,
      contents: params.contents,
      config: {
        systemInstruction: params.systemInstruction,
        abortSignal: params.abortSignal,
        temperature: 0.8,
        maxOutputTokens: 256,
        ...THINKING_CONFIG,
      },
    });
  }
}

/** Newest Flash tiers first; Flash-Lite trades a little quality for latency. */
const PREFERRED_MODELS = (preferred: string): string[] => [
  preferred,
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  "gemini-flash-lite-latest",
  "gemini-flash-latest",
];

function discoverFlash(listed: string[]): string[] {
  return listed.filter(
    (n) =>
      /flash/i.test(n) &&
      !/image|tts|live|audio|transcribe|omni|robotics/i.test(n),
  );
}

function isModelNotFound(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /"?code"?:\s*404|NOT_FOUND|no longer available/i.test(msg);
}

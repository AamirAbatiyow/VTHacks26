import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Copy .env.example to server/.env and fill in API keys.`,
    );
  }
  return value;
}

export interface AppConfig {
  databaseUrl?: string;
  port: number;
  geminiApiKey: string;
  elevenLabsApiKey: string;
  elevenLabsVoiceId: string;
  elevenLabsModelId: string;
  /** Preferred Gemini model; resolved further at runtime if unavailable. */
  geminiModelPreference: string;
  /** ONNX stutter classifier; detection is skipped if the file is absent. */
  stutterModelPath: string;
  /** Two-head binary gate; fluency falls back to the single-head model without it. */
  stutterGatePath: string;
}

export function loadConfig(): AppConfig {
  return {
    databaseUrl: process.env.DATABASE_URL?.trim() || undefined,
    port: Number(process.env.PORT ?? 3001),
    geminiApiKey: required("GEMINI_API_KEY"),
    elevenLabsApiKey: required("ELEVENLABS_API_KEY"),
    elevenLabsVoiceId: required("ELEVENLABS_VOICE_ID"),
    elevenLabsModelId: process.env.ELEVENLABS_MODEL_ID?.trim() || "eleven_flash_v2_5",
    geminiModelPreference:
      process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite",
    stutterModelPath:
      process.env.STUTTER_MODEL_PATH?.trim() ||
      path.resolve(__dirname, "../models/stutter.onnx"),
    stutterGatePath:
      process.env.STUTTER_GATE_PATH?.trim() ||
      path.resolve(__dirname, "../models/stutter_gate.onnx"),
  };
}

/**
 * One-shot: generate a short spoken greeting MP3 via ElevenLabs TTS
 * (not sound-generation). Skip if greeting.mp3 already exists and is > 1 KB.
 *
 *   npm run greeting:generate --workspace=@conversational-ai/server
 */
import { mkdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "..");
const projectRoot = path.dirname(serverRoot);
dotenv.config({ path: path.join(projectRoot, ".env"), quiet: true });
dotenv.config({ path: path.join(serverRoot, ".env"), quiet: true });

const OUT_DIR = path.join(projectRoot, "client/src/assets/sfx");
const OUT_FILE = "greeting.mp3";
const TEXT =
  "Hello. Take a comfortable breath. I'm here, and we can begin whenever you're ready.";

async function main(): Promise<void> {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is missing.");
  const voiceId =
    process.env.ELEVENLABS_VOICE_ID?.trim() || "pFZP5JQG7iQjIQuC4Bku";
  const modelId =
    process.env.ELEVENLABS_MODEL_ID?.trim() || "eleven_flash_v2_5";

  await mkdir(OUT_DIR, { recursive: true });
  const dest = path.join(OUT_DIR, OUT_FILE);
  try {
    const existing = await stat(dest);
    if (existing.size > 1000) {
      console.log(`Skipping ${OUT_FILE} (already ${existing.size} bytes)`);
      return;
    }
  } catch {
    /* generate */
  }

  process.stdout.write(`Generating ${OUT_FILE}… `);
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: TEXT,
      model_id: modelId,
      voice_settings: {
        stability: 0.55,
        similarity_boost: 0.7,
        style: 0.15,
        use_speaker_boost: true,
      },
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${response.status} ${detail.slice(0, 400)}`);
  }
  const audio = Buffer.from(await response.arrayBuffer());
  await writeFile(dest, audio);
  console.log(`${audio.length} bytes`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

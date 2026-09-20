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

const CLIPS = [
  {
    file: "pad-tap.mp3",
    duration: 0.55,
    text: "A single soft fingertip tap on a lily pad floating on a quiet pond, close and gentle, no music, no voice.",
  },
  {
    file: "pad-select.mp3",
    duration: 0.7,
    text: "A small water ripple after a lily pad is pressed, warm and wet, short, no music, no voice.",
  },
  {
    file: "whoosh.mp3",
    duration: 0.8,
    text: "A soft airy whoosh of wind over still water, welcoming and quiet, no music, no voice.",
  },
  {
    file: "step.mp3",
    duration: 0.5,
    text: "A tiny paper-soft tick, like turning a light page, very short UI click, no music.",
  },
  {
    file: "select.mp3",
    duration: 0.5,
    text: "A soft wooden click, muted and small, one UI selection, no music.",
  },
  {
    file: "begin.mp3",
    duration: 0.7,
    text: "A gentle high chime that dissolves into a drop of water, hopeful and short, no music, no voice.",
  },
  {
    file: "settle.mp3",
    duration: 0.9,
    text: "A warm low resolving tone, like a quiet bowl being set down, calm finish, no music, no voice.",
  },
  {
    file: "sparkle.mp3",
    duration: 0.5,
    text: "A very quiet bright water drip sparkle, tiny and sweet, no music, no voice.",
  },
] as const;

async function generate(clip: (typeof CLIPS)[number], apiKey: string): Promise<Buffer> {
  const url = "https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128";
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: clip.text,
      duration_seconds: clip.duration,
      prompt_influence: 0.55,
      model_id: "eleven_text_to_sound_v2",
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${clip.file}: ${response.status} ${detail.slice(0, 400)}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function main(): Promise<void> {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is missing.");
  await mkdir(OUT_DIR, { recursive: true });
  for (const clip of CLIPS) {
    const dest = path.join(OUT_DIR, clip.file);
    try {
      const existing = await stat(dest);
      if (existing.size > 800) {
        console.log(`Skipping ${clip.file} (already ${existing.size} bytes)`);
        continue;
      }
    } catch {
      /* generate */
    }
    process.stdout.write(`Generating ${clip.file}… `);
    const audio = await generate(clip, apiKey);
    await writeFile(dest, audio);
    console.log(`${audio.length} bytes`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

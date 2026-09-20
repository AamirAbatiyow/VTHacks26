/**
 * Manual check of the ONNX classifier wiring:
 *   npx tsx src/analysis/StutterClassifier.test.ts <model.onnx> <file.raw>...
 * Inputs are raw PCM16 LE mono @ 16 kHz, e.g.
 *   ffmpeg -i clip.wav -ac 1 -ar 16000 -f s16le clip.raw
 */
import fs from "node:fs";
import { StutterClassifier } from "./StutterClassifier.js";

const [modelPath, ...files] = process.argv.slice(2);
if (!modelPath || files.length === 0) {
  console.error("usage: tsx StutterClassifier.test.ts <model.onnx> <file.raw>...");
  process.exit(1);
}

const classifier = new StutterClassifier(modelPath);

for (const file of files) {
  const pcm = fs.readFileSync(file);
  const analysis = await classifier.classify(pcm, 16000);
  console.log(`\n=== ${file} (${(pcm.length / 2 / 16000).toFixed(2)}s) ===`);
  if (!analysis) {
    console.log("  no result (model missing or audio below silence gate)");
    continue;
  }
  console.log(
    `  windows=${analysis.windows.length} fluency=${analysis.fluency.toFixed(3)} ` +
      `inference=${analysis.inferenceMs}ms analyzed=${analysis.analyzedMs}ms`,
  );
  for (const e of analysis.events) {
    console.log(
      `    ${e.label.padEnd(14)} ${e.probability.toFixed(3)}${e.detected ? "  <-- detected" : ""}`,
    );
  }
  for (const w of analysis.windows) {
    console.log(`    window ${w.startMs}-${w.endMs}ms: [${w.scores.join(", ")}]`);
  }
}

// Silence must be gated out rather than scored.
const silence = Buffer.alloc(16000 * 2 * 3);
console.log("\nsilence ->", (await classifier.classify(silence, 16000)) === null ? "gated (null)" : "SCORED (unexpected)");

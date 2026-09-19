import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modelsDir = path.resolve(__dirname, "../../models");

/**
 * Every registered model MUST export to the same ONNX contract that
 * StutterClassifier.ts already assumes:
 *   input  "waveform" float32 [batch, clipSamples]  (clipSamples comes from
 *           the sidecar .json — the CNN uses 48000 = 3s @ 16kHz, vocametrix
 *           uses 64000 = 4s @ 16kHz, its native window; StutterClassifier.ts
 *           reads clipSamples generically so this can differ per model)
 *   output "logits"   float32 [batch, 6]             (sigmoid-able, same
 *           LABELS order as model.py: Prolongation, Block, SoundRep,
 *           WordRep, Interjection, Fluent)
 * plus a sidecar "<name>.json" with {labels, sampleRate, clipSamples,
 * thresholds}.
 *
 * The CNN (export_onnx.py) is naturally multi-label sigmoid. vocametrix
 * (export_onnx_vocametrix.py) is a single-label softmax classifier, so its
 * export bakes softmax -> inverse-sigmoid into the graph (logit = ln(p/(1-p)))
 * so sigmoid(logits) reproduces its softmax probabilities exactly — the
 * server never needs to know which activation a given model natively uses.
 * A two-head cascade model must similarly combine its gate + subclass heads
 * into a single final 6-vector at export time, NOT expose two separate
 * outputs — that's what lets the server treat every variant identically
 * with no runtime branching.
 */
export interface StutterModelDescriptor {
  id: string;
  /** Shown in a UI dropdown. */
  label: string;
  modelPath: string;
}

export const STUTTER_MODELS: StutterModelDescriptor[] = [
  {
    id: "cnn",
    label: "CNN — multi-label sigmoid (1.3M params)",
    modelPath: path.join(modelsDir, "stutter.onnx"),
  },
  {
    id: "vocametrix",
    label: "Vocametrix — wav2vec2-XLSR-53 (higher accuracy, higher latency)",
    modelPath: path.join(modelsDir, "stutter_vocametrix.onnx"),
  },
  {
    id: "cascade",
    label: "CNN — fluent-gate + subclass cascade",
    modelPath: path.join(modelsDir, "stutter_cascade.onnx"),
  },
  // Add new entries here as ml/stutter/export_onnx*.py produces new variants.
  // id is what the client sends in SessionConfig.stutterModel and what
  // STUTTER_MODEL selects by default; label is display-only. A model whose
  // .onnx/.json pair doesn't exist yet is safe to list: StutterClassifier
  // disables itself gracefully (see its load()) rather than crashing, so
  // "cascade" and "vocametrix" can be registered ahead of the file landing.
];

export const DEFAULT_STUTTER_MODEL_ID: string =
  process.env.STUTTER_MODEL?.trim() || STUTTER_MODELS[0].id;

export function isKnownStutterModelId(id: string): boolean {
  return STUTTER_MODELS.some((m) => m.id === id);
}

import path from "node:path";
import { serverRoot } from "../paths.js";

const modelsDir = path.join(serverRoot, "models");

/**
 * Every registered model MUST export to the same ONNX contract that
 * StutterClassifier.ts already assumes:
 *   input  "waveform" float32 [batch, clipSamples]  (clipSamples comes from
 *           the sidecar .json — the CNN uses 48000 = 3s @ 16kHz;
 *           StutterClassifier.ts reads clipSamples generically so this can
 *           differ per model)
 *   output "logits"   float32 [batch, 6]             (sigmoid-able, same
 *           LABELS order as model.py: Prolongation, Block, SoundRep,
 *           WordRep, Interjection, Fluent)
 * plus a sidecar "<name>.json" with {labels, sampleRate, clipSamples,
 * thresholds}. Extra outputs/fields (e.g. "gate", gateThreshold) are ignored
 * here and are fine to include. A model whose activation is natively softmax
 * should bake softmax -> inverse-sigmoid into its graph (logit = ln(p/(1-p)))
 * so the server never needs to know which activation a given model uses.
 *
 * The two-head model (ml/stutter/export_onnx_twohead.py) exports BOTH a
 * standalone-compatible "logits" output (registered below as "twohead") AND
 * a "gate" output. StutterClassifier.ts separately auto-loads a sibling
 * "<modelPath>_gate.onnx" file next to whichever model is active (by
 * filename convention, e.g. stutter.onnx -> stutter_gate.onnx) and blends
 * that gate's fluency call into the result. This means the CNN's fluency
 * score is quietly improved by the two-head gate whenever both files are
 * present, WITHOUT the two-head model needing its own registry entry — the
 * "twohead" entry below exists so it can also be selected and compared
 * head-to-head as a fully independent model, not because the CNN needs it
 * registered to use its gate.
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
    id: "twohead",
    label: "Two-head cascade — fluent-gate + subclass (standalone)",
    modelPath: path.join(modelsDir, "stutter_gate.onnx"),
  },
  // Add new entries here as ml/stutter/export_onnx*.py produces new variants.
  // id is what the client sends in SessionConfig.stutterModel and what
  // STUTTER_MODEL selects by default; label is display-only. A model whose
  // .onnx/.json pair doesn't exist yet is safe to list: StutterClassifier
  // disables itself gracefully (see its load()) rather than crashing.
];

export const DEFAULT_STUTTER_MODEL_ID = "cnn";

export function isKnownStutterModelId(id: string): boolean {
  return STUTTER_MODELS.some((m) => m.id === id);
}

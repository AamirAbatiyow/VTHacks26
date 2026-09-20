import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import * as ort from "onnxruntime-node";

import { logger } from "../logger.js";
import type {
  StutterAnalysis,
  StutterEventScore,
  StutterWindow,
} from "../../../shared/events.js";
import {
  isLiveStutterLabel,
  type AnalyzeInput,
  type SpeechAnalysisResult,
  type SpeechAnalyzer,
} from "./SpeechAnalyzer.js";

interface ModelMeta {
  labels: string[];
  sampleRate: number;
  clipSamples: number;
  thresholds: Record<string, number>;
}

interface GateMeta extends ModelMeta {
  gateThreshold: number;
}

/** Below this RMS a window is treated as silence and skipped entirely. */
const SILENCE_RMS = 0.003;
/** Guard against pathologically long utterances producing huge batches. */
const MAX_WINDOWS = 24;
const DEFAULT_THRESHOLD = 0.5;

/**
 * Multi-label stutter event classifier (SEP-28k).
 *
 * Runs on the ORIGINAL microphone PCM, never on the transcript. The ONNX graph
 * contains its own log-mel frontend, so all we hand it is float32 samples.
 * If the model file is absent the classifier stays disabled and the rest of the
 * pipeline is unaffected.
 *
 * Two models, each used where it benchmarks better (see ml/stutter/README.md):
 * per-type scores come from the single-head model, while the overall fluency
 * score comes from the two-head model's binary gate, which is significantly
 * better at the "is this disfluent at all" call (AUC 0.815 vs 0.798, p=0.001).
 * The gate is optional — without it fluency falls back to the single-head
 * model's own Fluent output.
 */
export class StutterClassifier implements SpeechAnalyzer {
  private session: ort.InferenceSession | null = null;
  private meta: ModelMeta | null = null;
  private gateSession: ort.InferenceSession | null = null;
  private gateMeta: GateMeta | null = null;
  private loading: Promise<void> | null = null;
  private failed = false;

  constructor(
    private readonly modelPath: string,
    private readonly gatePath = modelPath.replace(/\.onnx$/, "_gate.onnx"),
  ) {}

  get enabled(): boolean {
    return !this.failed;
  }

  private async load(): Promise<void> {
    if (this.session || this.failed) return;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      const metaPath = this.modelPath.replace(/\.onnx$/, ".json");
      if (!fs.existsSync(this.modelPath) || !fs.existsSync(metaPath)) {
        logger.warn(
          "ANALYSIS",
          `stutter model not found at ${path.resolve(this.modelPath)} — detection disabled. ` +
            `Train it with ml/stutter (see ml/stutter/README.md).`,
        );
        this.failed = true;
        return;
      }
      try {
        this.meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as ModelMeta;
        this.session = await ort.InferenceSession.create(this.modelPath, {
          executionProviders: ["cpu"],
          graphOptimizationLevel: "all",
        });
        logger.info(
          "ANALYSIS",
          `stutter model loaded: ${this.meta.labels.join(", ")} @ ${this.meta.sampleRate}Hz`,
        );
      } catch (err) {
        logger.warn("ANALYSIS", `failed to load stutter model: ${String(err)}`);
        this.failed = true;
        return;
      }
      await this.loadGate();
    })();

    return this.loading;
  }

  /** The gate is a bonus, not a requirement: any failure just leaves it off. */
  private async loadGate(): Promise<void> {
    const metaPath = this.gatePath.replace(/\.onnx$/, ".json");
    if (!fs.existsSync(this.gatePath) || !fs.existsSync(metaPath)) {
      logger.info(
        "ANALYSIS",
        "two-head gate not found — fluency falls back to the single-head Fluent output",
      );
      return;
    }
    try {
      this.gateMeta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as GateMeta;
      this.gateSession = await ort.InferenceSession.create(this.gatePath, {
        executionProviders: ["cpu"],
        graphOptimizationLevel: "all",
      });
      logger.info(
        "ANALYSIS",
        `two-head gate loaded — fluency from binary head (threshold ${this.gateMeta.gateThreshold})`,
      );
    } catch (err) {
      logger.warn("ANALYSIS", `failed to load stutter gate: ${String(err)}`);
      this.gateSession = null;
      this.gateMeta = null;
    }
  }

  async classify(
    pcm16: Buffer,
    sampleRate: number,
  ): Promise<StutterAnalysis | null> {
    await this.load();
    if (!this.session || !this.meta) return null;

    const { clipSamples, labels } = this.meta;
    let samples = pcm16ToFloat32(pcm16);
    if (sampleRate !== this.meta.sampleRate) {
      samples = resampleLinear(samples, sampleRate, this.meta.sampleRate);
    }
    if (samples.length === 0) return null;

    const starts = windowStarts(samples.length, clipSamples);
    const kept: number[] = [];
    const batch: Float32Array[] = [];
    for (const start of starts) {
      const win = slicePadded(samples, start, clipSamples);
      if (rms(win) < SILENCE_RMS) continue;
      kept.push(start);
      batch.push(win);
      if (batch.length >= MAX_WINDOWS) break;
    }
    if (batch.length === 0) return null;

    const flat = new Float32Array(batch.length * clipSamples);
    batch.forEach((w, i) => flat.set(w, i * clipSamples));

    // The gate only shares the batch if it was trained on the same geometry.
    const useGate =
      this.gateSession !== null &&
      this.gateMeta !== null &&
      this.gateMeta.clipSamples === clipSamples &&
      this.gateMeta.sampleRate === this.meta.sampleRate;

    const shape = [batch.length, clipSamples];
    const t0 = performance.now();
    const [output, gateOutput] = await Promise.all([
      this.session.run({ waveform: new ort.Tensor("float32", flat, shape) }),
      useGate
        ? this.gateSession!.run({ waveform: new ort.Tensor("float32", flat, shape) })
        : Promise.resolve(null),
    ]);
    const inferenceMs = performance.now() - t0;

    const logits = output.logits.data as Float32Array;
    const nLabels = labels.length;
    const msPerSample = 1000 / this.meta.sampleRate;

    const windows: StutterWindow[] = kept.map((start, i) => ({
      startMs: Math.round(start * msPerSample),
      endMs: Math.round((start + clipSamples) * msPerSample),
      scores: Array.from({ length: nLabels }, (_, c) =>
        round3(sigmoid(logits[i * nLabels + c])),
      ),
    }));

    // Per-window gate agreement when the two-head model is available: a type
    // only counts in a window if that window is also above the any-stutter gate.
    const gateThreshold = this.gateMeta?.gateThreshold ?? 0.5;
    const gateProbs = gateOutput
      ? Array.from(gateOutput.gate.data as Float32Array, (x) => sigmoid(x))
      : null;

    // One noisy 3s slice should not flag a longer turn — require two agreeing
    // windows when the utterance covers more than one hop.
    const minHits = windows.length >= 2 ? 2 : 1;

    const events: StutterEventScore[] = labels.map((label, c) => {
      const threshold = this.meta!.thresholds[label] ?? DEFAULT_THRESHOLD;
      let hits = 0;
      let probability = 0;
      for (let i = 0; i < windows.length; i++) {
        const score = windows[i]!.scores[c]!;
        if (score > probability) probability = score;
        const typeOk = score >= threshold;
        const gateOk = gateProbs == null || (gateProbs[i] ?? 0) >= gateThreshold;
        if (typeOk && gateOk) hits += 1;
      }
      return {
        label,
        probability: round3(probability),
        detected: hits >= minHits,
      };
    });

    const fluency = gateOutput
      ? gateFluency(gateOutput.gate.data as Float32Array)
      : fluentFluency(windows, labels.indexOf("Fluent"));

    return {
      labels,
      events,
      windows,
      fluency,
      analyzedMs: Math.round(samples.length * msPerSample),
      inferenceMs: Math.round(inferenceMs),
    };
  }

  /** SpeechAnalyzer adapter so detected events can reach conversation context. */
  async analyze(input: AnalyzeInput): Promise<SpeechAnalysisResult> {
    const analysis = await this.classify(input.pcm16, input.sampleRate);
    if (!analysis) {
      return { targetPhoneme: input.targetPhoneme, observations: [] };
    }
    const detected = analysis.events.filter(
      (e) => e.detected && isLiveStutterLabel(e.label),
    );
    return {
      targetPhoneme: input.targetPhoneme,
      confidence: analysis.fluency,
      observations: detected.map((e) => ({
        kind: "stutter_event",
        label: e.label,
        probability: e.probability,
      })),
    };
  }
}

/** Fluency from the two-head gate: the average window is not disfluent. */
function gateFluency(gate: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < gate.length; i++) sum += sigmoid(gate[i]);
  return round3(1 - sum / gate.length);
}

/** Fallback when the gate is unavailable: the single-head Fluent output. */
function fluentFluency(windows: StutterWindow[], fluentIdx: number): number {
  if (fluentIdx < 0 || windows.length === 0) return 0;
  const sum = windows.reduce((a, w) => a + w.scores[fluentIdx], 0);
  return round3(sum / windows.length);
}

function pcm16ToFloat32(buf: Buffer): Float32Array {
  const n = Math.floor(buf.length / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(i * 2) / 32768;
  return out;
}

function windowStarts(total: number, clip: number): number[] {
  if (total <= clip) return [0];
  const hop = Math.floor(clip / 2);
  const starts: number[] = [];
  for (let s = 0; s + clip <= total; s += hop) starts.push(s);
  const last = starts[starts.length - 1];
  // Cover the tail so a stutter at the very end is not missed.
  if (last + clip < total) starts.push(total - clip);
  return starts;
}

function slicePadded(src: Float32Array, start: number, length: number): Float32Array {
  const out = new Float32Array(length);
  const end = Math.min(src.length, start + length);
  if (start < end) out.set(src.subarray(start, end), 0);
  return out;
}

function rms(x: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += x[i] * x[i];
  return Math.sqrt(sum / x.length);
}

function resampleLinear(x: Float32Array, from: number, to: number): Float32Array {
  const ratio = to / from;
  const n = Math.floor(x.length * ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const pos = i / ratio;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const a = x[i0] ?? 0;
    const b = x[i0 + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

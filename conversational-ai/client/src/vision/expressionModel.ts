import type { ExpressionResult } from './expressions';

interface ExpressionModel {
  load(): Promise<void>;
  detect(input: HTMLVideoElement): Promise<ExpressionResult>;
}
const base = 'https://cdn.jsdelivr.net/npm/@vladmandic/human@3.3.6/';
let modelPromise: Promise<ExpressionModel> | null = null;
// The bundled ESM build includes TensorFlow.js. Only detector + expression models are enabled.
export function loadExpressionModel(): Promise<ExpressionModel> {
  if (!modelPromise) {
    modelPromise = (async () => {
      const url = `${base}dist/human.esm.js`;
      const module = await import(/* @vite-ignore */ url);
      const Human = module.Human ?? module.default;
      if (typeof Human !== 'function') throw new Error('Expression model could not be loaded.');
      const model: ExpressionModel = new Human({
        backend: 'webgl', debug: false, async: false, warmup: 'none',
        modelBasePath: `${base}models/`, cacheModels: true, cacheSensitivity: 0,
        filter: { enabled: true, width: 320, return: false },
        face: {
          enabled: true,
          detector: { maxDetected: 2, minConfidence: 0.5, rotation: false, return: false, skipFrames: 0, skipTime: 0 },
          emotion: { enabled: true, minConfidence: 0, skipFrames: 0, skipTime: 0 },
          mesh: { enabled: false }, iris: { enabled: false }, attention: { enabled: false },
          description: { enabled: false }, antispoof: { enabled: false }, liveness: { enabled: false }, gear: { enabled: false },
        },
        body: { enabled: false }, hand: { enabled: false }, object: { enabled: false },
        gesture: { enabled: false }, segmentation: { enabled: false },
      });
      await model.load();
      return model;
    })().catch(error => { modelPromise = null; throw error; });
  }
  return modelPromise;
}
// Serialize inference across stop/restart and component remounts: Human has mutable state.
let pending: Promise<unknown> = Promise.resolve();
export function detectExpression(model: ExpressionModel, video: HTMLVideoElement, current: () => boolean) {
  const result = pending.then(() => current() ? model.detect(video) : null);
  pending = result.catch(() => undefined);
  return result;
}

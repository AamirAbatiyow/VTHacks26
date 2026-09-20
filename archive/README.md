# Pre-MVP archive

Preserved reference material; nothing here is imported, built, or served by the MVP.
The directory structure records each item's original location.

- `dashboard-concept/`: standalone dashboard prototype, superseded by the React dashboard.
- `conversational-ai/client/src/components/`: unused diagnostics/old controls, flower illustration, and the manual speech journal/report screen. The active report now uses backend session/model results.
- `conversational-ai/client/src/types/events.ts`: unused re-export of the shared protocol.
- `conversational-ai/server/src/analysis/StutterClassifier.test.ts`: old argument-driven CLI diagnostic; replaced by automated model tests in the active server suite.
- `stutter.py`: standalone Hugging Face experiment, superseded by the runtime ONNX classifier and maintained training/export tools.
- `ml/sep28k_analysis/`: exploratory dataset audit, figures, and source data. Its relative internal layout is preserved.
- `conversational-ai/client/DESIGN.md`: described a dashboard-first flow and components that no longer exist.
- `conversational-ai/server/src/analysis/signal1d.ts`: downsampled the mic waveform for a UI that was removed. `transcript_final` now carries only `durationMs`, which is all analytics needed.
- `ml/stutter/`: research and diagnostics that do not produce a shipped model.
  - `benchmark.py`, `analyze_benchmark.py`, `bench_memory.py`: A/B benchmark against a wav2vec2-XLSR-53 baseline (latency, footprint, accuracy, significance).
  - `compare_twohead.py`: paired head-to-head of the single-head and two-head models.
  - `vocametrix.py`, `eval_vocametrix.py`, `export_onnx_vocametrix.py`: an alternative wav2vec2 model that was never exported into `server/models/`.
  - `predict.py`, `decode_mp3.py`, `classify_clips.ts`: ad-hoc inference over a file or folder of clips.
  - `artifacts_twohead/`: benchmark outputs (`comparison.json`, `test_predictions.npz`), not model inputs.

Restore a file to its original path before running code that uses old relative imports. The archived Python needs `model.py` and `data.py` beside it, which stayed in `ml/stutter/`. Archived UI files are reference snapshots, not a second runnable application.

Retained outside this folder: production model files (`stutter.onnx`, `stutter_gate.onnx` and their sidecars) and the `ml/stutter/` chain that reproduces them — `model.py`, `model_twohead.py`, `data.py`, `prepare_data.py`, `train.py`, `train_twohead.py`, `export_onnx.py`, `export_onnx_twohead.py`, plus both checkpoints and their tuned thresholds. Also retained: audio samples, the active analytics test suite, and the existing analytics database. No user history or database records were removed.

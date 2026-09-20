"""Peak RSS for one model in an isolated process (run once per model)."""

import argparse
import json
import resource
import sys
import time

import numpy as np


def peak_rss_mb() -> float:
    # ru_maxrss is bytes on macOS, kilobytes on Linux.
    v = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return v / 1e6 if sys.platform == "darwin" else v / 1e3


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--which", choices=["cnn", "w2v2"], required=True)
    ap.add_argument("--model", default="../../conversational-ai/server/models/stutter.onnx")
    ap.add_argument("--iters", type=int, default=30)
    args = ap.parse_args()

    baseline = peak_rss_mb()
    from benchmark import OnnxCnn, Wav2Vec2Baseline

    import_rss = peak_rss_mb()
    t0 = time.perf_counter()
    m = OnnxCnn(args.model) if args.which == "cnn" else Wav2Vec2Baseline(device="cpu")
    load_s = time.perf_counter() - t0
    loaded_rss = peak_rss_mb()

    clip = (np.random.randn(1, 48000) * 0.05).astype(np.float32)
    for _ in range(args.iters):
        m.predict(clip)

    print(json.dumps({
        "which": args.which,
        "interpreter_mb": round(baseline, 1),
        "after_import_mb": round(import_rss, 1),
        "after_load_mb": round(loaded_rss, 1),
        "peak_rss_mb": round(peak_rss_mb(), 1),
        "model_only_mb": round(peak_rss_mb() - import_rss, 1),
        "load_seconds": round(load_s, 3),
        "disk_mb": round(m.disk_bytes / 1e6, 1),
    }))


if __name__ == "__main__":
    main()

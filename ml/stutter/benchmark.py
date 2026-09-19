"""
A/B benchmark: our SEP-28k CNN (ONNX) vs the wav2vec2-XLSR baseline in stutter.py.

Both models expose the same six classes, so they are compared on identical audio
from the held-out (episode-disjoint) SEP-28k test split.

  python benchmark.py accuracy --data <dir> --model <onnx> --out results/
  python benchmark.py latency  --data <dir> --model <onnx> --out results/
"""

import argparse
import json
import platform
import time
from pathlib import Path

import numpy as np

SAMPLE_RATE = 16000
HF_MODEL = "vocametrix/wav2vec2-xlsr-53-stuttering-classification"

# Our canonical class order (matches model.LABELS / stutter.json).
OURS = ["Prolongation", "Block", "SoundRep", "WordRep", "Interjection", "Fluent"]
# The baseline's id2label, mapped onto the same order.
HF_TO_OURS = {
    "prolongation": "Prolongation",
    "block": "Block",
    "Soundrepetition": "SoundRep",
    "Wordrepetition": "WordRep",
    "interjection": "Interjection",
    "fluent": "Fluent",
}


# --------------------------------------------------------------------------
# Model wrappers. Each exposes predict(batch_of_3s_clips) -> [N, 6] scores in
# our canonical class order.
# --------------------------------------------------------------------------

class OnnxCnn:
    name = "SEP-28k CNN (ONNX)"
    short = "cnn"

    def __init__(self, model_path: str):
        import onnxruntime as ort

        t0 = time.perf_counter()
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 0  # let ORT pick, same as the Node server
        self.sess = ort.InferenceSession(
            model_path, opts, providers=["CPUExecutionProvider"]
        )
        self.load_seconds = time.perf_counter() - t0
        meta = json.load(open(Path(model_path).with_suffix(".json")))
        self.labels = meta["labels"]
        self.thresholds = meta["thresholds"]
        self.clip = meta["clipSamples"]
        self.disk_bytes = Path(model_path).stat().st_size
        self.reorder = [self.labels.index(c) for c in OURS]

    def predict(self, clips: np.ndarray) -> np.ndarray:
        x = np.ascontiguousarray(clips[:, : self.clip], dtype=np.float32)
        logits = self.sess.run(["logits"], {"waveform": x})[0]
        probs = 1.0 / (1.0 + np.exp(-logits))   # multi-label sigmoid
        return probs[:, self.reorder]


class Wav2Vec2Baseline:
    """Mirrors stutter.py: 4 s chunks, zero-padded, softmax over 6 classes."""

    name = "wav2vec2-XLSR-53 (stutter.py)"
    short = "w2v2"
    CHUNK = int(4.0 * SAMPLE_RATE)

    def __init__(self, device="cpu"):
        import torch
        from transformers import AutoFeatureExtractor, AutoModelForAudioClassification

        self.torch = torch
        t0 = time.perf_counter()
        self.fe = AutoFeatureExtractor.from_pretrained(HF_MODEL)
        self.model = AutoModelForAudioClassification.from_pretrained(HF_MODEL)
        self.model.eval()
        self.device = device
        self.model.to(device)
        self.load_seconds = time.perf_counter() - t0

        id2label = self.model.config.id2label
        self.n_params = sum(p.numel() for p in self.model.parameters())
        self.disk_bytes = _hf_cache_bytes()
        # Column j of our output should come from this baseline logit index.
        self.reorder = [
            next(i for i, lab in id2label.items() if HF_TO_OURS[lab] == c)
            for c in OURS
        ]

    def predict(self, clips: np.ndarray) -> np.ndarray:
        torch = self.torch
        n = len(clips)
        padded = np.zeros((n, self.CHUNK), dtype=np.float32)
        padded[:, : clips.shape[1]] = clips[:, : self.CHUNK]
        inputs = self.fe(
            list(padded), sampling_rate=SAMPLE_RATE, return_tensors="pt", padding=True
        )
        inputs = {k: v.to(self.device) for k, v in inputs.items()}
        with torch.no_grad():
            logits = self.model(**inputs).logits
            probs = torch.softmax(logits, dim=-1).float().cpu().numpy()
        return probs[:, self.reorder]


def _hf_cache_bytes() -> int:
    from huggingface_hub import scan_cache_dir

    try:
        for repo in scan_cache_dir().repos:
            if repo.repo_id == HF_MODEL:
                return int(repo.size_on_disk)
    except Exception:
        pass
    return 0


# --------------------------------------------------------------------------
# Data
# --------------------------------------------------------------------------

def load_test_split(data_dir: str, limit: int | None):
    """The same episode-disjoint test split the model was evaluated on."""
    from data import POSITIVE_VOTES, clean_mask, load_corpus, split_by_episode

    clips, votes, episodes, aux = load_corpus(data_dir)
    keep = clean_mask(aux)
    split = split_by_episode(episodes, seed=0)
    idx = np.where(keep & (split == "test"))[0]
    if limit:
        rng = np.random.default_rng(0)
        idx = np.sort(rng.choice(idx, size=min(limit, len(idx)), replace=False))

    from model import LABELS as MODEL_LABELS
    order = [MODEL_LABELS.index(c) for c in OURS]
    y = (votes[idx][:, order] >= POSITIVE_VOTES).astype(int)
    return clips, idx, y, episodes[idx]


def batched_clips(clips, idx, start, size):
    rows = idx[start:start + size]
    return clips[rows].astype(np.float32) / 32768.0


# --------------------------------------------------------------------------
# Accuracy
# --------------------------------------------------------------------------

def run_accuracy(args):
    import psutil

    clips, idx, y, episodes = load_test_split(args.data, args.limit)
    print(f"test clips: {len(idx)}  episodes: {len(set(episodes.tolist()))}", flush=True)

    models = [OnnxCnn(args.model), Wav2Vec2Baseline(device=args.hf_device)]
    out = {"n_clips": int(len(idx)), "labels": OURS, "y_true": y.tolist(), "models": {}}

    for m in models:
        proc = psutil.Process()
        rss_before = proc.memory_info().rss
        probs, t0 = [], time.perf_counter()
        for s in range(0, len(idx), args.batch_size):
            probs.append(m.predict(batched_clips(clips, idx, s, args.batch_size)))
            done = min(s + args.batch_size, len(idx))
            if done % (args.batch_size * 20) == 0 or done == len(idx):
                print(f"  {m.short}: {done}/{len(idx)} "
                      f"({time.perf_counter()-t0:.0f}s)", flush=True)
        elapsed = time.perf_counter() - t0
        probs = np.concatenate(probs)
        out["models"][m.short] = {
            "name": m.name,
            "probs": probs.tolist(),
            "wall_seconds": elapsed,
            "load_seconds": m.load_seconds,
            "disk_bytes": m.disk_bytes,
            "n_params": getattr(m, "n_params", 1_314_000),
            "peak_rss_delta_mb": (proc.memory_info().rss - rss_before) / 1e6,
        }
        print(f"{m.name}: {elapsed:.1f}s total", flush=True)

    Path(args.out).mkdir(parents=True, exist_ok=True)
    json.dump(out, open(Path(args.out) / "accuracy_raw.json", "w"))
    print(f"\nwrote {Path(args.out)/'accuracy_raw.json'}")


# --------------------------------------------------------------------------
# Latency
# --------------------------------------------------------------------------

def run_latency(args):
    clips, idx, _, _ = load_test_split(args.data, args.trials)
    models = [OnnxCnn(args.model), Wav2Vec2Baseline(device="cpu")]
    out = {
        "trials": args.trials,
        "warmup": args.warmup,
        "batch_size": 1,
        "device": "cpu",
        "host": {
            "platform": platform.platform(),
            "processor": platform.processor() or platform.machine(),
        },
        "models": {},
    }

    for m in models:
        # Warm up: first calls pay allocator/graph costs that skew the tail.
        for i in range(args.warmup):
            m.predict(batched_clips(clips, idx, i % len(idx), 1))

        samples = []
        for i in range(args.trials):
            clip = batched_clips(clips, idx, i, 1)
            t0 = time.perf_counter()
            m.predict(clip)
            samples.append((time.perf_counter() - t0) * 1000.0)
            if (i + 1) % 50 == 0:
                print(f"  {m.short}: {i+1}/{args.trials}", flush=True)
        out["models"][m.short] = {"name": m.name, "samples_ms": samples}
        a = np.array(samples)
        print(f"{m.name}: mean={a.mean():.1f}ms p50={np.percentile(a,50):.1f} "
              f"p95={np.percentile(a,95):.1f}", flush=True)

    Path(args.out).mkdir(parents=True, exist_ok=True)
    json.dump(out, open(Path(args.out) / "latency_raw.json", "w"))
    print(f"\nwrote {Path(args.out)/'latency_raw.json'}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["accuracy", "latency"])
    ap.add_argument("--data", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--out", default="bench_results")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--batch-size", type=int, default=16)
    ap.add_argument("--trials", type=int, default=200)
    ap.add_argument("--warmup", type=int, default=10)
    ap.add_argument("--hf-device", default="cpu")
    args = ap.parse_args()
    (run_accuracy if args.mode == "accuracy" else run_latency)(args)


if __name__ == "__main__":
    main()

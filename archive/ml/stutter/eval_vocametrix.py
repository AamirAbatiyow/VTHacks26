"""
Evaluate vocametrix/wav2vec2-xlsr-53-stuttering-classification on the exact
same episode-disjoint test split train.py reports our own model's numbers on,
using the exact same metric code (train.evaluate), so the two tables in the
pitch deck are actually comparable instead of macro-F1-vs-weighted-F1.

Also times inference (model forward pass only, no disk I/O) so the latency
line in the pitch is measured on this machine, not copied off a model card.

    ../.venv/bin/python eval_vocametrix.py --data /path/to/sep28k_data
"""

import argparse
import time

import numpy as np
import torch

from data import N_ANNOTATORS, clean_mask, load_corpus, split_by_episode
from model import LABELS
from train import evaluate, fmt
from vocametrix import model as vocametrix_model, vocametrix_classify_array


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--seed", type=int, default=0)  # must match train.py's default
    ap.add_argument("--limit", type=int, default=None, help="cap clips per split for a quick smoke test")
    args = ap.parse_args()

    clips, votes, episodes, aux = load_corpus(args.data)
    keep = clean_mask(aux)
    split = split_by_episode(episodes, seed=args.seed)

    def run_split(name):
        idx = np.where(keep & (split == name))[0]
        if args.limit:
            idx = idx[: args.limit]

        probs = np.zeros((len(idx), len(LABELS)), dtype=np.float32)
        latencies_ms = []
        for row, i in enumerate(idx):
            wav = clips[i].astype(np.float32) / 32768.0
            t0 = time.perf_counter()
            probs[row] = vocametrix_classify_array(wav)
            latencies_ms.append((time.perf_counter() - t0) * 1000)
            if row % 200 == 0:
                print(f"  {name}: {row}/{len(idx)}", end="\r")

        targets = votes[idx] / N_ANNOTATORS
        print(f"\n  {name}: {len(idx)} clips, "
              f"latency mean={np.mean(latencies_ms):.1f}ms "
              f"p50={np.median(latencies_ms):.1f}ms p95={np.percentile(latencies_ms, 95):.1f}ms")
        return probs, targets, latencies_ms

    print("Running vocametrix on val split (to tune thresholds, same as train.py)...")
    val_probs, val_targets, _ = run_split("val")
    val_metrics, thresholds = evaluate(val_probs, val_targets)

    print("Running vocametrix on test split (held-out episodes)...")
    test_probs, test_targets, test_latencies = run_split("test")
    test_metrics, _ = evaluate(test_probs, test_targets, thresholds=thresholds)

    print("\nVOCAMETRIX — TEST (held-out episodes, thresholds tuned on val):")
    print(fmt(test_metrics))

    n_params = sum(p.numel() for p in vocametrix_model.parameters())
    print(f"\nparams: {n_params/1e6:.1f}M")
    print(f"latency (CPU, model forward only): mean={np.mean(test_latencies):.1f}ms "
          f"p50={np.median(test_latencies):.1f}ms p95={np.percentile(test_latencies, 95):.1f}ms "
          f"over {len(test_latencies)} clips")

    # Secondary, simpler number that's easier to put on a slide: fluent vs.
    # not-fluent accuracy, collapsing both models' outputs to binary. This
    # sidesteps the macro-vs-weighted F1 apples-to-oranges problem entirely.
    fluent_i = LABELS.index("Fluent")
    y_true_bin = (test_targets[:, fluent_i] < (2 / 3) - 1e-6).astype(int)  # 1 = not fluent
    thr = thresholds["Fluent"]
    y_pred_bin = (test_probs[:, fluent_i] < thr).astype(int)
    acc = (y_true_bin == y_pred_bin).mean()
    print(f"binary fluent-vs-not accuracy: {acc:.3f}  (n={len(y_true_bin)})")


if __name__ == "__main__":
    main()

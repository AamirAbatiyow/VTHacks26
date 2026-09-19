"""Train the multi-label stutter event classifier on the SEP-28k clip corpus."""

import argparse
import json
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from sklearn.metrics import average_precision_score, f1_score, roc_auc_score
from torch.utils.data import DataLoader

from data import (
    POSITIVE_VOTES,
    ClipDataset,
    clean_mask,
    load_corpus,
    split_by_episode,
)
from model import LABELS, StutterNet, spec_augment


def pick_device():
    if torch.backends.mps.is_available():
        return torch.device("mps")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


@torch.no_grad()
def predict(model, loader, device):
    model.eval()
    probs, targets = [], []
    for wav, y in loader:
        logits = model(wav.to(device))
        probs.append(torch.sigmoid(logits).float().cpu().numpy())
        targets.append(y.numpy())
    return np.concatenate(probs), np.concatenate(targets)


def evaluate(probs, vote_fracs, thresholds=None):
    """Binarize targets at >= POSITIVE_VOTES annotators and score per class."""
    y_true = (vote_fracs * 3 >= POSITIVE_VOTES - 1e-6).astype(int)
    out, tuned = {}, {}
    for i, name in enumerate(LABELS):
        t, p = y_true[:, i], probs[:, i]
        if t.sum() == 0 or t.sum() == len(t):
            continue
        if thresholds is None:
            grid = np.linspace(0.05, 0.95, 91)
            f1s = [f1_score(t, (p >= g).astype(int), zero_division=0) for g in grid]
            best = int(np.argmax(f1s))
            thr, f1 = float(grid[best]), float(f1s[best])
        else:
            thr = thresholds[name]
            f1 = f1_score(t, (p >= thr).astype(int), zero_division=0)
        tuned[name] = thr
        out[name] = {
            "auc": float(roc_auc_score(t, p)),
            "ap": float(average_precision_score(t, p)),
            "f1": float(f1),
            "threshold": thr,
            "support": int(t.sum()),
        }
    out["_macro"] = {
        k: float(np.mean([v[k] for n, v in out.items() if not n.startswith("_")]))
        for k in ("auc", "ap", "f1")
    }
    return out, tuned


def fmt(metrics):
    lines = []
    for name in LABELS:
        m = metrics.get(name)
        if m:
            lines.append(f"    {name:14s} auc={m['auc']:.3f} ap={m['ap']:.3f} "
                         f"f1={m['f1']:.3f} thr={m['threshold']:.2f} n={m['support']}")
    mac = metrics["_macro"]
    lines.append(f"    {'MACRO':14s} auc={mac['auc']:.3f} ap={mac['ap']:.3f} f1={mac['f1']:.3f}")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--out", default="artifacts")
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--batch-size", type=int, default=64)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--width", type=int, default=32)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--detach", action="store_true",
                    help="daemonize so training survives the launching shell")
    args = ap.parse_args()

    if args.detach:
        import os
        if os.fork() > 0:
            return
        os.setsid()
        if os.fork() > 0:
            os._exit(0)

    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    device = pick_device()

    clips, votes, episodes, aux = load_corpus(args.data)
    keep = clean_mask(aux)
    split = split_by_episode(episodes, seed=args.seed)
    idx = {s: np.where(keep & (split == s))[0] for s in ("train", "val", "test")}

    print(f"device={device}  clips={len(clips)}  usable={int(keep.sum())}")
    print(f"episodes: {len(set(episodes.tolist()))}  "
          f"train={len(idx['train'])} val={len(idx['val'])} test={len(idx['test'])}")
    binary = (votes >= POSITIVE_VOTES).astype(int)
    for i, name in enumerate(LABELS):
        print(f"  {name:14s} train_pos={int(binary[idx['train'], i].sum()):5d} "
              f"val_pos={int(binary[idx['val'], i].sum()):4d} test_pos={int(binary[idx['test'], i].sum()):4d}")

    loaders = {
        s: DataLoader(
            ClipDataset(clips, votes, idx[s], train=(s == "train")),
            batch_size=args.batch_size,
            shuffle=(s == "train"),
            num_workers=args.workers,
            drop_last=(s == "train"),
            persistent_workers=args.workers > 0,
        )
        for s in ("train", "val", "test")
    }

    model = StutterNet(width=args.width).to(device)
    n_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"trainable params: {n_params/1e6:.2f}M")

    # Rare events (SoundRep, Prolongation) get upweighted so the loss is not
    # dominated by the majority Fluent class.
    pos = binary[idx["train"]].sum(0).clip(min=1)
    neg = len(idx["train"]) - pos
    pos_weight = torch.tensor(np.clip(neg / pos, 1.0, 8.0), dtype=torch.float32, device=device)
    print("pos_weight:", {n: round(float(w), 2) for n, w in zip(LABELS, pos_weight)})

    criterion = nn.BCEWithLogitsLoss(pos_weight=pos_weight)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-2)
    sched = torch.optim.lr_scheduler.OneCycleLR(
        opt, max_lr=args.lr, epochs=args.epochs, steps_per_epoch=len(loaders["train"]), pct_start=0.25
    )

    best = {"ap": -1.0}
    for epoch in range(1, args.epochs + 1):
        model.train()
        t0, total, seen = time.time(), 0.0, 0
        for wav, y in loaders["train"]:
            wav, y = wav.to(device), y.to(device)
            feat = spec_augment(model.features(wav))
            loss = criterion(model.head(feat), y)
            opt.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            opt.step()
            sched.step()
            total += loss.item() * len(wav)
            seen += len(wav)

        probs, targets = predict(model, loaders["val"], device)
        metrics, thresholds = evaluate(probs, targets)
        macro_ap = metrics["_macro"]["ap"]
        print(f"epoch {epoch:3d}  loss={total/seen:.4f}  val_macro_ap={macro_ap:.4f}  "
              f"({time.time()-t0:.0f}s)", flush=True)
        if epoch % 5 == 0 or epoch == args.epochs:
            print(fmt(metrics), flush=True)

        if macro_ap > best["ap"]:
            best = {"ap": macro_ap, "epoch": epoch, "thresholds": thresholds}
            torch.save({"state_dict": model.state_dict(), "width": args.width,
                        "labels": LABELS}, out_dir / "stutter_net.pt")

    print(f"\nbest val macro AP={best['ap']:.4f} @ epoch {best['epoch']}")
    ckpt = torch.load(out_dir / "stutter_net.pt", map_location=device)
    model.load_state_dict(ckpt["state_dict"])

    probs, targets = predict(model, loaders["test"], device)
    test_metrics, _ = evaluate(probs, targets, thresholds=best["thresholds"])
    print("\nTEST (held-out episodes, thresholds tuned on val):")
    print(fmt(test_metrics))

    json.dump(
        {"labels": LABELS, "thresholds": best["thresholds"], "val_macro_ap": best["ap"],
         "best_epoch": best["epoch"], "test": test_metrics},
        open(out_dir / "metrics.json", "w"), indent=2,
    )
    print(f"\nsaved {out_dir/'stutter_net.pt'} and {out_dir/'metrics.json'}")


if __name__ == "__main__":
    main()

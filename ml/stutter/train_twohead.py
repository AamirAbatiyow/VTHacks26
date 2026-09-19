"""
Train the two-head cascade classifier.

Trunk, splits, seed, augmentation, schedule, and epoch count match train.py so
the comparison isolates the architecture change.

    python train_twohead.py --data <dir> --out artifacts_twohead --epochs 45
"""

import argparse
import json
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from sklearn.metrics import average_precision_score, f1_score, roc_auc_score
from torch.utils.data import DataLoader

from data import POSITIVE_VOTES, ClipDataset, clean_mask, load_corpus, split_by_episode
from model import LABELS, spec_augment
from model_twohead import TYPES, StutterNetTwoHead, conditional_bce

TYPE_IDX = [LABELS.index(c) for c in TYPES]
FLUENT_IDX = LABELS.index("Fluent")


def pick_device(pref: str) -> torch.device:
    if pref == "mps" and torch.backends.mps.is_available():
        return torch.device("mps")
    if pref == "cuda" and torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def split_targets(y_votes: torch.Tensor):
    """From vote fractions -> (soft type targets, soft stage-1 targets, hard mask).

    The soft any-stutter target is the max over stutter-type vote fractions,
    which is exactly consistent with the >=2-of-3 binarization used at eval.
    Fluent keeps its own annotated column rather than being derived.
    """
    y_type = y_votes[:, TYPE_IDX]
    y_any = y_type.max(dim=1).values
    y_stage1 = torch.stack([y_any, y_votes[:, FLUENT_IDX]], dim=1)
    mask = y_any >= (POSITIVE_VOTES / 3.0) - 1e-6
    return y_type, y_stage1, mask


@torch.no_grad()
def predict(model, loader, device):
    """Returns (stage-1 probs [N,2] = (any, fluent), P(type|any) [N,5], votes [N,6])."""
    model.eval()
    p_stage1, p_type, truth = [], [], []
    for wav, y in loader:
        b, t = model.heads(model.features(wav.to(device)))
        p_stage1.append(torch.sigmoid(b).float().cpu().numpy())
        p_type.append(torch.sigmoid(t).float().cpu().numpy())
        truth.append(y.numpy())
    return np.concatenate(p_stage1), np.concatenate(p_type), np.concatenate(truth)


def evaluate(p_stage1, p_type, votes, thresholds=None):
    """Score the cascade. Per-class probability is P(any) * P(type|any)."""
    y = (votes * 3 >= POSITIVE_VOTES - 1e-6).astype(int)
    y_any = y[:, TYPE_IDX].max(axis=1)
    p_any, p_fluent = p_stage1[:, 0], p_stage1[:, 1]
    joint = p_any[:, None] * p_type

    out = {"binary": {
        "auc": float(roc_auc_score(y_any, p_any)),
        "ap": float(average_precision_score(y_any, p_any)),
    }}
    grid = np.linspace(0.05, 0.95, 91)
    f1s = [f1_score(y_any, (p_any >= g).astype(int), zero_division=0) for g in grid]
    bi = int(np.argmax(f1s))
    bin_thr = float(grid[bi]) if thresholds is None else thresholds["_binary"]
    out["binary"]["f1"] = float(f1_score(y_any, (p_any >= bin_thr).astype(int), zero_division=0))
    out["binary"]["threshold"] = bin_thr

    tuned = {"_binary": bin_thr}
    scores = {}
    for i, name in enumerate(LABELS):
        col = joint[:, TYPES.index(name)] if name in TYPES else p_fluent
        t = y[:, i]
        if t.sum() == 0 or t.sum() == len(t):
            continue
        if thresholds is None:
            f = [f1_score(t, (col >= g).astype(int), zero_division=0) for g in grid]
            j = int(np.argmax(f))
            thr, f1 = float(grid[j]), float(f[j])
        else:
            thr = thresholds[name]
            f1 = f1_score(t, (col >= thr).astype(int), zero_division=0)
        tuned[name] = thr
        scores[name] = {
            "auc": float(roc_auc_score(t, col)),
            "ap": float(average_precision_score(t, col)),
            "f1": f1, "threshold": thr, "support": int(t.sum()),
        }
    out["per_class"] = scores
    f1v = np.array([s["f1"] for s in scores.values()])
    sup = np.array([s["support"] for s in scores.values()])
    out["macro_f1"] = float(f1v.mean())
    out["weighted_f1"] = float((f1v * sup).sum() / sup.sum())
    out["macro_auc"] = float(np.mean([s["auc"] for s in scores.values()]))
    out["macro_ap"] = float(np.mean([s["ap"] for s in scores.values()]))
    return out, tuned


def fmt(m):
    lines = [f"    {'BINARY any-stutter':22s} auc={m['binary']['auc']:.3f} "
             f"ap={m['binary']['ap']:.3f} f1={m['binary']['f1']:.3f}"]
    for name in LABELS:
        s = m["per_class"].get(name)
        if s:
            lines.append(f"    {name:22s} auc={s['auc']:.3f} ap={s['ap']:.3f} "
                         f"f1={s['f1']:.3f} thr={s['threshold']:.2f} n={s['support']}")
    lines.append(f"    {'MACRO':22s} auc={m['macro_auc']:.3f} ap={m['macro_ap']:.3f} "
                 f"f1={m['macro_f1']:.3f} | weighted f1={m['weighted_f1']:.3f}")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--out", default="artifacts_twohead")
    ap.add_argument("--epochs", type=int, default=45)
    ap.add_argument("--batch-size", type=int, default=64)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--width", type=int, default=32)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--device", default="mps")
    ap.add_argument("--type-loss-weight", type=float, default=1.0)
    ap.add_argument("--detach", action="store_true")
    args = ap.parse_args()

    if args.detach:
        import os
        # setsid() leaves the Mach bootstrap namespace, which makes Metal's
        # shader compiler unreachable and aborts the process on first kernel.
        if args.device == "mps":
            raise SystemExit("--detach cannot be combined with --device mps")
        if os.fork() > 0:
            return
        os.setsid()
        if os.fork() > 0:
            os._exit(0)

    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    device = pick_device(args.device)

    clips, votes, episodes, aux = load_corpus(args.data)
    keep = clean_mask(aux)
    split = split_by_episode(episodes, seed=args.seed)
    idx = {s: np.where(keep & (split == s))[0] for s in ("train", "val", "test")}
    print(f"device={device}  usable={int(keep.sum())}  "
          f"train={len(idx['train'])} val={len(idx['val'])} test={len(idx['test'])}", flush=True)

    binary = (votes >= POSITIVE_VOTES).astype(int)
    tr_any = binary[idx["train"]][:, TYPE_IDX].max(axis=1)
    print(f"train any-stutter positives: {tr_any.sum()}/{len(tr_any)} "
          f"({tr_any.mean():.1%})", flush=True)

    loaders = {
        s: DataLoader(
            ClipDataset(clips, votes, idx[s], train=(s == "train")),
            batch_size=args.batch_size, shuffle=(s == "train"),
            num_workers=args.workers, drop_last=(s == "train"),
            persistent_workers=args.workers > 0,
        )
        for s in ("train", "val", "test")
    }

    model = StutterNetTwoHead(width=args.width).to(device)
    print(f"trainable params: "
          f"{sum(p.numel() for p in model.parameters() if p.requires_grad)/1e6:.2f}M", flush=True)

    # Stage 1 is weighted against the full training set...
    tr_fluent = binary[idx["train"]][:, FLUENT_IDX]
    s1_pos = np.array([tr_any.sum(), tr_fluent.sum()]).clip(min=1)
    bin_pw = torch.tensor(
        np.clip((len(tr_any) - s1_pos) / s1_pos, 1.0, 8.0),
        dtype=torch.float32, device=device,
    )
    # ...while the type head only ever sees stutter-positive clips, so its
    # class balance is computed on that subset.
    sub = binary[idx["train"]][tr_any == 1][:, TYPE_IDX]
    tpos = sub.sum(0).clip(min=1)
    type_pw = torch.tensor(
        np.clip((len(sub) - tpos) / tpos, 1.0, 8.0), dtype=torch.float32, device=device
    )
    print(f"stage1 pos_weight={{'any': {bin_pw[0]:.2f}, 'fluent': {bin_pw[1]:.2f}}} | "
          f"type pos_weight={dict(zip(TYPES, [round(float(x),2) for x in type_pw]))}", flush=True)

    bin_loss = nn.BCEWithLogitsLoss(pos_weight=bin_pw)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-2)
    sched = torch.optim.lr_scheduler.OneCycleLR(
        opt, max_lr=args.lr, epochs=args.epochs,
        steps_per_epoch=len(loaders["train"]), pct_start=0.25,
    )

    best = {"score": -1.0}
    for epoch in range(1, args.epochs + 1):
        model.train()
        t0, tot_b, tot_t, seen = time.time(), 0.0, 0.0, 0
        for wav, y in loaders["train"]:
            wav, y = wav.to(device), y.to(device)
            y_type, y_stage1, mask = split_targets(y)
            feat = spec_augment(model.features(wav))
            b_logit, t_logit = model.heads(feat)

            lb = bin_loss(b_logit, y_stage1)
            lt = conditional_bce(t_logit, y_type, mask, type_pw)
            loss = lb + args.type_loss_weight * lt

            opt.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            opt.step()
            sched.step()
            tot_b += lb.item() * len(wav)
            tot_t += lt.item() * len(wav)
            seen += len(wav)

        p_stage1, p_type, truth = predict(model, loaders["val"], device)
        metrics, thresholds = evaluate(p_stage1, p_type, truth)
        # Select on both objectives so stage 2 is not sacrificed for stage 1.
        score = metrics["binary"]["auc"] + metrics["macro_ap"]
        print(f"epoch {epoch:3d}  bin_loss={tot_b/seen:.4f} type_loss={tot_t/seen:.4f}  "
              f"val_binary_auc={metrics['binary']['auc']:.4f} "
              f"val_macro_ap={metrics['macro_ap']:.4f}  ({time.time()-t0:.0f}s)", flush=True)
        if epoch % 5 == 0 or epoch == args.epochs:
            print(fmt(metrics), flush=True)

        if score > best["score"]:
            best = {"score": score, "epoch": epoch, "thresholds": thresholds,
                    "binary_auc": metrics["binary"]["auc"]}
            torch.save({"state_dict": model.state_dict(), "width": args.width,
                        "labels": LABELS, "types": TYPES}, out_dir / "stutter_twohead.pt")

    print(f"\nbest val score={best['score']:.4f} @ epoch {best['epoch']} "
          f"(binary auc {best['binary_auc']:.4f})", flush=True)
    model.load_state_dict(torch.load(out_dir / "stutter_twohead.pt", map_location=device)["state_dict"])
    p_stage1, p_type, truth = predict(model, loaders["test"], device)
    test_metrics, _ = evaluate(p_stage1, p_type, truth, thresholds=best["thresholds"])
    print("\nTEST (held-out episodes, thresholds tuned on val):")
    print(fmt(test_metrics))

    json.dump({"labels": LABELS, "types": TYPES, "thresholds": best["thresholds"],
               "best_epoch": best["epoch"], "test": test_metrics},
              open(out_dir / "metrics.json", "w"), indent=2)
    np.savez(out_dir / "test_predictions.npz", p_stage1=p_stage1, p_type=p_type, votes=truth)
    print(f"\nsaved {out_dir/'stutter_twohead.pt'} and {out_dir/'metrics.json'}")


if __name__ == "__main__":
    main()

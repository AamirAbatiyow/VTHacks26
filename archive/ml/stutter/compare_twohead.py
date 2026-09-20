"""
Head-to-head: single-head StutterNet vs two-head cascade.

Both models are scored on the same held-out episode-disjoint test split with the
same metrics, and AUC deltas get a paired bootstrap over clips so we can say
whether a difference is real rather than noise.

    python compare_twohead.py --data <dir>
"""

import argparse
import json
from pathlib import Path

import numpy as np
import torch
from sklearn.metrics import average_precision_score, f1_score, roc_auc_score
from torch.utils.data import DataLoader

from data import POSITIVE_VOTES, ClipDataset, clean_mask, load_corpus, split_by_episode
from model import LABELS, StutterNet
from model_twohead import TYPES, StutterNetTwoHead
from train_twohead import pick_device

TYPE_IDX = [LABELS.index(c) for c in TYPES]
FLUENT_IDX = LABELS.index("Fluent")
N_BOOT = 2000


@torch.no_grad()
def run_single(model, loader, device):
    out = []
    for wav, _ in loader:
        out.append(torch.sigmoid(model(wav.to(device))).float().cpu().numpy())
    return np.concatenate(out)


@torch.no_grad()
def run_two(model, loader, device):
    """Returns (stage-1 probs [N,2] = (any, fluent), P(type|any) [N,5])."""
    ps, pt = [], []
    for wav, _ in loader:
        b, t = model.heads(model.features(wav.to(device)))
        ps.append(torch.sigmoid(b).float().cpu().numpy())
        pt.append(torch.sigmoid(t).float().cpu().numpy())
    return np.concatenate(ps), np.concatenate(pt)


def truth_of(loader):
    return np.concatenate([y.numpy() for _, y in loader])


def tune_threshold(y, score):
    grid = np.linspace(0.02, 0.98, 97)
    f1s = [f1_score(y, (score >= g).astype(int), zero_division=0) for g in grid]
    return float(grid[int(np.argmax(f1s))])


def paired_bootstrap(y, s_a, s_b, rng, metric=roc_auc_score):
    """Bootstrap the paired delta (B - A) over clips; returns (delta, lo, hi, p)."""
    n = len(y)
    obs = metric(y, s_b) - metric(y, s_a)
    deltas = np.empty(N_BOOT)
    for i in range(N_BOOT):
        idx = rng.integers(0, n, n)
        yi = y[idx]
        if yi.min() == yi.max():
            deltas[i] = 0.0
            continue
        deltas[i] = metric(yi, s_b[idx]) - metric(yi, s_a[idx])
    lo, hi = np.percentile(deltas, [2.5, 97.5])
    # two-sided p: how often the bootstrap distribution crosses zero
    p = 2 * min((deltas <= 0).mean(), (deltas >= 0).mean())
    return float(obs), float(lo), float(hi), float(min(p, 1.0))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--single", default="artifacts/stutter_net.pt")
    ap.add_argument("--two", default="artifacts_twohead/stutter_twohead.pt")
    ap.add_argument("--device", default="mps")
    ap.add_argument("--batch-size", type=int, default=64)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--out", default="artifacts_twohead/comparison.json")
    args = ap.parse_args()

    torch.manual_seed(0)
    rng = np.random.default_rng(0)
    device = pick_device(args.device)

    clips, votes, episodes, aux = load_corpus(args.data)
    keep = clean_mask(aux)
    split = split_by_episode(episodes, seed=0)
    idx = {s: np.where(keep & (split == s))[0] for s in ("val", "test")}
    loaders = {
        s: DataLoader(ClipDataset(clips, votes, idx[s], train=False),
                      batch_size=args.batch_size, num_workers=args.workers)
        for s in ("val", "test")
    }
    print(f"device={device}  val={len(idx['val'])}  test={len(idx['test'])}\n", flush=True)

    ck_a = torch.load(args.single, map_location=device)
    sd_a = ck_a.get("state_dict", ck_a)
    net_a = StutterNet(width=ck_a.get("width", 32)).to(device)
    net_a.load_state_dict(sd_a)
    net_a.eval()

    ck_b = torch.load(args.two, map_location=device)
    net_b = StutterNetTwoHead(width=ck_b.get("width", 32)).to(device)
    net_b.load_state_dict(ck_b["state_dict"])
    net_b.eval()

    preds = {}
    for s in ("val", "test"):
        y_votes = truth_of(loaders[s])
        y = (y_votes * 3 >= POSITIVE_VOTES - 1e-6).astype(int)
        pa_single = run_single(net_a, loaders[s], device)
        p_stage1_b, p_type_b = run_two(net_b, loaders[s], device)
        preds[s] = {"y": y, "single": pa_single,
                    "p_any": p_stage1_b[:, 0], "p_fluent": p_stage1_b[:, 1],
                    "joint": p_stage1_b[:, :1] * p_type_b}

    y_any = {s: preds[s]["y"][:, TYPE_IDX].max(axis=1) for s in preds}

    # The single-head model has no explicit "any stutter" output. Two rules are
    # defensible; pick whichever is stronger on val so the baseline is shown at
    # its best, then freeze that choice for test.
    rules = {
        "1 - P(Fluent)": lambda p: 1.0 - p[:, FLUENT_IDX],
        "max P(type)": lambda p: p[:, TYPE_IDX].max(axis=1),
    }
    val_auc = {k: roc_auc_score(y_any["val"], f(preds["val"]["single"]))
               for k, f in rules.items()}
    best_rule = max(val_auc, key=val_auc.get)
    print("single-head any-stutter rule selection (on val):")
    for k, v in val_auc.items():
        print(f"    {k:16s} auc={v:.4f}{'   <- selected' if k == best_rule else ''}")
    print()

    a_bin = {s: rules[best_rule](preds[s]["single"]) for s in preds}
    b_bin = {s: preds[s]["p_any"] for s in preds}

    result = {"single_head_binary_rule": best_rule, "binary": {}, "per_class": {}}

    # ---- stage 1: any stutter -------------------------------------------------
    ta, tb = tune_threshold(y_any["val"], a_bin["val"]), tune_threshold(y_any["val"], b_bin["val"])
    yt = y_any["test"]
    d_auc = paired_bootstrap(yt, a_bin["test"], b_bin["test"], rng)
    d_ap = paired_bootstrap(yt, a_bin["test"], b_bin["test"], rng, average_precision_score)
    result["binary"] = {
        "support": int(yt.sum()), "n": int(len(yt)),
        "single": {"auc": roc_auc_score(yt, a_bin["test"]),
                   "ap": average_precision_score(yt, a_bin["test"]),
                   "f1": f1_score(yt, (a_bin["test"] >= ta).astype(int)),
                   "acc": float(((a_bin["test"] >= ta).astype(int) == yt).mean())},
        "two_head": {"auc": roc_auc_score(yt, b_bin["test"]),
                     "ap": average_precision_score(yt, b_bin["test"]),
                     "f1": f1_score(yt, (b_bin["test"] >= tb).astype(int)),
                     "acc": float(((b_bin["test"] >= tb).astype(int) == yt).mean())},
        "delta_auc": d_auc, "delta_ap": d_ap,
    }

    print("=" * 76)
    print("STAGE 1 - any stutter vs fluent   (test n=%d, positives=%d)"
          % (len(yt), yt.sum()))
    print("=" * 76)
    r = result["binary"]
    print(f"    {'':12s} {'AUC':>8s} {'AP':>8s} {'F1':>8s} {'Acc':>8s}")
    print(f"    {'single-head':12s} {r['single']['auc']:8.4f} {r['single']['ap']:8.4f} "
          f"{r['single']['f1']:8.4f} {r['single']['acc']:8.4f}")
    print(f"    {'two-head':12s} {r['two_head']['auc']:8.4f} {r['two_head']['ap']:8.4f} "
          f"{r['two_head']['f1']:8.4f} {r['two_head']['acc']:8.4f}")
    o, lo, hi, p = d_auc
    print(f"\n    delta AUC = {o:+.4f}  95% CI [{lo:+.4f}, {hi:+.4f}]  p={p:.4f}"
          f"  {'SIGNIFICANT' if p < 0.05 else 'not significant'}")

    # ---- stage 2 + per-class --------------------------------------------------
    print("\n" + "=" * 76)
    print("PER-CLASS  (two-head uses cascade P(any) x P(type|any))")
    print("=" * 76)
    print(f"    {'class':14s} {'AUC 1-head':>11s} {'AUC 2-head':>11s} {'delta':>9s} "
          f"{'p':>8s} {'n':>6s}")
    rows = {}
    for i, name in enumerate(LABELS):
        yv, yts = preds["val"]["y"][:, i], preds["test"]["y"][:, i]
        if yts.sum() == 0:
            continue
        if name in TYPES:
            j = TYPES.index(name)
            bv, bt = preds["val"]["joint"][:, j], preds["test"]["joint"][:, j]
        else:
            bv, bt = preds["val"]["p_fluent"], preds["test"]["p_fluent"]
        av, at = preds["val"]["single"][:, i], preds["test"]["single"][:, i]
        t_a, t_b = tune_threshold(yv, av), tune_threshold(yv, bv)
        d = paired_bootstrap(yts, at, bt, rng)
        rows[name] = {
            "single": {"auc": roc_auc_score(yts, at), "ap": average_precision_score(yts, at),
                       "f1": f1_score(yts, (at >= t_a).astype(int), zero_division=0)},
            "two_head": {"auc": roc_auc_score(yts, bt), "ap": average_precision_score(yts, bt),
                         "f1": f1_score(yts, (bt >= t_b).astype(int), zero_division=0)},
            "delta_auc": d, "support": int(yts.sum()),
        }
        mark = "*" if d[3] < 0.05 else " "
        print(f"    {name:14s} {rows[name]['single']['auc']:11.4f} "
              f"{rows[name]['two_head']['auc']:11.4f} {d[0]:+9.4f} {d[3]:8.4f}{mark} "
              f"{rows[name]['support']:6d}")
    result["per_class"] = rows

    for key, label in (("auc", "macro AUC"), ("ap", "macro AP"), ("f1", "macro F1")):
        a = np.mean([r["single"][key] for r in rows.values()])
        b = np.mean([r["two_head"][key] for r in rows.values()])
        result.setdefault("macro", {})[key] = {"single": float(a), "two_head": float(b)}
        print(f"    {label:14s} {a:11.4f} {b:11.4f} {b-a:+9.4f}")

    sup = np.array([r["support"] for r in rows.values()])
    wa = float((np.array([r["single"]["f1"] for r in rows.values()]) * sup).sum() / sup.sum())
    wb = float((np.array([r["two_head"]["f1"] for r in rows.values()]) * sup).sum() / sup.sum())
    result["weighted_f1"] = {"single": wa, "two_head": wb}
    print(f"    {'weighted F1':14s} {wa:11.4f} {wb:11.4f} {wb-wa:+9.4f}")
    print("\n    * = paired bootstrap p < 0.05")

    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    json.dump(result, open(args.out, "w"), indent=2, default=float)
    print(f"\nsaved {args.out}")


if __name__ == "__main__":
    main()

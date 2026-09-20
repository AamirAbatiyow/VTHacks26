"""Statistical analysis of the A/B benchmark. Reads the raw JSON, writes report.json."""

import json
from pathlib import Path

import numpy as np
from scipy import stats
from sklearn.metrics import average_precision_score, f1_score, roc_auc_score

RNG = np.random.default_rng(0)
BOOT = 5000

# Tuned on validation, shipped in server/models/stutter.json.
_THRESHOLDS = json.load(
    open(Path(__file__).parent / "../../conversational-ai/server/models/stutter.json")
)["thresholds"]


def boot_auc_diff(y, pa, pb, n=BOOT):
    """Bootstrap the paired AUC difference (a - b) over clips."""
    obs = roc_auc_score(y, pa) - roc_auc_score(y, pb)
    idx = np.arange(len(y))
    diffs = np.empty(n)
    ok = 0
    for i in range(n):
        s = RNG.choice(idx, len(idx), replace=True)
        if y[s].sum() in (0, len(s)):
            continue
        diffs[ok] = roc_auc_score(y[s], pa[s]) - roc_auc_score(y[s], pb[s])
        ok += 1
    diffs = diffs[:ok]
    lo, hi = np.percentile(diffs, [2.5, 97.5])
    # Two-sided bootstrap p: how often the sign flips relative to the observed effect.
    p = 2 * min((diffs <= 0).mean(), (diffs >= 0).mean())
    return obs, float(lo), float(hi), float(min(max(p, 1 / ok), 1.0))


def mcnemar(a_correct, b_correct):
    """Exact McNemar on paired correctness (binomial on discordant pairs)."""
    b = int(np.sum(a_correct & ~b_correct))   # a right, b wrong
    c = int(np.sum(~a_correct & b_correct))   # b right, a wrong
    if b + c == 0:
        return b, c, 1.0
    p = float(stats.binomtest(b, b + c, 0.5).pvalue)
    return b, c, p


def main():
    out_dir = Path("/tmp/bench")
    acc = json.load(open(out_dir / "accuracy_raw.json"))
    lat = json.load(open(out_dir / "latency_raw.json"))
    labels = acc["labels"]
    y = np.array(acc["y_true"])
    P = {k: np.array(v["probs"]) for k, v in acc["models"].items()}
    report = {"n_clips": acc["n_clips"], "labels": labels}

    # ---------------- Latency ----------------
    a = np.array(lat["models"]["cnn"]["samples_ms"])
    b = np.array(lat["models"]["w2v2"]["samples_ms"])
    n = min(len(a), len(b))
    a, b = a[:n], b[:n]
    w = stats.wilcoxon(a, b)
    t = stats.ttest_rel(a, b)
    pooled_sd = np.sqrt((a.std(ddof=1) ** 2 + b.std(ddof=1) ** 2) / 2)
    ratios = b / a
    report["latency"] = {
        "n_trials": int(n),
        "cnn": _lat_stats(a),
        "w2v2": _lat_stats(b),
        "speedup_mean": float(b.mean() / a.mean()),
        "speedup_ci": [float(np.percentile(ratios, 2.5)), float(np.percentile(ratios, 97.5))],
        "wilcoxon_p": float(w.pvalue),
        "ttest_rel_p": float(t.pvalue),
        "cohens_d": float((b.mean() - a.mean()) / pooled_sd),
        "mean_diff_ms": float(b.mean() - a.mean()),
    }

    # ---------------- Per-class ranking quality ----------------
    per_class = {}
    for i, name in enumerate(labels):
        yi = y[:, i]
        if yi.sum() == 0 or yi.sum() == len(yi):
            continue
        row = {"support": int(yi.sum())}
        for k in ("cnn", "w2v2"):
            row[k] = {
                "auc": float(roc_auc_score(yi, P[k][:, i])),
                "ap": float(average_precision_score(yi, P[k][:, i])),
            }
        d, lo, hi, p = boot_auc_diff(yi, P["cnn"][:, i], P["w2v2"][:, i])
        row["auc_diff_cnn_minus_w2v2"] = float(d)
        row["auc_diff_ci95"] = [lo, hi]
        row["auc_diff_p"] = p
        per_class[name] = row
    report["per_class"] = per_class

    # ---------------- Common binary task: any stutter present ----------------
    fi = labels.index("Fluent")
    si = [i for i in range(len(labels)) if i != fi]
    y_any = (y[:, si].sum(1) > 0).astype(int)

    # Score each model the way it is actually meant to be read. For the
    # multi-label CNN that is the strongest stutter head; for the softmax
    # baseline it is the total non-fluent mass. Using 1-P(Fluent) for the CNN
    # would score it through a head that answers a different question
    # ("did annotators mark NoStutteredWords"), which is not the complement.
    s_cnn, s_w2v2 = P["cnn"][:, si].max(1), 1 - P["w2v2"][:, fi]
    d, lo, hi, p = boot_auc_diff(y_any, s_cnn, s_w2v2)

    # Alternative scoring rules, reported for transparency.
    report["binary_scoring_sensitivity"] = {
        "cnn_max_stutter_head": float(roc_auc_score(y_any, P["cnn"][:, si].max(1))),
        "cnn_one_minus_fluent": float(roc_auc_score(y_any, 1 - P["cnn"][:, fi])),
        "w2v2_max_stutter_head": float(roc_auc_score(y_any, P["w2v2"][:, si].max(1))),
        "w2v2_one_minus_fluent": float(roc_auc_score(y_any, 1 - P["w2v2"][:, fi])),
    }

    # Each model's own deployed decision rule.
    thr = np.array([_THRESHOLDS[labels[i]] for i in si])
    dec_cnn = (P["cnn"][:, si] >= thr).any(1).astype(int)   # StutterClassifier.ts rule
    dec_w2v2 = (P["w2v2"].argmax(1) != fi).astype(int)      # softmax argmax
    ca, cb = dec_cnn == y_any, dec_w2v2 == y_any
    nb, nc, p_mc = mcnemar(ca, cb)
    report["binary_any_stutter"] = {
        "prevalence": float(y_any.mean()),
        "cnn": {"auc": float(roc_auc_score(y_any, s_cnn)),
                "ap": float(average_precision_score(y_any, s_cnn)),
                "accuracy": float(ca.mean()), "f1": float(f1_score(y_any, dec_cnn))},
        "w2v2": {"auc": float(roc_auc_score(y_any, s_w2v2)),
                 "ap": float(average_precision_score(y_any, s_w2v2)),
                 "accuracy": float(cb.mean()), "f1": float(f1_score(y_any, dec_w2v2))},
        "auc_diff_cnn_minus_w2v2": float(d), "auc_diff_ci95": [lo, hi], "auc_diff_p": p,
        "mcnemar": {"cnn_only_correct": nb, "w2v2_only_correct": nc, "p": p_mc},
    }

    # ---------------- Footprint ----------------
    report["footprint"] = {
        k: {
            "name": acc["models"][k]["name"],
            "disk_mb": acc["models"][k]["disk_bytes"] / 1e6,
            "params_m": acc["models"][k]["n_params"] / 1e6,
            "load_seconds": acc["models"][k]["load_seconds"],
            "rss_delta_mb": acc["models"][k]["peak_rss_delta_mb"],
            "wall_seconds_full_testset": acc["models"][k]["wall_seconds"],
        }
        for k in ("cnn", "w2v2")
    }
    report["host"] = lat["host"]

    json.dump(report, open(out_dir / "report.json", "w"), indent=2)
    _print(report)


def _lat_stats(x):
    return {
        "mean": float(x.mean()), "sd": float(x.std(ddof=1)),
        "p50": float(np.percentile(x, 50)), "p95": float(np.percentile(x, 95)),
        "p99": float(np.percentile(x, 99)),
        "min": float(x.min()), "max": float(x.max()),
    }


def _print(r):
    L = r["latency"]
    print(f"\n=== LATENCY (n={L['n_trials']} paired trials, CPU, batch=1) ===")
    for k in ("cnn", "w2v2"):
        s = L[k]
        print(f"  {k:5s} mean={s['mean']:7.2f}ms sd={s['sd']:5.2f} p50={s['p50']:7.2f} "
              f"p95={s['p95']:7.2f} p99={s['p99']:7.2f}")
    print(f"  speedup={L['speedup_mean']:.1f}x  CI95=[{L['speedup_ci'][0]:.1f}, {L['speedup_ci'][1]:.1f}]")
    print(f"  wilcoxon p={L['wilcoxon_p']:.3e}  paired-t p={L['ttest_rel_p']:.3e}  d={L['cohens_d']:.1f}")

    print(f"\n=== PER-CLASS ROC-AUC (n={r['n_clips']} clips) ===")
    print(f"  {'class':14s} {'CNN':>6s} {'w2v2':>6s} {'diff':>7s} {'95% CI':>16s} {'p':>9s}  sup")
    for name, c in r["per_class"].items():
        lo, hi = c["auc_diff_ci95"]
        print(f"  {name:14s} {c['cnn']['auc']:6.3f} {c['w2v2']['auc']:6.3f} "
              f"{c['auc_diff_cnn_minus_w2v2']:+7.3f} [{lo:+.3f},{hi:+.3f}] {c['auc_diff_p']:9.2e}  {c['support']}")

    B = r["binary_any_stutter"]
    print(f"\n=== BINARY: any stutter (prevalence {B['prevalence']:.1%}) ===")
    for k in ("cnn", "w2v2"):
        s = B[k]
        print(f"  {k:5s} auc={s['auc']:.3f} ap={s['ap']:.3f} acc={s['accuracy']:.3f} f1={s['f1']:.3f}")
    print(f"  AUC diff={B['auc_diff_cnn_minus_w2v2']:+.3f} p={B['auc_diff_p']:.2e}")
    print("  scoring-rule sensitivity:", {k: round(v, 3)
          for k, v in r["binary_scoring_sensitivity"].items()})
    m = B["mcnemar"]
    print(f"  McNemar: cnn-only-correct={m['cnn_only_correct']} "
          f"w2v2-only-correct={m['w2v2_only_correct']} p={m['p']:.2e}")

    print("\n=== FOOTPRINT ===")
    for k, f in r["footprint"].items():
        print(f"  {k:5s} disk={f['disk_mb']:8.1f}MB params={f['params_m']:7.2f}M "
              f"load={f['load_seconds']:5.2f}s rss+={f['rss_delta_mb']:7.1f}MB")


if __name__ == "__main__":
    main()

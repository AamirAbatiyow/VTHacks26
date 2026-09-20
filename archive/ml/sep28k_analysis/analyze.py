"""Reproducible descriptive analysis of official SEP-28k CSV annotations.

Run: .venv/bin/python analyze.py (from this directory). No audio is downloaded.
"""
from pathlib import Path
import os
import json
import hashlib
import html
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent
os.environ.setdefault("MPLCONFIGDIR", str(ROOT / ".cache"))
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages

OUT = ROOT / "results"
OUT.mkdir(exist_ok=True)
LABELS = ["Prolongation", "Block", "SoundRep", "WordRep", "NoStutteredWords", "Interjection"]
EVENTS = ["Prolongation", "Block", "SoundRep", "WordRep", "Interjection"]
QUALITY = ["Unsure", "PoorAudioQuality", "DifficultToUnderstand", "NaturalPause", "Music", "NoSpeech"]
NAMES = {"SoundRep": "Sound repetition", "WordRep": "Word repetition",
         "NoStutteredWords": "No stuttered words", "PoorAudioQuality": "Poor audio quality",
         "DifficultToUnderstand": "Difficult to understand", "NaturalPause": "Natural pause",
         "NoSpeech": "No speech"}
nice = lambda key: NAMES.get(key, key)
df = pd.read_csv(ROOT / "data/SEP-28k_labels.csv", skipinitialspace=True)
ep = pd.read_csv(ROOT / "data/SEP-28k_episodes.csv", header=None, skipinitialspace=True,
                 names=["Podcast", "EpisodeTitle", "URL", "Show", "EpId"])
for frame in [df, ep]:
    frame["Show"] = frame.Show.str.strip()
all_labels = LABELS + QUALITY
assert not df.isna().any().any(), "Missing annotation values"
assert df[all_labels].isin([0, 1, 2, 3]).all().all(), "Invalid vote counts"
assert not df.duplicated(["Show", "EpId", "ClipId"]).any(), "Duplicate clip ID"
assert not ep.duplicated(["Show", "EpId"]).any(), "Duplicate episode key"
assert (df.Stop > df.Start).all() and (df.Start >= 0).all()
matched = df.merge(ep, on=["Show", "EpId"], how="left", validate="many_to_one", indicator=True)
assert matched._merge.eq("both").all(), "Clip missing episode metadata"
duration = (df.Stop - df.Start) / 16000
majority = df[all_labels].ge(2)
group_keys = [df.Show, df.EpId]
episode_sizes = df.groupby(["Show", "EpId"]).size()
show_sizes = df.groupby("Show").size().sort_values(ascending=False)

# Cluster bootstrap: resample entire episodes to preserve within-episode dependence.
# Descriptive sensitivity intervals, not population/clinical prevalence estimates.
rng = np.random.default_rng(20260919)
totals = majority.groupby(group_keys).sum().reindex(episode_sizes.index).to_numpy()
sizes = episode_sizes.to_numpy()
draws = rng.integers(0, len(sizes), size=(3000, len(sizes)))
boot = totals[draws].sum(axis=1) / sizes[draws].sum(axis=1)[:, None]
low, high = np.quantile(boot, [0.025, 0.975], axis=0)
rows = []
for i, label in enumerate(all_labels):
    k = df[label].to_numpy()
    mean_agreement = np.mean((k*(k-1) + (3-k)*(2-k)) / 6)
    p = k.mean()/3
    expected = p*p + (1-p)*(1-p)
    rows.append({"label": label, "any_vote_count": int((k >= 1).sum()),
      "majority_count": int((k >= 2).sum()), "unanimous_count": int((k == 3).sum()),
      "any_vote_pct": 100*np.mean(k >= 1), "majority_pct": 100*np.mean(k >= 2),
      "unanimous_pct": 100*np.mean(k == 3), "cluster_ci_low_pct": 100*low[i],
      "cluster_ci_high_pct": 100*high[i], "split_vote_pct": 100*np.mean((k == 1) | (k == 2)),
      "pairwise_agreement_pct": 100*mean_agreement,
      "fleiss_kappa": (mean_agreement-expected)/(1-expected)})
stats = pd.DataFrame(rows).set_index("label")
stats.to_csv(OUT / "label_statistics.csv")
show_rates = majority[LABELS].groupby(df.Show).mean().reindex(show_sizes.index)*100
show_rates.assign(clips=show_sizes).to_csv(OUT / "show_prevalence.csv")
episode_table = majority[all_labels].groupby(group_keys).mean()*100
episode_table.insert(0, "clips", episode_sizes)
episode_table.to_csv(OUT / "episode_statistics.csv")
vote_table = pd.DataFrame({label: df[label].value_counts().reindex(range(4), fill_value=0)
                           for label in all_labels}).T
vote_table.columns = ["votes_0", "votes_1", "votes_2", "votes_3"]
vote_table.to_csv(OUT / "vote_counts.csv")
b = majority[LABELS].astype(int).to_numpy()
co = b.T @ b
union = np.diag(co)[:, None] + np.diag(co)[None, :] - co
jaccard = np.divide(co, union, out=np.zeros_like(co, dtype=float), where=union > 0)
pd.DataFrame(co, index=LABELS, columns=LABELS).to_csv(OUT / "cooccurrence_counts.csv")
pd.DataFrame(jaccard, index=LABELS, columns=LABELS).to_csv(OUT / "jaccard.csv")
multi = majority[EVENTS].sum(axis=1).value_counts().reindex(range(6), fill_value=0)
any_event = majority[EVENTS].any(axis=1)
no_stutter = majority.NoStutteredWords
ambiguous = ~(any_event | no_stutter)
overlap = any_event & no_stutter
core_overlap = majority[EVENTS[:-1]].any(axis=1) & no_stutter

# Check overlap of time intervals within each episode, without assuming independent clips.
overlapping = 0
unique_samples = 0
for _, part in df.groupby(["Show", "EpId"]):
    end = -1
    for start, stop in part.sort_values("Start")[["Start", "Stop"]].itertuples(index=False, name=None):
        overlapping += int(start < end)
        unique_samples += max(0, stop-max(start, end))
        end = max(end, stop)
audit = {"clips": len(df), "shows": df.Show.nunique(), "episodes_with_clips": len(episode_sizes),
  "episode_metadata_rows": len(ep), "hours_sum_of_clips": float(duration.sum()/3600),
  "hours_union_of_intervals": unique_samples/16000/3600,
  "duration_min_seconds": float(duration.min()), "duration_max_seconds": float(duration.max()),
  "non_three_second_clips": int(duration.ne(3).sum()), "overlapping_intervals": overlapping,
  "missing_label_values": int(df.isna().sum().sum()), "duplicate_clip_ids": 0,
  "duplicate_episode_keys": 0, "unmatched_clip_episode_keys": 0,
  "any_event_majority": int(any_event.sum()), "no_stutter_majority": int(no_stutter.sum()),
  "multiple_event_types": int((majority[EVENTS].sum(axis=1) >= 2).sum()),
  "neither_majority_event_nor_no_stutter": int(ambiguous.sum()),
  "no_stutter_and_any_event": int(overlap.sum()), "no_stutter_and_core_event": int(core_overlap.sum()),
  "episode_clip_count_summary": episode_sizes.describe().to_dict(),
  "bootstrap_replicates": 3000, "seed": 20260919}
(OUT / "audit.json").write_text(json.dumps(audit, indent=2, default=int)+"\n")
manifest = {"generated_at_utc": datetime.now(timezone.utc).isoformat(),
  "source_repository": "https://github.com/apple-aiml-research/ml-stuttering-events-dataset",
  "files": {p.name: {"sha256": hashlib.sha256(p.read_bytes()).hexdigest(),
    "url": "https://raw.githubusercontent.com/apple-aiml-research/ml-stuttering-events-dataset/main/" + p.name.replace("upstream_", "")}
    for p in sorted((ROOT / "data").iterdir()) if p.is_file()},
  "versions": {"numpy": np.__version__, "pandas": pd.__version__, "matplotlib": matplotlib.__version__}}
(OUT / "provenance.json").write_text(json.dumps(manifest, indent=2)+"\n")

plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 11,
  "axes.spines.top": False, "axes.spines.right": False, "figure.facecolor": "#f7f9fc",
  "axes.facecolor": "#f7f9fc", "axes.titleweight": "bold", "savefig.facecolor": "#f7f9fc"})
BLUE, TEAL, ORANGE = "#285d94", "#218c89", "#db8a31"
figures = []
pdf = PdfPages(OUT / "sep28k_plots.pdf")
def save(fig, name):
    fig.savefig(OUT / f"{name}.png", dpi=180, bbox_inches="tight")
    fig.savefig(OUT / f"{name}.svg", bbox_inches="tight")
    pdf.savefig(fig, bbox_inches="tight")
    figures.append(name)
    plt.close(fig)

fig, ax = plt.subplots(figsize=(11, 5.4), layout="constrained")
x = stats.loc[LABELS]
y = np.arange(len(x))
ax.barh(y, x.majority_pct, color=[BLUE]*4+[TEAL, ORANGE], height=.6)
ax.errorbar(x.majority_pct, y, xerr=[x.majority_pct-x.cluster_ci_low_pct,
              x.cluster_ci_high_pct-x.majority_pct], fmt="none", color="#263448", capsize=4)
for i, row in enumerate(x.itertuples()):
    ax.text(row.cluster_ci_high_pct+1, i, f"{row.majority_pct:.1f}%  ({row.majority_count:,})", va="center")
ax.set(yticks=y, yticklabels=[nice(k) for k in LABELS], xlabel="Percent of all 28,177 clips", xlim=(0, 78))
ax.invert_yaxis()
ax.set_title("SEP-28k | Majority-vote label prevalence\n≥2 of 3 reviewers; bars: 95% episode-cluster bootstrap intervals", loc="left", fontsize=15)
save(fig, "01_label_prevalence")

fig, axes = plt.subplots(1, 2, figsize=(13, 5.5), layout="constrained")
axes[0].barh(show_sizes.index, show_sizes.values, color=BLUE)
axes[0].invert_yaxis()
for i, n in enumerate(show_sizes):
    axes[0].text(n+90, i, f"{n:,}", va="center")
axes[0].set(xlabel="Clips", xlim=(0, show_sizes.max()*1.2), title="Clip contribution by podcast")
axes[1].hist(episode_sizes, bins=25, color=TEAL, edgecolor="white")
axes[1].axvline(episode_sizes.median(), color=ORANGE, linestyle="--", label=f"Median: {episode_sizes.median():.0f}")
axes[1].set(xlabel="Clips per episode", ylabel="Episodes", title=f"{len(episode_sizes)} episodes across {len(show_sizes)} shows")
axes[1].legend(frameon=False)
fig.suptitle("Dataset composition is uneven", fontsize=18, fontweight="bold")
save(fig, "02_dataset_composition")

fig, ax = plt.subplots(figsize=(11, 6), layout="constrained")
im = ax.imshow(show_rates, cmap="YlGnBu", vmin=0, vmax=100, aspect="auto")
ax.set(xticks=range(6), xticklabels=[nice(k).replace(" ", "\n") for k in LABELS],
       yticks=range(len(show_sizes)), yticklabels=[f"{s} (n={show_sizes[s]:,})" for s in show_sizes.index])
for i in range(len(show_sizes)):
    for j in range(6):
        v = show_rates.iloc[i,j]
        ax.text(j, i, f"{v:.1f}%", ha="center", va="center", color="white" if v>52 else "#172b40")
fig.colorbar(im, ax=ax, label="Percent of clips within show")
ax.set_title("Label prevalence varies across podcasts\nMajority vote (≥2 of 3 reviewers)", loc="left", fontsize=15)
save(fig, "03_prevalence_by_show")

fig, axes = plt.subplots(1, 2, figsize=(13, 5.7), layout="constrained")
bottom = np.zeros(6)
for k, color in zip(range(4), ["#d6dfe8", "#e3b67b", "#599db0", "#285d94"]):
    values = vote_table.loc[LABELS, f"votes_{k}"]/len(df)*100
    axes[0].barh(range(6), values, left=bottom, color=color, label=f"{k} votes")
    bottom += values.to_numpy()
axes[0].set(yticks=range(6), yticklabels=[nice(k) for k in LABELS], xlabel="Percent of clips", xlim=(0,100))
axes[0].invert_yaxis()
axes[0].legend(ncol=4, loc="upper center", bbox_to_anchor=(.5, -.12), frameon=False)
for col, marker, label in [("any_vote_pct", "o", "≥1 vote"), ("majority_pct", "s", "≥2 votes"), ("unanimous_pct", "^", "3 votes")]:
    axes[1].scatter(stats.loc[LABELS, col], range(6), marker=marker, label=label)
axes[1].set(yticks=range(6), yticklabels=[], xlabel="Percent of clips", xlim=(0,85))
axes[1].invert_yaxis()
axes[1].set_ylim(5.5, -.5)
axes[1].legend(frameon=False)
fig.suptitle("Annotation disagreement changes apparent prevalence", fontsize=17, fontweight="bold")
save(fig, "04_votes_and_thresholds")

fig, ax = plt.subplots(figsize=(9, 7), layout="constrained")
im = ax.imshow(jaccard, cmap="Blues", vmin=0, vmax=1)
ax.set(xticks=range(6), xticklabels=[nice(k).replace(" ", "\n") for k in LABELS],
       yticks=range(6), yticklabels=[nice(k) for k in LABELS])
for i in range(6):
    for j in range(6):
        ax.text(j, i, f"{jaccard[i,j]:.2f}\n{co[i,j]:,} clips", ha="center", va="center",
                color="white" if jaccard[i,j]>.55 else "#172b40", fontsize=9)
fig.colorbar(im, ax=ax, label="Jaccard overlap: intersection / union")
ax.set_title("Labels overlap within clips\nMajority vote; diagonal is each label's positive count", loc="left", fontsize=15)
save(fig, "05_label_overlap")

fig, axes = plt.subplots(1, 2, figsize=(13, 5.5), layout="constrained")
axes[0].bar(multi.index, multi/len(df)*100, color=BLUE)
for k, n in multi.items():
    axes[0].text(k, n/len(df)*100+1, f"{n:,}", ha="center", fontsize=10)
axes[0].set(xlabel="Distinct positive event types (five categories)", ylabel="Percent of clips", ylim=(0,75), xticks=range(6))
axes[0].set_title("Multiple labels are possible; zero is not\na confirmed 'No stuttered words' label")
q = stats.loc[QUALITY].sort_values("majority_pct")
yy = np.arange(len(q))
axes[1].barh(yy-.17, q.any_vote_pct, .32, color="#aec6da", label="≥1 vote")
axes[1].barh(yy+.17, q.majority_pct, .32, color=TEAL, label="≥2 votes")
axes[1].set(yticks=yy, yticklabels=[nice(k) for k in q.index], xlabel="Percent of clips", title="Additional annotation flags")
axes[1].legend(frameon=False)
save(fig, "06_multilabel_and_quality")
pdf.close()

table = "| Label | Majority clips | Percent | 95% episode-bootstrap interval | Fleiss κ |\n|---|---:|---:|---:|---:|\n"
for key in LABELS:
    r = stats.loc[key]
    table += f"| {nice(key)} | {int(r.majority_count):,} | {r.majority_pct:.2f}% | {r.cluster_ci_low_pct:.2f}–{r.cluster_ci_high_pct:.2f}% | {r.fleiss_kappa:.3f} |\n"
report = f"""# SEP-28k statistical analysis

## Scope and methods

Analysis of the official [episode metadata](https://github.com/apple-aiml-research/ml-stuttering-events-dataset/blob/main/SEP-28k_episodes.csv)
and [clip labels](https://github.com/apple-aiml-research/ml-stuttering-events-dataset/blob/main/SEP-28k_labels.csv).
The [upstream documentation](https://github.com/apple-aiml-research/ml-stuttering-events-dataset#annotation-descriptions)
specifies three reviewers per clip and multiple allowed labels. Values 0–3 are
reviewer votes, **not event occurrence counts**. Main results use ≥2 votes; sensitivity
plots also show ≥1 vote and unanimous agreement. Every clip is retained; denominator
is all {len(df):,} clips unless explicitly grouped by show. No audio was downloaded or
reclassified, and no model was trained or evaluated.

Intervals are percentile 95% episode-cluster bootstrap intervals (3,000 resamples,
seed 20260919), resampling episodes with replacement and recalculating the clip-weighted
proportion. Dependence within an episode is preserved, but recurring speakers across
episodes and shows are not accounted for. These are descriptive sensitivity intervals,
not clinical or population prevalence estimates. Fleiss κ treats each label as a binary
three-rater decision and is derived from its vote totals; individual reviewer identities
and reviewer-specific performance are unavailable.

## Dataset audit

- **{len(df):,} clips**, **{len(episode_sizes)} episodes**, **{len(show_sizes)} podcast shows**; {len(ep)} metadata rows.
- Summed annotated duration: **{duration.sum()/3600:.2f} hours**; union of annotated time intervals: **{unique_samples/16000/3600:.2f} hours**.
- Durations range **{duration.min():.3f}–{duration.max():.3f} seconds**; {int(duration.ne(3).sum())} clips are not exactly three seconds.
- Start/stop positions are 16 kHz sample indices, as verified in the upstream extraction script.
- Zero missing label values, invalid vote counts, duplicate clip IDs, duplicate episode keys, or unmatched episode joins.
- {overlapping} intervals overlap preceding audio within the same episode.
- Clips per episode: median {episode_sizes.median():.0f}, IQR {episode_sizes.quantile(.25):.0f}–{episode_sizes.quantile(.75):.0f}, range {episode_sizes.min()}–{episode_sizes.max()}.
- Largest contribution: {show_sizes.index[0]}, {show_sizes.iloc[0]:,} clips ({show_sizes.iloc[0]/len(df)*100:.1f}%).

## Main label estimates

{table}

Labels are not mutually exclusive, so percentages should not be summed.

## Key findings

- At least one of the five event categories has majority support in **{any_event.sum():,} clips ({any_event.mean()*100:.2f}%)**.
- **{int((majority[EVENTS].sum(axis=1)>=2).sum()):,} clips ({(majority[EVENTS].sum(axis=1)>=2).mean()*100:.2f}%)** have at least two majority-positive event types.
- **{ambiguous.sum():,} clips ({ambiguous.mean()*100:.2f}%)** have neither a majority-positive event nor a majority-positive No Stuttered Words label. These should not automatically be marked fluent.
- No Stuttered Words overlaps at least one event category in **{overlap.sum():,} clips**, and overlaps one of the four non-interjection event categories in **{core_overlap.sum():,} clips**. Preserve the independent labels rather than forcing exclusivity.
- Block prevalence is **{stats.loc['Block','any_vote_pct']:.2f}%** at ≥1 vote but **{stats.loc['Block','majority_pct']:.2f}%** at majority and **{stats.loc['Block','unanimous_pct']:.2f}%** unanimously; threshold choice materially affects apparent class balance.
- Compare show-specific rates in `show_prevalence.csv`; overall rates are dominated by the larger shows, not an equal-show average.

## Implications for this project

Use clip-level multilabel targets and report metrics per category. Split evaluation
by episode at minimum, and by speaker/show when reliable identities are available,
to reduce shared-speaker/context leakage. Report the vote threshold and any quality
filter alongside results. Majority labels do not establish the number or timing of
events: overlapping three-second predictions cannot be directly summed into your
conversation occurrence counts. An event segmentation/merging rule and separate
validation are needed. No diagnosis, severity score, or child-specific performance
can be inferred from these podcast annotation statistics.

## Outputs and reproducibility

Run `.venv/bin/python analyze.py` in `ml/sep28k_analysis/` after installing
`requirements.txt`. Raw CSV snapshots and SHA-256 hashes in `results/provenance.json`
identify inputs. The report regenerates six PNG/SVG plots, a combined PDF,
machine-readable summary tables, and `audit.json`. `index.html` is a standalone
local gallery that references the PNG files in this folder.

Dataset attribution: Colin Lea, Vikramjit Mitra, Aparna Joshi, Sachin Kajarekar,
Jeffrey P. Bigham, *SEP-28k: A Dataset for Stuttering Event Detection from Podcasts
with People Who Stutter*, ICASSP 2021. The upstream dataset is CC BY-NC 4.0;
original podcast audio copyrights remain with their owners.
"""
(OUT / "report.md").write_text(report)
gallery = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>SEP-28k analysis</title><style>body{font:17px system-ui;background:#f7f9fc;color:#172b40;max-width:1200px;margin:40px auto;padding:0 24px}img{width:100%;margin:20px 0}p{line-height:1.6}a{color:#285d94}</style><h1>SEP-28k · Statistical analysis</h1>'
gallery += f'<p>{len(df):,} clips · {len(episode_sizes)} episodes · {len(show_sizes)} shows · {duration.sum()/3600:.2f} hours. Labels represent reviewer votes, not event counts. Main threshold: ≥2 of 3 votes.</p><p><a href="report.md">Full report</a> · <a href="sep28k_plots.pdf">Download all plots (PDF)</a> · <a href="label_statistics.csv">Statistics (CSV)</a></p>'
gallery += ''.join(f'<img src="{name}.png" alt="{html.escape(name.replace("_", " "))}">' for name in figures)
(OUT / "index.html").write_text(gallery+'</html>')
print(json.dumps(audit, indent=2, default=int))
print(stats.loc[LABELS, ["majority_count", "majority_pct", "fleiss_kappa"]].to_string())
print(f"Saved report and {len(figures)} plots to {OUT}")

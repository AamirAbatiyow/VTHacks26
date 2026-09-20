# SEP-28k statistical analysis

## Scope and methods

Analysis of the official [episode metadata](https://github.com/apple-aiml-research/ml-stuttering-events-dataset/blob/main/SEP-28k_episodes.csv)
and [clip labels](https://github.com/apple-aiml-research/ml-stuttering-events-dataset/blob/main/SEP-28k_labels.csv).
The [upstream documentation](https://github.com/apple-aiml-research/ml-stuttering-events-dataset#annotation-descriptions)
specifies three reviewers per clip and multiple allowed labels. Values 0–3 are
reviewer votes, **not event occurrence counts**. Main results use ≥2 votes; sensitivity
plots also show ≥1 vote and unanimous agreement. Every clip is retained; denominator
is all 28,177 clips unless explicitly grouped by show. No audio was downloaded or
reclassified, and no model was trained or evaluated.

Intervals are percentile 95% episode-cluster bootstrap intervals (3,000 resamples,
seed 20260919), resampling episodes with replacement and recalculating the clip-weighted
proportion. Dependence within an episode is preserved, but recurring speakers across
episodes and shows are not accounted for. These are descriptive sensitivity intervals,
not clinical or population prevalence estimates. Fleiss κ treats each label as a binary
three-rater decision and is derived from its vote totals; individual reviewer identities
and reviewer-specific performance are unavailable.

## Dataset audit

- **28,177 clips**, **385 episodes**, **8 podcast shows**; 385 metadata rows.
- Summed annotated duration: **23.48 hours**; union of annotated time intervals: **20.98 hours**.
- Durations range **2.540–3.000 seconds**; 9 clips are not exactly three seconds.
- Start/stop positions are 16 kHz sample indices, as verified in the upstream extraction script.
- Zero missing label values, invalid vote counts, duplicate clip IDs, duplicate episode keys, or unmatched episode joins.
- 9424 intervals overlap preceding audio within the same episode.
- Clips per episode: median 40, IQR 40–40, range 40–503.
- Largest contribution: WomenWhoStutter, 9,163 clips (32.5%).

## Main label estimates

| Label | Majority clips | Percent | 95% episode-bootstrap interval | Fleiss κ |
|---|---:|---:|---:|---:|
| Prolongation | 2,812 | 9.98% | 9.06–10.90% | 0.254 |
| Block | 3,370 | 11.96% | 11.16–12.82% | 0.112 |
| Sound repetition | 2,342 | 8.31% | 7.17–9.53% | 0.399 |
| Word repetition | 2,770 | 9.83% | 8.90–10.79% | 0.626 |
| No stuttered words | 16,046 | 56.95% | 55.19–58.78% | 0.390 |
| Interjection | 5,973 | 21.20% | 19.55–22.78% | 0.574 |


Labels are not mutually exclusive, so percentages should not be summed.

## Key findings

- At least one of the five event categories has majority support in **14,022 clips (49.76%)**.
- **3,009 clips (10.68%)** have at least two majority-positive event types.
- **1,736 clips (6.16%)** have neither a majority-positive event nor a majority-positive No Stuttered Words label. These should not automatically be marked fluent.
- No Stuttered Words overlaps at least one event category in **3,627 clips**, and overlaps one of the four non-interjection event categories in **199 clips**. Preserve the independent labels rather than forcing exclusivity.
- Block prevalence is **42.48%** at ≥1 vote but **11.96%** at majority and **1.87%** unanimously; threshold choice materially affects apparent class balance.
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

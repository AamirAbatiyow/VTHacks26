# SEP-28k annotation statistics

Open [the report](results/report.md), [plot gallery](results/index.html), or
[six-page plot PDF](results/sep28k_plots.pdf). Individual plots are PNG and SVG.

This analyzes the complete official SEP-28k metadata and clip annotations, not
the locally downloaded training subset. It does not modify the voice app or train models.

## Reproduce

Python 3.14 was used. From this folder:

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python analyze.py
```

Inputs are saved in `data/`; source URLs, hashes, and software versions are in
`results/provenance.json`. The virtual environment and plotting cache are ignored.
Output CSVs contain prevalence, agreement, overlap, and episode/show statistics.
Assertions validate annotation ranges, missingness, clip IDs, and episode joins.

Labels are votes from three reviewers, not occurrence counts. Majority (≥2 votes)
is the primary threshold; labels remain independent. See the full report for
bootstrap assumptions, limitations, and dataset attribution. Original upstream
README and license are included with the inputs.

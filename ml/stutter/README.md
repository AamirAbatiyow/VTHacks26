# Stutter event detection (SEP-28k)

A multi-label classifier that scores an utterance for five stuttering event
types plus fluent speech. It runs server-side on the **original microphone
PCM** — never on the transcript — and reports results to the UI per user turn.

| Class | Meaning |
| --- | --- |
| `Prolongation` | A sound held too long ("ssssoup") |
| `Block` | Audible or silent struggle before a sound |
| `SoundRep` | Repeated sound or syllable ("b-b-ball") |
| `WordRep` | Repeated whole word ("I I I went") |
| `Interjection` | Filler such as "um", "uh", "you know" |
| `Fluent` | Annotators marked no stuttered words |

Labels are **not** mutually exclusive — about 3,000 clips in the dataset carry
more than one event type — so the model uses independent sigmoid outputs and
binary cross-entropy rather than a softmax.

## Data

[SEP-28k](https://github.com/apple/ml-stuttering-events-dataset) ships labels
only; the audio has to be fetched from the original podcast feeds. Three of the
eight shows (`StutteringIsCool`, `StrongVoices`, `IStutterSoWhat`) are no longer
hosted, and FluencyBank now sits behind a login. What remains:

```
20,841 clips / 258 episodes / 5 shows   (74.5% of SEP-28k)
20,477 usable after dropping clips annotated as music, silence, or "unsure"
```

Class balance survives the loss almost exactly (e.g. Block 12.0% -> 12.1%), so
the subset is representative rather than skewed.

`prepare_data.py` downloads each episode, resamples to 16 kHz mono, cuts the
labeled 3-second clips, then deletes the episode audio — peak disk stays near
one episode per worker instead of the ~13 GB the full corpus would need. It is
resumable and safe to re-run.

```bash
python -m venv ../.venv && ../.venv/bin/pip install -r requirements.txt

../.venv/bin/python prepare_data.py \
  --dataset /path/to/ml-stuttering-events-dataset-main \
  --out /path/to/sep28k_data --workers 8
```

Output is `clips.i16` (a flat int16 memmap, 48,000 samples per clip) alongside
`meta.csv`.

## Training

```bash
../.venv/bin/python train.py --data /path/to/sep28k_data --out artifacts --epochs 45
```

Design notes that matter for accuracy:

- **Episode-disjoint splits.** Clips from one episode share a speaker, so a
  random clip-level split would let the model memorize voices and report
  inflated scores. Splitting by episode measures generalization to new speakers.
- **Soft targets.** Each clip has 3 annotators; targets are vote fractions
  (0, ⅓, ⅔, 1) instead of hard labels, which carries annotator uncertainty into
  the loss. Evaluation binarizes at ≥2 votes, matching the dataset paper.
- **Per-example normalization.** The log-mel spectrogram is standardized per
  clip so the model keys on spectral shape, not recording level — podcast audio
  and a laptop mic differ by a lot of gain.
- **Class weighting + augmentation.** `pos_weight` (capped at 8) keeps rare
  events from being drowned out by the majority `Fluent` class; training adds
  time shift, gain jitter, noise, and SpecAugment.

Thresholds are tuned per class on validation to maximize F1, then applied
unchanged to the test set.

### Results

45 epochs, 1.31M parameters, ~50 min on an M-series GPU (MPS). Scores are on
**held-out episodes** — none of these speakers appear in training.

| Class | ROC-AUC | Avg. precision | F1 | Threshold | Test positives |
| --- | --- | --- | --- | --- | --- |
| Prolongation | 0.882 | 0.491 | 0.478 | 0.73 | 227 |
| Block | 0.725 | 0.235 | 0.315 | 0.69 | 295 |
| SoundRep | 0.853 | 0.463 | 0.462 | 0.77 | 250 |
| WordRep | 0.769 | 0.351 | 0.366 | 0.61 | 284 |
| Interjection | 0.917 | 0.834 | 0.753 | 0.66 | 673 |
| Fluent | 0.793 | 0.813 | 0.782 | 0.37 | 1475 |
| **Macro** | **0.823** | **0.531** | **0.526** | | |

`Block` is the weakest class, which is expected: a block is often a *silent*
struggle before a sound, so there is little acoustic energy to key on, and it is
also the event annotators agree on least. `Interjection` is the strongest
because fillers like "um" have a consistent, easily-learned acoustic signature.

Thresholds maximize F1, which leans toward recall. If false positives are more
costly than misses in your setting, raise them in `stutter.json` — the ranking
quality (AUC) is unaffected.

## Two-head variant (experimental)

The single-head model's weakest decision is the aggregate one — "is this clip
disfluent at all" — so `model_twohead.py` splits that out into a cascade:

    stage 1   binary gate    any stutter vs not      (trained on every clip)
    stage 2   type head      which type(s)           (trained only on
                                                      stutter-positive clips)

Both heads share one trunk, so it is still a single forward pass and still
1.31M parameters. Freed from the fluent majority, stage 2 spends its capacity
on telling stutter types apart rather than on detecting them. Per-class output
is the cascade product `P(any) * P(type | any)`.

Stage 1 predicts `Fluent` **directly** rather than as `1 - P(any stutter)`.
SEP-28k annotates `Fluent` independently and it agrees with "no stutter type
reached 2 votes" only 80% of the time — 2,828 clips carry both a stutter and a
`Fluent` label, and 1,260 carry neither. An earlier revision derived it and
lost 0.12 AUC on that class alone.

```bash
../.venv/bin/python train_twohead.py --data <dir> --out artifacts_twohead --device mps
../.venv/bin/python compare_twohead.py --data <dir> --device mps
```

`--detach` cannot be combined with `--device mps`: daemonizing calls `setsid()`,
which leaves the Mach bootstrap namespace and makes Metal's shader compiler
unreachable, aborting on the first GPU kernel.

### Results vs. the single-head model

Same trunk, seed, splits, augmentation, schedule, and epoch count, so the
comparison isolates the architecture. Deltas carry a 2000-sample paired
bootstrap over test clips.

Stage 1, any stutter vs. not (test n=2642, 1406 positive):

| Metric | Single-head | Two-head | Delta |
| --- | --- | --- | --- |
| ROC-AUC | 0.798 | **0.815** | **+0.017**, 95% CI [+0.008, +0.026], p=0.001 |
| Avg. precision | 0.823 | **0.835** | +0.012 |
| F1 | 0.753 | **0.764** | +0.011 |
| Accuracy | 0.715 | **0.734** | +1.9 pts |

The single-head model has no explicit "any stutter" output, so it is scored
with the better of two rules, chosen on validation: `max P(type)` (AUC 0.811)
beat `1 - P(Fluent)` (0.721).

Per-class ROC-AUC:

| Class | Single-head | Two-head | Delta | p |
| --- | --- | --- | --- | --- |
| Prolongation | 0.882 | 0.871 | -0.011 | 0.031 |
| Block | 0.725 | 0.697 | -0.028 | 0.002 |
| SoundRep | 0.853 | 0.850 | -0.003 | 0.56 |
| WordRep | 0.769 | 0.759 | -0.010 | 0.12 |
| Interjection | 0.917 | 0.920 | +0.003 | 0.36 |
| Fluent | 0.793 | 0.788 | -0.005 | 0.20 |
| **Macro** | **0.823** | 0.814 | -0.009 | |

So the cascade buys a real, significant gain on the abnormal/normal gate and
pays for it with a small regression on fine-grained typing — significant only
for `Prolongation` and `Block`. That is the expected trade: stage 2 sees only
the 53% of clips that are stutter-positive, so each type has roughly half the
training signal it had in the single-head model. Weighted F1 is a wash (0.650
vs 0.644).

### What ships

Each model is used where it wins. The server keeps the single-head
`stutter.onnx` for per-type scores and adds the two-head `stutter_gate.onnx`
for the overall fluency score:

```bash
../.venv/bin/python export_onnx_twohead.py \
  --out ../../conversational-ai/server/models/stutter_gate.onnx
```

The gate graph exposes two outputs — `logits [B,6]` (cascade log-odds, same
contract as the single-head export) and `gate [B]` (stage-1 any-stutter
log-odds). Only `gate` is consumed today; `logits` is there so the two-head
model can stand alone later without a re-export.

Both graphs run on the same batched windows, so the cost is one extra ~66 ms
pass per 8-window batch. That sits in the post-utterance analysis path, not the
speech path, so it does not affect conversational latency. `stutter_gate.onnx`
is optional: if it is absent, fluency falls back to the single-head `Fluent`
output and a log line says so. Override its location with `STUTTER_GATE_PATH`.

Verified against the deployed artifacts on the test split: gate AUC 0.8149 and
single-head AUC 0.7980, matching the PyTorch numbers exactly.

## Export

```bash
../.venv/bin/python export_onnx.py \
  --out ../../conversational-ai/server/models/stutter.onnx
```

The STFT and mel filterbank are built from frozen conv/matmul ops rather than
torchaudio, so **feature extraction lives inside the ONNX graph**. The exported
model takes a raw waveform `[batch, 48000]` of float32 samples at 16 kHz and
returns `[batch, 6]` logits. The Node server therefore never reimplements a mel
frontend, which removes any chance of training/serving feature skew. The export
step asserts PyTorch and ONNX agree to within 1e-3.

A sidecar `stutter.json` carries the label order, sample rate, and tuned
thresholds.

## Trying it on a file

```bash
../.venv/bin/python predict.py \
  --model ../../conversational-ai/server/models/stutter.onnx \
  --audio "../../audio samples/st1.wav"
```

## How the server uses it

`server/src/analysis/StutterClassifier.ts` loads the ONNX model once per process
and, for each completed user turn, slides 3-second windows with a 1.5-second hop
over the captured microphone audio. Windows below an RMS gate are skipped so
silence cannot produce false positives. Per-class scores are aggregated with a
max across windows (an event anywhere in the utterance counts), and the result
is sent to the browser as a `stutter_analysis` event.

Inference runs **concurrently with the LLM response**, not in front of it, so it
adds no latency to the spoken reply. If the model file is missing the classifier
disables itself and the voice pipeline runs unchanged.

## Split an audio file into three-second clips and classify each one

From the repository root (uses the existing Node server dependencies):

```bash
node --import ./conversational-ai/node_modules/tsx/dist/loader.mjs \
  ml/stutter/classify_clips.ts \
  --audio "audio samples/IMG_4042.mp3" \
  --out "audio samples/IMG_4042_clips_new"
```

Compressed input uses FFmpeg. On machines without FFmpeg, pass
`--decoder-library /absolute/path/to/libmpg123` to use `decode_mp3.py` with
Python's standard library and an existing native mpg123 decoder. PCM 16-bit
WAV input needs neither decoder.

The script writes non-overlapping, three-second mono WAV files at the decoded
sample rate and classifies each using the actual `StutterClassifier` server
implementation, including its resampling, silence gate, thresholds, and optional
two-head fluency model. The last clip is zero-padded; its original end timestamp
and padding duration are recorded. It refuses to overwrite a nonempty output
directory. `results.csv` contains timestamps, detected labels, all six model
scores, and fluency; `results.json` also includes model metadata and per-window
outputs. Labels are independent and can overlap, including Fluent.

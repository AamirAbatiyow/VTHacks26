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

## Export — vocametrix (open-source comparison model)

`vocametrix/wav2vec2-xlsr-53-stuttering-classification` (see `vocametrix.py`,
`eval_vocametrix.py`) can be exported to the *same* ONNX contract as our CNN,
so the Node server treats it as just another registered model — same
`waveform -> logits` I/O, same sidecar `.json` shape, zero server code
differences:

```bash
../.venv/bin/python export_onnx_vocametrix.py \
  --data /path/to/sep28k_data \
  --out ../../conversational-ai/server/models/stutter_vocametrix.onnx
```

vocametrix is single-label softmax (6 mutually exclusive classes), not
multi-label like the CNN. The export bakes softmax -> inverse-sigmoid into
the graph (`logit = ln(p / (1-p))`) so `sigmoid(logits)` reproduces its
softmax probabilities exactly — `StutterClassifier.ts` doesn't need to know
which activation a given model natively uses. Its native window is 4s
(64000 samples @ 16kHz) rather than the CNN's 3s; that's carried in the
sidecar `.json`'s `clipSamples` and the server reads it generically, so no
code change is needed for the different window size.

Before trusting the export, the script re-runs a handful of val clips
through both the exported graph *and* `vocametrix.py`'s own HF pipeline and
asserts they agree to 1e-3 — catches any mismatch in the hand-rolled
zero-mean/unit-variance normalization immediately instead of shipping a
silently-wrong model. Pass `--data` to also tune per-label thresholds on the
val split (same procedure `train.py` uses for the CNN); omit it to write
default 0.5 thresholds you can hand-edit later in `stutter_vocametrix.json`.

Once exported, it's live in the app immediately: `modelRegistry.ts` already
lists a `vocametrix` entry pointing at this file, so it appears in the
client's model dropdown / is selectable via `STUTTER_MODEL=vocametrix` with
no further edits.

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

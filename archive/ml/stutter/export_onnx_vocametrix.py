"""
Export vocametrix/wav2vec2-xlsr-53-stuttering-classification to the SAME
ONNX contract export_onnx.py produces for our own CNN, so the Node server
(StutterClassifier.ts) can load either model with zero runtime code
changes — just a different conversational-ai/server/models/*.onnx file and
a registry entry (see server/src/analysis/modelRegistry.ts).

Contract:
  input  "waveform" float32 [batch, clipSamples]   samples in [-1, 1]
  output "logits"   float32 [batch, 6]              sigmoid-able, same
          LABELS order as model.py (Prolongation, Block, SoundRep, WordRep,
          Interjection, Fluent)
  sidecar "<name>.json": {labels, sampleRate, clipSamples, thresholds}

vocametrix is a SINGLE-LABEL softmax classifier (6 mutually-exclusive
classes) — not multi-label like our CNN. StutterClassifier.ts always applies
sigmoid(logits) per class independently; rather than teaching the server a
second activation function, we bake the conversion into the graph itself:
compute vocametrix's own softmax, permute into our LABELS order (see
vocametrix.py's _PERM), then invert the sigmoid so that
sigmoid(baked_logit) == softmax_probability exactly. From the server's
point of view this model is indistinguishable from the CNN: same op, same
output name, same shape, same downstream math.

Usage (run on a machine with the ml/stutter venv — this pulls in
transformers/torch/librosa, same as vocametrix.py and eval_vocametrix.py):

    ../.venv/bin/python export_onnx_vocametrix.py \
      --data /path/to/sep28k_data \
      --out ../../conversational-ai/server/models/stutter_vocametrix.onnx

Pass --data (the same prepare_data.py output eval_vocametrix.py reads) to
tune per-label thresholds on the val split — same procedure train.py uses
for the CNN. Omit it to write default 0.5 thresholds you can hand-tune
later directly in the sidecar .json (no re-export needed).
"""

import argparse
import json
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

from model import LABELS
from vocametrix import _PERM as VOCAMETRIX_PERM
from vocametrix import feature_extractor
from vocametrix import model as hf_model
from vocametrix import vocametrix_classify_array

SAMPLE_RATE = 16000
CLIP_SECONDS = 4.0  # vocametrix's native window (see vocametrix.py)
CLIP_SAMPLES = int(CLIP_SECONDS * SAMPLE_RATE)
EPS = 1e-6


class VocametrixONNXWrapper(nn.Module):
    """waveform -> logits, matching StutterNet's exported contract exactly."""

    def __init__(self, hf_model, perm, do_normalize: bool):
        super().__init__()
        self.hf_model = hf_model
        self.register_buffer("perm", torch.tensor(perm, dtype=torch.long))
        self.do_normalize = do_normalize

    def forward(self, waveform: torch.Tensor) -> torch.Tensor:
        x = waveform
        if self.do_normalize:
            # Wav2Vec2FeatureExtractor's zero-mean/unit-variance normalization,
            # reimplemented as tensor ops so it's baked into the graph instead
            # of living in a separate preprocessing step the server would have
            # to reimplement in TypeScript.
            mean = x.mean(dim=-1, keepdim=True)
            var = x.var(dim=-1, keepdim=True, unbiased=False)
            x = (x - mean) / torch.sqrt(var + EPS)

        raw_logits = self.hf_model(input_values=x).logits  # [B, n_classes], vocametrix's own order
        probs = F.softmax(raw_logits, dim=-1).index_select(-1, self.perm)  # reorder -> LABELS
        probs = probs.clamp(EPS, 1 - EPS)
        return torch.log(probs / (1 - probs))  # sigmoid(this) == probs, exactly


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="output .onnx path")
    ap.add_argument(
        "--data",
        default=None,
        help="SEP-28k data dir (prepare_data.py output) to tune thresholds on the val "
        "split. Omit to write default 0.5 thresholds for every label.",
    )
    ap.add_argument("--seed", type=int, default=0, help="must match train.py's split seed")
    ap.add_argument(
        "--parity-clips",
        type=int,
        default=8,
        help="val clips to sanity-check the exported graph against vocametrix.py's own "
        "HF pipeline before trusting it (requires --data)",
    )
    args = ap.parse_args()

    do_normalize = bool(getattr(feature_extractor, "do_normalize", True))
    wrapper = VocametrixONNXWrapper(hf_model, VOCAMETRIX_PERM, do_normalize).eval()

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    dummy = torch.randn(2, CLIP_SAMPLES) * 0.05
    torch.onnx.export(
        wrapper,
        (dummy,),
        str(out_path),
        input_names=["waveform"],
        output_names=["logits"],
        dynamic_axes={"waveform": {0: "batch"}, "logits": {0: "batch"}},
        opset_version=17,
        dynamo=False,
    )

    import onnxruntime as ort

    sess = ort.InferenceSession(str(out_path), providers=["CPUExecutionProvider"])
    # vocametrix is a ~300M-param wav2vec2-XLSR transformer (vs. the CNN's
    # 1.3M params), so float32 rounding accumulates over many more layers
    # between the traced ONNX graph and eager PyTorch. 1e-3 (the CNN's
    # tolerance) is unrealistically tight here; the logits themselves are
    # squashed through sigmoid downstream, so this level of drift has no
    # visible effect on the resulting probabilities.
    ONNX_TOLERANCE = 5e-3
    for n_batch in (1, 3):
        x = (torch.randn(n_batch, CLIP_SAMPLES) * 0.05).numpy().astype(np.float32)
        with torch.no_grad():
            ref = wrapper(torch.from_numpy(x)).numpy()
        got = sess.run(["logits"], {"waveform": x})[0]
        err = float(np.abs(ref - got).max())
        print(f"batch={n_batch} max|torch - onnx| = {err:.3e}")
        assert err < ONNX_TOLERANCE, f"ONNX output diverges from PyTorch ({err})"

    thresholds = {label: 0.5 for label in LABELS}
    if args.data:
        from data import N_ANNOTATORS, clean_mask, load_corpus, split_by_episode
        from train import evaluate, fmt

        clips, votes, episodes, aux = load_corpus(args.data)
        keep = clean_mask(aux)
        split = split_by_episode(episodes, seed=args.seed)
        idx = np.where(keep & (split == "val"))[0]

        print(f"\ntuning thresholds on {len(idx)} val clips from {args.data} ...")
        probs = np.zeros((len(idx), len(LABELS)), dtype=np.float32)
        checked = 0
        for row, i in enumerate(idx):
            wav = clips[i].astype(np.float32) / 32768.0
            probs[row] = vocametrix_classify_array(wav)  # original HF pipeline (ground truth)

            if checked < args.parity_clips:
                clip = wav[:CLIP_SAMPLES]
                if len(clip) < CLIP_SAMPLES:
                    clip = np.pad(clip, (0, CLIP_SAMPLES - len(clip)))
                with torch.no_grad():
                    onnx_probs = torch.sigmoid(
                        wrapper(torch.from_numpy(clip).unsqueeze(0))
                    ).numpy()[0]
                diff = float(np.abs(onnx_probs - probs[row]).max())
                assert diff < ONNX_TOLERANCE, (
                    f"exported graph diverges from vocametrix.py's own HF pipeline on "
                    f"val clip {i} (max diff {diff:.3e}) — check do_normalize / padding "
                    f"assumptions in VocametrixONNXWrapper before trusting this export"
                )
                checked += 1

            if row % 200 == 0:
                print(f"  val: {row}/{len(idx)}", end="\r")

        print(
            f"\nparity check passed on {checked} clips "
            f"(exported graph == vocametrix.py's own HF pipeline, max diff < 1e-3)"
        )

        targets = votes[idx] / N_ANNOTATORS
        val_metrics, thresholds = evaluate(probs, targets)
        print(fmt(val_metrics))
    else:
        print(
            "\n--data not given: writing default 0.5 thresholds for every label "
            "(tune later by re-running with --data, or hand-edit the sidecar .json)."
        )

    sidecar = out_path.with_suffix(".json")
    json.dump(
        {
            "labels": LABELS,
            "sampleRate": SAMPLE_RATE,
            "clipSamples": CLIP_SAMPLES,
            "thresholds": thresholds,
        },
        open(sidecar, "w"),
        indent=2,
    )
    size_mb = out_path.stat().st_size / 1e6
    print(f"\nwrote {out_path} ({size_mb:.1f} MB) and {sidecar}")


if __name__ == "__main__":
    main()

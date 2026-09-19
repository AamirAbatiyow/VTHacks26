"""
Export the trained classifier to ONNX for the Node inference server.

The exported graph takes a raw waveform batch [B, 48000] of float32 samples in
[-1, 1] at 16 kHz and returns [B, 6] logits. Feature extraction is inside the
graph, so the server never reimplements the mel frontend.
"""

import argparse
import json
from pathlib import Path

import numpy as np
import torch

from model import CLIP_SAMPLES, LABELS, SAMPLE_RATE, StutterNet


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", default="artifacts/stutter_net.pt")
    ap.add_argument("--metrics", default="artifacts/metrics.json")
    ap.add_argument("--out", required=True, help="output .onnx path")
    args = ap.parse_args()

    ckpt = torch.load(args.checkpoint, map_location="cpu")
    model = StutterNet(width=ckpt["width"])
    model.load_state_dict(ckpt["state_dict"])
    model.eval()

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    dummy = torch.randn(2, CLIP_SAMPLES) * 0.05
    torch.onnx.export(
        model,
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
    for n_batch in (1, 3):
        x = (torch.randn(n_batch, CLIP_SAMPLES) * 0.05).numpy().astype(np.float32)
        with torch.no_grad():
            ref = model(torch.from_numpy(x)).numpy()
        got = sess.run(["logits"], {"waveform": x})[0]
        err = float(np.abs(ref - got).max())
        print(f"batch={n_batch} max|torch - onnx| = {err:.3e}")
        assert err < 1e-3, f"ONNX output diverges from PyTorch ({err})"

    thresholds = {}
    if Path(args.metrics).exists():
        thresholds = json.load(open(args.metrics)).get("thresholds", {})

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

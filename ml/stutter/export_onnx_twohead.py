"""
Export the two-head cascade to ONNX.

Emits two outputs from one graph:

    logits [B, 6]  cascade log-odds over LABELS, same contract as the
                   single-head export (apply a sigmoid to get probabilities)
    gate   [B]     stage-1 any-stutter log-odds

The server only needs `gate` — per-type scores still come from the single-head
model, which benchmarks marginally better on fine-grained typing — but `logits`
is exported too so the two-head model can stand alone if that ever changes.
"""

import argparse
import json
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

from model import CLIP_SAMPLES, LABELS, SAMPLE_RATE
from model_twohead import EPS, TYPES, StutterNetTwoHead


class ExportWrapper(nn.Module):
    """Builds the output columns with cat() rather than index assignment, which
    keeps the exported graph free of scatter ops."""

    def __init__(self, net: StutterNetTwoHead):
        super().__init__()
        self.net = net

    def forward(self, wav: torch.Tensor):
        stage1, type_logits = self.net.heads(self.net.features(wav))
        p_any = torch.sigmoid(stage1[:, :1])
        p_joint = (p_any * torch.sigmoid(type_logits)).clamp(EPS, 1 - EPS)
        joint_logodds = torch.log(p_joint / (1 - p_joint))

        cols = []
        for name in LABELS:
            if name in TYPES:
                j = TYPES.index(name)
                cols.append(joint_logodds[:, j : j + 1])
            else:
                cols.append(stage1[:, 1:2])
        return torch.cat(cols, dim=1), stage1[:, 0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", default="artifacts_twohead/stutter_twohead.pt")
    ap.add_argument("--metrics", default="artifacts_twohead/metrics.json")
    ap.add_argument("--out", required=True, help="output .onnx path")
    args = ap.parse_args()

    ckpt = torch.load(args.checkpoint, map_location="cpu")
    net = StutterNetTwoHead(width=ckpt.get("width", 32))
    net.load_state_dict(ckpt["state_dict"])
    net.eval()
    model = ExportWrapper(net).eval()

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    dummy = torch.randn(2, CLIP_SAMPLES) * 0.05
    torch.onnx.export(
        model,
        (dummy,),
        str(out_path),
        input_names=["waveform"],
        output_names=["logits", "gate"],
        dynamic_axes={
            "waveform": {0: "batch"},
            "logits": {0: "batch"},
            "gate": {0: "batch"},
        },
        opset_version=17,
        dynamo=False,
    )

    import onnxruntime as ort

    sess = ort.InferenceSession(str(out_path), providers=["CPUExecutionProvider"])
    for n_batch in (1, 3):
        x = (torch.randn(n_batch, CLIP_SAMPLES) * 0.05).numpy().astype(np.float32)
        with torch.no_grad():
            ref_logits, ref_gate = model(torch.from_numpy(x))
        got_logits, got_gate = sess.run(["logits", "gate"], {"waveform": x})
        e1 = float(np.abs(ref_logits.numpy() - got_logits).max())
        e2 = float(np.abs(ref_gate.numpy() - got_gate).max())
        print(f"batch={n_batch} max|torch - onnx|  logits={e1:.3e}  gate={e2:.3e}")
        assert max(e1, e2) < 1e-3, "ONNX output diverges from PyTorch"

    metrics = json.load(open(args.metrics)) if Path(args.metrics).exists() else {}
    thresholds = metrics.get("thresholds", {})
    sidecar = out_path.with_suffix(".json")
    json.dump(
        {
            "labels": LABELS,
            "types": TYPES,
            "sampleRate": SAMPLE_RATE,
            "clipSamples": CLIP_SAMPLES,
            "gateThreshold": thresholds.get("_binary", 0.5),
            "thresholds": {k: v for k, v in thresholds.items() if not k.startswith("_")},
        },
        open(sidecar, "w"),
        indent=2,
    )
    print(f"\nwrote {out_path} ({out_path.stat().st_size/1e6:.1f} MB) and {sidecar}")


if __name__ == "__main__":
    main()

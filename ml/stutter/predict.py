"""
Run the exported ONNX classifier on an audio file.

This intentionally uses the ONNX artifact (not the PyTorch checkpoint) so it
exercises exactly what the Node server loads at runtime.

    python predict.py --model ../../conversational-ai/server/models/stutter.onnx --audio clip.wav
"""

import argparse
import json
import subprocess
from pathlib import Path

import numpy as np
import onnxruntime as ort

SILENCE_RMS = 0.003


def load_audio(path: str, sample_rate: int) -> np.ndarray:
    """Decode anything ffmpeg understands into mono float32 at sample_rate."""
    out = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-i", str(path),
         "-ac", "1", "-ar", str(sample_rate), "-f", "s16le", "-"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(out, dtype=np.int16).astype(np.float32) / 32768.0


def window_starts(total: int, clip: int) -> list[int]:
    if total <= clip:
        return [0]
    hop = clip // 2
    starts = list(range(0, total - clip + 1, hop))
    if starts[-1] + clip < total:
        starts.append(total - clip)
    return starts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--audio", required=True, nargs="+")
    args = ap.parse_args()

    meta = json.load(open(Path(args.model).with_suffix(".json")))
    labels, sr, clip = meta["labels"], meta["sampleRate"], meta["clipSamples"]
    thresholds = meta.get("thresholds", {})
    sess = ort.InferenceSession(args.model, providers=["CPUExecutionProvider"])

    for audio_path in args.audio:
        wav = load_audio(audio_path, sr)
        batch, starts = [], []
        for s in window_starts(len(wav), clip):
            w = np.zeros(clip, dtype=np.float32)
            seg = wav[s:s + clip]
            w[:len(seg)] = seg
            if np.sqrt((w ** 2).mean()) < SILENCE_RMS:
                continue
            batch.append(w)
            starts.append(s)

        print(f"\n=== {audio_path}  ({len(wav)/sr:.1f}s, {len(batch)} windows) ===")
        if not batch:
            print("  all windows below the silence gate")
            continue

        logits = sess.run(["logits"], {"waveform": np.stack(batch)})[0]
        probs = 1 / (1 + np.exp(-logits))

        print("  per-window:")
        for s, p in zip(starts, probs):
            top = ", ".join(
                f"{labels[i]}={p[i]:.2f}" for i in np.argsort(-p)[:3]
            )
            print(f"    {s/sr:5.1f}s  {top}")

        print("  utterance (max over windows):")
        for i, name in enumerate(labels):
            peak = float(probs[:, i].max())
            thr = thresholds.get(name, 0.5)
            flag = "  <-- DETECTED" if peak >= thr and name != "Fluent" else ""
            print(f"    {name:14s} {peak:.3f}  (thr {thr:.2f}){flag}")


if __name__ == "__main__":
    main()

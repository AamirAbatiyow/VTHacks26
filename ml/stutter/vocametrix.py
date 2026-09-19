from transformers import AutoModelForAudioClassification, AutoFeatureExtractor
import torch
import torch.nn.functional as F
import librosa
import numpy as np

# Load model
model_name = "vocametrix/wav2vec2-xlsr-53-stuttering-classification"
feature_extractor = AutoFeatureExtractor.from_pretrained(model_name)
model = AutoModelForAudioClassification.from_pretrained(model_name)
model.eval()

def vocametrix_classify(audio_file):

    # Load audio (16 kHz, mono)
    audio, sr = librosa.load(audio_file, sr=16000, mono=True)

    chunk_duration = 4.0  # seconds
    overlap = 0.50
    chunk_samples = int(chunk_duration * 16000)
    step_samples = int(chunk_samples * (1 - overlap))

    results = []
    pos = 0
    while pos < len(audio):
        end = min(pos + chunk_samples, len(audio))
        chunk = audio[pos:end]
        if len(chunk) < chunk_samples:
            chunk = np.pad(chunk, (0, chunk_samples - len(chunk)))

        inputs = feature_extractor(chunk, sampling_rate=16000, return_tensors="pt", padding=True)
        with torch.no_grad():
            logits = model(**inputs).logits
            probs = F.softmax(logits, dim=-1)
            pred_id = torch.argmax(probs, dim=-1).item()
            results.append({
                "start": pos / 16000,
                "end": end / 16000,
                "label": model.config.id2label[pred_id],
                "confidence": probs[0][pred_id].item(),
            })
        pos += step_samples
    return results


# --- Added for eval_vocametrix.py -------------------------------------------
# vocametrix's own id2label order (from its config.json) does not match this
# repo's LABELS order in model.py. Map indices once so downstream code can
# treat both models' outputs as directionally the same 6-vector.
from model import LABELS  # ["Prolongation", "Block", "SoundRep", "WordRep", "Interjection", "Fluent"]

_VOCAMETRIX_ID2LABEL = model.config.id2label  # {0: "Soundrepetition", 1: "Wordrepetition", 2: "block", ...}
_NAME_MAP = {
    "soundrepetition": "SoundRep",
    "wordrepetition": "WordRep",
    "block": "Block",
    "fluent": "Fluent",
    "interjection": "Interjection",
    "prolongation": "Prolongation",
}
# _PERM[i] = index in vocametrix's softmax output that corresponds to LABELS[i]
_PERM = [
    next(k for k, v in _VOCAMETRIX_ID2LABEL.items() if _NAME_MAP[v.lower()] == name)
    for name in LABELS
]

print(_VOCAMETRIX_ID2LABEL,_PERM)

def vocametrix_classify_array(wav: np.ndarray, sr: int = 16000) -> np.ndarray:
    """
    Run vocametrix on an in-memory float32 mono waveform and return a single
    softmax probability vector of shape [6], reordered into this repo's
    LABELS order (Prolongation, Block, SoundRep, WordRep, Interjection, Fluent).

    Unlike vocametrix_classify(), this:
      - takes an array directly (no disk I/O, no ffmpeg subprocess) so timing
        measures only model inference, and eval doesn't write thousands of wavs.
      - does NOT chunk: our SEP-28k clips are a fixed 3s (48000 samples), which
        is shorter than vocametrix's 4s window, so there is always exactly one
        padded window. Multi-window aggregation is not needed for this corpus.
    """
    chunk_samples = int(4.0 * sr)
    if len(wav) < chunk_samples:
        wav = np.pad(wav, (0, chunk_samples - len(wav)))
    else:
        wav = wav[:chunk_samples]

    inputs = feature_extractor(wav, sampling_rate=sr, return_tensors="pt", padding=True)
    with torch.no_grad():
        logits = model(**inputs).logits
        probs = F.softmax(logits, dim=-1)[0].numpy()
    return probs[_PERM]

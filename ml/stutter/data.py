"""Dataset + episode-disjoint splits for the SEP-28k clip corpus."""

import csv
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import Dataset

from model import CLIP_SAMPLES, LABELS

# Annotators per clip in SEP-28k. Targets are vote fractions (soft labels);
# evaluation binarizes at >= 2 votes, matching the dataset paper.
N_ANNOTATORS = 3
POSITIVE_VOTES = 2

SOURCE_COLS = {
    "Prolongation": "Prolongation",
    "Block": "Block",
    "SoundRep": "SoundRep",
    "WordRep": "WordRep",
    "Interjection": "Interjection",
    "Fluent": "NoStutteredWords",
}


def load_corpus(data_dir: str):
    """Return (clips memmap [N, CLIP_SAMPLES] int16, votes [N, C] float32, episode ids [N])."""
    d = Path(data_dir)
    meta = list(csv.DictReader(open(d / "meta.csv")))
    clips = np.memmap(d / "clips.i16", dtype=np.int16, mode="r").reshape(-1, CLIP_SAMPLES)
    assert len(meta) == len(clips), f"meta {len(meta)} != clips {len(clips)}"

    votes = np.array(
        [[int(m[SOURCE_COLS[c]]) for c in LABELS] for m in meta], dtype=np.float32
    )
    aux = {
        k: np.array([int(m[k]) for m in meta], dtype=np.int16)
        for k in ("Unsure", "PoorAudioQuality", "DifficultToUnderstand", "NaturalPause", "Music", "NoSpeech")
    }
    episodes = np.array([f"{m['Show']}/{m['EpId']}" for m in meta])
    return clips, votes, episodes, aux


def clean_mask(aux) -> np.ndarray:
    """Drop clips the annotators flagged as music, silence, or unusable."""
    bad = (aux["Music"] >= POSITIVE_VOTES) | (aux["NoSpeech"] >= POSITIVE_VOTES) | (aux["Unsure"] >= POSITIVE_VOTES)
    return ~bad


def split_by_episode(episodes: np.ndarray, seed=0, val_frac=0.12, test_frac=0.12):
    """Episode-disjoint split. Clips from one episode share a speaker, so
    splitting at clip level would leak speaker identity into validation."""
    uniq = np.array(sorted(set(episodes.tolist())))
    rng = np.random.default_rng(seed)
    rng.shuffle(uniq)
    n = len(uniq)
    n_test = max(1, int(round(n * test_frac)))
    n_val = max(1, int(round(n * val_frac)))
    test_eps, val_eps = set(uniq[:n_test]), set(uniq[n_test:n_test + n_val])

    split = np.full(len(episodes), "train", dtype=object)
    for i, e in enumerate(episodes):
        if e in test_eps:
            split[i] = "test"
        elif e in val_eps:
            split[i] = "val"
    return split


class ClipDataset(Dataset):
    def __init__(self, clips, votes, indices, train=False):
        self.clips = clips
        self.votes = votes
        self.indices = indices
        self.train = train

    def __len__(self):
        return len(self.indices)

    def __getitem__(self, i):
        idx = self.indices[i]
        wav = self.clips[idx].astype(np.float32) / 32768.0
        y = self.votes[idx] / N_ANNOTATORS

        if self.train:
            wav = np.roll(wav, np.random.randint(-4000, 4000))
            wav = wav * np.float32(10 ** (np.random.uniform(-6, 6) / 20))
            if np.random.rand() < 0.5:
                wav = wav + np.random.randn(len(wav)).astype(np.float32) * np.float32(
                    np.random.uniform(0.0005, 0.005)
                )
            wav = np.clip(wav, -1.0, 1.0)

        return torch.from_numpy(np.ascontiguousarray(wav)), torch.from_numpy(y)

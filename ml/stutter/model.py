"""
Multi-label stutter event classifier.

The log-mel frontend is built from frozen conv1d/matmul ops rather than
torchaudio, so the whole waveform -> logits path exports to ONNX as a single
graph. The inference server then only has to hand over raw float32 samples.
"""

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

SAMPLE_RATE = 16000
CLIP_SAMPLES = SAMPLE_RATE * 3
N_FFT = 400
HOP = 160
N_MELS = 64
FMIN = 50.0
FMAX = 7600.0

LABELS = ["Prolongation", "Block", "SoundRep", "WordRep", "Interjection", "Fluent"]


def _hz_to_mel(hz):
    return 2595.0 * np.log10(1.0 + hz / 700.0)


def _mel_to_hz(mel):
    return 700.0 * (10.0 ** (mel / 2595.0) - 1.0)


def mel_filterbank(sr=SAMPLE_RATE, n_fft=N_FFT, n_mels=N_MELS, fmin=FMIN, fmax=FMAX):
    """Standard HTK-style triangular mel filters, shape [n_mels, n_fft//2 + 1]."""
    n_bins = n_fft // 2 + 1
    fft_freqs = np.linspace(0, sr / 2, n_bins)
    mel_points = np.linspace(_hz_to_mel(fmin), _hz_to_mel(fmax), n_mels + 2)
    hz_points = _mel_to_hz(mel_points)

    fb = np.zeros((n_mels, n_bins), dtype=np.float32)
    for m in range(n_mels):
        left, center, right = hz_points[m], hz_points[m + 1], hz_points[m + 2]
        rising = (fft_freqs - left) / max(center - left, 1e-9)
        falling = (right - fft_freqs) / max(right - center, 1e-9)
        fb[m] = np.maximum(0.0, np.minimum(rising, falling))
    return fb


class LogMel(nn.Module):
    """Waveform [B, T] -> per-example normalized log-mel [B, 1, n_mels, frames]."""

    def __init__(self):
        super().__init__()
        n_bins = N_FFT // 2 + 1
        window = np.hanning(N_FFT + 1)[:-1].astype(np.float32)
        n = np.arange(N_FFT)
        k = np.arange(n_bins)[:, None]
        angle = 2.0 * np.pi * k * n[None, :] / N_FFT
        real = np.cos(angle) * window
        imag = -np.sin(angle) * window
        kernel = np.concatenate([real, imag], axis=0)[:, None, :].astype(np.float32)

        self.register_buffer("stft_kernel", torch.from_numpy(kernel))
        self.register_buffer("mel_fb", torch.from_numpy(mel_filterbank()))

    def forward(self, wav: torch.Tensor) -> torch.Tensor:
        if wav.dim() == 2:
            wav = wav.unsqueeze(1)
        spec = F.conv1d(wav, self.stft_kernel, stride=HOP)
        n_bins = N_FFT // 2 + 1
        power = spec[:, :n_bins] ** 2 + spec[:, n_bins:] ** 2

        mel = torch.matmul(self.mel_fb, power)
        logmel = torch.log(mel + 1e-6)

        # Per-example standardization: makes the model indifferent to recording
        # gain, which differs a lot between podcast audio and a laptop mic.
        mean = logmel.mean(dim=(1, 2), keepdim=True)
        std = logmel.std(dim=(1, 2), keepdim=True)
        return ((logmel - mean) / (std + 1e-5)).unsqueeze(1)


class ConvBlock(nn.Module):
    def __init__(self, cin, cout, pool):
        super().__init__()
        self.conv1 = nn.Conv2d(cin, cout, 3, padding=1, bias=False)
        self.bn1 = nn.BatchNorm2d(cout)
        self.conv2 = nn.Conv2d(cout, cout, 3, padding=1, bias=False)
        self.bn2 = nn.BatchNorm2d(cout)
        self.pool = pool

    def forward(self, x):
        x = F.relu(self.bn1(self.conv1(x)))
        x = F.relu(self.bn2(self.conv2(x)))
        return F.max_pool2d(x, self.pool)


class StutterNet(nn.Module):
    def __init__(self, n_classes=len(LABELS), width=32, dropout=0.3):
        super().__init__()
        self.frontend = LogMel()
        w = width
        self.blocks = nn.Sequential(
            ConvBlock(1, w, (2, 2)),
            ConvBlock(w, w * 2, (2, 2)),
            ConvBlock(w * 2, w * 4, (2, 2)),
            ConvBlock(w * 4, w * 8, (2, 2)),
        )
        self.dropout = nn.Dropout(dropout)
        self.fc1 = nn.Linear(w * 16, 256)
        self.fc2 = nn.Linear(256, n_classes)

    def features(self, wav: torch.Tensor) -> torch.Tensor:
        return self.frontend(wav)

    def head(self, feat: torch.Tensor) -> torch.Tensor:
        x = self.blocks(feat)
        x = x.mean(dim=2)                       # collapse frequency -> [B, C, frames]
        x = torch.cat([x.mean(dim=2), x.amax(dim=2)], dim=1)   # mean+max over time
        x = self.dropout(F.relu(self.fc1(self.dropout(x))))
        return self.fc2(x)

    def forward(self, wav: torch.Tensor) -> torch.Tensor:
        return self.head(self.features(wav))


def spec_augment(feat: torch.Tensor, n_freq=2, n_time=2, f_max=12, t_max=30):
    """SpecAugment applied to the normalized log-mel features during training."""
    b, _, n_mels, n_frames = feat.shape
    out = feat.clone()
    for _ in range(n_freq):
        f = torch.randint(0, f_max + 1, (b,), device=feat.device)
        f0 = (torch.rand(b, device=feat.device) * (n_mels - f).clamp(min=1)).long()
        idx = torch.arange(n_mels, device=feat.device)[None, :]
        mask = (idx >= f0[:, None]) & (idx < (f0 + f)[:, None])
        out = out.masked_fill(mask[:, None, :, None], 0.0)
    for _ in range(n_time):
        t = torch.randint(0, t_max + 1, (b,), device=feat.device)
        t0 = (torch.rand(b, device=feat.device) * (n_frames - t).clamp(min=1)).long()
        idx = torch.arange(n_frames, device=feat.device)[None, :]
        mask = (idx >= t0[:, None]) & (idx < (t0 + t)[:, None])
        out = out.masked_fill(mask[:, None, None, :], 0.0)
    return out

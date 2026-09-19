"""
Two-head (cascade) stutter classifier.

The single-head model's weak spot is the aggregate call — "is there a stutter at
all" scored 0.798 AUC while per-class ranking was already competitive. This
splits that decision out:

    stage 1  binary head   fluent  vs  any stutter          (trained on all clips)
    stage 2  type head     which stutter type(s)            (trained only on
                                                             stutter-positive clips)

Both heads sit on one shared trunk, so inference is still a single forward pass.
Stage 2 is conditional: freed from the fluent majority, it can spend its capacity
on telling stutter types apart instead of on detecting stutters.

Final per-class probability is the cascade product:

    P(type_i) = P(any stutter) * P(type_i | any stutter)

which makes the six outputs directly comparable to the single-head model's.

Stage 1 predicts Fluent directly rather than as 1 - P(any stutter). SEP-28k
annotates Fluent independently, and it agrees with "no stutter type reached 2
votes" only 80% of the time -- 2.8k clips carry both a stutter and a Fluent
label, and 1.3k have neither. Deriving it discards that supervision and costs
~0.12 AUC on the Fluent class.
"""

import torch
import torch.nn as nn
import torch.nn.functional as F

from model import LABELS, ConvBlock, LogMel

# Stage-2 classes, in the order used by the type head.
TYPES = ["Prolongation", "Block", "SoundRep", "WordRep", "Interjection"]
FLUENT = "Fluent"
# Maps (types + fluent) back onto the canonical LABELS order.
TYPE_TO_LABEL = [LABELS.index(c) for c in TYPES]
FLUENT_IDX = LABELS.index(FLUENT)

EPS = 1e-6


class StutterNetTwoHead(nn.Module):
    """Shared trunk, one binary head and one conditional multi-label type head."""

    def __init__(self, width=32, dropout=0.3, n_types=len(TYPES)):
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
        self.fc_shared = nn.Linear(w * 16, 256)
        # Stage 1 emits [any-stutter gate, Fluent]; both see every clip.
        self.head_binary = nn.Linear(256, 2)
        self.head_type = nn.Linear(256, n_types)

    def features(self, wav: torch.Tensor) -> torch.Tensor:
        return self.frontend(wav)

    def trunk(self, feat: torch.Tensor) -> torch.Tensor:
        x = self.blocks(feat)
        x = x.mean(dim=2)                                      # collapse frequency
        x = torch.cat([x.mean(dim=2), x.amax(dim=2)], dim=1)   # mean+max over time
        return self.dropout(F.relu(self.fc_shared(self.dropout(x))))

    def heads(self, feat: torch.Tensor):
        """Returns (stage1_logits [B, 2] = (any, fluent), type_logits [B, n_types])."""
        h = self.trunk(feat)
        return self.head_binary(h), self.head_type(h)

    def forward(self, wav: torch.Tensor) -> torch.Tensor:
        """Cascade log-odds over the canonical six LABELS.

        Emits log-odds rather than probabilities so a consumer can apply a
        plain sigmoid and recover P — matching the single-head model's output
        contract exactly, which keeps the inference code drop-in compatible.
        """
        stage1, type_logits = self.heads(self.features(wav))
        p_any = torch.sigmoid(stage1[:, :1])
        p_joint = (p_any * torch.sigmoid(type_logits)).clamp(EPS, 1 - EPS)

        out = torch.empty(
            wav.shape[0], len(LABELS), device=p_joint.device, dtype=p_joint.dtype
        )
        out[:, TYPE_TO_LABEL] = torch.log(p_joint / (1 - p_joint))
        out[:, FLUENT_IDX] = stage1[:, 1]
        return out


def conditional_bce(
    type_logits: torch.Tensor,
    targets: torch.Tensor,
    mask: torch.Tensor,
    pos_weight: torch.Tensor,
) -> torch.Tensor:
    """BCE over the type head, averaged only over stutter-positive clips.

    Fluent clips carry no information about *which* stutter occurred, so
    including them would just teach the head to output all-zeros.
    """
    per_elem = F.binary_cross_entropy_with_logits(
        type_logits, targets, pos_weight=pos_weight, reduction="none"
    )
    m = mask.unsqueeze(-1).float()
    denom = m.sum() * type_logits.shape[-1]
    if denom.item() == 0:
        return type_logits.sum() * 0.0
    return (per_elem * m).sum() / denom

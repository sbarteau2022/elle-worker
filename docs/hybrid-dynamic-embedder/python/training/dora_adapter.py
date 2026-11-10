"""
Milestone 5: DoRA (Weight-Decomposed Low-Rank Adaptation) Training Pipeline.

Implements parameter-efficient fine-tuning via DoRA on the PatchMerger fc1/fc2
layers and a compound manifold loss on H^n × T^d for the Hybrid Dynamic Embedder.

DoRA decomposes weight W = m * (V / ||V||_c) where:
    m: magnitude vector (trainable, shape [out_dim])
    V: direction matrix (low-rank adapted, shape [out_dim, in_dim])
    V = W_0 + B @ A where B: [out_dim, rank], A: [rank, in_dim]

Compound Manifold Loss:
    L = L_hyp(H^n) + λ_tor * L_tor(T^d) + λ_reg * ||ΔW||_F
    L_hyp: Poincaré ball geodesic distance loss
    L_tor: Toroidal angular distance loss
    L_reg: Low-rank parameter Frobenius norm regularization
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Sequence, Tuple

try:
    import numpy as np
except ImportError:
    np = None

try:
    import mlx.core as mx
    import mlx.nn as nn_mlx
    HAS_MLX = True
except ImportError:
    HAS_MLX = False
    mx = None
    nn_mlx = None


# ============================================================================
# DoRA Adapter
# ============================================================================

class DoRAAdapter:
    """
    Weight-Decomposed Low-Rank Adaptation (DoRA) adapter.

    Decomposes a pretrained weight matrix W_0 into magnitude m and direction V,
    then applies low-rank update to the direction via ΔV = B @ A.

    Attributes:
        in_dim: Input dimension.
        out_dim: Output dimension.
        rank: Low-rank decomposition rank.
        alpha: Scaling factor (default: rank).
        magnitude: Trainable magnitude vector m ∈ R^out_dim.
        lora_A: Low-rank factor A ∈ R^{rank × in_dim}.
        lora_B: Low-rank factor B ∈ R^{out_dim × rank}.
    """

    def __init__(
        self,
        in_dim: int,
        out_dim: int,
        rank: int = 16,
        alpha: Optional[float] = None,
        seed: int = 42,
    ) -> None:
        self.in_dim = in_dim
        self.out_dim = out_dim
        self.rank = rank
        self.alpha = alpha if alpha is not None else float(rank)
        self.scale = self.alpha / float(rank)

        rng = np.random.RandomState(seed) if np is not None else None

        # Initialize W_0 as identity-like (Kaiming) for simulation
        if np is not None:
            fan_in_scale = 1.0 / math.sqrt(in_dim)
            self.W_0 = rng.randn(out_dim, in_dim).astype(np.float32) * fan_in_scale

            # Magnitude m = ||W_0||_col (column-wise norms)
            self.magnitude = np.sqrt(np.sum(self.W_0 ** 2, axis=1)).astype(np.float32)

            # LoRA factors: A ~ N(0, 1/sqrt(rank)), B = zeros
            self.lora_A = rng.randn(rank, in_dim).astype(np.float32) * (1.0 / math.sqrt(rank))
            self.lora_B = np.zeros((out_dim, rank), dtype=np.float32)
        else:
            self.W_0 = [[0.0] * in_dim] * out_dim
            self.magnitude = [1.0] * out_dim
            self.lora_A = [[0.0] * in_dim] * rank
            self.lora_B = [[0.0] * rank] * out_dim

        self._frozen = True

    @property
    def trainable_param_count(self) -> int:
        """Number of trainable parameters: m + A + B."""
        return self.out_dim + (self.rank * self.in_dim) + (self.out_dim * self.rank)

    @property
    def compression_ratio(self) -> float:
        """Ratio of trainable params to full weight params."""
        full_params = self.out_dim * self.in_dim
        return self.trainable_param_count / float(full_params)

    def compute_effective_weight(self) -> Any:
        """
        Computes effective DoRA weight: W_eff = m * normalize(W_0 + scale * B @ A).

        Returns:
            Effective weight matrix of shape [out_dim, in_dim].
        """
        if np is not None:
            delta_V = self.scale * (self.lora_B @ self.lora_A)
            V = self.W_0 + delta_V
            # Column-wise normalization
            V_norms = np.sqrt(np.sum(V ** 2, axis=1, keepdims=True)) + 1e-8
            V_normalized = V / V_norms
            # Apply magnitude
            W_eff = self.magnitude[:, None] * V_normalized
            return W_eff
        raise RuntimeError("NumPy required for DoRA weight computation")

    def forward(self, x: Any) -> Any:
        """Applies DoRA-adapted linear transformation: y = x @ W_eff^T."""
        W_eff = self.compute_effective_weight()
        if np is not None and isinstance(x, np.ndarray):
            return x @ W_eff.T
        # Pure Python fallback
        result = []
        for row in x:
            out = [0.0] * self.out_dim
            for j in range(self.out_dim):
                for i in range(self.in_dim):
                    out[j] += row[i] * W_eff[j][i]
            result.append(out)
        return result


# ============================================================================
# Compound Manifold Loss on H^n × T^d
# ============================================================================

def poincare_distance_loss(
    embeddings: Sequence[Sequence[float]],
    targets: Sequence[Sequence[float]],
    c: float = 1.0,
) -> float:
    """
    Computes mean Poincaré ball geodesic distance loss.

    L_hyp = (1/N) * Σ d_B(x_i, y_i)
    where d_B is the Poincaré distance.
    """
    if len(embeddings) == 0:
        return 0.0

    total_dist = 0.0
    for emb, tgt in zip(embeddings, targets):
        diff_sq = sum((a - b) ** 2 for a, b in zip(emb, tgt))
        emb_norm_sq = sum(x * x for x in emb)
        tgt_norm_sq = sum(x * x for x in tgt)

        denom = max(1e-15, (1.0 - c * emb_norm_sq) * (1.0 - c * tgt_norm_sq))
        arg = 1.0 + 2.0 * c * diff_sq / denom
        arg = max(arg, 1.0 + 1e-15)
        dist = (1.0 / math.sqrt(c)) * math.acosh(arg)
        total_dist += dist

    return total_dist / float(len(embeddings))


def toroidal_distance_loss(
    phases: Sequence[Sequence[float]],
    target_phases: Sequence[Sequence[float]],
) -> float:
    """
    Computes mean toroidal angular distance loss.

    L_tor = (1/N) * Σ ||wrap(θ_i - φ_i)||_2
    where wrap(·) maps to [-π, π].
    """
    if len(phases) == 0:
        return 0.0

    total_dist = 0.0
    for ph, tph in zip(phases, target_phases):
        sq_sum = 0.0
        for a, b in zip(ph, tph):
            diff = (a - b + math.pi) % (2 * math.pi) - math.pi
            sq_sum += diff * diff
        total_dist += math.sqrt(sq_sum)

    return total_dist / float(len(phases))


def frobenius_regularization(adapter: DoRAAdapter) -> float:
    """
    Computes Frobenius norm of ΔW = scale * B @ A for regularization.

    L_reg = ||ΔW||_F
    """
    if np is not None:
        delta = adapter.scale * (adapter.lora_B @ adapter.lora_A)
        return float(np.sqrt(np.sum(delta ** 2)))
    return 0.0


def compound_manifold_loss(
    embeddings: Sequence[Sequence[float]],
    targets: Sequence[Sequence[float]],
    phases: Optional[Sequence[Sequence[float]]] = None,
    target_phases: Optional[Sequence[Sequence[float]]] = None,
    adapter: Optional[DoRAAdapter] = None,
    c: float = 1.0,
    lambda_tor: float = 0.1,
    lambda_reg: float = 0.01,
) -> Dict[str, float]:
    """
    Compound manifold loss on H^n × T^d with optional DoRA regularization.

    L = L_hyp + λ_tor * L_tor + λ_reg * ||ΔW||_F

    Returns:
        Dictionary with 'total', 'hyperbolic', 'toroidal', 'regularization' components.
    """
    l_hyp = poincare_distance_loss(embeddings, targets, c=c)

    l_tor = 0.0
    if phases is not None and target_phases is not None:
        l_tor = toroidal_distance_loss(phases, target_phases)

    l_reg = 0.0
    if adapter is not None:
        l_reg = frobenius_regularization(adapter)

    total = l_hyp + lambda_tor * l_tor + lambda_reg * l_reg

    return {
        "total": total,
        "hyperbolic": l_hyp,
        "toroidal": l_tor,
        "regularization": l_reg,
    }


# ============================================================================
# DoRA-wrapped PatchMerger adapter scaffolding
# ============================================================================

class DoRAPatchMergerAdapter:
    """
    Wraps the PatchMerger fc1/fc2 layers with DoRA low-rank adapters.

    This allows parameter-efficient fine-tuning of the visual projection
    without modifying the original frozen weights.
    """

    def __init__(
        self,
        merged_dim: int = 4608,
        intermediate_dim: int = 5120,
        out_dim: int = 5120,
        rank: int = 16,
        alpha: Optional[float] = None,
    ) -> None:
        self.fc1_adapter = DoRAAdapter(
            in_dim=merged_dim,
            out_dim=intermediate_dim,
            rank=rank,
            alpha=alpha,
            seed=42,
        )
        self.fc2_adapter = DoRAAdapter(
            in_dim=intermediate_dim,
            out_dim=out_dim,
            rank=rank,
            alpha=alpha,
            seed=43,
        )
        self.merged_dim = merged_dim
        self.intermediate_dim = intermediate_dim
        self.out_dim = out_dim
        self.rank = rank

    @property
    def total_trainable_params(self) -> int:
        """Total trainable parameters across both adapters."""
        return self.fc1_adapter.trainable_param_count + self.fc2_adapter.trainable_param_count

    @property
    def total_frozen_params(self) -> int:
        """Total frozen (pretrained) parameters."""
        return (self.merged_dim * self.intermediate_dim) + (self.intermediate_dim * self.out_dim)

    def summary(self) -> Dict[str, Any]:
        """Returns a summary of the DoRA adapter configuration."""
        return {
            "fc1_adapter": {
                "in_dim": self.fc1_adapter.in_dim,
                "out_dim": self.fc1_adapter.out_dim,
                "rank": self.fc1_adapter.rank,
                "trainable_params": self.fc1_adapter.trainable_param_count,
                "compression_ratio": round(self.fc1_adapter.compression_ratio, 4),
            },
            "fc2_adapter": {
                "in_dim": self.fc2_adapter.in_dim,
                "out_dim": self.fc2_adapter.out_dim,
                "rank": self.fc2_adapter.rank,
                "trainable_params": self.fc2_adapter.trainable_param_count,
                "compression_ratio": round(self.fc2_adapter.compression_ratio, 4),
            },
            "total_trainable_params": self.total_trainable_params,
            "total_frozen_params": self.total_frozen_params,
            "efficiency": round(
                self.total_trainable_params / float(self.total_frozen_params + self.total_trainable_params), 6
            ),
        }

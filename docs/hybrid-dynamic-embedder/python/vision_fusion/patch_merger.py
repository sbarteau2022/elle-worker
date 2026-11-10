"""
Multimodal Projector & 2x2 Spatial Patch Merger Module (R3).

Merges 2x2 spatial patch windows into a single dense visual token and projects
from 4 * D_vit = 4608 to D = 5120 LLM latent space with LayerNorm and GELU MLP.
Exposes linear layers fc1 and fc2 for DoRA low-rank adaptation (Milestone 3).
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple, Union
import numpy as np

try:
    import mlx.core as mx
    import mlx.nn as nn_mlx
    HAS_MLX = True
except ImportError:
    HAS_MLX = False
    mx = None
    nn_mlx = None


class PatchMerger:
    """
    Merges 2x2 spatial patch windows and projects directly into LLM latent space D=5120.
    Supports MLX (Metal GPU) and NumPy (deterministic CPU) execution.
    """

    def __init__(
        self,
        in_dim: int = 1152,
        out_dim: int = 5120,
        intermediate_dim: int = 5120,
        backend: str = "auto",
        seed: int = 42,
    ) -> None:
        self.in_dim = in_dim
        self.merged_dim = in_dim * 4  # 4608
        self.out_dim = out_dim
        self.intermediate_dim = intermediate_dim
        self.seed = seed

        if backend == "auto":
            self.backend = "mlx" if HAS_MLX else "numpy"
        else:
            self.backend = backend.lower()
            if self.backend == "mlx" and not HAS_MLX:
                self.backend = "numpy"

        self._init_projector()

    def _init_projector(self) -> None:
        rng = np.random.RandomState(self.seed)

        # NumPy weights
        scale1 = 1.0 / math.sqrt(self.merged_dim)
        scale2 = 1.0 / math.sqrt(self.intermediate_dim)
        self.w_fc1_np = rng.randn(self.merged_dim, self.intermediate_dim).astype(np.float32) * scale1
        self.b_fc1_np = np.zeros((self.intermediate_dim,), dtype=np.float32)
        self.w_fc2_np = rng.randn(self.intermediate_dim, self.out_dim).astype(np.float32) * scale2
        self.b_fc2_np = np.zeros((self.out_dim,), dtype=np.float32)
        self.gamma_np = np.ones((self.merged_dim,), dtype=np.float32)
        self.beta_np = np.zeros((self.merged_dim,), dtype=np.float32)

        # MLX modules
        if self.backend == "mlx" and HAS_MLX:
            self.ln_mlx = nn_mlx.LayerNorm(self.merged_dim)
            self.fc1_mlx = nn_mlx.Linear(self.merged_dim, self.intermediate_dim)
            self.act_mlx = nn_mlx.GELU()
            self.fc2_mlx = nn_mlx.Linear(self.intermediate_dim, self.out_dim)

    def merge_and_project(
        self,
        patches: Any,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Tuple[Any, Dict[str, Any]]:
        """
        Merges 2x2 spatial patch windows and projects to D=5120.

        Args:
            patches: Tensor of shape (B, Nh, Nw, D_vit)
            metadata: Optional metadata dictionary from VisionTower

        Returns:
            (visual_tokens, spatial_metadata)
            visual_tokens: Shape (B, Mh, Mw, 5120) where Mh = Nh // 2, Mw = Nw // 2.
        """
        Nh, Nw = int(patches.shape[1]), int(patches.shape[2])
        assert Nh % 2 == 0 and Nw % 2 == 0, f"Grid dimensions ({Nh}, {Nw}) must both be even numbers."

        Mh, Mw = Nh // 2, Nw // 2
        effective_patch_size = 28  # 14 * 2

        spatial_meta = {
            "grid_h": Mh,
            "grid_w": Mw,
            "effective_patch_size": effective_patch_size,
            "token_count": Mh * Mw,
            "out_dim": self.out_dim,
            "centroids": [
                [
                    (
                        effective_patch_size * r + effective_patch_size // 2,
                        effective_patch_size * c + effective_patch_size // 2,
                    )
                    for c in range(Mw)
                ]
                for r in range(Mh)
            ],
            "bboxes": [
                [
                    (
                        effective_patch_size * r,
                        effective_patch_size * c,
                        effective_patch_size * (r + 1),
                        effective_patch_size * (c + 1),
                    )
                    for c in range(Mw)
                ]
                for r in range(Mh)
            ],
        }
        if metadata is not None:
            spatial_meta.update({k: v for k, v in metadata.items() if k not in spatial_meta})

        if self.backend == "mlx" and HAS_MLX and isinstance(patches, mx.array):
            B, _, _, D = patches.shape
            merged = mx.reshape(patches, (B, Mh, 2, Mw, 2, D))
            merged = mx.transpose(merged, (0, 1, 3, 2, 4, 5))
            merged = mx.reshape(merged, (B, Mh, Mw, 4 * D))

            # Forward through LayerNorm -> Linear -> GELU -> Linear
            normed = self.ln_mlx(merged)
            h = self.act_mlx(self.fc1_mlx(normed))
            out = self.fc2_mlx(h)
            mx.eval(out)
            return out, spatial_meta
        else:
            p_np = np.asarray(patches, dtype=np.float32)
            B, _, _, D = p_np.shape
            merged = p_np.reshape(B, Mh, 2, Mw, 2, D).transpose(0, 1, 3, 2, 4, 5).reshape(B, Mh, Mw, 4 * D)

            # LayerNorm in numpy
            mean = np.mean(merged, axis=-1, keepdims=True)
            var = np.var(merged, axis=-1, keepdims=True)
            normed = (merged - mean) / np.sqrt(var + 1e-6) * self.gamma_np + self.beta_np

            # GELU activation in numpy: 0.5 * h * (1 + tanh(sqrt(2/pi) * (h + 0.044715 * h^3)))
            h = normed @ self.w_fc1_np + self.b_fc1_np
            gelu_h = 0.5 * h * (1.0 + np.tanh(math.sqrt(2.0 / math.pi) * (h + 0.044715 * np.power(h, 3))))
            out = gelu_h @ self.w_fc2_np + self.b_fc2_np
            return out, spatial_meta

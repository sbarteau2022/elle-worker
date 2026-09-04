"""
Qwen-VL Vision Tower & 2D-RoPE Patch Extraction Module (R3).

Implements:
1. 14x14 ViT patch extraction from RGB images (H x W x 3).
2. Spatial edge padding to multiples of 28 pixels (14 x 2).
3. 2D Rotary Position Embeddings (2D-RoPE) decomposing vertical and horizontal coordinates.
4. Multi-backend execution: MLX (Metal GPU) and NumPy (deterministic CPU) with automatic detection.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union
import numpy as np

try:
    import mlx.core as mx
    import mlx.nn as nn_mlx
    HAS_MLX = True
except ImportError:
    HAS_MLX = False
    mx = None
    nn_mlx = None


def compute_2d_rope_freqs_numpy(
    Nh: int,
    Nw: int,
    dim: int = 1152,
    base: float = 10000.0,
) -> Tuple[np.ndarray, np.ndarray]:
    """Computes vertical and horizontal rotary frequency grids in NumPy."""
    half_dim = dim // 2
    freq_dim = half_dim // 2
    inv_freq = 1.0 / (base ** (np.arange(0, freq_dim, dtype=np.float32) * 2.0 / half_dim))

    r = np.arange(Nh, dtype=np.float32)
    c = np.arange(Nw, dtype=np.float32)

    angles_r = np.outer(r, inv_freq)  # (Nh, freq_dim)
    angles_c = np.outer(c, inv_freq)  # (Nw, freq_dim)

    angles_r_grid = np.repeat(angles_r[:, np.newaxis, :], Nw, axis=1)  # (Nh, Nw, freq_dim)
    angles_c_grid = np.repeat(angles_c[np.newaxis, :, :], Nh, axis=0)  # (Nh, Nw, freq_dim)
    return angles_r_grid, angles_c_grid


def apply_rotary_emb_1d_numpy(x: np.ndarray, angles: np.ndarray) -> np.ndarray:
    """Applies 1D rotary embedding to interleaved coordinate pairs."""
    cos = np.cos(angles)
    sin = np.sin(angles)
    x1 = x[..., 0::2]
    x2 = x[..., 1::2]
    out = np.empty_like(x)
    out[..., 0::2] = x1 * cos - x2 * sin
    out[..., 1::2] = x1 * sin + x2 * cos
    return out


def apply_2d_rope_numpy(x: np.ndarray, base: float = 10000.0) -> np.ndarray:
    """
    Applies 2D-RoPE to patch tensor of shape (B, Nh, Nw, D).
    Guarantees norm preservation and 2D relative displacement invariance.
    """
    B, Nh, Nw, D = x.shape
    half_dim = D // 2
    angles_r, angles_c = compute_2d_rope_freqs_numpy(Nh, Nw, dim=D, base=base)

    xv = x[..., :half_dim]
    xh = x[..., half_dim:]

    rot_v = apply_rotary_emb_1d_numpy(xv, angles_r)
    rot_h = apply_rotary_emb_1d_numpy(xh, angles_c)
    return np.concatenate([rot_v, rot_h], axis=-1)


def apply_2d_rope_mlx(x: Any, base: float = 10000.0) -> Any:
    """Applies 2D-RoPE using MLX operations on Apple Silicon."""
    if not HAS_MLX or mx is None:
        raise RuntimeError("MLX is not installed or available.")
    B, Nh, Nw, D = x.shape
    half_dim = D // 2
    freq_dim = half_dim // 2

    inv_freq = 1.0 / (base ** (mx.arange(0, freq_dim, dtype=mx.float32) * 2.0 / half_dim))
    r = mx.arange(Nh, dtype=mx.float32)
    c = mx.arange(Nw, dtype=mx.float32)

    angles_r = r[:, None] * inv_freq[None, :]
    angles_c = c[:, None] * inv_freq[None, :]

    angles_r_grid = mx.broadcast_to(angles_r[:, None, :], (Nh, Nw, freq_dim))
    angles_c_grid = mx.broadcast_to(angles_c[None, :, :], (Nh, Nw, freq_dim))

    xv = x[..., :half_dim]
    xh = x[..., half_dim:]

    def mlx_rope_1d(t: Any, angles: Any) -> Any:
        cos = mx.cos(angles)
        sin = mx.sin(angles)
        t1 = t[..., 0::2]
        t2 = t[..., 1::2]
        out1 = t1 * cos - t2 * sin
        out2 = t1 * sin + t2 * cos
        stacked = mx.stack([out1, out2], axis=-1)
        return mx.reshape(stacked, t.shape)

    rot_v = mlx_rope_1d(xv, angles_r_grid)
    rot_h = mlx_rope_1d(xh, angles_c_grid)
    return mx.concatenate([rot_v, rot_h], axis=-1)


class VisionTower:
    """
    Vision Tower executing 14x14 patch extraction, spatial padding, and 2D-RoPE coordinate embedding.
    Supports MLX and NumPy execution modes.
    """

    def __init__(
        self,
        patch_size: int = 14,
        embed_dim: int = 1152,
        backend: str = "auto",
        seed: int = 42,
    ) -> None:
        self.patch_size = patch_size
        self.embed_dim = embed_dim
        self.seed = seed

        if backend == "auto":
            self.backend = "mlx" if HAS_MLX else "numpy"
        else:
            self.backend = backend.lower()
            if self.backend == "mlx" and not HAS_MLX:
                self.backend = "numpy"

        self._init_weights()

    def _init_weights(self) -> None:
        rng = np.random.RandomState(self.seed)
        patch_dim = self.patch_size * self.patch_size * 3  # 588
        self.w_embed_np = rng.randn(patch_dim, self.embed_dim).astype(np.float32) * (1.0 / math.sqrt(patch_dim))
        self.b_embed_np = np.zeros((self.embed_dim,), dtype=np.float32)

        if self.backend == "mlx" and HAS_MLX:
            self.conv_mlx = nn_mlx.Conv2d(
                in_channels=3,
                out_channels=self.embed_dim,
                kernel_size=self.patch_size,
                stride=self.patch_size,
            )

    def extract_patches(self, image: Union[np.ndarray, Any]) -> Tuple[Any, Dict[str, Any]]:
        """
        Extracts 14x14 patches and applies 2D-RoPE spatial embeddings.

        Args:
            image: RGB image of shape (H, W, 3) or (B, H, W, 3)

        Returns:
            (rope_features, metadata_dict)
            rope_features: shape (B, Nh, Nw, embed_dim)
        """
        # Ensure batch dimension and determine H, W
        if hasattr(image, "shape") and len(image.shape) == 3:
            if self.backend == "mlx" and HAS_MLX and isinstance(image, mx.array):
                image = image[None, ...]
            else:
                image = np.expand_dims(image, axis=0)

        H, W = int(image.shape[1]), int(image.shape[2])
        pad_h = int(math.ceil(H / 28.0) * 28)
        pad_w = int(math.ceil(W / 28.0) * 28)

        Nh = pad_h // self.patch_size
        Nw = pad_w // self.patch_size

        meta = {
            "orig_h": H,
            "orig_w": W,
            "pad_h": pad_h,
            "pad_w": pad_w,
            "Nh": Nh,
            "Nw": Nw,
            "patch_size": self.patch_size,
            "embed_dim": self.embed_dim,
            "backend": self.backend,
        }

        if self.backend == "mlx" and HAS_MLX:
            if not isinstance(image, mx.array):
                image = mx.array(image, dtype=mx.float32)

            if pad_h != H or pad_w != W:
                pad_bottom = pad_h - H
                pad_right = pad_w - W
                image = mx.pad(image, [(0, 0), (0, pad_bottom), (0, pad_right), (0, 0)])

            raw_patches = self.conv_mlx(image)
            rope_patches = apply_2d_rope_mlx(raw_patches)
            mx.eval(rope_patches)
            return rope_patches, meta
        else:
            img_np = np.asarray(image, dtype=np.float32)
            if pad_h != H or pad_w != W:
                img_np = np.pad(
                    img_np,
                    ((0, 0), (0, pad_h - H), (0, pad_w - W), (0, 0)),
                    mode="edge",
                )
            B = img_np.shape[0]
            # Reshape into patches
            patches = img_np.reshape(B, Nh, self.patch_size, Nw, self.patch_size, 3)
            patches = patches.transpose(0, 1, 3, 2, 4, 5).reshape(B, Nh, Nw, -1)
            raw_features = patches @ self.w_embed_np + self.b_embed_np
            rope_features = apply_2d_rope_numpy(raw_features)
            return rope_features, meta

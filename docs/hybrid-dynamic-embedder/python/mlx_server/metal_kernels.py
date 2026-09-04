"""
Apple Silicon Metal Compute Kernels for Hyperbolic Operations (R5, POTENTIAL_TUNING §5.4).

JIT-compiles MSL (Metal Shading Language) compute shaders via MLX for sub-millisecond
execution of Poincaré distance batch operations in Apple Silicon unified memory (UMA).
"""

from __future__ import annotations

import math
from typing import Optional, Tuple, Union

try:
    import mlx.core as mx
    _HAS_MLX = True
except ImportError:
    mx = None
    _HAS_MLX = False

# Metal Shading Language source for batch Poincare distance calculation
_POINCARE_BATCH_SOURCE = """
    uint idx = thread_position_in_grid.x;
    uint n_val = N[0];
    uint d_val = D[0];
    float c_val = c[0];
    if (idx >= n_val) return;
    uint offset = idx * d_val;
    float u_sq = 0.0f;
    float v_sq = 0.0f;
    float diff_sq = 0.0f;

    for (uint i = 0; i < d_val; i++) {
        float ui = (float)u_vecs[offset + i];
        float vi = (float)v_vecs[offset + i];
        u_sq += ui * ui;
        v_sq += vi * vi;
        float diff = ui - vi;
        diff_sq += diff * diff;
    }

    float alpha = 1.0f - c_val * u_sq;
    float beta  = 1.0f - c_val * v_sq;
    float arg   = 1.0f + 2.0f * c_val * diff_sq / metal::max(alpha * beta, 1e-7f);
    
    // acosh(x) = log(x + sqrt(x*x - 1))
    distances[idx] = (1.0f / metal::sqrt(c_val)) * metal::log(arg + metal::sqrt(metal::max(arg * arg - 1.0f, 0.0f)));
"""

_POINCARE_HEADER = """
#include <metal_stdlib>
using namespace metal;
"""

_CACHED_POINCARE_KERNEL = None


def get_poincare_metal_kernel():
    """Lazily compiles and returns the Metal compute shader via MLX."""
    global _CACHED_POINCARE_KERNEL
    if not _HAS_MLX:
        return None
    if _CACHED_POINCARE_KERNEL is None:
        _CACHED_POINCARE_KERNEL = mx.fast.metal_kernel(
            name="poincare_distance_batch",
            input_names=["u_vecs", "v_vecs", "N", "D", "c"],
            output_names=["distances"],
            source=_POINCARE_BATCH_SOURCE,
            header=_POINCARE_HEADER,
        )
    return _CACHED_POINCARE_KERNEL


def poincare_distance_metal(
    u: mx.array,
    v: mx.array,
    c: float = 1.0,
) -> mx.array:
    """
    Computes batched Poincare distance on Apple Silicon GPU using Metal compute shader.
    
    Args:
        u: [N, D] array of coordinates in B_c^D
        v: [N, D] array of coordinates in B_c^D
        c: Curvature parameter (default 1.0)
        
    Returns:
        [N] array of distances
    """
    if not _HAS_MLX:
        raise RuntimeError("MLX is required for Metal acceleration.")

    assert u.shape == v.shape, f"Shape mismatch: {u.shape} vs {v.shape}"
    if len(u.shape) == 1:
        u = u.reshape(1, -1)
        v = v.reshape(1, -1)

    N, D = u.shape
    kernel = get_poincare_metal_kernel()

    n_arr = mx.array([N], dtype=mx.uint32)
    d_arr = mx.array([D], dtype=mx.uint32)
    c_arr = mx.array([c], dtype=mx.float32)

    u_flat = u.reshape(-1).astype(mx.float32)
    v_flat = v.reshape(-1).astype(mx.float32)

    out = kernel(
        inputs=[u_flat, v_flat, n_arr, d_arr, c_arr],
        grid=(N, 1, 1),
        threadgroup=(min(256, N), 1, 1),
        output_shapes=[(N,)],
        output_dtypes=[mx.float32],
    )[0]

    return out

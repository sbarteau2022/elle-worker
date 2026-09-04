r"""
Shared Tangent Space Fusion and Poincaré Projection Module (R3).

Implements the fusion of Qwen-VL visual patch embeddings and Qwen3.8:27b text tokens
in the origin tangent space T_0 B_c^d \cong R^d with dynamic gating g \in (0, 1),
1/sqrt(D) tangent dimension scaling, tangent-space LayerNorm, and Riemannian
exponential mapping exp_0^c(LayerNorm(z)).
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union

try:
    import numpy as np
except ImportError:
    np = None

try:
    import mlx.core as mx
except ImportError:
    mx = None


def vector_norm(v: Sequence[float]) -> float:
    """Euclidean L2 norm of vector in Euclidean or tangent space."""
    return math.sqrt(sum(x * x for x in v))


def tangent_norm(v: Sequence[float]) -> float:
    """Alias for vector_norm in tangent space."""
    return vector_norm(v)


def tangent_layernorm(v: Sequence[float], eps: float = 1e-5) -> List[float]:
    """
    Applies LayerNorm (zero mean, unit variance) to a tangent vector (SPECIFICATION.md §4.2):
      mu = (1 / D) * sum(v_j)
      sigma^2 = (1 / D) * sum((v_j - mu)^2)
      hat{v}_j = (v_j - mu) / sqrt(sigma^2 + eps)
    """
    dim = len(v)
    if dim == 0:
        return []

    if np is not None and isinstance(v, np.ndarray):
        mean_val = float(np.mean(v))
        var_val = float(np.var(v))
        std_val = math.sqrt(var_val + eps)
        return ((v - mean_val) / std_val).tolist()

    if mx is not None and isinstance(v, mx.array):
        mean_val = mx.mean(v)
        var_val = mx.var(v)
        std_val = mx.sqrt(var_val + eps)
        normed = (v - mean_val) / std_val
        return normed.tolist()

    mean_val = sum(v) / float(dim)
    var_val = sum((x - mean_val) ** 2 for x in v) / float(dim)
    std_val = math.sqrt(var_val + eps)
    return [(x - mean_val) / std_val for x in v]


def compute_dynamic_gate_context(
    task: str = "invoice_anomaly",
    conf_ocr: float = 1.0,
    q_image: float = 1.0,
    w_gate: Optional[Sequence[float]] = None,
    bias: float = 0.0,
) -> float:
    """
    Computes dynamic modality gating g in (0, 1) based on operational context (SPECIFICATION.md §4.2):
      g_i = sigmoid( w_g^T [e_task; conf_ocr; q_image] + b_g )

    Calibrated defaults:
      - Pristine text / high OCR confidence -> g -> 1.0 (text-dominated)
      - Degraded image / handwriting / layout shifts -> g -> 0.0 (vision-dominated)
      - Vendor invoice audit -> g ~ 0.5 (balanced cross-modal verification)
    """
    task_map = {
        "invoice_anomaly": [1.0, 0.0, 0.0],
        "receipt_extraction": [0.0, 1.0, 0.0],
        "vendor_audit": [0.0, 0.0, 1.0],
    }
    e_task = task_map.get(task, [0.33, 0.33, 0.33])

    if w_gate is None:
        logit = 3.5 * (conf_ocr - 0.5) + 1.0 * (q_image - 0.5) + bias
    else:
        features = list(e_task) + [conf_ocr, q_image]
        logit = sum(w * f for w, f in zip(w_gate, features)) + bias

    sig = 1.0 / (1.0 + math.exp(-max(-30.0, min(30.0, logit))))
    return max(0.001, min(0.999, sig))


def compute_dynamic_gate(
    z_text: Sequence[float],
    z_vis: Sequence[float],
    w_gate: Optional[Sequence[float]] = None,
    bias: float = 0.0,
    default_g: float = 0.8,
) -> float:
    """
    Computes dynamic cross-modal gating factor g in (0, 1) from latent representations.
    Retains full backwards compatibility with feature-based routing.
    """
    if w_gate is None:
        return default_g

    combined = list(z_text) + list(z_vis)
    dot = sum(w * x for w, x in zip(w_gate, combined)) + bias
    sig = 1.0 / (1.0 + math.exp(-max(-30.0, min(30.0, dot))))
    return max(0.001, min(0.999, sig))


def project_to_poincare_ball(
    v: Sequence[float],
    c: float = 1.0,
    eps: float = 1e-6,
    convention: str = "B",
) -> List[float]:
    """
    Riemannian exponential mapping from origin tangent space T_0 B_c^n to Poincaré ball B_c^n.

    Convention B (SPECIFICATION.md §2.2 / §4.2, matches tree depth ||v|| = depth(x)):
      exp_0^c(v) = tanh(sqrt(c) * ||v|| / 2) * (v / (sqrt(c) * ||v||))

    Convention A (Möbius gyrovector convention):
      exp_0^c(v) = tanh(sqrt(c) * ||v||) * (v / (sqrt(c) * ||v||))
    """
    norm_v = vector_norm(v)
    if norm_v < 1e-15:
        factor = 0.5 if convention.upper() == "B" else 1.0
        return [factor * x for x in v]

    sqrt_c = math.sqrt(c)
    max_radius = (1.0 - eps) / sqrt_c

    if convention.upper() == "B":
        factor = math.tanh(sqrt_c * norm_v / 2.0) / (sqrt_c * norm_v)
    elif convention.upper() == "A":
        factor = math.tanh(sqrt_c * norm_v) / (sqrt_c * norm_v)
    else:
        raise ValueError(f"Unknown convention: {convention}. Expected 'A' or 'B'.")

    projected = [x * factor for x in v]

    # Guard: strictly clamp within open ball
    p_norm = vector_norm(projected)
    if p_norm >= max_radius:
        scale = max_radius / (p_norm + 1e-12)
        projected = [x * scale for x in projected]

    return projected


def shared_tangent_fusion(
    z_text: Sequence[float],
    z_vis: Sequence[float],
    g: float = 0.8,
    D: int = 5120,
    c: float = 1.0,
    apply_layernorm: bool = True,
    convention: str = "B",
) -> Tuple[List[float], List[float]]:
    """
    Shared tangent space fusion in T_0 B_c^D with 1/sqrt(D) scaling (R3, SPEC §4.2).

    1. Linearly blends text and visual representations in origin tangent space:
       z_unscaled = g * z_text + (1 - g) * z_vis
    2. Scales by 1/sqrt(D) to stabilize high-dimensional norms:
       z_scaled = z_unscaled / sqrt(D)
    3. Applies LayerNorm (zero mean, unit variance) to tangent vector (if apply_layernorm=True).
    4. Projects into Poincaré ball via Riemannian exp_0^c(LayerNorm(z)).

    Returns:
        (fused_tangent_vector, poincare_ball_point)
    """
    assert len(z_text) == len(z_vis), f"Dimension mismatch: {len(z_text)} vs {len(z_vis)}"
    actual_d = len(z_text)
    dim = D if D > 0 else actual_d
    scale = 1.0 / math.sqrt(dim)

    # 1. Native convex combination with 1/sqrt(D) scaling in tangent space
    fused_tangent: List[float] = [
        (g * tx + (1.0 - g) * vx) * scale
        for tx, vx in zip(z_text, z_vis)
    ]

    # 2. Tangent LayerNorm
    if apply_layernorm:
        normalized = tangent_layernorm(fused_tangent)
    else:
        normalized = fused_tangent

    # 3. Riemannian exp_0^c map onto Poincaré ball
    poincare_pt = project_to_poincare_ball(normalized, c=c, convention=convention)

    return fused_tangent, poincare_pt

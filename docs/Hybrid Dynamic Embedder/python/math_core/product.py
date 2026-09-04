"""
Mixed-Curvature Product Manifold (H^n x T^d) Core.

Combines the hyperbolic factor H^n (Poincaré ball / derivation depth & taxonomic lineage)
with the toroidal factor T^d (flat torus / operational phase, periodic recurrence, & winding numbers).
Product metric: d_P^2 = w_h * d_H^2 + w_t * d_T^2.
Grounded in Gu et al. (2019).
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Any

from python.math_core.poincare import _to_float_list, poincare_distance

PHI: float = (1.0 + math.sqrt(5.0)) / 2.0  # Golden ratio ~1.618033988749895
TORUS_DIM: int = 8
TWO_PI: float = 2.0 * math.pi
GOLDEN_ANGLE: float = TWO_PI * (2.0 - PHI)  # ~2.39996 rad


def norm_2pi(a: float) -> float:
    """Normalize any angle to [0, 2*pi)."""
    x = math.fmod(a, TWO_PI)
    return x + TWO_PI if x < 0.0 else x


def wrap_angle(delta: float) -> float:
    """
    Signed wrapped angular difference in (-pi, pi].

    Correctly computes periodic difference across the branch cut.
    """
    d = math.fmod(delta, TWO_PI)
    if d > math.pi:
        d -= TWO_PI
    elif d <= -math.pi:
        d += TWO_PI
    return d


def phi_scale_weights(dim: int) -> list[float]:
    """
    Multiscale golden-ratio weights for toroidal axes:
    omega_j = phi^(-j / 2), so that omega_j^2 = phi^(-j).
    """
    return [PHI ** (-float(j) / 2.0) for j in range(dim)]


def torus_distance(
    a: Sequence[float],
    b: Sequence[float],
    weights: Sequence[float] | None = None,
) -> float:
    """
    Flat torus geodesic distance with multiscale axis weights:
    d_T(a, b) = sqrt(sum_j omega_j^2 * (wrap(a_j - b_j))^2)
    """
    a_list = _to_float_list(a)
    b_list = _to_float_list(b)
    if len(a_list) != len(b_list):
        raise ValueError(
            f"Dimension mismatch in torus_distance: len(a)={len(a_list)} != len(b)={len(b_list)}"
        )
    n = len(a_list)
    if n == 0:
        return 0.0

    w_list = _to_float_list(weights) if weights is not None else None
    total = 0.0
    for i in range(n):
        d = wrap_angle(a_list[i] - b_list[i])
        w = w_list[i] if w_list is not None and i < len(w_list) else 1.0
        total += (w * d) ** 2
    return math.sqrt(total)


def unit_torus_distance(u: Sequence[float], v: Sequence[float]) -> float:
    """
    Flat unit torus geodesic distance in [0, 1)^d:
    d_T,unit(u, v) = sqrt(sum_i min(|u_i - v_i|, 1 - |u_i - v_i|)^2)
    """
    u_list = _to_float_list(u)
    v_list = _to_float_list(v)
    if len(u_list) != len(v_list):
        raise ValueError(
            f"Dimension mismatch in unit_torus_distance: len(u)={len(u_list)} != len(v)={len(v_list)}"
        )
    n = len(u_list)
    total = 0.0
    for i in range(n):
        diff = math.fmod(abs(u_list[i] - v_list[i]), 1.0)
        d = min(diff, 1.0 - diff)
        total += d * d
    return math.sqrt(total)


def product_distance(
    a_ball: Sequence[float],
    a_torus: Sequence[float],
    b_ball: Sequence[float],
    b_torus: Sequence[float],
    w_h: float = 1.0,
    w_t: float = 1.0,
    c: float = 1.0,
) -> float:
    """
    Combined Riemannian product distance on H^n x T^d:
    d_P = sqrt(w_h * (d_H^c)^2 + w_t * (d_T)^2)
    """
    a_ball_list = _to_float_list(a_ball)
    b_ball_list = _to_float_list(b_ball)
    a_torus_list = _to_float_list(a_torus)
    b_torus_list = _to_float_list(b_torus)
    if len(a_ball_list) != len(b_ball_list):
        raise ValueError(
            f"Dimension mismatch in ball coordinates: len(a_ball)={len(a_ball_list)} != len(b_ball)={len(b_ball_list)}"
        )
    if len(a_torus_list) != len(b_torus_list):
        raise ValueError(
            f"Dimension mismatch in torus coordinates: len(a_torus)={len(a_torus_list)} != len(b_torus)={len(b_torus_list)}"
        )
    d_h = poincare_distance(a_ball_list, b_ball_list, c=c)
    torus_dim = len(a_torus_list)
    weights = phi_scale_weights(torus_dim)
    d_t = torus_distance(a_torus_list, b_torus_list, weights=weights)
    return math.sqrt(w_h * (d_h * d_h) + w_t * (d_t * d_t))


def winding_numbers(seq: Sequence[Sequence[float]]) -> dict[str, Any]:
    """
    Topological winding numbers in pi_1(T^d) = Z^d and exact cycle turns.
    Computes integer circulation vector across a sequence of phase steps.
    """
    if len(seq) < 2:
        dim = len(seq[0]) if seq else 0
        return {
            "winding": [0] * dim,
            "turns": [0.0] * dim,
        }

    seq_list = [_to_float_list(pt) for pt in seq]
    dim = len(seq_list[0])
    acc = [0.0] * dim

    for k in range(1, len(seq_list)):
        for j in range(dim):
            prev = seq_list[k - 1][j] if j < len(seq_list[k - 1]) else 0.0
            curr = seq_list[k][j] if j < len(seq_list[k]) else 0.0
            acc[j] += wrap_angle(curr - prev)

    winding = [round(a / TWO_PI) for a in acc]
    turns = [a / TWO_PI for a in acc]
    return {"winding": winding, "turns": turns}


def recognition_invariant(phase_seq: Sequence[Sequence[float]]) -> list[int]:
    """Exact topological recognition invariant: integer vector w in Z^d."""
    return winding_numbers(phase_seq)["winding"]


def same_recurrence_class(
    seq_a: Sequence[Sequence[float]], seq_b: Sequence[Sequence[float]]
) -> bool:
    """
    Check whether two phase trajectories share identical topological winding
    recurrence identity: w(A) == w(B).
    """
    return recognition_invariant(seq_a) == recognition_invariant(seq_b)


def metric_return(
    phase_seq: Sequence[Sequence[float]], weights: Sequence[float] | None = None
) -> float:
    """
    Metric return: closest approach distance to trajectory origin on the torus:
    inf_{k >= 1} d_T(theta^{(0)}, theta^{(k)}).
    """
    if len(phase_seq) < 2:
        return math.inf

    seq_list = [_to_float_list(pt) for pt in phase_seq]
    start = seq_list[0]
    best = math.inf
    for pt in seq_list[1:]:
        d = torus_distance(start, pt, weights=weights)
        best = min(best, d)
    return best


def axis_discrepancy(angles: Sequence[float]) -> float:
    """
    1D Star discrepancy D^* of angles on circle [0, 2*pi).
    Evaluates uniformity of angular distribution.
    """
    angles_list = _to_float_list(angles)
    if any(not math.isfinite(a) for a in angles_list):
        return math.nan
    n = len(angles_list)
    if n == 0:
        return 1.0

    pts = sorted(norm_2pi(a) / TWO_PI for a in angles_list)
    d_max = 0.0
    for i, p in enumerate(pts):
        d1 = abs((i + 1) / n - p)
        d2 = abs(i / n - p)
        d_max = max(d_max, d1, d2)
    return d_max


def atlas_discrepancy(points: Sequence[Sequence[float]], dim: int) -> dict[str, Any]:
    """
    Discrepancy metrics across multi-axis torus atlas:
    Returns mean, max, and per_axis discrepancy.
    """
    if not points or dim == 0:
        return {
            "mean": 0.0,
            "max": 0.0,
            "per_axis": [0.0] * dim,
        }

    points_list = [_to_float_list(pt) for pt in points]
    per_axis: list[float] = []
    for j in range(dim):
        col = [pt[j] if j < len(pt) else 0.0 for pt in points_list]
        per_axis.append(axis_discrepancy(col))

    has_nan = any(not math.isfinite(v) for v in per_axis)
    mean_val = math.nan if has_nan else sum(per_axis) / float(dim)
    max_val = math.nan if has_nan else max(per_axis)
    return {
        "mean": mean_val,
        "max": max_val,
        "per_axis": per_axis,
    }


def generalized_golden(d: int) -> float:
    """
    Generalized golden ratio constant solving g^(d+1) = g + 1.
    Used for Roberts' R_d low-discrepancy quasi-random sequences.
    """
    g = 2.0
    for _ in range(64):
        g = (1.0 + g) ** (1.0 / float(d + 1))
    return g


def golden_sequence(n: int, dim: int, seed: float = 0.0) -> list[list[float]]:
    """
    Roberts' R_d low-discrepancy sequence seating bare nodes across T^d.
    """
    g = generalized_golden(dim)
    alpha = [g ** (-float(j + 1)) for j in range(dim)]
    out: list[list[float]] = []
    for k in range(1, n + 1):
        pt = [norm_2pi(TWO_PI * math.fmod(seed + float(k) * a, 1.0)) for a in alpha]
        out.append(pt)
    return out


def phases_to_torus(phases: Sequence[float], dim: int) -> list[float]:
    """Maps raw phase vector to T^d coordinates in [0, 2*pi)."""
    p_list = _to_float_list(phases)
    out: list[float] = []
    for i in range(dim):
        val = p_list[i] if i < len(p_list) else 0.0
        out.append(norm_2pi(val) if math.isfinite(val) else 0.0)
    return out


def translation_align(a: Sequence[float], b: Sequence[float]) -> dict[str, float]:
    """Translation alignment score between two phase vectors."""
    a_list = _to_float_list(a)
    b_list = _to_float_list(b)
    if len(a_list) != len(b_list):
        raise ValueError(
            f"Dimension mismatch in translation_align: len(a)={len(a_list)} != len(b)={len(b_list)}"
        )
    n = len(a_list)
    if n == 0:
        return {"shift": 0.0, "score": 0.0}

    sin_s = 0.0
    cos_s = 0.0
    for i in range(n):
        d = wrap_angle(a_list[i] - b_list[i])
        sin_s += math.sin(d)
        cos_s += math.cos(d)

    shift = math.atan2(sin_s, cos_s)
    score = 0.0
    for i in range(n):
        score += math.cos(wrap_angle(a_list[i] - b_list[i] - shift))

    return {
        "shift": round(shift, 5),
        "score": round(score / float(n), 5),
    }


def disagreements(
    hyper_points: dict[str, Sequence[float]],
    torus_points: dict[str, Sequence[float]],
    max_nodes: int = 128,
    top_k: int = 8,
    w_h: float = 1.0,
    w_t: float = 1.0,
    c: float = 1.0,
) -> dict[str, list[dict[str, Any]]]:
    """
    Dual-chart disagreement ranking:
    Over the shared node set, rank pairs where the two charts most disagree:
    1. same_rhythm_diff_lineage: Torus-close, Ball-far (convergent concepts).
    2. same_lineage_drift_phase: Ball-close, Torus-far (derivational drift).
    """
    shared_keys = sorted([k for k in hyper_points if k in torus_points])[
        : min(max_nodes, 256)
    ]

    if len(shared_keys) < 2:
        return {
            "same_rhythm_diff_lineage": [],
            "same_lineage_drift_phase": [],
        }

    torus_dim = len(torus_points[shared_keys[0]])
    weights = phi_scale_weights(torus_dim)

    pairs = []
    ball_max = 1e-9
    torus_max = 1e-9

    for i in range(len(shared_keys)):
        for j in range(i + 1, len(shared_keys)):
            id_a = shared_keys[i]
            id_b = shared_keys[j]
            d_ball = poincare_distance(hyper_points[id_a], hyper_points[id_b], c=c)
            d_torus = torus_distance(
                torus_points[id_a], torus_points[id_b], weights=weights
            )
            # Filter non-finite (NaN, Inf) distances from entering rankings
            if not (math.isfinite(d_ball) and math.isfinite(d_torus)):
                continue

            ball_max = max(ball_max, d_ball)
            torus_max = max(torus_max, d_torus)
            pairs.append(
                {
                    "a": id_a,
                    "b": id_b,
                    "ball": d_ball,
                    "torus": d_torus,
                }
            )

    if not pairs:
        return {
            "same_rhythm_diff_lineage": [],
            "same_lineage_drift_phase": [],
        }

    def norm_scores(p: dict[str, Any]) -> tuple[float, float]:
        nb = w_h * (p["ball"] / ball_max)
        nt = w_t * (p["torus"] / torus_max)
        return nb, nt

    # Sort for same_rhythm_diff_lineage (highest nb - nt first)
    rhythm_sorted = sorted(
        pairs,
        key=lambda p: norm_scores(p)[0] - norm_scores(p)[1],
        reverse=True,
    )
    same_rhythm = [
        {
            "a": p["a"],
            "b": p["b"],
            "ball": round(p["ball"], 4),
            "torus": round(p["torus"], 4),
        }
        for p in rhythm_sorted[: min(top_k, 50)]
    ]

    # Sort for same_lineage_drift_phase (highest nt - nb first)
    lineage_sorted = sorted(
        pairs,
        key=lambda p: norm_scores(p)[1] - norm_scores(p)[0],
        reverse=True,
    )
    same_lineage = [
        {
            "a": p["a"],
            "b": p["b"],
            "ball": round(p["ball"], 4),
            "torus": round(p["torus"], 4),
        }
        for p in lineage_sorted[: min(top_k, 50)]
    ]

    return {
        "same_rhythm_diff_lineage": same_rhythm,
        "same_lineage_drift_phase": same_lineage,
    }

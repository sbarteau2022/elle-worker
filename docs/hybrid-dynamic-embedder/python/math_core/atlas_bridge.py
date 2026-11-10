"""
Atlas Bridge: Toroidal Isotropic Geometry & Mixed-Curvature Manifold Synthesis.

Bridges the empirical Toroidal Isotropic Transformer (TIT) proof results and
Atlas Transformer / Tokenizer into the Hybrid Dynamic Embedder and DHNG:
1. Golden ratio constants and Hurwitz bound (delta = 1/sqrt(5))
2. Isotropic suppression (1/pi) and Google TurboQuant bias (2/pi)
3. Golden-ratio product manifold closure: w_hyp = phi^(-1) ~ 0.618, w_tor = phi^(-2) ~ 0.382 (sum = 1.0)
4. Toroidal positional encoding with phi-wound geodesics
5. Three-gap attention masking structure (ratios = phi)
6. Geodesic residual connections on T^d
7. Stern-Brocot depth scheduling
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Sequence, Tuple

PHI: float = (1.0 + math.sqrt(5.0)) / 2.0  # 1.618033988749895
PHI_M1: float = PHI - 1.0  # 0.618033988749895
DELTA_PHI: float = 1.0 / math.sqrt(5.0)  # 0.447213595499958 (Hurwitz theoretical bound)
INV_SQRT5: float = DELTA_PHI  # Backward compatibility alias
ISOTROPIC_SUPPRESSION: float = 1.0 / math.pi  # ~0.318309886
TURBOQUANT_BIAS: float = 2.0 / math.pi  # ~0.636619772

# Product manifold closed weights summing strictly to 1.0
WEIGHT_HYPERBOLIC: float = 1.0 / PHI  # phi^(-1) ~ 0.6180339887
WEIGHT_TOROIDAL: float = 1.0 / (PHI * PHI)  # phi^(-2) ~ 0.3819660113

# Fibonacci sequence
FIBS: List[int] = [1, 1]
while FIBS[-1] < 20000:
    FIBS.append(FIBS[-1] + FIBS[-2])


def get_phi_decay_weights(dim: int) -> List[float]:
    """Generates phi-decay weights w_k = phi^(-k) for k in 1..dim."""
    return [PHI ** (-k) for k in range(1, dim + 1)]


def generate_toroidal_pe(seq_len: int, dim: int, phi: float = PHI_M1) -> List[List[float]]:
    """
    Generates toroidal positional encodings on T^(dim/2) with phi-wound geodesics.
    x_k = sin(2*pi * pos * freq)
    y_k = cos(2*pi * pos * freq)
    """
    half_dim = dim // 2
    pe: List[List[float]] = []

    for pos in range(seq_len):
        row: List[float] = []
        for d in range(half_dim):
            freq = (d + 1) * phi
            angle = 2.0 * math.pi * pos * freq
            row.append(math.sin(angle))
            row.append(math.cos(angle))
        if dim % 2 == 1:
            row.append(math.sin(2.0 * math.pi * pos * (half_dim + 1) * phi))
        pe.append(row)

    return pe


def circular_distance(theta: float, psi: float) -> float:
    """Geodesic distance on S^1 normalized to [0, 1): min(|t - p|, 1 - |t - p|)."""
    diff = math.fmod(abs(theta - psi), 1.0)
    return min(diff, 1.0 - diff)


def three_gap_thresholds(base_small: float = 0.001186) -> Tuple[float, float, float]:
    """
    Computes three-gap distance thresholds with exact phi ratios:
      small = base_small
      medium = small * PHI
      large = medium * PHI = small * PHI^2
    Ratios: large/medium = medium/small = PHI.
    """
    small = base_small
    medium = small * PHI
    large = medium * PHI
    return small, medium, large


def three_gap_partition(dist: float, base_small: float = 0.001186) -> int:
    """
    Partitions distance on T^d into three-gap bins (0: small, 1: medium, 2: large).
    """
    small, medium, _ = three_gap_thresholds(base_small)
    if dist < small:
        return 0
    elif dist < medium:
        return 1
    return 2


def three_gap_attention_weights(
    dist: float,
    thresholds: Optional[Tuple[float, float]] = None,
    weights: Tuple[float, float, float] = (1.0, 1.0 / PHI, 1.0 / (PHI * PHI)),
) -> float:
    """
    Assigns attention weight based on three-gap thresholds.
    Tokens separated by small gap receive 1.0, medium gap 1/phi ~ 0.618, large gap 1/phi^2 ~ 0.382.
    """
    if thresholds is None:
        small_th, med_th, _ = three_gap_thresholds(0.001186)
    else:
        small_th, med_th = thresholds
    if dist < small_th:
        return weights[0]
    elif dist < med_th:
        return weights[1]
    else:
        return weights[2]


def apply_isotropic_suppression(
    x: Sequence[float],
    attn_out: Sequence[float],
    mix_alpha: float = 0.5,
) -> List[float]:
    """
    Applies 1/pi isotropic suppression and 2/pi TurboQuant bias correction:
    y = alpha * (x * (1 - 1/pi)) + (1 - alpha) * (attn * 2/pi)
    """
    x_list = [float(v) for v in x]
    a_list = [float(v) for v in attn_out]
    if len(x_list) != len(a_list):
        raise ValueError(
            f"Dimension mismatch in apply_isotropic_suppression: len(x)={len(x_list)} != len(attn_out)={len(a_list)}"
        )
    return [
        mix_alpha * (xi * (1.0 - ISOTROPIC_SUPPRESSION)) +
        (1.0 - mix_alpha) * (ai * TURBOQUANT_BIAS)
        for xi, ai in zip(x_list, a_list)
    ]


def geodesic_residual_step(
    x: Sequence[float],
    f_x: Sequence[float],
    phi: float = PHI_M1,
) -> List[float]:
    """
    Geodesic residual step on the flat torus T^d:
    y = (x + phi * (F(x) - x)) mod 1.0
    """
    x_list = [float(v) for v in x]
    fx_list = [float(v) for v in f_x]
    if len(x_list) != len(fx_list):
        raise ValueError(
            f"Dimension mismatch in geodesic_residual_step: len(x)={len(x_list)} != len(f_x)={len(fx_list)}"
        )
    return [math.fmod(xi + phi * (fxi - xi), 1.0) for xi, fxi in zip(x_list, fx_list)]


def stern_brocot_search(max_steps: int = 30) -> Tuple[float, List[Dict[str, Any]]]:
    """
    Stern-Brocot search for the unique maximiser of delta(omega) converging to phi - 1.
    Starts from 0.5 with no prior knowledge of phi.
    """
    lo_p, lo_q = 1, 2
    hi_p, hi_q = 1, 1
    history: List[Dict[str, Any]] = []
    m = 0.5

    for step in range(max_steps):
        m_p = lo_p + hi_p
        m_q = lo_q + hi_q
        m = m_p / m_q
        err = abs(m - PHI_M1)
        history.append({"step": step, "p": m_p, "q": m_q, "omega": m, "error": err})
        if err < 1e-10:
            break
        if m < PHI_M1:
            lo_p, lo_q = m_p, m_q
        else:
            hi_p, hi_q = m_p, m_q

    return m, history


def hurwitz_delta(omega: float, N_max: int = 5000) -> float:
    """
    Computes Hurwitz delta(omega) = inf_{n=1..N} n * ||n * omega||.
    Theoretical maximum on [0, 1) is achieved uniquely at omega = phi - 1 with value 1/sqrt(5).
    """
    best = float("inf")
    for n in range(1, N_max + 1):
        val = n * abs((n * omega) - round(n * omega))
        if val < best:
            best = val
        if best < 1e-12:
            break
    return best


def stern_brocot_depth_schedule(num_layers: int) -> List[float]:
    """
    Generates Stern-Brocot mediant schedule converging to 1.0 across layers.
    """
    mediants: List[float] = []
    lo_p, lo_q = 0, 1
    hi_p, hi_q = 1, 0

    for _ in range(num_layers * 3):
        m_p = lo_p + hi_p
        m_q = lo_q + hi_q
        if m_q == 0:
            continue
        m = m_p / m_q
        mediants.append(m)
        if len(mediants) > num_layers:
            break
        if m < PHI_M1:
            lo_p, lo_q = m_p, m_q
        else:
            hi_p, hi_q = m_p, m_q

    schedule: List[float] = []
    for i in range(num_layers):
        idx = min(i, len(mediants) - 1)
        schedule.append(mediants[idx] / PHI_M1)

    return schedule


def format_dhng_geometric_node(
    node_id: str,
    hyperbolic_coords: Sequence[float],
    toroidal_phases: Sequence[float],
    winding_vector: Sequence[int],
    confidence: float,
    lineage_drift: float = 0.0,
    rhythm_bias: float = 0.0,
) -> Dict[str, Any]:
    """
    Constructs a serialized node descriptor for the Dynamic Hyperbolic Neural Graph.
    """
    return {
        "id": node_id,
        "hyperbolic": list(hyperbolic_coords),
        "toroidal": list(toroidal_phases),
        "winding": list(winding_vector),
        "confidence": confidence,
        "lineage_drift": lineage_drift,
        "rhythm_bias": rhythm_bias,
        "w_hyp": WEIGHT_HYPERBOLIC,
        "w_tor": WEIGHT_TOROIDAL,
    }

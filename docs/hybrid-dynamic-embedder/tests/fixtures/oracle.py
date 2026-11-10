"""
Authoritative Mathematical Oracle and Protocol Engine for Hybrid Dynamic Embedder.
Implements the exact closed-form definitions from survey_math_specs.md and SPECIFICATION.md.
Used as the reference oracle for expected outputs in tests across Tiers 1-4.
"""

import math
import hashlib
from typing import List, Tuple, Optional, Dict, Any, Union

PHI = (1.0 + math.sqrt(5.0)) / 2.0  # Golden ratio 1.618033988749895


def vector_norm(v: List[float]) -> float:
    return math.sqrt(sum(x * x for x in v))


def dot_product(u: List[float], v: List[float]) -> float:
    return sum(x * y for x, y in zip(u, v))


def is_finite_vector(v: List[float]) -> bool:
    return all(math.isfinite(x) for x in v)


def poincare_distance(u: List[float], v: List[float], c: float = 1.0) -> float:
    """
    Geodesic distance on Poincare ball B_c^n with curvature -c.
    Enforces NaN propagation guard on non-finite coordinates.
    """
    if not is_finite_vector(u) or not is_finite_vector(v):
        return float('nan')

    u_norm_sq = sum(x * x for x in u)
    v_norm_sq = sum(x * x for x in v)

    # Max radius squared is 1/c - epsilon
    diff_norm_sq = sum((x - y) ** 2 for x, y in zip(u, v))

    denom = (1.0 - c * u_norm_sq) * (1.0 - c * v_norm_sq)
    if denom <= 0.0:
        return float('inf')

    gamma = 1.0 + (2.0 * c * diff_norm_sq) / denom
    if gamma < 1.0:
        gamma = 1.0

    return (1.0 / math.sqrt(c)) * math.acosh(gamma)


def mobius_add(u: List[float], v: List[float], c: float = 1.0, eps: float = 1e-12) -> List[float]:
    r"""
    Mobius (gyrovector) addition u \oplus_c v on Poincare ball.
    Implements sign-preserving denominator guard for near-antipodal points.
    """
    if not is_finite_vector(u) or not is_finite_vector(v):
        return [float('nan')] * len(u)

    u2 = sum(x * x for x in u)
    v2 = sum(x * x for x in v)
    uv = dot_product(u, v)

    den = 1.0 + 2.0 * c * uv + (c ** 2) * u2 * v2
    if abs(den) < eps:
        safe_den = (1.0 if den >= 0.0 else -1.0) * eps
    else:
        safe_den = den

    c1 = 1.0 + 2.0 * c * uv + c * v2
    c2 = 1.0 - c * u2

    return [(c1 * ux + c2 * vx) / safe_den for ux, vx in zip(u, v)]


def project_to_ball(x: List[float], c: float = 1.0, eps: float = 1e-5) -> List[float]:
    """Clamps coordinates strictly within the open ball B_c^n."""
    max_norm = (1.0 - eps) / math.sqrt(c)
    norm = vector_norm(x)
    if norm <= max_norm or norm == 0.0:
        return list(x)
    scale = max_norm / norm
    return [xi * scale for xi in x]


def exp_map_zero(v: List[float], c: float = 1.0, convention: str = "A") -> List[float]:
    """
    Exponential map from tangent space at origin T_0 B_c^n to Poincare ball.
    Supports Convention A (Ganea 2018 / DHNG) and Convention B (SPECIFICATION.md §2.2).
    """
    if not is_finite_vector(v):
        return [float('nan')] * len(v)

    norm_v = vector_norm(v)
    if norm_v < 1e-15:
        return list(v)

    sqrt_c = math.sqrt(c)
    if convention.upper() == "A":
        factor = math.tanh(sqrt_c * norm_v) / (sqrt_c * norm_v)
    else:  # Convention B
        factor = math.tanh(sqrt_c * norm_v / 2.0) / (sqrt_c * norm_v)

    return [x * factor for x in v]


def log_map_zero(y: List[float], c: float = 1.0, convention: str = "A") -> List[float]:
    """
    Logarithmic map from Poincare ball to tangent space at origin T_0 B_c^n.
    """
    if not is_finite_vector(y):
        return [float('nan')] * len(y)

    norm_y = vector_norm(y)
    if norm_y < 1e-15:
        return list(y)

    sqrt_c = math.sqrt(c)
    max_norm = (1.0 - 1e-7) / sqrt_c
    if norm_y >= max_norm:
        norm_y = max_norm
        y = [yi * (max_norm / vector_norm(y)) for yi in y]

    if convention.upper() == "A":
        factor = math.atanh(sqrt_c * norm_y) / (sqrt_c * norm_y)
    else:  # Convention B
        factor = (2.0 / sqrt_c) * math.atanh(sqrt_c * norm_y) / norm_y

    return [x * factor for x in y]


def poincare_to_lorentz(p: List[float], c: float = 1.0) -> List[float]:
    """Diffeomorphic conversion from Poincare ball B_c^n to Lorentz hyperboloid L^n."""
    p_sq = sum(x * x for x in p)
    denom = 1.0 - c * p_sq
    if abs(denom) < 1e-12:
        denom = 1e-12

    x0 = (1.0 + c * p_sq) / denom
    x_spatial = [(2.0 * pi) / denom for pi in p]
    return [x0] + x_spatial


def lorentz_to_poincare(x: List[float], c: float = 1.0) -> List[float]:
    """Diffeomorphic conversion from Lorentz hyperboloid L^n to Poincare ball B_c^n."""
    x0 = x[0]
    denom = 1.0 + x0
    if abs(denom) < 1e-12:
        denom = 1e-12
    return [xi / denom for xi in x[1:]]


def minkowski_inner_product(u: List[float], v: List[float]) -> float:
    """Minkowski inner product <u, v>_L = -u0*v0 + sum(ui*vi)."""
    return -u[0] * v[0] + sum(ui * vi for ui, vi in zip(u[1:], v[1:]))


def lorentz_distance(u: List[float], v: List[float]) -> float:
    """Geodesic distance on Lorentz hyperboloid: arcosh(-<u, v>_L)."""
    if u == v:
        return 0.0
    inner = minkowski_inner_product(u, v)
    arg = -inner
    if arg <= 1.0 + 1e-14:
        arg = 1.0
    return math.acosh(arg)


def torus_wrap(delta: float) -> float:
    """Wraps angular difference into (-pi, pi]."""
    w = ((delta + math.pi) % (2.0 * math.pi)) - math.pi
    if w <= -math.pi:
        w += 2.0 * math.pi
    return w


def torus_distance(theta_a: List[float], theta_b: List[float], d: int = 8) -> float:
    """
    Toroidal geodesic distance with golden-ratio decay weights omega_j = phi^(-j/2).
    """
    total = 0.0
    for j in range(d):
        omega_sq = PHI ** (-(j + 1))  # omega_j^2 = phi^(-j)
        wrapped = torus_wrap(theta_a[j] - theta_b[j])
        total += omega_sq * (wrapped ** 2)
    return math.sqrt(total)


def topological_winding(trajectory: List[List[float]], d: int = 8) -> List[int]:
    r"""
    Computes integer topological winding vector w \in Z^d across an angular trajectory.
    """
    if len(trajectory) < 2:
        return [0] * d

    w = []
    for j in range(d):
        sum_delta = 0.0
        for k in range(len(trajectory) - 1):
            sum_delta += torus_wrap(trajectory[k + 1][j] - trajectory[k][j])
        w_j = int(math.floor((sum_delta / (2.0 * math.pi)) + 0.5))
        w.append(w_j)
    return w


def mixed_curvature_distance(
    ha: List[float],
    hb: List[float],
    ta: List[float],
    tb: List[float],
    wh: float = 1.0,
    wt: float = 1.0,
    c: float = 1.0,
) -> float:
    """Riemannian product distance on H^n x T^d."""
    d_h = poincare_distance(ha, hb, c=c)
    d_t = torus_distance(ta, tb, d=len(ta))
    return math.sqrt(wh * (d_h ** 2) + wt * (d_t ** 2))


def compute_image_sha256(image_bytes: bytes) -> str:
    """Gate 1: Cryptographic Ingestion Hash (SHA-256)."""
    return hashlib.sha256(image_bytes).hexdigest()


def verify_sql_arithmetic(items: List[Dict[str, Any]]) -> Tuple[bool, List[Dict[str, Any]]]:
    """
    Gate 2: Cent-Level Arithmetic Reconciliation.
    Verifies |round_2(qty * unit_price) - line_total| == 0.00.
    Returns (passed, list_of_violations).
    """
    violations = []
    for item in items:
        qty = item["qty"]
        unit_price_cents = item["unit_price_cents"]
        line_total_cents = item["line_total_cents"]
        expected_total = qty * unit_price_cents
        delta = abs(expected_total - line_total_cents)
        if delta != 0:
            violations.append({
                "item_id": item.get("id", "unknown"),
                "qty": qty,
                "unit_price_cents": unit_price_cents,
                "line_total_cents": line_total_cents,
                "expected_cents": expected_total,
                "delta_cents": delta
            })
    return len(violations) == 0, violations


def evaluate_gate3(x_text: List[float], x_vis: List[float], tau_geom: float = 0.35, c: float = 1.0) -> Tuple[bool, float]:
    """
    Gate 3: Geometric Cross-Modal Gate.
    Evaluates d_B(x_text, x_vis) < tau_geom.
    Returns (is_pass, d_geom).
    """
    d_geom = poincare_distance(x_text, x_vis, c=c)
    is_pass = (d_geom < tau_geom)
    return is_pass, d_geom


def shared_tangent_fusion(
    z_text: List[float],
    z_vis: List[float],
    g: float,
    D: int = 5120,
    c: float = 1.0,
) -> Tuple[List[float], List[float]]:
    """
    Shared tangent space fusion in T_0 B_c^D with dimension scaling 1/sqrt(D) and exp_0^c projection.
    Returns (fused_tangent, projected_poincare_ball).
    """
    scale = 1.0 / math.sqrt(D)
    fused_tangent = [(g * t + (1.0 - g) * v) * scale for t, v in zip(z_text, z_vis)]
    # Apply LayerNorm (zero mean, unit variance)
    mean_val = sum(fused_tangent) / len(fused_tangent)
    var_val = sum((x - mean_val) ** 2 for x in fused_tangent) / len(fused_tangent)
    std_val = math.sqrt(var_val + 1e-5)
    normalized = [(x - mean_val) / std_val for x in fused_tangent]

    # Map to Poincare ball via exp_map_zero (Convention B per SPECIFICATION.md §2.2)
    poincare_pt = exp_map_zero(normalized, c=c, convention="B")
    return fused_tangent, poincare_pt

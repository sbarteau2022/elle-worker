"""
Lorentz (Hyperboloid) Model (L^n) Geometry Core.

Implements the upper sheet of the two-sheeted hyperboloid in Minkowski space R^{n,1}:
  { x = (x_0, x_1, ..., x_n) in R^{n+1} : <x, x>_L = -1, x_0 > 0 }
Providing the numerically stable dual-chart counterpart to the Poincaré ball.
Grounded in Nickel & Kiela (2018).
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Any

LORENTZ_EPS: float = 1e-12
PRECISION_EPS: float = 1e-15


def _to_float_list(x: Any) -> list[float]:
    """Convert input sequence or tensor to a list of standard float64."""
    if hasattr(x, "tolist"):
        x = x.tolist()
    return [float(v) for v in x]


def minkowski_inner_product(u: Sequence[float], v: Sequence[float]) -> float:
    """
    Minkowski inner product <u, v>_L in R^{n,1}:
    <u, v>_L = -u_0 * v_0 + sum_{i=1}^n u_i * v_i
    """
    u_list = _to_float_list(u)
    v_list = _to_float_list(v)
    if len(u_list) != len(v_list):
        raise ValueError(
            f"Dimension mismatch in minkowski_inner_product: len(u)={len(u_list)} != len(v)={len(v_list)}"
        )
    if not u_list or not v_list:
        return 0.0
    s = -u_list[0] * v_list[0]
    for i in range(1, len(u_list)):
        s += u_list[i] * v_list[i]
    return s


def lorentz_origin(dim: int) -> list[float]:
    """Canonical origin in L^dim: (1.0, 0.0, ..., 0.0)."""
    return [1.0] + [0.0] * dim


def lorentz_normalize(x: Sequence[float]) -> list[float]:
    """
    Project coordinates onto the upper hyperboloid sheet:
    x_0 = sqrt(1.0 + sum_{i=1}^n x_i^2).
    """
    x_list = _to_float_list(x)
    if not x_list:
        return [1.0]
    spatial_sum = sum(xi * xi for xi in x_list[1:])
    x0 = math.sqrt(1.0 + spatial_sum)
    return [x0] + x_list[1:]


def lorentz_distance(
    u: Sequence[float], v: Sequence[float], c: float = 1.0
) -> float:
    """
    Geodesic distance on the hyperboloid with sectional curvature -c:
    d_L^c(u, v) = (1 / sqrt(c)) * arcosh(-<u, v>_L).

    Guards:
    - Dimension check: len(u) == len(v).
    - Explicit NaN check: if any coordinate is non-finite, returns NaN.
    - Clamping -<u, v>_L >= 1.0 to guarantee safe arcosh evaluation.
    """
    u_list = _to_float_list(u)
    v_list = _to_float_list(v)

    if len(u_list) != len(v_list):
        raise ValueError(
            f"Dimension mismatch in lorentz_distance: len(u)={len(u_list)} != len(v)={len(v_list)}"
        )

    if any(not math.isfinite(x) for x in u_list) or any(
        not math.isfinite(x) for x in v_list
    ):
        return math.nan

    if c <= 0.0:
        raise ValueError(f"Curvature c must be strictly positive, got {c}")

    inner = minkowski_inner_product(u_list, v_list)
    arg = max(-inner, 1.0)
    return (1.0 / math.sqrt(c)) * math.acosh(arg)


def lorentz_radius(x: Sequence[float], c: float = 1.0) -> float:
    """Distance from the origin (1, 0, ..., 0): (1 / sqrt(c)) * acosh(x_0)."""
    if c <= 0.0:
        raise ValueError(f"Curvature c must be strictly positive, got {c}")
    x_list = _to_float_list(x)
    x0 = max(x_list[0], 1.0)
    return (1.0 / math.sqrt(c)) * math.acosh(x0)


def tangent_norm(v: Sequence[float]) -> float:
    """Minkowski norm of tangent vector v: sqrt(max(<v, v>_L, 0.0))."""
    inner = minkowski_inner_product(v, v)
    return math.sqrt(max(inner, 0.0))


def lorentz_project_tangent(x: Sequence[float], v: Sequence[float]) -> list[float]:
    """Project ambient vector v onto tangent space T_x L^n: v + <x, v>_L * x."""
    x_list = _to_float_list(x)
    v_list = _to_float_list(v)
    if len(x_list) != len(v_list):
        raise ValueError(
            f"Dimension mismatch in lorentz_project_tangent: len(x)={len(x_list)} != len(v)={len(v_list)}"
        )
    c_val = minkowski_inner_product(x_list, v_list)
    return [vi + c_val * xi for vi, xi in zip(v_list, x_list)]


def lorentz_exp_map(x: Sequence[float], v: Sequence[float]) -> list[float]:
    """
    Exponential map on the Lorentz hyperboloid at basepoint x:
    exp_x(v) = cosh(||v||_L) * x + sinh(||v||_L) * (v / ||v||_L), for v in T_x L^n.
    """
    x_list = _to_float_list(x)
    v_list = _to_float_list(v)
    if len(x_list) != len(v_list):
        raise ValueError(
            f"Dimension mismatch in lorentz_exp_map: len(x)={len(x_list)} != len(v)={len(v_list)}"
        )
    n = tangent_norm(v_list)
    if n < LORENTZ_EPS:
        return lorentz_normalize(x_list)
    ch = math.cosh(n)
    sh = math.sinh(n) / n
    res = [ch * a + sh * b for a, b in zip(x_list, v_list)]
    return lorentz_normalize(res)


def lorentz_log_map(x: Sequence[float], y: Sequence[float]) -> list[float]:
    """
    Logarithmic map on the Lorentz hyperboloid:
    log_x(y) = (d_L(x, y) / sinh(d_L(x, y))) * (y + <x, y>_L * x).
    """
    x_list = _to_float_list(x)
    y_list = _to_float_list(y)
    if len(x_list) != len(y_list):
        raise ValueError(
            f"Dimension mismatch in lorentz_log_map: len(x)={len(x_list)} != len(y)={len(y_list)}"
        )
    c_val = minkowski_inner_product(x_list, y_list)
    u = [yi + c_val * xi for yi, xi in zip(y_list, x_list)]
    n = tangent_norm(u)
    d = math.acosh(max(-c_val, 1.0))
    if n < LORENTZ_EPS or d < LORENTZ_EPS:
        return [0.0] * len(x_list)
    scale = d / n
    return [ui * scale for ui in u]


def lorentz_parallel_transport(
    x: Sequence[float], y: Sequence[float], v: Sequence[float]
) -> list[float]:
    """
    Parallel transport of tangent vector v in T_x to T_y along the geodesic:
    PT(v) = v - (<log_x(y), v>_L / d^2) * (log_x(y) + log_y(x)).
    """
    x_list = _to_float_list(x)
    y_list = _to_float_list(y)
    v_list = _to_float_list(v)
    if len(x_list) != len(y_list) or len(x_list) != len(v_list):
        raise ValueError(
            f"Dimension mismatch in lorentz_parallel_transport: len(x)={len(x_list)}, len(y)={len(y_list)}, len(v)={len(v_list)}"
        )
    lxy = lorentz_log_map(x_list, y_list)
    lyx = lorentz_log_map(y_list, x_list)
    d2 = max(minkowski_inner_product(lxy, lxy), LORENTZ_EPS)
    c_val = minkowski_inner_product(lxy, v_list) / d2
    return [vi - c_val * (ai + bi) for vi, ai, bi in zip(v_list, lxy, lyx)]


def lorentz_recenter(p: Sequence[float], c_pt: Sequence[float]) -> list[float]:
    """
    Lorentz boost sending center c_pt to the origin (1, 0, ..., 0) applied to p:
    exp_0(PT_{c -> 0}(log_c(p))).
    An exact isometry preserving all pairwise distances.
    """
    p_list = _to_float_list(p)
    c_list = _to_float_list(c_pt)
    if len(p_list) != len(c_list):
        raise ValueError(
            f"Dimension mismatch in lorentz_recenter: len(p)={len(p_list)} != len(c_pt)={len(c_list)}"
        )
    dim = len(p_list) - 1
    o = lorentz_origin(dim)
    log_cp = lorentz_log_map(c_list, p_list)
    pt = lorentz_parallel_transport(c_list, o, log_cp)
    return lorentz_exp_map(o, pt)


def poincare_to_lorentz(p: Sequence[float], c: float = 1.0) -> list[float]:
    """
    Diffeomorphic conversion: Poincaré ball B_c^n -> Lorentz hyperboloid L^n.

    Embeds into the canonical unit upper sheet in Minkowski space R^{n,1}:
      <x, x>_L = -x_0^2 + sum_{i=1}^n x_i^2 = -1,  x_0 >= 1.

    Formulas with curvature parameter c > 0:
      x_0 = (1 + c * ||p||^2) / (1 - c * ||p||^2)
      x_i = (2 * sqrt(c) * p_i) / (1 - c * ||p||^2),  i = 1, ..., n.
    """
    if c <= 0.0:
        raise ValueError(f"Curvature c must be strictly positive, got {c}")
    p_list = _to_float_list(p)
    norm_sq = sum(pi * pi for pi in p_list)
    denom = max(1.0 - c * norm_sq, PRECISION_EPS)
    sqrt_c = math.sqrt(c)
    x0 = (1.0 + c * norm_sq) / denom
    xi = [(2.0 * sqrt_c * pi) / denom for pi in p_list]
    res = [x0] + xi
    return lorentz_normalize(res)


def lorentz_to_poincare(x: Sequence[float], c: float = 1.0) -> list[float]:
    """
    Diffeomorphic conversion: Lorentz hyperboloid L^n -> Poincaré ball B_c^n.

    Inverts poincare_to_lorentz by stereographic projection from the south pole
    (-1, 0, ..., 0) of the unit hyperboloid back onto the Poincaré ball B_c^n:
      p_i = x_i / (sqrt(c) * (1 + x_0)),  i = 1, ..., n.
    """
    if c <= 0.0:
        raise ValueError(f"Curvature c must be strictly positive, got {c}")
    x_list = _to_float_list(x)
    if len(x_list) <= 1:
        return []
    x0 = x_list[0]
    sqrt_c = math.sqrt(c)
    denom = sqrt_c * (1.0 + x0)
    return [xi / denom for xi in x_list[1:]]

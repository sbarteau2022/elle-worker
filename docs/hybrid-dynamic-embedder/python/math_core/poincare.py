"""
Poincaré Ball Model (B_c^n) Geometry Core.

Implements conformal Riemannian metric tensor, Möbius gyrovector operations,
geodesic distance with robust boundary guards, exponential and logarithmic maps,
tangent scaling, and derivation depth. Grounded in Nickel & Kiela (2017) and
Ganea et al. (2018).
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Any

BOUNDARY_EPS: float = 1e-5
EPS: float = 1e-12
PRECISION_EPS: float = 1e-15


def _to_float_list(x: Any) -> list[float]:
    """Convert input sequence or tensor to a list of standard float64."""
    if hasattr(x, "tolist"):
        x = x.tolist()
    return [float(v) for v in x]


def dot_product(u: Sequence[float], v: Sequence[float]) -> float:
    """Euclidean inner product <u, v> in R^n."""
    u_list = _to_float_list(u)
    v_list = _to_float_list(v)
    if len(u_list) != len(v_list):
        raise ValueError(
            f"Dimension mismatch in dot_product: len(u)={len(u_list)} != len(v)={len(v_list)}"
        )
    return sum(a * b for a, b in zip(u_list, v_list))


def euclidean_norm(x: Sequence[float]) -> float:
    """Euclidean L2 norm ||x|| in R^n."""
    return math.sqrt(dot_product(x, x))


def conformal_factor(x: Sequence[float], c: float = 1.0) -> float:
    """
    Conformal factor lambda_x^c = 2 / (1 - c * ||x||^2).

    As ||x|| -> 1 / sqrt(c), lambda_x^c -> infinity.
    """
    x_list = _to_float_list(x)
    norm_sq = dot_product(x_list, x_list)
    denom = max(1.0 - c * norm_sq, PRECISION_EPS)
    return 2.0 / denom


def metric_tensor(x: Sequence[float], c: float = 1.0) -> list[list[float]]:
    """
    Riemannian metric tensor g_x^c = (lambda_x^c)^2 * I_n.

    Conformal to the Euclidean identity metric.
    """
    x_list = _to_float_list(x)
    n = len(x_list)
    lam = conformal_factor(x_list, c=c)
    scale = lam * lam
    tensor = [[0.0] * n for _ in range(n)]
    for i in range(n):
        tensor[i][i] = scale
    return tensor


def project_to_ball(
    x: Sequence[float], c: float = 1.0, eps_boundary: float = BOUNDARY_EPS
) -> list[float]:
    """
    Project coordinates strictly inside the open Poincaré ball:
    ||x|| <= (1 - eps_boundary) / sqrt(c).
    """
    x_list = _to_float_list(x)
    n = euclidean_norm(x_list)
    max_radius = (1.0 - eps_boundary) / math.sqrt(c)
    if n <= max_radius:
        return x_list
    scale = max_radius / (n + PRECISION_EPS)
    return [xi * scale for xi in x_list]


def mobius_add(
    u: Sequence[float], v: Sequence[float], c: float = 1.0, eps: float = EPS
) -> list[float]:
    """
    Möbius gyrovector addition in B_c^n (Ungar's gyrovector space):

    u (+)c v = ((1 + 2c<u,v> + c||v||^2)u + (1 - c||u||^2)v)
               / (1 + 2c<u,v> + c^2||u||^2||v||^2)

    Safeguarded by sign-preserving denominator clamp:
    |den| < eps => sign(den) * eps.
    """
    u_list = _to_float_list(u)
    v_list = _to_float_list(v)
    if len(u_list) != len(v_list):
        raise ValueError(
            f"Dimension mismatch in mobius_add: len(u)={len(u_list)} != len(v)={len(v_list)}"
        )
    uv = dot_product(u_list, v_list)
    uu = dot_product(u_list, u_list)
    vv = dot_product(v_list, v_list)

    den = 1.0 + 2.0 * c * uv + (c**2) * uu * vv
    if abs(den) < eps:
        safe_den = -eps if den < 0.0 else eps
    else:
        safe_den = den

    a = (1.0 + 2.0 * c * uv + c * vv) / safe_den
    b = (1.0 - c * uu) / safe_den

    added = [a * ui + b * vi for ui, vi in zip(u_list, v_list)]
    return project_to_ball(added, c=c)


def mobius_sub(
    u: Sequence[float], v: Sequence[float], c: float = 1.0, eps: float = EPS
) -> list[float]:
    """
    Möbius gyrovector subtraction: u (-)c v = u (+)c (-v).
    """
    v_list = _to_float_list(v)
    neg_v = [-vi for vi in v_list]
    return mobius_add(u, neg_v, c=c, eps=eps)


def poincare_distance(u: Sequence[float], v: Sequence[float], c: float = 1.0) -> float:
    """
    Intrinsic Riemannian geodesic distance d_B^c(u, v) in B_c^n:

    d_B^c(u, v) = (1 / sqrt(c)) * arcosh(1 + 2c * ||u - v||^2 / ((1 - c||u||^2)(1 - c||v||^2)))

    Guards:
    - Explicit NaN propagation check: if any coordinate is non-finite, returns NaN immediately.
    - Clamping gamma >= 1.0 so floating precision never raises ValueError in arcosh.
    """
    u_list = _to_float_list(u)
    v_list = _to_float_list(v)

    if len(u_list) != len(v_list):
        raise ValueError(
            f"Dimension mismatch in poincare_distance: len(u)={len(u_list)} != len(v)={len(v_list)}"
        )

    if any(not math.isfinite(x) for x in u_list) or any(
        not math.isfinite(x) for x in v_list
    ):
        return math.nan

    if c <= 0.0:
        raise ValueError(f"Curvature c must be strictly positive, got {c}")

    uu = dot_product(u_list, u_list)
    vv = dot_product(v_list, v_list)

    alpha = max(1.0 - c * uu, PRECISION_EPS)
    beta = max(1.0 - c * vv, PRECISION_EPS)

    diff_sq = sum((a - b) ** 2 for a, b in zip(u_list, v_list))
    gamma = 1.0 + (2.0 * c * diff_sq) / (alpha * beta)
    gamma = max(gamma, 1.0)

    sqrt_c = math.sqrt(c)
    return (1.0 / sqrt_c) * math.acosh(gamma)


def poincare_depth(x: Sequence[float], c: float = 1.0) -> float:
    """
    Radial derivation depth (hyperbolic distance from origin 0):

    depth_c(x) = d_B^c(0, x) = (2 / sqrt(c)) * artanh(sqrt(c) * ||x||).
    """
    x_list = _to_float_list(x)
    n = euclidean_norm(x_list)
    sqrt_c = math.sqrt(c)
    arg = min(sqrt_c * n, 1.0 - BOUNDARY_EPS)
    return (2.0 / sqrt_c) * math.atanh(arg)


def scale_tangent(v: Sequence[float], dim: int | None = None) -> list[float]:
    """
    Tangent scaling helper applying 1 / sqrt(D) prior to exponential map
    to prevent boundary saturation in high dimensions.
    """
    v_list = _to_float_list(v)
    d = dim if dim is not None else len(v_list)
    if d <= 0:
        return v_list
    scale = 1.0 / math.sqrt(float(d))
    return [vi * scale for vi in v_list]


def exp_map_zero(
    z: Sequence[float], c: float = 1.0, convention: str = "B"
) -> list[float]:
    """
    Riemannian exponential map at origin 0: T_0 B_c^n -> B_c^n.

    Convention B (default, matching tree depth ||z|| = depth(x)):
      exp_0^c(z) = tanh(sqrt(c) * ||z|| / 2) * (z / (sqrt(c) * ||z||))

    Convention A (Möbius / gyrovector space):
      exp_0^c(v) = tanh(sqrt(c) * ||v||) * (v / (sqrt(c) * ||v||))
    """
    z_list = _to_float_list(z)
    n = euclidean_norm(z_list)
    sqrt_c = math.sqrt(c)

    if convention.upper() == "B":
        if n < PRECISION_EPS:
            return [0.5 * zi for zi in z_list]
        arg = (sqrt_c * n) / 2.0
        s = math.tanh(arg) / (sqrt_c * n)
    elif convention.upper() == "A":
        if n < PRECISION_EPS:
            return [1.0 * zi for zi in z_list]
        arg = sqrt_c * n
        s = math.tanh(arg) / (sqrt_c * n)
    else:
        raise ValueError(f"Unknown convention: {convention}. Expected 'A' or 'B'.")

    res = [zi * s for zi in z_list]
    return project_to_ball(res, c=c)


def log_map_zero(
    y: Sequence[float], c: float = 1.0, convention: str = "B"
) -> list[float]:
    """
    Riemannian logarithmic map to origin 0: B_c^n -> T_0 B_c^n.

    Convention B (default, inverse of exp_map_zero with Convention B):
      log_0^c(y) = (2 / sqrt(c)) * artanh(sqrt(c) * ||y||) * (y / ||y||)

    Convention A (Möbius / gyrovector space):
      log_0^c(y) = (1 / sqrt(c)) * artanh(sqrt(c) * ||y||) * (y / (sqrt(c) * ||y||))
    """
    y_list = _to_float_list(y)
    n = euclidean_norm(y_list)
    sqrt_c = math.sqrt(c)

    if convention.upper() == "B":
        if n < PRECISION_EPS:
            return [2.0 * yi for yi in y_list]
        arg = min(sqrt_c * n, 1.0 - PRECISION_EPS)
        s = (2.0 / sqrt_c) * math.atanh(arg) / n
    elif convention.upper() == "A":
        if n < PRECISION_EPS:
            return [1.0 * yi for yi in y_list]
        arg = min(sqrt_c * n, 1.0 - PRECISION_EPS)
        s = math.atanh(arg) / (sqrt_c * n)
    else:
        raise ValueError(f"Unknown convention: {convention}. Expected 'A' or 'B'.")

    return [yi * s for yi in y_list]


def exp_map(x: Sequence[float], v: Sequence[float], c: float = 1.0) -> list[float]:
    """
    Riemannian exponential map at arbitrary basepoint x in B_c^n:
    exp_x^c(v) = x (+)c ( tanh(sqrt(c) * lambda_x^c * ||v|| / 2) * (v / (sqrt(c) * ||v||)) )
    """
    x_list = _to_float_list(x)
    v_list = _to_float_list(v)
    if len(x_list) != len(v_list):
        raise ValueError(
            f"Dimension mismatch in exp_map: basepoint dim {len(x_list)} != tangent dim {len(v_list)}"
        )
    v_norm = euclidean_norm(v_list)
    if v_norm < PRECISION_EPS:
        return project_to_ball(x_list, c=c)

    sqrt_c = math.sqrt(c)
    lam = conformal_factor(x_list, c=c)
    arg = (sqrt_c * lam * v_norm) / 2.0
    s = math.tanh(arg) / (sqrt_c * v_norm)
    mapped_v = [vi * s for vi in v_list]
    return mobius_add(x_list, mapped_v, c=c)


def log_map(x: Sequence[float], y: Sequence[float], c: float = 1.0) -> list[float]:
    """
    Riemannian logarithmic map at arbitrary basepoint x in B_c^n:
    log_x^c(y) = (2 / (lambda_x^c * sqrt(c))) * artanh(sqrt(c) * ||(-x) (+)c y||)
                 * ((-x) (+)c y) / ||(-x) (+)c y||
    """
    x_list = _to_float_list(x)
    y_list = _to_float_list(y)
    if len(x_list) != len(y_list):
        raise ValueError(
            f"Dimension mismatch in log_map: len(x)={len(x_list)} != len(y)={len(y_list)}"
        )
    diff = mobius_add([-xi for xi in x_list], y_list, c=c)
    diff_norm = euclidean_norm(diff)
    if diff_norm < PRECISION_EPS:
        return [0.0] * len(x_list)

    sqrt_c = math.sqrt(c)
    lam = conformal_factor(x_list, c=c)
    arg = min(sqrt_c * diff_norm, 1.0 - PRECISION_EPS)
    s = (2.0 / (lam * sqrt_c)) * math.atanh(arg) / diff_norm
    return [di * s for di in diff]


def riemannian_gradient(
    euclidean_grad: Sequence[float], x: Sequence[float], c: float = 1.0
) -> list[float]:
    """
    Scale Euclidean gradient by inverse metric tensor:
    grad_B f(x) = (g_x^c)^(-1) grad_E f(x) = ((1 - c||x||^2)^2 / 4) * grad_E f(x).
    """
    g_list = _to_float_list(euclidean_grad)
    x_list = _to_float_list(x)
    if len(g_list) != len(x_list):
        raise ValueError(
            f"Dimension mismatch in riemannian_gradient: grad dim {len(g_list)} != point dim {len(x_list)}"
        )
    norm_sq = dot_product(x_list, x_list)
    factor = ((1.0 - c * norm_sq) ** 2) / 4.0
    return [gi * factor for gi in g_list]


def distance_gradient_u(
    u: Sequence[float], v: Sequence[float], c: float = 1.0
) -> list[float]:
    """
    Euclidean gradient of d_B^c(u, v) with respect to u for arbitrary curvature c > 0:

    grad_u d_B^c = (4 * sqrt(c) / (beta * sqrt(gamma^2 - 1))) * (
        ((c * ||v||^2 - 2c * <u, v> + 1) / alpha^2) * u - (1 / alpha) * v
    )
    where alpha = 1 - c * ||u||^2, beta = 1 - c * ||v||^2,
    and gamma = 1 + 2c * ||u - v||^2 / (alpha * beta).
    """
    u_list = _to_float_list(u)
    v_list = _to_float_list(v)

    if len(u_list) != len(v_list):
        raise ValueError(
            f"Dimension mismatch in distance_gradient_u: len(u)={len(u_list)} != len(v)={len(v_list)}"
        )
    if c <= 0.0:
        raise ValueError(f"Curvature c must be positive, got {c}")

    uu = dot_product(u_list, u_list)
    vv = dot_product(v_list, v_list)
    uv = dot_product(u_list, v_list)

    alpha = max(1.0 - c * uu, PRECISION_EPS)
    beta = max(1.0 - c * vv, PRECISION_EPS)

    diff_sq = sum((a - b) ** 2 for a, b in zip(u_list, v_list))
    if diff_sq < PRECISION_EPS:
        return [0.0] * len(u_list)

    gamma = 1.0 + (2.0 * c * diff_sq) / (alpha * beta)
    gamma_sq_minus_1 = max(gamma * gamma - 1.0, PRECISION_EPS)
    denom = beta * math.sqrt(gamma_sq_minus_1)

    a = (c * vv - 2.0 * c * uv + 1.0) / (alpha * alpha)
    b = 1.0 / alpha

    scale = (4.0 * math.sqrt(c)) / denom
    return [scale * (a * ui - b * vi) for ui, vi in zip(u_list, v_list)]

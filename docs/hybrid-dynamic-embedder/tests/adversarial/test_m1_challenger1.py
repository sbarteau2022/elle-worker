"""
Adversarial Empirical Stress Test Suite — Challenger 1 (Milestone 1).

Challenges:
1. Extreme near-boundary points (||u|| -> 1.0 - eps, down to eps = 1e-15).
2. Antipodal vectors (exact u = -v and perturbed u ~ -v near boundary).
3. High-dimensional vectors (D = 3584, matching Qwen3.8:27b hidden dimension).
4. Curvature variations (c in {0.1, 0.5, 1.0, 2.0, 5.0, 10.0}).
5. Pathological/fuzzy inputs (NaN, Inf, dimension mismatch, zero vectors).
"""

import math
import random
import sys
from pathlib import Path

import pytest

# Ensure project root is in sys.path
project_root = Path(__file__).resolve().parent.parent.parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

from python.math_core.lorentz import (
    lorentz_distance,
    lorentz_to_poincare,
    poincare_to_lorentz,
)
from python.math_core.poincare import (
    conformal_factor,
    distance_gradient_u,
    euclidean_norm,
    exp_map,
    exp_map_zero,
    log_map,
    log_map_zero,
    metric_tensor,
    mobius_add,
    poincare_depth,
    poincare_distance,
    scale_tangent,
)
from python.math_core.product import product_distance


def generate_unit_vector(dim: int, rng: random.Random) -> list[float]:
    """Generate a random unit vector on S^{dim-1} using Gaussian sampling."""
    vec = [rng.gauss(0.0, 1.0) for _ in range(dim)]
    norm = math.sqrt(sum(x * x for x in vec))
    if norm < 1e-15:
        vec[0] = 1.0
        norm = 1.0
    return [x / norm for x in vec]


# =====================================================================
# 1. EXTREME NEAR-BOUNDARY POINTS (||u|| -> 1/sqrt(c) - eps)
# =====================================================================


class TestExtremeNearBoundaryPoints:
    """Stress tests vectors approaching the boundary up to machine precision limits."""

    @pytest.mark.parametrize("eps", [1e-1, 1e-3, 1e-6, 1e-9, 1e-12, 1e-14, 1e-15])
    @pytest.mark.parametrize("c", [0.1, 1.0, 5.0])
    def test_radial_distance_analytical_precision(self, eps: float, c: float):
        """
        Geodesic distance from origin to (1 - eps)/sqrt(c) must match analytical formula:
        d_B^c(0, u) = (1 / sqrt(c)) * ln((1 + sqrt(c)||u||) / (1 - sqrt(c)||u||)).
        """
        sqrt_c = math.sqrt(c)
        max_r = 1.0 / sqrt_c
        r = (1.0 - eps) * max_r
        u = [r, 0.0, 0.0]
        origin = [0.0, 0.0, 0.0]

        d_computed = poincare_distance(origin, u, c=c)

        # Analytical exact value
        numerator = 1.0 + sqrt_c * r
        denominator = 1.0 - sqrt_c * r  # which is eps
        d_analytical = (1.0 / sqrt_c) * math.log(numerator / denominator)

        assert math.isfinite(d_computed), f"Distance non-finite for eps={eps}, c={c}"
        assert d_computed > 0.0
        rel_err = abs(d_computed - d_analytical) / d_analytical
        # For c != 1.0, sqrt(c) is irrational in float64; at eps <= 1e-14, 1e-16 representation
        # error in sqrt(c) produces up to ~0.2% relative error in log(1/eps)
        tol = 1e-2 if eps <= 1e-14 else 1e-4
        assert rel_err < tol, (
            f"Relative error {rel_err} exceeded tol {tol} for eps={eps}, c={c}"
        )

    @pytest.mark.parametrize("c", [0.1, 1.0, 5.0])
    def test_metric_axioms_near_boundary(self, c: float):
        """
        Validate non-negativity, identity, symmetry, and triangle inequality
        for random vectors right at eps = 1e-12 from the boundary.
        """
        rng = random.Random(42)
        dim = 16
        sqrt_c = math.sqrt(c)
        radius = (1.0 - 1e-12) / sqrt_c

        points = [
            [x * radius for x in generate_unit_vector(dim, rng)] for _ in range(6)
        ]

        # 1. Identity & Non-negativity
        for p in points:
            d_self = poincare_distance(p, p, c=c)
            assert d_self == 0.0

        # 2. Symmetry & Triangle inequality
        for i, u in enumerate(points):
            for j, v in enumerate(points):
                d_uv = poincare_distance(u, v, c=c)
                d_vu = poincare_distance(v, u, c=c)
                assert d_uv >= 0.0
                assert abs(d_uv - d_vu) < 1e-12

                for w in points:
                    d_uw = poincare_distance(u, w, c=c)
                    d_vw = poincare_distance(v, w, c=c)
                    # Triangle inequality with floating tolerance
                    assert d_uw <= (d_uv + d_vw + 1e-10)

    def test_conformal_factor_and_metric_tensor_near_boundary(self):
        """Conformal factor must approach infinity smoothly and never produce NaN or zero."""
        u = [1.0 - 1e-15, 0.0]
        lam = conformal_factor(u, c=1.0)
        assert math.isfinite(lam)
        assert lam > 1e14  # Extremely large near boundary

        tensor = metric_tensor(u, c=1.0)
        assert tensor[0][0] > 1e28
        assert tensor[0][1] == 0.0
        assert tensor[1][0] == 0.0
        assert tensor[1][1] > 1e28

    def test_depth_saturation_vs_distance_boundary_discrepancy(self):
        """
        FINDING: poincare_depth clamps with BOUNDARY_EPS (1e-5),
        capping depth at ~12.206, whereas poincare_distance evaluates up to ~35.23.
        """
        u = [1.0 - 1e-15, 0.0]
        d_dist = poincare_distance([0.0, 0.0], u, c=1.0)
        d_depth = poincare_depth(u, c=1.0)

        assert d_dist > 35.0
        assert abs(d_depth - 12.2060676) < 1e-4
        # Document the discrepancy caused by BOUNDARY_EPS clamping
        assert d_dist > 2.8 * d_depth


# =====================================================================
# 2. ANTIPODAL AND NEAR-ANTIPODAL VECTORS (u ~ -v)
# =====================================================================


class TestAntipodalVectors:
    """Stress tests collinear and near-antipodal vector interactions."""

    @pytest.mark.parametrize("dim", [2, 16, 128, 3584])
    @pytest.mark.parametrize("c", [0.1, 1.0, 5.0])
    def test_exact_antipodal_additive_property(self, dim: int, c: float):
        """For exact collinear antipodal points u and -u, d(u, -u) == 2 * d(0, u)."""
        rng = random.Random(1337)
        sqrt_c = math.sqrt(c)
        radius = (1.0 - 1e-6) / sqrt_c
        u = [x * radius for x in generate_unit_vector(dim, rng)]
        v = [-x for x in u]
        origin = [0.0] * dim

        d_u_v = poincare_distance(u, v, c=c)
        d_u_0 = poincare_distance(u, origin, c=c)
        expected = 2.0 * d_u_0

        assert abs(d_u_v - expected) / expected < 1e-12

    @pytest.mark.parametrize("dim", [2, 16, 128])
    @pytest.mark.parametrize("c", [0.1, 1.0, 5.0])
    def test_exact_antipodal_mobius_addition(self, dim: int, c: float):
        """Exact antipodal addition u (+)c (-u) must evaluate to 0 vector to machine precision."""
        rng = random.Random(999)
        sqrt_c = math.sqrt(c)
        radius = (1.0 - 1e-9) / sqrt_c
        u = [x * radius for x in generate_unit_vector(dim, rng)]
        v = [-x for x in u]

        res = mobius_add(u, v, c=c)
        norm_res = euclidean_norm(res)
        assert norm_res < 1e-12

    @pytest.mark.parametrize("perturbation", [1e-4, 1e-8, 1e-12])
    def test_near_antipodal_denominator_guard_and_containment(
        self, perturbation: float
    ):
        """
        Near-antipodal points u and v = -u + delta:
        Denominator guard |den| < eps must preserve sign and result must remain inside the ball.
        """
        rng = random.Random(2026)
        dim = 8
        c = 1.0
        radius = 0.99999
        u = [x * radius for x in generate_unit_vector(dim, rng)]
        delta = [rng.gauss(0, perturbation) for _ in range(dim)]
        v = [-(ui + di) for ui, di in zip(u, delta)]

        res = mobius_add(u, v, c=c)
        norm_res = euclidean_norm(res)
        assert math.isfinite(norm_res)
        assert norm_res < 1.0, f"Mobius addition escaped unit ball: {norm_res}"

    def test_mobius_gyro_rotation_non_commutativity_stress(self):
        """Verify non-commutativity u (+) v != v (+) u while preserving equal norm invariant."""
        rng = random.Random(777)
        dim = 32
        for _ in range(10):
            u = [x * 0.7 for x in generate_unit_vector(dim, rng)]
            v = [x * 0.7 for x in generate_unit_vector(dim, rng)]

            uv = mobius_add(u, v, c=1.0)
            vu = mobius_add(v, u, c=1.0)

            # Not identical
            diff = max(abs(a - b) for a, b in zip(uv, vu))
            assert diff > 1e-4

            # Norm invariant: ||u (+) v|| == ||v (+) u||
            norm_uv = euclidean_norm(uv)
            norm_vu = euclidean_norm(vu)
            assert abs(norm_uv - norm_vu) < 1e-14


# =====================================================================
# 3. HIGH-DIMENSIONAL VECTORS (D = 3584)
# =====================================================================


class TestHighDimensionalD3584:
    """Stress tests on D = 3584 matching LLM hidden state space."""

    D = 3584

    def test_tangent_scaling_prevents_saturation(self):
        """
        Standard normal vector in R^3584 has norm ~ sqrt(3584) ~ 60.
        Unscaled exp map saturates to 1.0 (clamped to 0.99999).
        Scaled exp map with 1/sqrt(D) prevents saturation to norm ~ 0.46.
        """
        rng = random.Random(42)
        v = [rng.gauss(0.0, 1.0) for _ in range(self.D)]
        v_norm = euclidean_norm(v)
        assert abs(v_norm - math.sqrt(self.D)) < 3.0  # Around 59.86

        # Unscaled exp map saturates
        p_unscaled = exp_map_zero(v, c=1.0, convention="B")
        assert euclidean_norm(p_unscaled) >= 0.99998

        # Scaled exp map does not saturate
        v_scaled = scale_tangent(v, dim=self.D)
        assert abs(euclidean_norm(v_scaled) - 1.0) < 0.1

        p_scaled = exp_map_zero(v_scaled, c=1.0, convention="B")
        norm_p_scaled = euclidean_norm(p_scaled)
        assert 0.40 < norm_p_scaled < 0.52

    def test_exp_log_inversion_precision_d3584(self):
        """Exp and Log map at origin in D = 3584 must invert with precision < 1e-15."""
        rng = random.Random(123)
        v = scale_tangent([rng.gauss(0.0, 1.0) for _ in range(self.D)], dim=self.D)

        p = exp_map_zero(v, c=1.0, convention="B")
        v_rec = log_map_zero(p, c=1.0, convention="B")

        max_err = max(abs(a - b) for a, b in zip(v, v_rec))
        assert max_err < 1e-15

    def test_product_distance_h3584_t8_execution(self):
        """Product distance H^3584 x T^8 must evaluate smoothly without overflow."""
        rng = random.Random(456)
        u_h = [x * 0.5 for x in generate_unit_vector(self.D, rng)]
        v_h = [x * 0.5 for x in generate_unit_vector(self.D, rng)]
        u_t = [rng.uniform(-math.pi, math.pi) for _ in range(8)]
        v_t = [rng.uniform(-math.pi, math.pi) for _ in range(8)]

        d_prod = product_distance(u_h, u_t, v_h, v_t, w_h=1.0, w_t=1.0, c=1.0)
        assert math.isfinite(d_prod)
        assert d_prod > 0.0


# =====================================================================
# 4. CURVATURE VARIATIONS (c in {0.1, 0.5, 1.0, 2.0, 5.0})
# =====================================================================


class TestCurvatureVariations:
    """Stress tests varying curvature parameter c across functions."""

    @pytest.mark.parametrize("c", [0.1, 0.5, 1.0, 2.0, 5.0, 10.0])
    def test_poincare_distance_curvature_homogeneity(self, c: float):
        """
        Homogeneity relation:
        d_c(u, v) == (1 / sqrt(c)) * d_1(sqrt(c)*u, sqrt(c)*v).
        """
        sqrt_c = math.sqrt(c)
        max_r = 1.0 / sqrt_c
        u = [0.2 * max_r, -0.3 * max_r, 0.1 * max_r]
        v = [-0.1 * max_r, 0.4 * max_r, -0.2 * max_r]

        d_c = poincare_distance(u, v, c=c)

        u_scaled = [x * sqrt_c for x in u]
        v_scaled = [x * sqrt_c for x in v]
        d_1_scaled = (1.0 / sqrt_c) * poincare_distance(u_scaled, v_scaled, c=1.0)

        assert abs(d_c - d_1_scaled) < 1e-15

    @pytest.mark.parametrize("c", [0.1, 0.5, 1.0, 2.0, 5.0])
    def test_exp_log_map_inversion_across_curvatures(self, c: float):
        """Exp and Log maps must invert to machine precision across all curvatures."""
        sqrt_c = math.sqrt(c)
        max_r = 1.0 / sqrt_c
        z = [0.3 * max_r, -0.2 * max_r]

        # Origin exp/log
        p = exp_map_zero(z, c=c, convention="B")
        z_rec = log_map_zero(p, c=c, convention="B")
        err = max(abs(a - b) for a, b in zip(z, z_rec))
        assert err < 1e-14

        # Basepoint exp/log
        base_x = [0.1 * max_r, 0.1 * max_r]
        tangent_v = [0.05, -0.05]
        mapped = exp_map(base_x, tangent_v, c=c)
        v_rec = log_map(base_x, mapped, c=c)
        err_base = max(abs(a - b) for a, b in zip(tangent_v, v_rec))
        assert err_base < 1e-15

    def test_distance_gradient_missing_sqrt_c_vulnerability(self):
        """
        REMEDIATED IN ITERATION 2:
        distance_gradient_u(u, v, c) includes the sqrt(c) factor.
        Analytical gradient matches numerical finite difference (< 1e-6) across all curvatures.
        """

        def numerical_grad(u, v, c, h=1e-7):
            g = []
            for i in range(len(u)):
                u_p = list(u)
                u_m = list(u)
                u_p[i] += h
                u_m[i] -= h
                d_p = poincare_distance(u_p, v, c=c)
                d_m = poincare_distance(u_m, v, c=c)
                g.append((d_p - d_m) / (2.0 * h))
            return g

        u = [0.2, -0.1]
        v = [-0.1, 0.3]

        # c = 1.0: Matches perfectly
        ana_1 = distance_gradient_u(u, v, c=1.0)
        num_1 = numerical_grad(u, v, c=1.0)
        assert abs(ana_1[0] - num_1[0]) < 1e-6
        assert abs(ana_1[1] - num_1[1]) < 1e-6

        # c = 0.1: Must match numerical finite difference
        ana_01 = distance_gradient_u(u, v, c=0.1)
        num_01 = numerical_grad(u, v, c=0.1)
        assert abs(ana_01[0] - num_01[0]) < 1e-6
        assert abs(ana_01[1] - num_01[1]) < 1e-6

        # c = 5.0: Must match numerical finite difference
        ana_5 = distance_gradient_u(u, v, c=5.0)
        num_5 = numerical_grad(u, v, c=5.0)
        assert abs(ana_5[0] - num_5[0]) < 1e-6
        assert abs(ana_5[1] - num_5[1]) < 1e-6

    def test_lorentz_c_variable_vulnerability(self):
        """
        REMEDIATED IN ITERATION 2:
        poincare_to_lorentz and lorentz_to_poincare scale spatial coordinates and denominator
        by sqrt(c) for all c > 0.
        Roundtrip error is < 1e-12 and cross-chart distance agreement is < 1e-13.
        """
        for c in [0.01, 0.1, 0.5, 1.0, 2.0, 5.0, 10.0]:
            max_r = 1.0 / math.sqrt(c)
            p = [0.3 * max_r, -0.4 * max_r]
            lor = poincare_to_lorentz(p, c=c)
            rec = lorentz_to_poincare(lor, c=c)
            err = max(abs(a - b) for a, b in zip(p, rec))
            assert err < 1e-12, f"Roundtrip error {err} >= 1e-12 for c={c}"

            # Cross-chart distance agreement
            u = [0.2 * max_r, -0.1 * max_r]
            v = [0.1 * max_r, 0.3 * max_r]
            lu = poincare_to_lorentz(u, c=c)
            lv = poincare_to_lorentz(v, c=c)
            d_ball = poincare_distance(u, v, c=c)
            d_lor = lorentz_distance(lu, lv, c=c)
            assert abs(d_ball - d_lor) < 1e-13, f"Cross-chart distance mismatch for c={c}: {abs(d_ball - d_lor)}"

    def test_lorentz_conversion_curvature_incompatibility_vulnerability(self):
        """Alias for test_lorentz_c_variable_vulnerability preserving backward test discovery."""
        self.test_lorentz_c_variable_vulnerability()


# =====================================================================
# 5. FUZZY, PATHOLOGICAL, AND MISMATCHED INPUTS
# =====================================================================


class TestFuzzyAndPathologicalInputs:
    """Stress tests non-finite, out-of-bounds, and mismatched dimension inputs."""

    def test_nan_and_inf_propagation(self):
        """NaN and Inf must return NaN immediately, never 0.0 or corrupted float."""
        u_nan = [math.nan, 0.5]
        v = [0.1, 0.2]
        assert math.isnan(poincare_distance(u_nan, v))
        assert math.isnan(poincare_distance(v, u_nan))

        u_inf = [math.inf, 0.5]
        assert math.isnan(poincare_distance(u_inf, v))

        # Lorentz NaN check
        assert math.isnan(lorentz_distance(u_nan, [1.0, 0.0]))

    def test_dimension_mismatch_silent_truncation_vulnerability(self):
        """
        REMEDIATED IN ITERATION 2:
        poincare_distance validates dimensions and raises ValueError on mismatch.
        """
        u = [0.1, 0.2]
        v = [0.1, 0.2, 0.99]
        with pytest.raises(ValueError, match="Dimension mismatch"):
            poincare_distance(u, v)

    def test_points_outside_ball_clamping(self):
        """Points outside the ball (||u|| >= 1.0) clamp alpha/beta to PRECISION_EPS."""
        u_outside = [1.5, 0.0]
        origin = [0.0, 0.0]
        d = poincare_distance(u_outside, origin, c=1.0)
        assert math.isfinite(d)
        assert d > 30.0  # Clamped to precision limit, does not crash

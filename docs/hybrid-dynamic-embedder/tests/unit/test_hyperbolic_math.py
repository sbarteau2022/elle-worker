"""
Analytical Closed-Form Unit Tests for Hyperbolic Math & Product Manifold Core.

Validates all 8 analytical closed-form controls to machine precision (< 1e-15),
alongside robust boundary safeguards, dual-chart Lorentz isometries, and
multiscale product manifold topological invariants.
"""

import math
import sys
import unittest
from pathlib import Path

# Ensure project root is in sys.path
project_root = Path(__file__).resolve().parent.parent.parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

from python.math_core.lorentz import (
    lorentz_distance,
    lorentz_exp_map,
    lorentz_log_map,
    lorentz_normalize,
    lorentz_origin,
    lorentz_parallel_transport,
    lorentz_project_tangent,
    lorentz_radius,
    lorentz_recenter,
    lorentz_to_poincare,
    minkowski_inner_product,
    poincare_to_lorentz,
    tangent_norm,
)
from python.math_core.poincare import (
    conformal_factor,
    distance_gradient_u,
    dot_product,
    euclidean_norm,
    exp_map,
    exp_map_zero,
    log_map,
    log_map_zero,
    metric_tensor,
    mobius_add,
    mobius_sub,
    poincare_depth,
    poincare_distance,
    project_to_ball,
    riemannian_gradient,
    scale_tangent,
)
from python.math_core.product import (
    GOLDEN_ANGLE,
    PHI,
    TORUS_DIM,
    TWO_PI,
    atlas_discrepancy,
    axis_discrepancy,
    disagreements,
    golden_sequence,
    metric_return,
    norm_2pi,
    phases_to_torus,
    phi_scale_weights,
    product_distance,
    recognition_invariant,
    same_recurrence_class,
    torus_distance,
    translation_align,
    unit_torus_distance,
    winding_numbers,
    wrap_angle,
)
from python.math_core.atlas_bridge import (
    DELTA_PHI,
    ISOTROPIC_SUPPRESSION,
    PHI as ATLAS_PHI,
    PHI_M1,
    TURBOQUANT_BIAS,
    WEIGHT_HYPERBOLIC,
    WEIGHT_TOROIDAL,
    apply_isotropic_suppression,
    circular_distance,
    generate_toroidal_pe,
    geodesic_residual_step,
    hurwitz_delta,
    stern_brocot_depth_schedule,
    stern_brocot_search,
    three_gap_attention_weights,
    three_gap_partition,
    three_gap_thresholds,
)


class TestHyperbolicAnalyticalControls(unittest.TestCase):
    """
    Validation of the 8 authoritative analytical closed-form test controls
    from survey_math_specs.md §3 and §11 evaluated to machine precision (< 1e-15).
    """

    def test_control_1_identity_invariant(self):
        """
        Control 1: Identity Invariant.
        Input: u = (0.3, -0.4), v = (0.3, -0.4) in B_1^2.
        Expected: d_B(u, v) == 0.0 with error <= 1e-15.
        """
        u = [0.3, -0.4]
        v = [0.3, -0.4]
        dist = poincare_distance(u, v, c=1.0)
        self.assertLess(abs(dist - 0.0), 1e-15, f"Control 1 failed: dist={dist}")
        self.assertEqual(dist, 0.0)

    def test_control_2_distance_from_origin_radial_depth(self):
        """
        Control 2: Distance from Origin (Radial Depth).
        Input: u = (0, 0), v = (0.5, 0) with c = 1.
        Analytical: d_B(0, v) = 2 * artanh(0.5) = ln(3).
        ln(3) ≈ 1.098612288668109691395245.
        Error must be <= 1e-15.
        """
        u = [0.0, 0.0]
        v = [0.5, 0.0]
        expected = math.log(3.0)

        dist = poincare_distance(u, v, c=1.0)
        error_dist = abs(dist - expected)
        self.assertLess(
            error_dist, 1e-15, f"Control 2 poincare_distance failed: error={error_dist}"
        )

        depth = poincare_depth(v, c=1.0)
        error_depth = abs(depth - expected)
        self.assertLess(
            error_depth, 1e-15, f"Control 2 poincare_depth failed: error={error_depth}"
        )

    def test_control_3_collinear_points_across_origin(self):
        """
        Control 3: Collinear Points across Origin (Opposite Sides).
        Input: u = (-0.5, 0), v = (0.5, 0) with c = 1.
        Analytical: d_B(u, v) = d(u, 0) + d(0, v) = ln(3) + ln(3) = ln(9) = 2*ln(3).
        ln(9) ≈ 2.197224577336219382790490.
        Error must be <= 1e-15.
        """
        u = [-0.5, 0.0]
        v = [0.5, 0.0]
        expected = math.log(9.0)

        dist = poincare_distance(u, v, c=1.0)
        error = abs(dist - expected)
        self.assertLess(error, 1e-15, f"Control 3 failed: error={error}")

    def test_control_4_collinear_points_same_side(self):
        """
        Control 4: Collinear Points on Same Side of Origin.
        Input: u = (1/3, 0), v = (3/5, 0) = (0.6, 0) with c = 1.
        Analytical: d_B(u, v) = d(0, v) - d(0, u) = ln(4) - ln(2) = ln(2).
        ln(2) ≈ 0.693147180559945309417232.
        Error must be <= 1e-15.
        """
        u = [1.0 / 3.0, 0.0]
        v = [0.6, 0.0]
        expected = math.log(2.0)

        dist = poincare_distance(u, v, c=1.0)
        error = abs(dist - expected)
        self.assertLess(error, 1e-15, f"Control 4 failed: error={error}")

    def test_control_5_mobius_addition_collinear_rational(self):
        """
        Control 5: Möbius Addition Collinear Rational Control.
        Input: u = (0.3, 0), v = (0.4, 0) with c = 1.
        Analytical: Relativistic velocity addition: (0.3 + 0.4) / (1 + 0.12) = 0.70 / 1.12 = 5/8 = 0.625.
        Expected: (0.625, 0.0).
        Error must be <= 1e-15.
        """
        u = [0.3, 0.0]
        v = [0.4, 0.0]
        res = mobius_add(u, v, c=1.0)
        error_x = abs(res[0] - 0.625)
        error_y = abs(res[1] - 0.0)
        self.assertLess(error_x, 1e-15, f"Control 5 x error: {error_x}")
        self.assertLess(error_y, 1e-15, f"Control 5 y error: {error_y}")

    def test_control_6_mobius_gyro_rotation_non_commutativity(self):
        """
        Control 6: Möbius Gyro-Rotation / Non-Commutativity.
        Input: u = (0.5, 0), v = (0, 0.5) with c = 1.
        Analytical:
          u (+) v = (10/17, 6/17) ≈ (0.5882352941176471, 0.35294117647058826)
          v (+) u = (6/17, 10/17) ≈ (0.35294117647058826, 0.5882352941176471)
          ||u (+) v||^2 = ||v (+) u||^2 = 8/17 ≈ 0.47058823529411764.
        Error must be <= 1e-15.
        """
        u = [0.5, 0.0]
        v = [0.0, 0.5]
        uv = mobius_add(u, v, c=1.0)
        vu = mobius_add(v, u, c=1.0)

        expected_uv = [10.0 / 17.0, 6.0 / 17.0]
        expected_vu = [6.0 / 17.0, 10.0 / 17.0]
        expected_norm_sq = 8.0 / 17.0

        self.assertLess(abs(uv[0] - expected_uv[0]), 1e-15)
        self.assertLess(abs(uv[1] - expected_uv[1]), 1e-15)
        self.assertLess(abs(vu[0] - expected_vu[0]), 1e-15)
        self.assertLess(abs(vu[1] - expected_vu[1]), 1e-15)

        norm_sq_uv = uv[0] ** 2 + uv[1] ** 2
        norm_sq_vu = vu[0] ** 2 + vu[1] ** 2
        self.assertLess(abs(norm_sq_uv - expected_norm_sq), 1e-15)
        self.assertLess(abs(norm_sq_vu - expected_norm_sq), 1e-15)

    def test_control_7_exponential_and_logarithmic_map_inversion(self):
        """
        Control 7: Exponential and Logarithmic Map Inversion (Convention B).
        Input: z = (ln(3), 0.0) ≈ (1.0986122886681097, 0.0).
        Analytical:
          exp_0(z) = tanh(ln(3) / 2) * e_1 = tanh(ln(sqrt(3))) * e_1 = 0.5 * e_1 = (0.5, 0.0).
          log_0((0.5, 0.0)) = 2 * artanh(0.5) * e_1 = ln(3) * e_1 = z.
        Error must be <= 1e-15.
        """
        z = [math.log(3.0), 0.0]
        exp_z = exp_map_zero(z, c=1.0, convention="B")
        self.assertLess(abs(exp_z[0] - 0.5), 1e-15)
        self.assertLess(abs(exp_z[1] - 0.0), 1e-15)

        log_exp = log_map_zero(exp_z, c=1.0, convention="B")
        self.assertLess(abs(log_exp[0] - math.log(3.0)), 1e-15)
        self.assertLess(abs(log_exp[1] - 0.0), 1e-15)

    def test_control_8_poincare_lorentz_exact_dual_chart_round_trip(self):
        """
        Control 8: Poincaré <-> Lorentz Exact Dual-Chart Round Trip.
        Input: Poincaré coordinate p = (0.6, 0.0) with c = 1.
        Analytical Lorentz Projection:
          x_0 = (1 + 0.36) / (1 - 0.36) = 1.36 / 0.64 = 17 / 8 = 2.125
          x_1 = (2 * 0.6) / (1 - 0.36) = 1.20 / 0.64 = 15 / 8 = 1.875
        Minkowski Invariant:
          -x_0^2 + x_1^2 = -(2.125)^2 + (1.875)^2 = -289/64 + 225/64 = -64/64 = -1.0.
        Inverse to Poincaré:
          p_1 = x_1 / (1 + x_0) = (15/8) / (25/8) = 15/25 = 0.6.
        Error must be <= 1e-15.
        """
        p = [0.6, 0.0]
        lor = poincare_to_lorentz(p, c=1.0)
        self.assertLess(abs(lor[0] - 2.125), 1e-15)
        self.assertLess(abs(lor[1] - 1.875), 1e-15)
        self.assertLess(abs(lor[2] - 0.0), 1e-15)

        mink_inner = minkowski_inner_product(lor, lor)
        self.assertLess(abs(mink_inner - (-1.0)), 1e-15)

        p_back = lorentz_to_poincare(lor, c=1.0)
        self.assertLess(abs(p_back[0] - 0.6), 1e-15)
        self.assertLess(abs(p_back[1] - 0.0), 1e-15)


class TestHyperbolicEdgeCasesAndSafeguards(unittest.TestCase):
    """
    Validation of boundary edge cases, sign-preserving denominator clamps,
    and NaN propagation protection.
    """

    def test_nan_propagation_guard(self):
        """
        Test that NaN in inputs propagates to NaN rather than being silently clamped
        to 1.0 (which would falsely report distance 0.0 / 'identical points').
        """
        u_nan = [math.nan, 0.2]
        v_ok = [0.1, 0.2]
        dist = poincare_distance(u_nan, v_ok, c=1.0)
        self.assertTrue(
            math.isnan(dist), "Poincaré distance must return NaN on NaN input"
        )

        lor_dist = lorentz_distance([math.nan, 0.0, 0.0], [1.0, 0.0, 0.0])
        self.assertTrue(
            math.isnan(lor_dist), "Lorentz distance must return NaN on NaN input"
        )

    def test_sign_preserving_denominator_guard(self):
        """
        Near-antipodal boundary points: u = (0.999995, 0), v = (-0.999995, 0).
        Ensure sign-preserving clamp in mobius_add prevents flipping result across origin.
        """
        u = [0.999995, 0.0]
        v = [-0.999995, 0.0]
        res = mobius_add(u, v, c=1.0)
        self.assertTrue(all(math.isfinite(x) for x in res))
        self.assertLessEqual(euclidean_norm(res), 1.0)

    def test_boundary_projection(self):
        """
        Points with norm >= 1.0 must be projected strictly inside the ball
        ||x|| <= 1.0 - 1e-5.
        """
        p_outside = [0.8, 0.8]  # norm ≈ 1.13137
        projected = project_to_ball(p_outside, c=1.0, eps_boundary=1e-5)
        norm_proj = euclidean_norm(projected)
        self.assertLessEqual(norm_proj, 1.0 - 1e-5 + 1e-12)

    def test_conformal_factor_and_metric_tensor(self):
        """
        Test conformal factor lambda_x^c = 2 / (1 - c||x||^2).
        At origin: lambda_0 = 2.0, g_0 = 4 * I.
        At x = (0.5, 0.0): lambda = 2 / 0.75 = 8/3.
        """
        origin = [0.0, 0.0]
        self.assertAlmostEqual(conformal_factor(origin, c=1.0), 2.0, places=15)
        g0 = metric_tensor(origin, c=1.0)
        self.assertEqual(g0[0][0], 4.0)
        self.assertEqual(g0[1][1], 4.0)
        self.assertEqual(g0[0][1], 0.0)

        p = [0.5, 0.0]
        expected_lam = 8.0 / 3.0
        self.assertLess(abs(conformal_factor(p, c=1.0) - expected_lam), 1e-15)

    def test_tangent_scaling_helper(self):
        """
        Test scale_tangent applies 1 / sqrt(D) scaling.
        For D = 5120 and unit components, norm becomes 1.0.
        """
        dim = 5120
        v = [1.0] * dim
        scaled = scale_tangent(v, dim=dim)
        expected_scale = 1.0 / math.sqrt(dim)
        for val in scaled:
            self.assertLess(abs(val - expected_scale), 1e-15)
        self.assertLess(abs(euclidean_norm(scaled) - 1.0), 1e-14)

    def test_riemannian_gradient_scaling(self):
        """
        Riemannian gradient grad_B = ((1 - c||x||^2)^2 / 4) * grad_E.
        At origin, scale factor is 1/4.
        """
        origin = [0.0, 0.0]
        e_grad = [4.0, 8.0]
        r_grad = riemannian_gradient(e_grad, origin, c=1.0)
        self.assertLess(abs(r_grad[0] - 1.0), 1e-15)
        self.assertLess(abs(r_grad[1] - 2.0), 1e-15)

    def test_distance_gradient_finite_difference_reconciliation(self):
        """
        Validate distance_gradient_u against central finite differences
        across all curvatures c in {0.1, 0.5, 1.0, 2.0, 5.0} to error < 1e-7.
        """
        def numerical_gradient(u, v, c, h=1e-7):
            grad = []
            for i in range(len(u)):
                u_p = list(u)
                u_m = list(u)
                u_p[i] += h
                u_m[i] -= h
                d_p = poincare_distance(u_p, v, c=c)
                d_m = poincare_distance(u_m, v, c=c)
                grad.append((d_p - d_m) / (2.0 * h))
            return grad

        test_cases = [
            ([0.2, 0.3], [0.4, -0.1]),
            ([0.1, -0.2], [-0.3, 0.1]),
            ([0.05, 0.08], [0.12, -0.15]),
        ]
        curvatures = [0.1, 0.5, 1.0, 2.0, 5.0]

        for c in curvatures:
            for u, v in test_cases:
                ana_grad = distance_gradient_u(u, v, c=c)
                num_grad = numerical_gradient(u, v, c=c)
                for a_val, n_val in zip(ana_grad, num_grad):
                    self.assertLess(
                        abs(a_val - n_val),
                        1e-7,
                        f"Gradient mismatch for c={c}, u={u}, v={v}: ana={a_val}, num={n_val}",
                    )

    def test_distance_gradient_riemannian_unit_norm(self):
        """
        Verify that Riemannian gradient grad_R d(u, v) = (alpha^2 / 4) * grad_E
        has Riemannian norm identically 1.0 for all c > 0 and u != v.
        """
        curvatures = [0.1, 0.5, 1.0, 2.0, 5.0]
        u = [0.15, 0.20]
        v = [-0.10, 0.25]

        for c in curvatures:
            grad_e = distance_gradient_u(u, v, c=c)
            uu = sum(x * x for x in u)
            alpha = 1.0 - c * uu
            grad_r = [(alpha * alpha / 4.0) * gi for gi in grad_e]
            # Riemannian norm ||grad_r||_g = (2 / alpha) * ||grad_r||_e
            norm_e = math.sqrt(sum(gi * gi for gi in grad_r))
            norm_r = (2.0 / alpha) * norm_e
            self.assertLess(abs(norm_r - 1.0), 1e-12)

    def test_distance_gradient_coincident_points(self):
        """Verify coincident points evaluate to zero vector."""
        u = [0.2, 0.3]
        for c in [0.1, 1.0, 5.0]:
            grad = distance_gradient_u(u, u, c=c)
            self.assertEqual(grad, [0.0, 0.0])

    def test_dimension_mismatch_validation(self):
        """Verify dimension mismatch raises ValueError across all functions."""
        # Poincaré
        with self.assertRaises(ValueError):
            poincare_distance([0.1, 0.2], [0.1, 0.2, 0.3])
        with self.assertRaises(ValueError):
            mobius_add([0.1, 0.2], [0.1, 0.2, 0.3])
        with self.assertRaises(ValueError):
            dot_product([0.1, 0.2], [0.1, 0.2, 0.3])
        with self.assertRaises(ValueError):
            exp_map([0.1, 0.2], [0.1, 0.2, 0.3])
        with self.assertRaises(ValueError):
            log_map([0.1, 0.2], [0.1, 0.2, 0.3])
        with self.assertRaises(ValueError):
            distance_gradient_u([0.1, 0.2], [0.1, 0.2, 0.3])
        with self.assertRaises(ValueError):
            riemannian_gradient([0.1, 0.2, 0.3], [0.1, 0.2])

        # Lorentz
        with self.assertRaises(ValueError):
            lorentz_distance([1.0, 0.1, 0.2], [1.0, 0.1, 0.2, 0.3])
        with self.assertRaises(ValueError):
            lorentz_distance([1.0, 0.1, 0.2, 0.3], [1.0, 0.1, 0.2])
        with self.assertRaises(ValueError):
            minkowski_inner_product([1.0, 0.1, 0.2], [1.0, 0.1, 0.2, 0.3])
        with self.assertRaises(ValueError):
            lorentz_project_tangent([1.0, 0.1, 0.2], [1.0, 0.1, 0.2, 0.3])
        with self.assertRaises(ValueError):
            lorentz_exp_map([1.0, 0.1, 0.2], [1.0, 0.1, 0.2, 0.3])
        with self.assertRaises(ValueError):
            lorentz_log_map([1.0, 0.1, 0.2], [1.0, 0.1, 0.2, 0.3])
        with self.assertRaises(ValueError):
            lorentz_parallel_transport([1.0, 0.1, 0.2], [1.0, 0.1, 0.2, 0.3], [1.0, 0.1, 0.2])
        with self.assertRaises(ValueError):
            lorentz_recenter([1.0, 0.1, 0.2], [1.0, 0.1, 0.2, 0.3])

        # Torus & Product
        with self.assertRaises(ValueError):
            torus_distance([0.1, 0.2], [0.1, 0.2, 0.3])
        with self.assertRaises(ValueError):
            unit_torus_distance([0.1, 0.2], [0.1, 0.2, 0.3])
        with self.assertRaises(ValueError):
            product_distance([0.1, 0.2], [0.1, 0.2], [0.1, 0.2, 0.3], [0.1, 0.2])
        with self.assertRaises(ValueError):
            product_distance([0.1, 0.2], [0.1, 0.2], [0.1, 0.2], [0.1, 0.2, 0.3])
        with self.assertRaises(ValueError):
            translation_align([0.1, 0.2], [0.1, 0.2, 0.3])


class TestLorentzHyperboloidChart(unittest.TestCase):
    """
    Validation of Lorentz (hyperboloid) geometry, parallel transport,
    exponential and logarithmic maps, and isometry recentering.
    """

    def test_lorentz_distance_and_radius(self):
        """
        Test distance on the hyperboloid matching radius from origin.
        """
        o = lorentz_origin(2)
        p = [math.cosh(1.5), math.sinh(1.5), 0.0]
        p_norm = lorentz_normalize(p)

        r = lorentz_radius(p_norm)
        self.assertLess(abs(r - 1.5), 1e-14)

        d = lorentz_distance(o, p_norm)
        self.assertLess(abs(d - 1.5), 1e-14)

    def test_lorentz_exp_log_map_inversion(self):
        """
        Test that log_x(exp_x(v)) == v for tangent vectors in T_x L^n.
        """
        x = lorentz_origin(2)
        v = [0.0, 0.75, -0.4]  # in T_x since <x, v>_L = -1 * 0 + 0 = 0.
        y = lorentz_exp_map(x, v)
        v_rec = lorentz_log_map(x, y)

        for a, b in zip(v, v_rec):
            self.assertLess(abs(a - b), 1e-14)

    def test_lorentz_isometry_recentering(self):
        """
        Lorentz boost recentering preserves pairwise geodesic distances (isometry).
        """
        a = lorentz_normalize([1.5, 0.5, 0.6])
        b = lorentz_normalize([2.0, 1.0, -0.8])
        c = lorentz_normalize([1.8, -0.4, 0.9])

        dist_before = lorentz_distance(a, b)
        a_recentered = lorentz_recenter(a, c)
        b_recentered = lorentz_recenter(b, c)
        dist_after = lorentz_distance(a_recentered, b_recentered)

        self.assertLess(
            abs(dist_before - dist_after),
            1e-12,
            f"Lorentz recentering must be an exact isometry: {dist_before} vs {dist_after}",
        )

    def test_poincare_lorentz_cross_chart_distance_consistency(self):
        """
        Distance measured in Poincaré ball must match distance in Lorentz chart.
        """
        p_a = [0.2, -0.3]
        p_b = [-0.4, 0.1]

        d_poincare = poincare_distance(p_a, p_b, c=1.0)
        l_a = poincare_to_lorentz(p_a, c=1.0)
        l_b = poincare_to_lorentz(p_b, c=1.0)
        d_lorentz = lorentz_distance(l_a, l_b)

        self.assertLess(
            abs(d_poincare - d_lorentz),
            1e-14,
            f"Cross-chart distances must agree: {d_poincare} vs {d_lorentz}",
        )

    def test_poincare_lorentz_round_trip_variable_curvatures(self):
        """Verify dual-chart round-trip to < 1e-14 across c in {0.1, 0.5, 1.0, 2.0, 5.0}."""
        for c in [0.1, 0.5, 1.0, 2.0, 5.0]:
            max_r = 1.0 / math.sqrt(c)
            p = [0.3 * max_r, -0.4 * max_r]
            lor = poincare_to_lorentz(p, c=c)

            # Sheet invariant
            sheet = minkowski_inner_product(lor, lor)
            self.assertLess(abs(sheet - (-1.0)), 1e-13)

            # Round-trip recovery
            p_back = lorentz_to_poincare(lor, c=c)
            for pi, p_bi in zip(p, p_back):
                self.assertLess(abs(pi - p_bi), 1e-14)

    def test_cross_chart_distance_variable_curvatures(self):
        """Verify d_B(u, v, c) == d_L(lor(u, c), lor(v, c), c) across curvatures."""
        for c in [0.1, 0.5, 1.0, 2.0, 5.0]:
            max_r = 1.0 / math.sqrt(c)
            u = [0.2 * max_r, -0.1 * max_r]
            v = [0.1 * max_r, 0.3 * max_r]

            d_ball = poincare_distance(u, v, c=c)
            lu = poincare_to_lorentz(u, c=c)
            lv = poincare_to_lorentz(v, c=c)
            d_lor = lorentz_distance(lu, lv, c=c)

            self.assertLess(abs(d_ball - d_lor), 1e-14)


class TestProductManifoldAndTorus(unittest.TestCase):
    """
    Validation of flat torus metric, golden ratio multiscale weights,
    topological winding numbers, and dual-chart discrepancy rankings.
    """

    def test_angle_wrapping_boundary(self):
        """
        Periodic angle difference across the branch cut:
        wrap_angle(0.1 - (2*pi - 0.1)) == 0.2.
        wrap_angle(pi) == pi, wrap_angle(-pi) == pi.
        """
        a = 0.1
        b = TWO_PI - 0.1
        d = wrap_angle(a - b)
        self.assertLess(abs(d - 0.2), 1e-14)

        self.assertLess(abs(wrap_angle(math.pi) - math.pi), 1e-14)
        self.assertLess(abs(wrap_angle(-math.pi) - math.pi), 1e-14)

    def test_torus_geodesic_distance(self):
        """
        Test torus distance with and without multiscale weights.
        """
        a = [0.1, math.pi]
        b = [TWO_PI - 0.1, 0.0]
        # diffs: [0.2, pi]
        # unweighted d = sqrt(0.04 + pi^2)
        expected = math.sqrt(0.04 + math.pi**2)
        d = torus_distance(a, b)
        self.assertLess(abs(d - expected), 1e-14)

    def test_phi_scale_weights(self):
        """
        Test golden ratio weights: omega_j = phi^(-j / 2).
        omega_0 = 1.0, omega_1 = 1 / sqrt(phi), omega_2 = 1 / phi.
        """
        weights = phi_scale_weights(4)
        self.assertLess(abs(weights[0] - 1.0), 1e-15)
        self.assertLess(abs(weights[1] - (1.0 / math.sqrt(PHI))), 1e-15)
        self.assertLess(abs(weights[2] - (1.0 / PHI)), 1e-15)

    def test_topological_winding_numbers(self):
        """
        A trajectory making 2 full rotations around the circle must have winding = 2.
        A trajectory oscillating back and forth without completing a loop must have winding = 0.
        """
        # Circular trajectory: 2 turns (4*pi) in 16 steps
        steps = 16
        circle_seq = [
            [norm_2pi((2.0 * TWO_PI * float(k)) / float(steps))]
            for k in range(steps + 1)
        ]
        res_circle = winding_numbers(circle_seq)
        self.assertEqual(res_circle["winding"], [2])
        self.assertAlmostEqual(res_circle["turns"][0], 2.0, places=3)

        # Oscillating trajectory: 0 turns
        oscillating = [
            [0.1],
            [0.5],
            [0.9],
            [0.3],
            [0.0],
            [0.2],
        ]
        res_osc = winding_numbers(oscillating)
        self.assertEqual(res_osc["winding"], [0])

        # Test recognition invariant and same_recurrence_class
        inv_circle = recognition_invariant(circle_seq)
        self.assertEqual(inv_circle, [2])
        self.assertTrue(same_recurrence_class(circle_seq, circle_seq))
        self.assertFalse(same_recurrence_class(circle_seq, oscillating))

    def test_metric_return(self):
        """
        Test metric return finding closest return to origin on the torus.
        """
        seq = [
            [0.0, 0.0],
            [1.0, 1.0],
            [2.0, 2.0],
            [0.05, 0.02],
            [1.5, 1.5],
        ]
        ret = metric_return(seq)
        expected = math.sqrt(0.05**2 + 0.02**2)
        self.assertLess(abs(ret - expected), 1e-14)

    def test_product_distance_composite(self):
        """
        Composite product distance: d_P^2 = w_h * d_H^2 + w_t * d_T^2.
        """
        a_ball = [0.0, 0.0]
        b_ball = [0.5, 0.0]  # d_H = ln(3)
        a_torus = [0.0] * 8
        b_torus = [0.0] * 8  # d_T = 0.0

        d_p = product_distance(
            a_ball, a_torus, b_ball, b_torus, w_h=1.0, w_t=1.0, c=1.0
        )
        self.assertLess(abs(d_p - math.log(3.0)), 1e-15)

    def test_dual_chart_disagreements_ranking(self):
        """
        Test disagreements ranking detects:
        1. same_rhythm_diff_lineage (convergent concepts: torus close, ball far)
        2. same_lineage_drift_phase (derivational drift: ball close, torus far)
        """
        # Node A & B: close on torus, far on ball
        # Node C & D: close on ball, far on torus
        hyper_points = {
            "node_A": [0.8, 0.0],
            "node_B": [-0.8, 0.0],  # very far in hyperbolic space
            "node_C": [0.05, 0.0],
            "node_D": [0.06, 0.0],  # very close in hyperbolic space
        }
        torus_points = {
            "node_A": [0.01] * 8,
            "node_B": [0.02] * 8,  # very close on torus
            "node_C": [0.0] * 8,
            "node_D": [math.pi] * 8,  # antipodal on torus
        }

        disag = disagreements(hyper_points, torus_points, top_k=2)
        rhythm = disag["same_rhythm_diff_lineage"]
        lineage = disag["same_lineage_drift_phase"]

        self.assertGreater(len(rhythm), 0)
        self.assertGreater(len(lineage), 0)

        # Top rhythm pair should be (node_A, node_B)
        top_rhythm_nodes = {rhythm[0]["a"], rhythm[0]["b"]}
        self.assertEqual(top_rhythm_nodes, {"node_A", "node_B"})

        # Top lineage drift pair should be (node_C, node_D)
        top_lineage_nodes = {lineage[0]["a"], lineage[0]["b"]}
        self.assertEqual(top_lineage_nodes, {"node_C", "node_D"})

    def test_golden_sequence_and_atlas_discrepancy(self):
        """
        Test Roberts' R_d low-discrepancy sequence generation and discrepancy metrics.
        """
        pts = golden_sequence(32, 8, seed=0.0)
        self.assertEqual(len(pts), 32)
        self.assertEqual(len(pts[0]), 8)

        disc = atlas_discrepancy(pts, 8)
        self.assertIn("mean", disc)
        self.assertIn("max", disc)
        self.assertIn("per_axis", disc)
        self.assertEqual(len(disc["per_axis"]), 8)
        self.assertGreater(disc["mean"], 0.0)
        self.assertLess(disc["mean"], 1.0)

    def test_mobius_sub_and_dot_product(self):
        """
        Test mobius_sub(u, v) == mobius_add(u, -v) and dot_product correctness.
        """
        u = [0.2, 0.3]
        v = [0.1, -0.2]
        self.assertAlmostEqual(dot_product(u, v), 0.2 * 0.1 - 0.3 * 0.2, places=15)

        sub_res = mobius_sub(u, v, c=1.0)
        neg_v = [-v[0], -v[1]]
        add_neg_res = mobius_add(u, neg_v, c=1.0)
        for a, b in zip(sub_res, add_neg_res):
            self.assertLess(abs(a - b), 1e-15)

    def test_general_basepoint_exp_log_map(self):
        """
        Test general basepoint exp_map and log_map in Poincaré ball:
        log_x(exp_x(v)) == v.
        """
        x = [0.2, -0.1]
        v = [0.05, 0.08]
        y = exp_map(x, v, c=1.0)
        v_rec = log_map(x, y, c=1.0)
        for a, b in zip(v, v_rec):
            self.assertLess(abs(a - b), 1e-14)

    def test_lorentz_tangent_projection_and_transport(self):
        """
        Test lorentz_project_tangent and parallel transport on hyperboloid.
        """
        x = lorentz_origin(2)
        amb = [1.0, 0.3, 0.4]
        tangent_v = lorentz_project_tangent(x, amb)
        # Tangent vector must satisfy <x, tangent_v>_L == 0.0
        self.assertLess(abs(minkowski_inner_product(x, tangent_v)), 1e-14)
        self.assertGreater(tangent_norm(tangent_v), 0.0)

        y = lorentz_normalize([1.5, 0.5, 0.0])
        transported = lorentz_parallel_transport(x, y, tangent_v)
        # Parallel transport is an isometry on tangent space: ||PT(v)||_L == ||v||_L
        self.assertLess(abs(tangent_norm(transported) - tangent_norm(tangent_v)), 1e-12)

    def test_torus_dim_and_golden_angle_constants(self):
        """
        Verify product manifold constants: TORUS_DIM == 8, GOLDEN_ANGLE ≈ 2.39996.
        """
        self.assertEqual(TORUS_DIM, 8)
        self.assertLess(abs(GOLDEN_ANGLE - (TWO_PI * (2.0 - PHI))), 1e-15)

    def test_phases_to_torus_and_translation_align(self):
        """
        Test phases_to_torus wrapping and translation_align phase correlation.
        """
        raw = [-0.5, TWO_PI + 0.5, 10.0]
        torus_coords = phases_to_torus(raw, 3)
        self.assertEqual(len(torus_coords), 3)
        for val in torus_coords:
            self.assertGreaterEqual(val, 0.0)
            self.assertLess(val, TWO_PI)

        a = [0.2, 0.4, 0.6]
        b = [0.2, 0.4, 0.6]
        align = translation_align(a, b)
        self.assertLess(abs(align["shift"]), 1e-4)
        self.assertAlmostEqual(align["score"], 1.0, places=4)

    def test_unit_torus_distance_and_axis_discrepancy(self):
        """
        Test unit_torus_distance on [0, 1)^d and 1D axis_discrepancy.
        """
        u = [0.1, 0.95]
        v = [0.9, 0.05]
        # diff 1: 0.8 -> min(0.8, 0.2) = 0.2
        # diff 2: 0.9 -> min(0.9, 0.1) = 0.1
        expected_d = math.sqrt(0.2**2 + 0.1**2)
        d = unit_torus_distance(u, v)
        self.assertLess(abs(d - expected_d), 1e-14)

        # Uniform angles should have low discrepancy
        angles = [(TWO_PI * i) / 10.0 for i in range(10)]
        disc = axis_discrepancy(angles)
        self.assertLess(disc, 0.2)

    def test_disagreements_nan_exclusion(self):
        """Verify non-finite pairs are excluded from disagreements ranking."""
        hyper = {
            "a": [0.1, 0.2],
            "b": [math.nan, 0.2],
            "c": [0.3, 0.4],
        }
        torus = {
            "a": [0.1] * 8,
            "b": [0.2] * 8,
            "c": [0.3] * 8,
        }
        disag = disagreements(hyper, torus)
        for pair in disag["same_rhythm_diff_lineage"]:
            self.assertNotIn("b", (pair["a"], pair["b"]))
            self.assertTrue(math.isfinite(pair["ball"]))
            self.assertTrue(math.isfinite(pair["torus"]))
        for pair in disag["same_lineage_drift_phase"]:
            self.assertNotIn("b", (pair["a"], pair["b"]))
            self.assertTrue(math.isfinite(pair["ball"]))
            self.assertTrue(math.isfinite(pair["torus"]))

    def test_axis_discrepancy_nan_propagation(self):
        """Verify NaN in angles propagates to NaN in axis_discrepancy."""
        val = axis_discrepancy([0.1, math.nan, 0.5])
        self.assertTrue(math.isnan(val))

    def test_atlas_bridge_geometric_proofs(self):
        """
        Validate Atlas bridge proofs, constants, three-gap partition,
        Hurwitz bound, Stern-Brocot schedule, and dimension validations.
        """
        # 1. Exact Constants
        self.assertLess(abs(ATLAS_PHI - (1.0 + math.sqrt(5.0)) / 2.0), 1e-15)
        self.assertLess(abs(DELTA_PHI - 1.0 / math.sqrt(5.0)), 1e-15)
        self.assertLess(abs(ISOTROPIC_SUPPRESSION - 1.0 / math.pi), 1e-15)
        self.assertLess(abs(TURBOQUANT_BIAS - 2.0 / math.pi), 1e-15)
        self.assertLess(abs((WEIGHT_HYPERBOLIC + WEIGHT_TOROIDAL) - 1.0), 1e-15)

        # 2. Three-gap partition with exact phi ratios
        small, med, lrg = three_gap_thresholds(0.001186)
        self.assertLess(abs(med / small - ATLAS_PHI), 1e-12)
        self.assertLess(abs(lrg / med - ATLAS_PHI), 1e-12)
        self.assertEqual(three_gap_partition(0.0005, base_small=0.001186), 0)
        self.assertEqual(three_gap_partition(0.0015, base_small=0.001186), 1)
        self.assertEqual(three_gap_partition(0.0035, base_small=0.001186), 2)

        # 3. Three-gap attention weights
        w0 = three_gap_attention_weights(0.0005)
        w1 = three_gap_attention_weights(0.0015)
        w2 = three_gap_attention_weights(0.0035)
        self.assertLess(abs(w0 - 1.0), 1e-12)
        self.assertLess(abs(w1 - 1.0 / ATLAS_PHI), 1e-12)
        self.assertLess(abs(w2 - 1.0 / (ATLAS_PHI * ATLAS_PHI)), 1e-12)

        # 4. Hurwitz delta and Stern-Brocot search convergence
        d_phi = hurwitz_delta(PHI_M1, N_max=1000)
        self.assertLess(abs(d_phi - (1.0 / (ATLAS_PHI * ATLAS_PHI))), 1e-12)
        for om in [0.1, 0.2, 0.4, 0.5, 0.7, 0.8, math.sqrt(2.0) - 1.0]:
            self.assertGreater(d_phi, hurwitz_delta(om, N_max=1000))

        final_m, history = stern_brocot_search(max_steps=30)
        self.assertLess(abs(final_m - PHI_M1), 1e-8)
        self.assertGreater(len(history), 0)

        # 5. Stern-Brocot depth schedule
        schedule = stern_brocot_depth_schedule(6)
        self.assertEqual(len(schedule), 6)
        # Schedule converges towards 1.0
        self.assertLess(abs(schedule[-1] - 1.0), 0.1)

        # 6. Toroidal positional encoding
        pe = generate_toroidal_pe(seq_len=16, dim=8)
        self.assertEqual(len(pe), 16)
        self.assertEqual(len(pe[0]), 8)

        # 7. Geodesic residual step and dimension mismatch check
        x = [0.1, 0.2, 0.3]
        fx = [0.4, 0.5, 0.6]
        res = geodesic_residual_step(x, fx)
        self.assertEqual(len(res), 3)
        with self.assertRaises(ValueError):
            geodesic_residual_step([0.1, 0.2], [0.1, 0.2, 0.3])

        # 8. Isotropic suppression and dimension mismatch check
        suppressed = apply_isotropic_suppression(x, fx)
        self.assertEqual(len(suppressed), 3)
        with self.assertRaises(ValueError):
            apply_isotropic_suppression([0.1, 0.2], [0.1, 0.2, 0.3])

        # 9. Circular distance
        c_dist = circular_distance(0.1, 0.9)
        self.assertLess(abs(c_dist - 0.2), 1e-12)


if __name__ == "__main__":
    unittest.main()

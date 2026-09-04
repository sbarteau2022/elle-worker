"""
Adversarial Empirical Stress Tests for Challenger 2 (Milestone 1).

Rigorous adversarial challenge of:
1. Periodic boundary branch cuts in (-pi, pi] and torus geodesic metric axioms.
2. Winding number trajectory edge cases, Nyquist aliasing boundaries, and turn accumulation.
3. Discrepancy metric monotonicity under cluster transitions and golden sequence scaling.
4. Lorentz isometry preservation under successive boosts and float64 boundary limits.
5. High-dimensional projection stability in D = 3584 with tangent scaling.
6. Dual-chart disagreement ranking robustness under extreme configurations.
"""

from __future__ import annotations

import math
import random
import sys
import unittest
from pathlib import Path

# Ensure project root is in sys.path
project_root = Path(__file__).resolve().parent.parent.parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

from python.math_core.lorentz import (
    lorentz_distance,
    lorentz_normalize,
    lorentz_origin,
    lorentz_parallel_transport,
    lorentz_project_tangent,
    lorentz_recenter,
    lorentz_to_poincare,
    minkowski_inner_product,
    poincare_to_lorentz,
    tangent_norm,
)
from python.math_core.poincare import (
    euclidean_norm,
    exp_map_zero,
    poincare_distance,
    scale_tangent,
)
from python.math_core.product import (
    TWO_PI,
    atlas_discrepancy,
    axis_discrepancy,
    disagreements,
    golden_sequence,
    metric_return,
    norm_2pi,
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


class TestPeriodicBranchCutAdversarial(unittest.TestCase):
    """
    Adversarial verification of periodic boundary branch cuts in (-pi, pi],
    metric axioms on T^d, and angle wrap continuity.
    """

    def test_wrap_angle_branch_cut_exact_values(self):
        """
        Branch cut exact evaluation:
        In (-pi, pi], delta = pi -> pi; delta = -pi -> pi; delta = 3*pi -> pi.
        delta = 2*pi -> 0.0; delta = -2*pi -> -0.0.
        """
        self.assertAlmostEqual(wrap_angle(math.pi), math.pi, places=15)
        self.assertAlmostEqual(wrap_angle(-math.pi), math.pi, places=15)
        self.assertAlmostEqual(wrap_angle(3.0 * math.pi), math.pi, places=15)
        self.assertAlmostEqual(wrap_angle(-3.0 * math.pi), math.pi, places=15)
        self.assertAlmostEqual(wrap_angle(TWO_PI), 0.0, places=15)
        self.assertAlmostEqual(wrap_angle(-TWO_PI), 0.0, places=15)
        self.assertAlmostEqual(wrap_angle(0.0), 0.0, places=15)

    def test_wrap_angle_continuity_across_branch_cut(self):
        """
        Probe limits as delta approaches pi from left and right:
        Left limit: wrap(pi - eps) = pi - eps.
        Right limit: wrap(pi + eps) = -pi + eps.
        While signed wrap jumps by 2*pi, squared wrap (wrap)^2 is continuous.
        """
        eps = 1e-12
        left_val = wrap_angle(math.pi - eps)
        right_val = wrap_angle(math.pi + eps)
        self.assertAlmostEqual(left_val, math.pi - eps, places=11)
        self.assertAlmostEqual(right_val, -math.pi + eps, places=11)
        self.assertLess(abs(left_val**2 - right_val**2), 1e-10)

    def test_torus_geodesic_metric_axioms(self):
        """
        Empirically verify Riemannian metric axioms on T^8:
        1. Non-negativity: d_T(a, b) >= 0.
        2. Identity of indiscernibles: d_T(a, b) == 0 iff a == b (mod 2*pi).
        3. Symmetry: d_T(a, b) == d_T(b, a).
        4. Triangle inequality: d_T(a, c) <= d_T(a, b) + d_T(b, c) + eps.
        Tested on 5,000 random triplets in [-50, 50]^8.
        """
        random.seed(1337)
        weights = phi_scale_weights(8)
        max_slack = 0.0

        for _ in range(5000):
            a = [random.uniform(-50.0, 50.0) for _ in range(8)]
            b = [random.uniform(-50.0, 50.0) for _ in range(8)]
            c = [random.uniform(-50.0, 50.0) for _ in range(8)]

            # Non-negativity
            dab = torus_distance(a, b, weights)
            self.assertGreaterEqual(dab, 0.0)

            # Symmetry
            dba = torus_distance(b, a, weights)
            self.assertLess(abs(dab - dba), 1e-14, f"Symmetry violated: {dab} vs {dba}")

            # Identity under 2*pi shifts
            a_shifted = [ai + 2.0 * math.pi * random.randint(-5, 5) for ai in a]
            d_ident = torus_distance(a, a_shifted, weights)
            self.assertLess(d_ident, 1e-12, f"Identity violated: {d_ident}")

            # Triangle inequality
            dbc = torus_distance(b, c, weights)
            dac = torus_distance(a, c, weights)
            slack = dac - (dab + dbc)
            max_slack = max(max_slack, slack)
            self.assertLessEqual(
                dac,
                dab + dbc + 1e-14,
                f"Triangle inequality failed: {dac} > {dab + dbc}",
            )

        self.assertLessEqual(max_slack, 1e-14)

    def test_unit_torus_distance_boundary_wrap(self):
        """
        Verify unit_torus_distance on [0, 1)^d wraps properly across 0 and 1:
        d(0.01, 0.99) == 0.02.
        d(0.5, 0.5) == 0.0.
        d(0.0, 1.0) == 0.0 (integer wrap).
        """
        u = [0.01, 0.5, 0.0]
        v = [0.99, 0.5, 1.0]
        dist = unit_torus_distance(u, v)
        expected = math.sqrt(0.02**2 + 0.0**2 + 0.0**2)
        self.assertLess(abs(dist - expected), 1e-14)

    def test_translation_align_branch_cut_shifts(self):
        """
        Verify translation_align correctly recovers circular shifts across branch cuts.
        """
        base = [0.2, 0.8, 1.5, 2.5, 3.5, 4.5, 5.5, 6.0]
        # Shift by 2.0 rad (modulo 2*pi)
        shifted = [norm_2pi(x + 2.0) for x in base]
        align = translation_align(shifted, base)
        self.assertAlmostEqual(align["shift"], 2.0, places=4)
        self.assertAlmostEqual(align["score"], 1.0, places=4)

    def test_torus_distance_large_angular_coordinates(self):
        """
        Verify numerical stability for angles offset by 10^3*pi, 10^6*pi, 10^9*pi.
        """
        base_a = [0.5] * 8
        base_b = [1.5] * 8
        d_base = torus_distance(base_a, base_b)

        for multiplier in [1000, 1_000_000, 100_000_000]:
            large_a = [x + float(multiplier) * TWO_PI for x in base_a]
            large_b = [x + float(multiplier) * TWO_PI for x in base_b]
            d_large = torus_distance(large_a, large_b)
            self.assertLess(
                abs(d_base - d_large),
                1e-6,
                f"Precision lost at multiplier {multiplier}: {d_base} vs {d_large}",
            )


class TestWindingNumberEdgeCases(unittest.TestCase):
    """
    Adversarial verification of topological winding numbers in pi_1(T^d) = Z^d,
    Nyquist aliasing boundaries, and long-trajectory turn accumulation.
    """

    def test_winding_positive_and_negative_turns(self):
        """
        Verify exact integer winding numbers for loops with W in [-20, 20].
        """
        for W in [-20, -10, -5, -2, -1, 0, 1, 2, 5, 10, 20]:
            steps_per_loop = 16
            total_steps = abs(W) * steps_per_loop if W != 0 else 16
            seq = []
            for s in range(total_steps + 1):
                theta = (
                    (W * TWO_PI * s) / float(total_steps) if total_steps > 0 else 0.0
                )
                seq.append([norm_2pi(theta)])
            res = winding_numbers(seq)
            self.assertEqual(
                res["winding"], [W], f"Failed for W={W}: got {res['winding']}"
            )
            self.assertAlmostEqual(res["turns"][0], float(W), places=3)

    def test_winding_nyquist_step_aliasing(self):
        """
        Nyquist boundary stress test:
        When step size Delta theta is strictly less than pi, forward direction is preserved.
        When step size Delta theta exceeds pi, wrap_angle aliases step into backwards step.
        """
        steps = 6
        # Sub-pi step: delta = pi - 0.05 (forward motion)
        seq_sub = [[(k * (math.pi - 0.05)) % TWO_PI] for k in range(steps + 1)]
        res_sub = winding_numbers(seq_sub)
        self.assertGreater(res_sub["turns"][0], 0.0)

        # Super-pi step: delta = pi + 0.05 (aliased into backwards motion)
        seq_super = [[(k * (math.pi + 0.05)) % TWO_PI] for k in range(steps + 1)]
        res_super = winding_numbers(seq_super)
        self.assertLess(res_super["turns"][0], 0.0)

    def test_winding_long_trajectory_accumulation(self):
        """
        Accumulate 50,000 steps around the torus and verify zero integer drift.
        """
        total_steps = 50000
        target_loops = 15
        seq = [
            [(target_loops * TWO_PI * k) / float(total_steps)]
            for k in range(total_steps + 1)
        ]
        res = winding_numbers(seq)
        self.assertEqual(res["winding"], [target_loops])
        self.assertAlmostEqual(res["turns"][0], float(target_loops), places=5)

    def test_winding_torus8_multiscale_independent_axes(self):
        """
        Verify independent simultaneous winding across all 8 dimensions of T^8.
        Axes wind with target vector W = [1, -2, 3, -4, 5, -6, 7, -8].
        """
        target_w = [1, -2, 3, -4, 5, -6, 7, -8]
        steps = 480  # divisible by all |W|
        seq = []
        for s in range(steps + 1):
            pt = [norm_2pi((w * TWO_PI * s) / float(steps)) for w in target_w]
            seq.append(pt)

        res = winding_numbers(seq)
        self.assertEqual(res["winding"], target_w)

    def test_winding_empty_and_single_point_trajectories(self):
        """
        Verify robust handling of degenerate sequences:
        - Empty list []
        - Single point [[0.1, 0.2]]
        - Mismatched dimensions
        """
        res_empty = winding_numbers([])
        self.assertEqual(res_empty["winding"], [])
        self.assertEqual(res_empty["turns"], [])

        res_single = winding_numbers([[0.5, 1.2, 2.3]])
        self.assertEqual(res_single["winding"], [0, 0, 0])
        self.assertEqual(res_single["turns"], [0.0, 0.0, 0.0])

        # Sequence with variable dimensional points
        res_var = winding_numbers([[0.1, 0.2], [0.5]])
        self.assertEqual(len(res_var["winding"]), 2)

    def test_metric_return_vs_recognition_invariant(self):
        """
        Verify topological recognition invariant distinguishes trajectories
        where metric return is identically 0:
        - A closed loop completing 1 turn returns to start (metric return = 0, winding = 1).
        - An oscillating trajectory returns to start (metric return = 0, winding = 0).
        """
        loop = [
            [0.0],
            [math.pi / 2],
            [math.pi],
            [3 * math.pi / 2],
            [TWO_PI],
        ]
        osc = [
            [0.0],
            [0.5],
            [-0.5],
            [0.0],
        ]
        self.assertLess(metric_return(loop), 1e-12)
        self.assertLess(metric_return(osc), 1e-12)

        self.assertEqual(recognition_invariant(loop), [1])
        self.assertEqual(recognition_invariant(osc), [0])
        self.assertFalse(same_recurrence_class(loop, osc))


class TestDiscrepancyMetricMonotonicity(unittest.TestCase):
    """
    Adversarial verification of 1D star discrepancy D^* monotonicity,
    bounds [1/(2N), 1.0], and Roberts' R_d golden sequence convergence.
    """

    def test_axis_discrepancy_monotonicity_uniform_to_clustered(self):
        """
        Monotonicity under progressive cluster collapse:
        Starting from theoretical minimum D* = 1 / (2*N) (optimal uniform spacing),
        progressively collapse points to a single point:
          p_i(alpha) = (1 - alpha) * p_i^{unif} + alpha * 0.
        Discrepancy D*(alpha) must increase strictly monotonically from 1/(2N) to 1.0.
        """
        N = 25
        unif_pts = [(2 * i + 1) / (2 * N) * TWO_PI for i in range(N)]
        prev_d = -1.0

        for step in range(21):
            alpha = step / 20.0
            pts = [(1.0 - alpha) * u for u in unif_pts]
            d = axis_discrepancy(pts)

            if step == 0:
                # Optimal theoretical uniform discrepancy is exactly 1 / (2*N)
                self.assertAlmostEqual(d, 1.0 / (2.0 * N), places=12)
            elif step == 20:
                # Fully clustered discrepancy is exactly 1.0
                self.assertAlmostEqual(d, 1.0, places=12)

            self.assertGreaterEqual(
                d,
                prev_d - 1e-12,
                f"Monotonicity failed at alpha={alpha}: prev={prev_d}, curr={d}",
            )
            prev_d = d

    def test_axis_discrepancy_bounds(self):
        """
        For any non-empty point set of size N, star discrepancy must satisfy:
          1 / (2*N) <= D^*(N) <= 1.0.
        """
        random.seed(42)
        for N in [5, 10, 20, 50]:
            # Random points
            pts_rand = [random.uniform(0, TWO_PI) for _ in range(N)]
            d_rand = axis_discrepancy(pts_rand)
            self.assertGreaterEqual(d_rand, 1.0 / (2.0 * N) - 1e-14)
            self.assertLessEqual(d_rand, 1.0)

            # Uniform points
            pts_unif = [(2 * i + 1) / (2 * N) * TWO_PI for i in range(N)]
            d_unif = axis_discrepancy(pts_unif)
            self.assertAlmostEqual(d_unif, 1.0 / (2.0 * N), places=12)

            # Clustered points
            pts_clust = [0.0] * N
            d_clust = axis_discrepancy(pts_clust)
            self.assertAlmostEqual(d_clust, 1.0, places=12)

    def test_golden_sequence_asymptotic_monotonicity(self):
        """
        Verify Roberts' R_d low-discrepancy sequence across sample sizes:
        As N scales: 10, 20, 50, 100, 200, 500, 1000, 2000,
        mean and max discrepancy must decrease asymptotically towards 0.
        """
        sample_sizes = [10, 20, 50, 100, 200, 500, 1000, 2000]
        discrepancies = []

        for n in sample_sizes:
            pts = golden_sequence(n, dim=8)
            disc = atlas_discrepancy(pts, dim=8)
            discrepancies.append(disc["mean"])

        # Check overall monotonic downward trend
        for i in range(len(discrepancies) - 1):
            self.assertLess(
                discrepancies[i + 1],
                discrepancies[i],
                f"Golden sequence discrepancy failed to decrease from N={sample_sizes[i]} to N={sample_sizes[i + 1]}",
            )

    def test_atlas_discrepancy_multi_axis_consistency(self):
        """
        Verify consistency of atlas_discrepancy statistics:
        min(per_axis) <= mean <= max <= max(per_axis).
        """
        pts = golden_sequence(64, dim=8)
        disc = atlas_discrepancy(pts, dim=8)
        per_axis = disc["per_axis"]
        self.assertEqual(len(per_axis), 8)
        self.assertLessEqual(min(per_axis), disc["mean"] + 1e-12)
        self.assertGreaterEqual(max(per_axis), disc["mean"] - 1e-12)
        self.assertAlmostEqual(disc["max"], max(per_axis), places=5)


class TestLorentzIsometrySuccessiveBoosts(unittest.TestCase):
    """
    Adversarial verification of Lorentz isometry recentering under successive boosts,
    preservation of Minkowski metric, and float64 stability boundaries.
    """

    def test_successive_boosts_isometry_bounded_radius(self):
        """
        Verify that 50 consecutive Lorentz boosts recentering around points
        within bounded radius preserve pairwise geodesic distance to < 1e-13.
        """
        random.seed(999)
        dim = 8
        p = lorentz_normalize([1.0] + [random.uniform(-0.5, 0.5) for _ in range(dim)])
        q = lorentz_normalize([1.0] + [random.uniform(-0.5, 0.5) for _ in range(dim)])
        d_init = lorentz_distance(p, q)

        cur_p = p[:]
        cur_q = q[:]

        for k in range(50):
            # Recenter around cur_p itself: keeps coordinates near origin (r ~ 0)
            cur_q = lorentz_recenter(cur_q, cur_p)
            cur_p = lorentz_recenter(cur_p, cur_p)
            d_k = lorentz_distance(cur_p, cur_q)
            self.assertLess(
                abs(d_k - d_init), 1e-13, f"Boost {k} drifted: {d_init} vs {d_k}"
            )

    def test_alternating_boosts_exponential_coordinate_growth(self):
        """
        Empirical discovery: Alternating boosts with fixed centers (cA, cB) compose
        into a non-zero translation, causing radial distance r to grow linearly with k
        and coordinates x_0 = cosh(r) to grow exponentially:
        - For k <= 20 (x_0 < 1000): distance error < 1e-12 (preserved).
        - For k = 50 (x_0 ~ 5e5): distance error ~ 1e-5 (minor drift).
        - For k >= 100 (x_0 > 1e11): catastrophic cancellation in float64 degrades distance.
        This test confirms stability within normal operational limits (k <= 20).
        """
        p = lorentz_normalize([1.0, 0.2, -0.1, 0.3, -0.2])
        q = lorentz_normalize([1.0, -0.3, 0.1, -0.2, 0.4])
        d_init = lorentz_distance(p, q)

        cA = lorentz_normalize([1.0, 0.3, 0.0, 0.1, -0.1])
        cB = lorentz_normalize([1.0, -0.2, 0.2, -0.1, 0.0])

        cur_p = p[:]
        cur_q = q[:]

        for k in range(1, 21):
            c = cA if k % 2 == 1 else cB
            cur_p = lorentz_recenter(cur_p, c)
            cur_q = lorentz_recenter(cur_q, c)
            d_k = lorentz_distance(cur_p, cur_q)
            self.assertLess(
                abs(d_k - d_init),
                1e-11,
                f"Boost {k} distance error exceeded 1e-11: {abs(d_k - d_init)}",
            )

    def test_minkowski_norm_and_hyperboloid_sheet_invariant(self):
        """
        Verify points remain strictly on the upper sheet:
        <x, x>_L == -1.0 and x_0 >= 1.0 under boosts.
        """
        dim = 8
        p = lorentz_normalize([1.0] + [0.5] * dim)
        c = lorentz_normalize([1.0] + [-0.3] * dim)
        boosted = lorentz_recenter(p, c)

        self.assertGreaterEqual(boosted[0], 1.0)
        inner = minkowski_inner_product(boosted, boosted)
        self.assertAlmostEqual(inner, -1.0, places=13)

    def test_parallel_transport_isometry_succession(self):
        """
        Verify tangent vector Minkowski norm ||v||_L is invariant under chained parallel transport.
        """
        x = lorentz_origin(4)
        y = lorentz_normalize([1.0, 0.4, -0.3, 0.2, 0.1])
        z = lorentz_normalize([1.0, -0.2, 0.5, -0.1, 0.3])

        v_amb = [0.0, 0.3, -0.2, 0.5, 0.1]
        v = lorentz_project_tangent(x, v_amb)
        norm_v = tangent_norm(v)

        v_y = lorentz_parallel_transport(x, y, v)
        self.assertAlmostEqual(tangent_norm(v_y), norm_v, places=12)

        v_z = lorentz_parallel_transport(y, z, v_y)
        self.assertAlmostEqual(tangent_norm(v_z), norm_v, places=12)

    def test_poincare_lorentz_cross_chart_consistency_after_boost(self):
        """
        Verify that Poincaré distance and Lorentz distance agree before and after boosts.
        """
        p_ball = [0.3, -0.2]
        q_ball = [-0.4, 0.1]
        c_ball = [0.1, 0.2]

        p_lor = poincare_to_lorentz(p_ball)
        q_lor = poincare_to_lorentz(q_ball)
        c_lor = poincare_to_lorentz(c_ball)

        d_ball_before = poincare_distance(p_ball, q_ball)
        d_lor_before = lorentz_distance(p_lor, q_lor)
        self.assertAlmostEqual(d_ball_before, d_lor_before, places=13)

        p_boosted = lorentz_recenter(p_lor, c_lor)
        q_boosted = lorentz_recenter(q_lor, c_lor)
        d_lor_after = lorentz_distance(p_boosted, q_boosted)
        self.assertAlmostEqual(d_lor_before, d_lor_after, places=12)


class TestHighDimensionalProjectionStability(unittest.TestCase):
    """
    Adversarial verification of high-dimensional projection stability in D = 3584,
    tangent scaling 1/sqrt(D), and dual-chart roundtrip accuracy.
    """

    def test_dimension_3584_tangent_scaling_prevents_saturation(self):
        """
        In D = 3584:
        A raw unit tangent vector has Euclidean norm sqrt(3584) ≈ 59.866.
        Without scaling: exp_0(v) saturates to ball boundary 1.0 - BOUNDARY_EPS (0.99999).
        With scaling (1 / sqrt(D)): norm becomes 1.0, and exp_0(v) lands safely at radius
        tanh(0.5) ≈ 0.462117.
        """
        D = 3584
        v_raw = [1.0] * D
        p_unscaled = exp_map_zero(v_raw, c=1.0)
        norm_unscaled = euclidean_norm(p_unscaled)
        self.assertAlmostEqual(norm_unscaled, 1.0 - 1e-5, places=5)

        v_scaled = scale_tangent(v_raw, dim=D)
        self.assertAlmostEqual(euclidean_norm(v_scaled), 1.0, places=14)

        p_scaled = exp_map_zero(v_scaled, c=1.0)
        norm_scaled = euclidean_norm(p_scaled)
        expected_radius = math.tanh(0.5)
        self.assertAlmostEqual(norm_scaled, expected_radius, places=14)

    def test_dimension_3584_dual_chart_roundtrip_precision(self):
        """
        In D = 3584:
        Verify roundtrip Poincaré -> Lorentz -> Poincaré evaluated across 3584 dimensions
        achieves machine precision error <= 1e-15.
        """
        random.seed(2026)
        D = 3584
        raw = [random.gauss(0, 1) for _ in range(D)]
        v_tangent = scale_tangent(raw, dim=D)
        p = exp_map_zero(v_tangent, c=1.0)

        # Convert to Lorentz hyperboloid
        lor = poincare_to_lorentz(p, c=1.0)
        self.assertEqual(len(lor), D + 1)
        inner = minkowski_inner_product(lor, lor)
        self.assertAlmostEqual(inner, -1.0, places=12)

        # Convert back to Poincaré ball
        p_roundtrip = lorentz_to_poincare(lor, c=1.0)
        self.assertEqual(len(p_roundtrip), D)

        max_err = max(abs(a - b) for a, b in zip(p, p_roundtrip))
        self.assertLess(max_err, 1e-14, f"D=3584 roundtrip error: {max_err}")

    def test_dimension_3584_poincare_distance_numerical_stability(self):
        """
        In D = 3584:
        Compute pairwise Poincaré distance between multiple high-dimensional embeddings.
        Verify distance evaluates without NaN, overflow, or precision loss.
        """
        random.seed(777)
        D = 3584
        points = []
        for _ in range(5):
            raw = [random.gauss(0, 1) for _ in range(D)]
            v = scale_tangent(raw, dim=D)
            p = exp_map_zero(v, c=1.0)
            points.append(p)

        for i in range(len(points)):
            for j in range(i, len(points)):
                d = poincare_distance(points[i], points[j], c=1.0)
                self.assertTrue(math.isfinite(d))
                if i == j:
                    self.assertAlmostEqual(d, 0.0, places=15)
                else:
                    self.assertGreater(d, 0.0)

    def test_product_manifold_composite_distance_h3584_t8(self):
        """
        Compute composite product distance d_P on H^3584 x T^8 with golden ratio weights:
          d_P^2 = w_h * d_H^2 + w_t * d_T^2.
        """
        random.seed(888)
        D = 3584
        v1 = scale_tangent([random.gauss(0, 1) for _ in range(D)], dim=D)
        v2 = scale_tangent([random.gauss(0, 1) for _ in range(D)], dim=D)
        p1 = exp_map_zero(v1, c=1.0)
        p2 = exp_map_zero(v2, c=1.0)

        t1 = [random.uniform(0, TWO_PI) for _ in range(8)]
        t2 = [random.uniform(0, TWO_PI) for _ in range(8)]

        d_p = product_distance(p1, t1, p2, t2, w_h=1.0, w_t=1.0, c=1.0)
        self.assertTrue(math.isfinite(d_p))
        self.assertGreater(d_p, 0.0)


class TestDualChartDisagreementsRanking(unittest.TestCase):
    """
    Adversarial verification of dual-chart disagreement rankings:
    Separation of convergent concepts vs derivational drift.
    """

    def test_disagreements_ranking_extreme_geometries(self):
        """
        Adversarial test: Construct extreme node pairs:
        1. Pair (A, B): Hyperbolic distance ~ 5.0 (far), Torus distance ~ 0.01 (close).
        2. Pair (C, D): Hyperbolic distance ~ 0.01 (close), Torus distance ~ 5.0 (far).
        Disagreements must cleanly separate:
        - top rhythm pair is (A, B).
        - top lineage pair is (C, D).
        """
        hyper = {
            "node_A": [0.95, 0.0],
            "node_B": [-0.95, 0.0],
            "node_C": [0.001, 0.0],
            "node_D": [0.002, 0.0],
        }
        torus = {
            "node_A": [0.001] * 8,
            "node_B": [0.002] * 8,
            "node_C": [0.0] * 8,
            "node_D": [math.pi] * 8,
        }

        disag = disagreements(hyper, torus, top_k=2)
        rhythm = disag["same_rhythm_diff_lineage"]
        lineage = disag["same_lineage_drift_phase"]

        self.assertEqual({rhythm[0]["a"], rhythm[0]["b"]}, {"node_A", "node_B"})
        self.assertEqual({lineage[0]["a"], lineage[0]["b"]}, {"node_C", "node_D"})

    def test_disagreements_edge_cases(self):
        """
        Verify behavior when inputs are disjoint or empty.
        """
        res_empty = disagreements({}, {})
        self.assertEqual(res_empty["same_rhythm_diff_lineage"], [])
        self.assertEqual(res_empty["same_lineage_drift_phase"], [])

        res_disjoint = disagreements({"a": [0.1, 0.2]}, {"b": [0.1] * 8})
        self.assertEqual(res_disjoint["same_rhythm_diff_lineage"], [])
        self.assertEqual(res_disjoint["same_lineage_drift_phase"], [])


if __name__ == "__main__":
    unittest.main()

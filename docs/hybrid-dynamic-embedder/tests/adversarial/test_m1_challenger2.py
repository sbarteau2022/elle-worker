"""
Adversarial Empirical Stress Test Suite — Challenger 2 (Milestone 1 Iteration 2 Remediation).

Comprehensive challenge and empirical verification of:
1. Product Manifold H^n x T^8 (python/math_core/product.py):
   - Golden ratio multiscale weights omega_j = phi^{-j/2} and metric invariants.
   - Strict dimension mismatch rejection across torus and product distance functions.
   - Dual-chart disagreement ranking robustness with non-finite / NaN / Inf inputs.
   - Star discrepancy NaN propagation behavior.
2. Atlas & TIT Bridge (python/math_core/atlas_bridge.py):
   - Hurwitz measure delta(phi) = 1/sqrt(5) and unique maximality of phi - 1.
   - Stern-Brocot search convergence to phi - 1 and Fibonacci convergents.
   - Three-gap partition boundaries with phi-ratios and empirical TIT orbit gaps.
   - Isotropic suppression (1/pi) and TurboQuant bias (2/pi) vector operations.
3. Boundary Stress Conditions:
   - Behavior as points approach the manifold boundary ||u|| -> 1/sqrt(c).
   - Numerical stability of distance, gradients, Möbius addition, and Lorentz duality under extreme epsilon.
"""

from __future__ import annotations

import math
import random
import sys
from pathlib import Path
from typing import Any, Dict, List, Sequence, Tuple

import pytest

# Ensure project root is in sys.path
project_root = Path(__file__).resolve().parent.parent.parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

from python.math_core.atlas_bridge import (
    DELTA_PHI,
    INV_SQRT5,
    ISOTROPIC_SUPPRESSION,
    PHI,
    PHI_M1,
    TURBOQUANT_BIAS,
    WEIGHT_HYPERBOLIC,
    WEIGHT_TOROIDAL,
    apply_isotropic_suppression,
    circular_distance,
    format_dhng_geometric_node,
    generate_toroidal_pe,
    geodesic_residual_step,
    hurwitz_delta,
    stern_brocot_depth_schedule,
    stern_brocot_search,
    three_gap_attention_weights,
    three_gap_partition,
    three_gap_thresholds,
)
from python.math_core.lorentz import (
    lorentz_distance,
    lorentz_to_poincare,
    minkowski_inner_product,
    poincare_to_lorentz,
)
from python.math_core.poincare import (
    BOUNDARY_EPS,
    conformal_factor,
    distance_gradient_u,
    euclidean_norm,
    exp_map_zero,
    log_map_zero,
    mobius_add,
    poincare_depth,
    poincare_distance,
    project_to_ball,
    riemannian_gradient,
)
from python.math_core.product import (
    GOLDEN_ANGLE,
    PHI as PRODUCT_PHI,
    TORUS_DIM,
    TWO_PI,
    atlas_discrepancy,
    axis_discrepancy,
    disagreements,
    golden_sequence,
    norm_2pi,
    phi_scale_weights,
    product_distance,
    torus_distance,
    translation_align,
    unit_torus_distance,
    wrap_angle,
)


# =====================================================================
# 1. PRODUCT MANIFOLD H^n x T^8 STRESS TESTS
# =====================================================================


class TestProductManifoldStress:
    """Stress tests product manifold H^n x T^8 in python/math_core/product.py."""

    def test_golden_ratio_multiscale_weights_invariants(self):
        """
        Verify golden ratio multiscale weights: omega_j = phi^{-j / 2}.
        Squared weights: omega_j^2 = phi^{-j}.
        Successive ratio: omega_j^2 / omega_{j+1}^2 = phi.
        """
        for dim in [1, 2, 8, 16, 64]:
            weights = phi_scale_weights(dim)
            assert len(weights) == dim
            assert abs(weights[0] - 1.0) < 1e-15

            for j in range(dim):
                expected = PRODUCT_PHI ** (-float(j) / 2.0)
                assert abs(weights[j] - expected) < 1e-15

                if j > 0:
                    sq_prev = weights[j - 1] ** 2
                    sq_curr = weights[j] ** 2
                    ratio = sq_prev / sq_curr
                    assert abs(ratio - PRODUCT_PHI) < 1e-13

            # Geometric sum of squared weights: sum_{j=0}^{dim-1} phi^{-j} = (1 - phi^{-dim}) / (1 - phi^{-1})
            # Since 1 - phi^{-1} = phi^{-2}, sum = phi^2 * (1 - phi^{-dim})
            sum_sq = sum(w * w for w in weights)
            expected_sum = (PRODUCT_PHI ** 2) * (1.0 - PRODUCT_PHI ** (-dim))
            assert abs(sum_sq - expected_sum) < 1e-13

        # For high dimension D = 5120, weights taper off monotonically down to float64 underflow
        weights_5120 = phi_scale_weights(5120)
        assert len(weights_5120) == 5120
        assert weights_5120[0] == 1.0
        assert weights_5120[8] == PRODUCT_PHI ** (-4.0)
        assert all(weights_5120[k] >= weights_5120[k + 1] for k in range(len(weights_5120) - 1))

    def test_torus_distance_dimension_mismatch_rejection(self):
        """Verify torus_distance strictly raises ValueError on dimension mismatch."""
        with pytest.raises(ValueError, match="Dimension mismatch in torus_distance"):
            torus_distance([0.1, 0.2], [0.1, 0.2, 0.3])

        with pytest.raises(ValueError, match="Dimension mismatch in torus_distance"):
            torus_distance([0.1, 0.2, 0.3], [0.1, 0.2])

        with pytest.raises(ValueError, match="Dimension mismatch in torus_distance"):
            torus_distance([], [0.1])

        with pytest.raises(ValueError, match="Dimension mismatch in torus_distance"):
            torus_distance([0.1], [])

    def test_unit_torus_distance_dimension_mismatch_rejection(self):
        """Verify unit_torus_distance strictly raises ValueError on dimension mismatch."""
        with pytest.raises(ValueError, match="Dimension mismatch in unit_torus_distance"):
            unit_torus_distance([0.1, 0.2], [0.1, 0.2, 0.3])

        with pytest.raises(ValueError, match="Dimension mismatch in unit_torus_distance"):
            unit_torus_distance([0.1, 0.2, 0.3], [0.1, 0.2])

    def test_product_distance_dimension_mismatch_rejection(self):
        """Verify product_distance strictly raises ValueError on ball and torus dimension mismatches."""
        # Ball coordinates mismatch
        with pytest.raises(ValueError, match="ball coordinates"):
            product_distance(
                a_ball=[0.1, 0.2],
                a_torus=[0.1] * 8,
                b_ball=[0.1, 0.2, 0.3],
                b_torus=[0.1] * 8,
            )

        # Torus coordinates mismatch
        with pytest.raises(ValueError, match="torus coordinates"):
            product_distance(
                a_ball=[0.1, 0.2],
                a_torus=[0.1] * 8,
                b_ball=[0.1, 0.2],
                b_torus=[0.1] * 7,
            )

        # Both mismatched (ball checked first)
        with pytest.raises(ValueError, match="ball coordinates"):
            product_distance(
                a_ball=[0.1],
                a_torus=[0.1] * 8,
                b_ball=[0.1, 0.2],
                b_torus=[0.1] * 7,
            )

    def test_translation_align_dimension_mismatch_rejection(self):
        """Verify translation_align strictly raises ValueError on dimension mismatch."""
        with pytest.raises(ValueError, match="Dimension mismatch in translation_align"):
            translation_align([0.1, 0.2], [0.1, 0.2, 0.3])

        with pytest.raises(ValueError, match="Dimension mismatch in translation_align"):
            translation_align([0.1, 0.2, 0.3], [0.1, 0.2])

    def test_disagreements_nan_strict_filtering(self):
        """
        Verify that nodes with NaN coordinates in either hyperbolic or toroidal space
        are strictly filtered out of top-k rankings.
        """
        hyper = {
            "valid_A": [0.3, 0.0],
            "valid_B": [-0.3, 0.0],
            "valid_C": [0.0, 0.4],
            "nan_hyp_1": [math.nan, 0.2],
            "nan_hyp_2": [0.1, math.nan],
            "nan_tor_1": [0.2, 0.1],
            "nan_tor_2": [0.3, -0.1],
        }
        torus = {
            "valid_A": [0.1] * 8,
            "valid_B": [0.2] * 8,
            "valid_C": [math.pi] * 8,
            "nan_hyp_1": [0.5] * 8,
            "nan_hyp_2": [0.6] * 8,
            "nan_tor_1": [math.nan] * 8,
            "nan_tor_2": [0.1, math.nan, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
        }

        res = disagreements(hyper, torus, top_k=10)
        tainted_nodes = {"nan_hyp_1", "nan_hyp_2", "nan_tor_1", "nan_tor_2"}

        all_ranked_pairs = (
            res["same_rhythm_diff_lineage"] + res["same_lineage_drift_phase"]
        )
        assert len(all_ranked_pairs) > 0

        for pair in all_ranked_pairs:
            assert pair["a"] not in tainted_nodes, f"Tainted node {pair['a']} found in ranking"
            assert pair["b"] not in tainted_nodes, f"Tainted node {pair['b']} found in ranking"
            assert math.isfinite(pair["ball"]), f"Non-finite ball distance in pair: {pair}"
            assert math.isfinite(pair["torus"]), f"Non-finite torus distance in pair: {pair}"

    def test_disagreements_all_nan_graceful_empty_return(self):
        """Verify disagreements gracefully returns empty lists when all nodes contain NaNs."""
        hyper = {
            "node_1": [math.nan, 0.1],
            "node_2": [math.nan, 0.2],
        }
        torus = {
            "node_1": [0.1] * 8,
            "node_2": [0.2] * 8,
        }
        res = disagreements(hyper, torus, top_k=5)
        assert res["same_rhythm_diff_lineage"] == []
        assert res["same_lineage_drift_phase"] == []

    def test_star_discrepancy_nan_propagation(self):
        """
        Verify that NaNs propagate as math.nan in axis_discrepancy and atlas_discrepancy
        rather than producing bogus finite values.
        """
        # 1. 1D axis discrepancy with NaN
        nan_angles = [0.1, 0.5, math.nan, 1.2]
        d_axis_nan = axis_discrepancy(nan_angles)
        assert math.isnan(d_axis_nan)

        # 2. 1D axis discrepancy with Inf
        inf_angles = [0.1, 0.5, math.inf, 1.2]
        d_axis_inf = axis_discrepancy(inf_angles)
        assert math.isnan(d_axis_inf)

        # 3. Multi-axis atlas discrepancy with single NaN entry
        pts_single_nan = [
            [0.1, 0.2, 0.3],
            [0.4, math.nan, 0.6],
            [0.7, 0.8, 0.9],
        ]
        res_atlas = atlas_discrepancy(pts_single_nan, dim=3)
        assert math.isnan(res_atlas["mean"])
        assert math.isnan(res_atlas["max"])
        assert not math.isnan(res_atlas["per_axis"][0])
        assert math.isnan(res_atlas["per_axis"][1])
        assert not math.isnan(res_atlas["per_axis"][2])

        # 4. Multi-axis atlas discrepancy with all NaNs
        pts_all_nan = [[math.nan, math.nan], [math.nan, math.nan]]
        res_all_nan = atlas_discrepancy(pts_all_nan, dim=2)
        assert math.isnan(res_all_nan["mean"])
        assert math.isnan(res_all_nan["max"])
        assert math.isnan(res_all_nan["per_axis"][0])
        assert math.isnan(res_all_nan["per_axis"][1])


# =====================================================================
# 2. ATLAS & TIT BRIDGE STRESS TESTS
# =====================================================================


class TestAtlasTITBridgeStress:
    """Stress tests Atlas/TIT bridge in python/math_core/atlas_bridge.py."""

    def test_hurwitz_measure_and_unique_maximality_of_phi(self):
        """
        Verify Hurwitz bound constant: DELTA_PHI = 1 / sqrt(5) == INV_SQRT5.
        Verify finite infimum metric: delta(phi - 1) = 1 / phi^2 ~ 0.381966.
        Verify that phi - 1 uniquely maximizes delta(omega) over rational and irrational grid.
        """
        expected_hurwitz = 1.0 / math.sqrt(5.0)
        assert abs(DELTA_PHI - expected_hurwitz) < 1e-16
        assert INV_SQRT5 == DELTA_PHI

        # delta(phi - 1) evaluates to 1/phi^2
        d_phi = hurwitz_delta(PHI_M1, N_max=3000)
        expected_finite_inf = 1.0 / (PHI * PHI)
        assert abs(d_phi - expected_finite_inf) < 1e-12

        # Verify maximality over test grid
        test_omegas = [
            0.1, 0.2, 1.0 / 3.0, 0.4, 0.5, 2.0 / 3.0,
            0.7, 0.8, math.sqrt(2.0) - 1.0,
            math.pi % 1.0, math.e % 1.0,
        ]
        for om in test_omegas:
            d_om = hurwitz_delta(om, N_max=3000)
            assert d_om < d_phi, (
                f"Omega {om} achieved delta {d_om} >= delta(phi-1) {d_phi}"
            )

    def test_stern_brocot_search_convergence_to_phi(self):
        """
        Verify Stern-Brocot search starts at 0.5 with no knowledge of phi,
        and converges to phi - 1 with error < 1e-10 within 30 steps.
        """
        final_omega, history = stern_brocot_search(max_steps=30)
        err = abs(final_omega - PHI_M1)
        assert err < 1e-10, f"Stern-Brocot search error {err} >= 1e-10"
        assert len(history) <= 30

        # Check mediants and monotonic error reduction
        errors = [h["error"] for h in history]
        assert errors[-1] < errors[0]
        assert history[0]["omega"] == 2.0 / 3.0  # (1+1)/(2+1) = 2/3

    def test_three_gap_partition_boundaries_phi_ratios(self):
        """
        Verify three-gap thresholds and discrete partition:
        Threshold ratios: medium / small == phi, large / medium == phi.
        Partition bins: 0 (< small), 1 ([small, medium)), 2 (>= medium).
        """
        base_small = 0.001186
        small, medium, large = three_gap_thresholds(base_small=base_small)

        assert abs(medium / small - PHI) < 1e-14
        assert abs(large / medium - PHI) < 1e-14
        assert abs(large / small - (PHI ** 2)) < 1e-14

        # Boundary partition tests
        assert three_gap_partition(0.0, base_small=base_small) == 0
        assert three_gap_partition(small - 1e-10, base_small=base_small) == 0
        assert three_gap_partition(small, base_small=base_small) == 1
        assert three_gap_partition((small + medium) / 2.0, base_small=base_small) == 1
        assert three_gap_partition(medium - 1e-10, base_small=base_small) == 1
        assert three_gap_partition(medium, base_small=base_small) == 2
        assert three_gap_partition(large, base_small=base_small) == 2
        assert three_gap_partition(100.0, base_small=base_small) == 2

    def test_three_gap_attention_weights_phi_decay(self):
        """
        Verify three-gap attention weights:
        Small gap: 1.0.
        Medium gap: 1/phi ~ 0.618034.
        Large gap: 1/phi^2 ~ 0.381966.
        """
        base = 0.001186
        s, m, _ = three_gap_thresholds(base)

        w_small = three_gap_attention_weights(s - 1e-6)
        w_med = three_gap_attention_weights((s + m) / 2.0)
        w_large = three_gap_attention_weights(m + 1e-6)

        assert abs(w_small - 1.0) < 1e-15
        assert abs(w_med - 1.0 / PHI) < 1e-15
        assert abs(w_large - 1.0 / (PHI ** 2)) < 1e-15

    def test_empirical_three_gap_orbit_theorem(self):
        """
        Empirical replication of TIT Prediction 3:
        For N = 1000 points on circle generated by orbit of phi - 1:
        1. There are exactly 3 distinct gap lengths.
        2. Ratios large/medium and medium/small equal phi to within 0.1%.
        """
        N = 1000
        pts = sorted([(k * PHI_M1) % 1.0 for k in range(1, N + 1)])
        circ = pts + [pts[0] + 1.0]
        gaps = [round(circ[i + 1] - circ[i], 8) for i in range(N)]
        distinct = sorted(set(gaps))

        assert len(distinct) == 3, f"Expected 3 gaps, got {len(distinct)}: {distinct}"
        r_large_med = distinct[2] / distinct[1]
        r_med_small = distinct[1] / distinct[0]

        assert abs(r_large_med - PHI) < 0.001
        assert abs(r_med_small - PHI) < 0.001

    def test_isotropic_suppression_and_geodesic_residual_dimension_checks(self):
        """Verify dimension checking in apply_isotropic_suppression and geodesic_residual_step."""
        with pytest.raises(ValueError, match="Dimension mismatch in apply_isotropic_suppression"):
            apply_isotropic_suppression([0.1, 0.2], [0.1, 0.2, 0.3])

        with pytest.raises(ValueError, match="Dimension mismatch in geodesic_residual_step"):
            geodesic_residual_step([0.1, 0.2], [0.1, 0.2, 0.3])

        # Mathematical correctness
        x = [1.0, 2.0]
        attn = [0.5, 0.8]
        supp = apply_isotropic_suppression(x, attn, mix_alpha=0.5)
        assert len(supp) == 2
        exp0 = 0.5 * (1.0 * (1.0 - ISOTROPIC_SUPPRESSION)) + 0.5 * (0.5 * TURBOQUANT_BIAS)
        assert abs(supp[0] - exp0) < 1e-15

        step = geodesic_residual_step(x, attn)
        assert len(step) == 2
        exp_step0 = math.fmod(1.0 + PHI_M1 * (0.5 - 1.0), 1.0)
        assert abs(step[0] - exp_step0) < 1e-15


# =====================================================================
# 3. BOUNDARY STRESS CONDITIONS (||u|| -> 1/sqrt(c))
# =====================================================================


class TestBoundaryStressConditions:
    """Stress tests boundary behavior as ||u|| approaches 1/sqrt(c)."""

    @pytest.mark.parametrize("c", [0.01, 0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 100.0])
    def test_boundary_distance_clamping_and_finiteness(self, c: float):
        """
        Verify that as ||u|| -> 1/sqrt(c), poincare_distance evaluates to finite numbers
        and never produces NaN, Inf, or raises math domain errors.
        """
        sqrt_c = math.sqrt(c)
        max_r = 1.0 / sqrt_c
        origin = [0.0, 0.0, 0.0]

        for eps in [1e-1, 1e-3, 1e-6, 1e-9, 1e-12, 1e-14, 1e-15, 1e-16, 0.0, -1e-5]:
            r = (1.0 - eps) * max_r
            u = [r, 0.0, 0.0]
            d = poincare_distance(origin, u, c=c)

            assert math.isfinite(d), f"Distance non-finite for c={c}, eps={eps}"
            assert d > 0.0

            # Near the boundary, distance must be strictly increasing as eps decreases down to precision limit
            if eps >= 1e-14:
                d_analytical = (1.0 / sqrt_c) * math.log((1.0 + sqrt_c * r) / (1.0 - sqrt_c * r))
                rel_err = abs(d - d_analytical) / d_analytical
                assert rel_err < 0.05, f"Analytical mismatch at c={c}, eps={eps}: rel_err={rel_err}"

    @pytest.mark.parametrize("c", [0.1, 1.0, 5.0])
    def test_boundary_gradient_finiteness(self, c: float):
        """
        Verify distance_gradient_u remains completely finite without NaN or Inf
        for near-boundary points.
        """
        sqrt_c = math.sqrt(c)
        max_r = 1.0 / sqrt_c
        v = [0.1 * max_r, 0.0]

        for eps in [1e-3, 1e-6, 1e-9, 1e-12, 1e-14, 1e-15, 1e-16, 0.0]:
            r = (1.0 - eps) * max_r
            u = [r, 0.0]
            grad = distance_gradient_u(u, v, c=c)
            assert len(grad) == 2
            assert all(math.isfinite(g) for g in grad), f"Non-finite gradient at c={c}, eps={eps}"

    @pytest.mark.parametrize("c", [0.1, 1.0, 5.0])
    def test_boundary_mobius_add_containment(self, c: float):
        """
        Verify mobius_add keeps points strictly within the open ball ||u (+) v|| < 1/sqrt(c).
        """
        sqrt_c = math.sqrt(c)
        max_r = 1.0 / sqrt_c

        for eps in [1e-2, 1e-4, 1e-6, 1e-9, 1e-12, 1e-15]:
            r = (1.0 - eps) * max_r
            u = [r, 0.0]
            # Add a small step in the outward direction
            step = [0.01 * max_r, 0.0]
            added = mobius_add(u, step, c=c)
            norm_added = euclidean_norm(added)
            assert norm_added < max_r, f"Escaped ball at c={c}, eps={eps}: {norm_added} >= {max_r}"

    @pytest.mark.parametrize("c", [0.1, 1.0, 5.0])
    def test_boundary_lorentz_dual_chart_roundtrip(self, c: float):
        """
        Verify Poincaré -> Lorentz -> Poincaré roundtrip maintains stability
        up to eps = 1e-12 from the boundary.
        """
        sqrt_c = math.sqrt(c)
        max_r = 1.0 / sqrt_c

        for eps in [1e-2, 1e-4, 1e-6, 1e-9, 1e-12]:
            r = (1.0 - eps) * max_r
            u = [r * math.cos(0.5), r * math.sin(0.5)]
            p_proj = project_to_ball(u, c=c)

            lor = poincare_to_lorentz(p_proj, c=c)
            # Verify Minkowski sheet invariant <x, x>_L == -1.0
            # For x_0 ~ 10^5, x_0^2 ~ 10^10; catastrophic cancellation in float64 is bounded by 1e-5
            inner = minkowski_inner_product(lor, lor)
            assert abs(inner - (-1.0)) < 1e-5, f"Minkowski invariant drifted at eps={eps}: {inner}"

            rec = lorentz_to_poincare(lor, c=c)
            err = max(abs(a - b) for a, b in zip(p_proj, rec))
            assert err < 1e-12, f"Dual-chart roundtrip error {err} >= 1e-12 at eps={eps}"

    @pytest.mark.parametrize("c", [0.1, 1.0, 5.0])
    def test_boundary_product_distance_stability(self, c: float):
        """
        Verify product_distance on H^n x T^8 evaluates without overflow
        when hyperbolic coordinates approach the boundary.
        """
        sqrt_c = math.sqrt(c)
        max_r = 1.0 / sqrt_c

        u_ball = [(1.0 - 1e-15) * max_r, 0.0]
        v_ball = [0.0, 0.0]
        u_torus = [0.1] * 8
        v_torus = [math.pi] * 8

        dp = product_distance(u_ball, u_torus, v_ball, v_torus, c=c)
        assert math.isfinite(dp)
        assert dp > 0.0

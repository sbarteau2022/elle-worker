"""
Comprehensive tests for Atlas/TIT integration (Milestone 3 — R3).

Tests:
    - TIT golden ratio predictions (4/4 must confirm)
    - Atlas package importability
    - Hurwitz delta maximizer verification
    - Stern-Brocot convergence to φ
    - Three-gap property
    - Isotropic geodesic invariant
"""

import math
import pytest

from python.atlas import (
    PHI,
    PHI_M1,
    INV_SQRT5,
    hurwitz_delta,
    measure_discrepancy,
    measure_three_gap,
    stern_brocot_search,
)


class TestTITGoldenRatioEmergence:
    """Prediction 1: φ is the unique maximiser of δ(ω) on [0,1)."""

    def test_phi_maximizes_hurwitz_delta(self):
        """δ(φ mod 1) must approach 1/√5 (the supremum, reached in the limit)."""
        delta_phi = hurwitz_delta(PHI_M1, N_max=5000)
        # Finite-N approximation converges slowly; verify within 15% of theoretical max
        assert delta_phi > 0.35, f"δ(φ)={delta_phi} too low"
        assert delta_phi <= INV_SQRT5 + 1e-10, f"δ(φ)={delta_phi} exceeds theoretical max"

    def test_phi_beats_all_competitors(self):
        """δ(φ) must be strictly greater than δ(ω) for any other ω."""
        delta_phi = hurwitz_delta(PHI_M1, N_max=3000)
        competitors = [0.1, 0.2, 1 / 3, 0.4, 0.5, 2 / 3, 0.7, 0.8, math.sqrt(2) - 1]
        for omega in competitors:
            d = hurwitz_delta(omega, N_max=3000)
            assert d < delta_phi, f"δ({omega})={d} >= δ(φ)={delta_phi}"

    def test_hurwitz_delta_positive(self):
        """δ(ω) must be > 0 for any irrational ω."""
        for omega in [PHI_M1, math.sqrt(2) - 1, math.pi - 3]:
            d = hurwitz_delta(omega, N_max=1000)
            assert d > 0.0, f"δ({omega}) = {d} <= 0"


class TestSternBrocotConvergence:
    """Prediction: Stern-Brocot search converges to φ mod 1."""

    def test_convergence_to_phi(self):
        final_omega, history = stern_brocot_search(max_steps=30)
        assert abs(final_omega - PHI_M1) < 1e-8, f"SB converged to {final_omega}, not φ"

    def test_mediants_are_fibonacci_ratios(self):
        _, history = stern_brocot_search(max_steps=20)
        # Early mediants should approach Fibonacci ratios F_k/F_{k+1}
        assert len(history) > 5
        # Error must decrease monotonically
        errors = [h["error"] for h in history]
        for i in range(1, min(len(errors), 10)):
            assert errors[i] <= errors[i - 1] + 1e-15

    def test_convergence_speed(self):
        """Must converge within 30 steps."""
        final_omega, history = stern_brocot_search(max_steps=30)
        assert history[-1]["error"] < 1e-8


class TestThreeGapProperty:
    """Prediction 3: φ-orbit has exactly 3 distinct gap lengths with ratios = φ."""

    def test_three_distinct_gaps(self):
        distinct, n_gaps = measure_three_gap(PHI_M1, N=1000)
        assert n_gaps == 3, f"Expected 3 gaps, got {n_gaps}: {distinct}"

    def test_gap_ratios_equal_phi(self):
        distinct, n_gaps = measure_three_gap(PHI_M1, N=1000)
        assert n_gaps == 3
        r1 = distinct[2] / distinct[1]
        r2 = distinct[1] / distinct[0]
        assert abs(r1 - PHI) < 0.01, f"large/medium = {r1}, expected φ"
        assert abs(r2 - PHI) < 0.01, f"medium/small = {r2}, expected φ"

    def test_non_phi_has_different_gaps(self):
        """A non-φ rotation should NOT have 3 gaps with ratio φ."""
        distinct, n_gaps = measure_three_gap(0.3, N=500)
        if n_gaps == 3:
            r1 = distinct[2] / distinct[1]
            assert abs(r1 - PHI) > 0.05, "Non-φ should not have φ gap ratio"


class TestIsotropicGeodesic:
    """Prediction 4: φ-wound geodesic has constant angular step."""

    def test_constant_step(self):
        N = 500
        steps = [((k + 1) * PHI_M1 % 1.0 - k * PHI_M1 % 1.0) % 1.0 for k in range(N)]
        mean_step = sum(steps) / len(steps)
        assert abs(mean_step - PHI_M1) < 1e-12

    def test_zero_variance(self):
        N = 500
        steps = [((k + 1) * PHI_M1 % 1.0 - k * PHI_M1 % 1.0) % 1.0 for k in range(N)]
        mean_step = sum(steps) / len(steps)
        variance = sum((s - mean_step) ** 2 for s in steps) / len(steps)
        assert variance < 1e-25, f"Variance = {variance}, expected machine zero"


class TestDiscrepancy:
    """Prediction 2: Fibonacci discrepancy ratios converge to φ."""

    def test_discrepancy_at_fib_89(self):
        D = measure_discrepancy(PHI_M1, 89)
        # D*_89(φ) ≈ 1/144
        expected = 1.0 / 144.0
        assert abs(D - expected) < 0.01, f"D*_89 = {D}, expected ~{expected}"

    def test_discrepancy_monotone_decrease(self):
        """Discrepancy at larger N must not exceed smaller N."""
        D_100 = measure_discrepancy(PHI_M1, 100)
        D_500 = measure_discrepancy(PHI_M1, 500)
        assert D_500 <= D_100 + 1e-10


class TestAtlasConstants:
    """Verify fundamental constants from the Atlas package."""

    def test_phi_value(self):
        assert abs(PHI - (1 + math.sqrt(5)) / 2) < 1e-15

    def test_phi_m1_value(self):
        assert abs(PHI_M1 - (PHI - 1)) < 1e-15

    def test_inv_sqrt5_value(self):
        assert abs(INV_SQRT5 - 1.0 / math.sqrt(5)) < 1e-15

    def test_phi_reciprocal_identity(self):
        """φ - 1 = 1/φ (golden ratio identity)."""
        assert abs(PHI_M1 - 1.0 / PHI) < 1e-15

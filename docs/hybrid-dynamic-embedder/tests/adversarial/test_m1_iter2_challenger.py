"""
Adversarial Empirical Stress Test Suite — Challenger 1 (Milestone 1 Iteration 2 Remediation).

Empirically challenges and stress-tests:
1. Property-based verification across wide spectrum of curvatures c in [0.001, 1000.0]:
   - distance_gradient_u vs high-precision central finite difference (< 1e-7).
   - Riemannian gradient norm ||grad_R d(u, v)||_g == 1.000000000000.
2. Lorentz dual-chart conversions under variable curvature c in [0.001, 1000.0]:
   - Hyperboloid sheet invariant <x, x>_L == -1.0 to machine precision.
   - Round-trip recovery ||u - lorentz_to_poincare(poincare_to_lorentz(u, c), c)|| < 1e-12.
   - Geodesic distance equality |d_B(u, v, c) - d_L(lor(u,c), lor(v,c), c)| < 1e-12.
3. Universal dimension validation across poincare.py and lorentz.py functions.
4. Edge cases: coincident points, extreme boundary points (1 - 1e-14), D=5120 hidden states.
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

from python.math_core import lorentz, poincare

CURVATURE_SPECTRUM = [
    0.001,
    0.005,
    0.01,
    0.05,
    0.1,
    0.5,
    1.0,
    2.0,
    5.0,
    10.0,
    50.0,
    100.0,
    500.0,
    1000.0,
]


def generate_unit_vector(dim: int, rng: random.Random) -> list[float]:
    """Generate a unit vector on S^{dim-1} using Gaussian sampling."""
    vec = [rng.gauss(0.0, 1.0) for _ in range(dim)]
    norm = math.sqrt(sum(x * x for x in vec))
    if norm < 1e-15:
        vec[0] = 1.0
        norm = 1.0
    return [x / norm for x in vec]


def central_finite_difference_grad_u(
    u: list[float], v: list[float], c: float, h: float | None = None
) -> list[float]:
    """
    High-precision 4th-order central finite difference numerical gradient of d_B^c(u, v) w.r.t u:
    f'(x) = (-f(x+2h) + 8f(x+h) - 8f(x-h) + f(x-2h)) / (12h).
    """
    R = 1.0 / math.sqrt(c)
    if h is None:
        # Scale step size with domain radius to maintain proportional relative step
        h = 1e-5 * min(1.0, R)

    grad = []
    for i in range(len(u)):
        u_p2, u_p1, u_m1, u_m2 = list(u), list(u), list(u), list(u)
        u_p2[i] += 2.0 * h
        u_p1[i] += h
        u_m1[i] -= h
        u_m2[i] -= 2.0 * h

        d_p2 = poincare.poincare_distance(u_p2, v, c=c)
        d_p1 = poincare.poincare_distance(u_p1, v, c=c)
        d_m1 = poincare.poincare_distance(u_m1, v, c=c)
        d_m2 = poincare.poincare_distance(u_m2, v, c=c)

        val = (-d_p2 + 8.0 * d_p1 - 8.0 * d_m1 + d_m2) / (12.0 * h)
        grad.append(val)
    return grad


# =====================================================================
# 1. CURVATURE SPECTRUM GRADIENT RECONCILIATION & RIEMANNIAN NORM
# =====================================================================


class TestCurvatureSpectrumGradientReconciliation:
    """Stress tests distance_gradient_u and Riemannian norm across c in [0.001, 1000.0]."""

    @pytest.mark.parametrize("c", CURVATURE_SPECTRUM)
    def test_distance_gradient_against_central_finite_difference(self, c: float):
        """
        Compare distance_gradient_u against high-precision central finite differences.
        Verification requirement: Max absolute component error < 1e-7 across all curvatures.
        """
        rng = random.Random(int(c * 10000) + 7)
        R = 1.0 / math.sqrt(c)

        for dim in [2, 5, 16]:
            for frac_u, frac_v in [(0.1, 0.2), (0.4, 0.3), (0.7, 0.5), (0.85, 0.8)]:
                u_dir = generate_unit_vector(dim, rng)
                v_dir = generate_unit_vector(dim, rng)
                u = [x * frac_u * R for x in u_dir]
                v = [x * frac_v * R for x in v_dir]

                analytical = poincare.distance_gradient_u(u, v, c=c)
                numerical = central_finite_difference_grad_u(u, v, c=c)

                max_err = max(abs(a - b) for a, b in zip(analytical, numerical))
                assert max_err < 1e-7, (
                    f"Gradient error {max_err:.2e} >= 1e-7 for c={c}, dim={dim}, "
                    f"frac_u={frac_u}, frac_v={frac_v}"
                )

    @pytest.mark.parametrize("c", [0.001, 0.1, 1.0, 10.0, 1000.0])
    def test_distance_gradient_high_dimension_d5120(self, c: float):
        """Test gradient on D=5120 LLM hidden dimension space across curvature extremes."""
        rng = random.Random(42)
        dim = 5120
        R = 1.0 / math.sqrt(c)

        u_dir = generate_unit_vector(dim, rng)
        v_dir = generate_unit_vector(dim, rng)
        u = [x * 0.35 * R for x in u_dir]
        v = [x * 0.55 * R for x in v_dir]

        analytical = poincare.distance_gradient_u(u, v, c=c)

        # Verify Riemannian gradient norm
        grad_r = poincare.riemannian_gradient(analytical, u, c=c)
        lam = poincare.conformal_factor(u, c=c)
        norm_r = math.sqrt((lam**2) * poincare.dot_product(grad_r, grad_r))
        assert abs(norm_r - 1.0) < 1e-12, f"Riemannian norm failed at D=5120, c={c}: {norm_r}"

        # Spot-check components against numerical gradient
        h = 1e-5 * min(1.0, R)
        test_indices = [0, 42, 512, 1024, 2048, 3583]
        for idx in test_indices:
            up, um = list(u), list(u)
            up[idx] += h
            um[idx] -= h
            num = (
                poincare.poincare_distance(up, v, c=c)
                - poincare.poincare_distance(um, v, c=c)
            ) / (2.0 * h)
            err = abs(analytical[idx] - num)
            assert err < 1e-7, f"Component {idx} mismatch at D=5120, c={c}: err={err:.2e}"

    @pytest.mark.parametrize("c", CURVATURE_SPECTRUM)
    def test_riemannian_gradient_unit_norm_exact(self, c: float):
        """
        Verify that the Riemannian gradient has exact unit norm ||grad_R d(u, v)||_g == 1.000000000000
        across all curvatures and radially across 0.05 to 0.9999 of the ball radius.
        """
        rng = random.Random(int(c * 1000) + 13)
        R = 1.0 / math.sqrt(c)
        dim = 8

        radial_fractions = [0.05, 0.2, 0.5, 0.8, 0.95, 0.99, 0.999]
        for frac_u in radial_fractions:
            for frac_v in [0.2, 0.7]:
                u_dir = generate_unit_vector(dim, rng)
                v_dir = generate_unit_vector(dim, rng)
                u = [x * frac_u * R for x in u_dir]
                v = [x * frac_v * R for x in v_dir]

                grad_e = poincare.distance_gradient_u(u, v, c=c)
                grad_r = poincare.riemannian_gradient(grad_e, u, c=c)
                lam = poincare.conformal_factor(u, c=c)
                norm_r = math.sqrt((lam**2) * poincare.dot_product(grad_r, grad_r))

                diff = abs(norm_r - 1.0)
                assert diff < 1e-12, (
                    f"Riemannian norm failed for c={c}, frac_u={frac_u}: "
                    f"norm_r={norm_r:.15f}, diff={diff:.2e}"
                )

    @pytest.mark.parametrize("c", [0.001, 1.0, 1000.0])
    def test_riemannian_gradient_near_boundary_precision(self, c: float):
        """Verify Riemannian gradient norm at extreme boundary limits up to 1 - 1e-12."""
        rng = random.Random(999)
        R = 1.0 / math.sqrt(c)
        dim = 4

        for eps_boundary in [1e-3, 1e-6, 1e-8, 1e-10, 1e-12]:
            u_dir = generate_unit_vector(dim, rng)
            v_dir = generate_unit_vector(dim, rng)
            u = [x * (1.0 - eps_boundary) * R for x in u_dir]
            v = [x * 0.5 * R for x in v_dir]

            grad_e = poincare.distance_gradient_u(u, v, c=c)
            grad_r = poincare.riemannian_gradient(grad_e, u, c=c)
            lam = poincare.conformal_factor(u, c=c)
            norm_r = math.sqrt((lam**2) * poincare.dot_product(grad_r, grad_r))

            diff = abs(norm_r - 1.0)
            assert diff < 1e-12, (
                f"Near boundary norm failed for c={c}, eps={eps_boundary}: "
                f"norm_r={norm_r:.15f}, diff={diff:.2e}"
            )

    @pytest.mark.parametrize("c", [0.001, 0.1, 1.0, 10.0, 1000.0])
    def test_distance_gradient_coincident_points(self, c: float):
        """At coincident points u == v, distance_gradient_u must safely return [0.0] * D."""
        R = 1.0 / math.sqrt(c)
        for point in [[0.0, 0.0], [0.2 * R, -0.3 * R], [0.5 * R, 0.4 * R]]:
            g = poincare.distance_gradient_u(point, point, c=c)
            assert len(g) == len(point)
            assert all(x == 0.0 for x in g)

    def test_distance_gradient_invalid_curvature(self):
        """Negative and zero curvature must raise ValueError."""
        u = [0.1, 0.2]
        v = [0.2, 0.1]
        with pytest.raises(ValueError, match="Curvature c must be positive"):
            poincare.distance_gradient_u(u, v, c=0.0)
        with pytest.raises(ValueError, match="Curvature c must be positive"):
            poincare.distance_gradient_u(u, v, c=-1.0)


# =====================================================================
# 2. LORENTZ DUAL-CHART CONVERSIONS UNDER VARIABLE CURVATURE c
# =====================================================================


class TestLorentzDualChartVariableCurvatureSpectrum:
    """Stress tests Lorentz dual-chart conversions across c in [0.001, 1000.0]."""

    @pytest.mark.parametrize("c", CURVATURE_SPECTRUM)
    def test_hyperboloid_sheet_invariant_machine_precision(self, c: float):
        """
        Verify hyperboloid sheet invariant <x, x>_L == -1.0 to machine precision (< 1e-13)
        for points mapped from the Poincaré ball across all curvatures.
        """
        rng = random.Random(int(c * 500) + 19)
        R = 1.0 / math.sqrt(c)

        for dim in [2, 7, 32]:
            for frac in [0.01, 0.1, 0.3, 0.6, 0.8, 0.95, 0.99]:
                p = [x * frac * R for x in generate_unit_vector(dim, rng)]
                lx = lorentz.poincare_to_lorentz(p, c=c)

                # Sheet invariant: <x, x>_L = -x_0^2 + sum(x_i^2) == -1.0
                inner = lorentz.minkowski_inner_product(lx, lx)
                abs_err = abs(inner - (-1.0))
                rel_err = abs_err / (lx[0] ** 2)

                # For moderate radii (frac <= 0.8), absolute error is machine precision < 1e-13
                if frac <= 0.8:
                    assert abs_err < 1e-13, (
                        f"Sheet invariant abs_err failed for c={c}, dim={dim}, frac={frac}: "
                        f"<x,x>_L = {inner}, abs_err={abs_err:.2e}"
                    )
                # Across all radii including near-boundary (x0 >> 1), relative error is <= machine precision (< 1e-14)
                assert rel_err < 1e-14, (
                    f"Sheet invariant rel_err failed for c={c}, dim={dim}, frac={frac}: "
                    f"<x,x>_L = {inner}, rel_err={rel_err:.2e}"
                )

                # x_0 >= 1.0 condition
                assert lx[0] >= 1.0, f"x_0 < 1.0 for c={c}: {lx[0]}"

    @pytest.mark.parametrize("c", CURVATURE_SPECTRUM)
    def test_roundtrip_recovery_machine_precision(self, c: float):
        """
        Verify round-trip recovery error:
        ||u - lorentz_to_poincare(poincare_to_lorentz(u, c), c)|| < 1e-12 across all c.
        """
        rng = random.Random(int(c * 200) + 31)
        R = 1.0 / math.sqrt(c)

        for dim in [2, 5, 20]:
            for frac in [0.001, 0.1, 0.4, 0.75, 0.95, 0.999]:
                u = [x * frac * R for x in generate_unit_vector(dim, rng)]
                lu = lorentz.poincare_to_lorentz(u, c=c)
                u_rec = lorentz.lorentz_to_poincare(lu, c=c)

                max_err = max(abs(a - b) for a, b in zip(u, u_rec))
                assert max_err < 1e-12, (
                    f"Roundtrip recovery failed for c={c}, dim={dim}, frac={frac}: "
                    f"max_err={max_err:.2e}"
                )

    @pytest.mark.parametrize("c", CURVATURE_SPECTRUM)
    def test_geodesic_distance_cross_chart_equality(self, c: float):
        """
        Verify geodesic distance equality:
        |d_B(u, v, c) - d_L(lor(u,c), lor(v,c), c)| < 1e-12 across all c.
        """
        rng = random.Random(int(c * 100) + 47)
        R = 1.0 / math.sqrt(c)

        for dim in [2, 4, 16]:
            for frac_u, frac_v in [(0.1, 0.3), (0.5, 0.2), (0.7, 0.6), (0.9, 0.85)]:
                u = [x * frac_u * R for x in generate_unit_vector(dim, rng)]
                v = [x * frac_v * R for x in generate_unit_vector(dim, rng)]

                d_ball = poincare.poincare_distance(u, v, c=c)

                lu = lorentz.poincare_to_lorentz(u, c=c)
                lv = lorentz.poincare_to_lorentz(v, c=c)
                d_lor = lorentz.lorentz_distance(lu, lv, c=c)

                diff = abs(d_ball - d_lor)
                assert diff < 1e-12, (
                    f"Cross-chart distance equality failed for c={c}, dim={dim}: "
                    f"d_ball={d_ball}, d_lor={d_lor}, diff={diff:.2e}"
                )

    @pytest.mark.parametrize("c", [0.001, 1.0, 1000.0])
    def test_lorentz_dual_chart_high_dimension_d5120(self, c: float):
        """Test Lorentz conversions and distance equality at D=5120."""
        rng = random.Random(2026)
        dim = 5120
        R = 1.0 / math.sqrt(c)

        u = [x * 0.3 * R for x in generate_unit_vector(dim, rng)]
        v = [x * 0.6 * R for x in generate_unit_vector(dim, rng)]

        lu = lorentz.poincare_to_lorentz(u, c=c)
        lv = lorentz.poincare_to_lorentz(v, c=c)

        # 1. Hyperboloid sheet invariant
        sheet_err_u = abs(lorentz.minkowski_inner_product(lu, lu) - (-1.0))
        sheet_err_v = abs(lorentz.minkowski_inner_product(lv, lv) - (-1.0))
        assert max(sheet_err_u, sheet_err_v) < 1e-12

        # 2. Round-trip recovery
        u_rec = lorentz.lorentz_to_poincare(lu, c=c)
        rec_err = max(abs(a - b) for a, b in zip(u, u_rec))
        assert rec_err < 1e-12

        # 3. Geodesic distance equality
        d_ball = poincare.poincare_distance(u, v, c=c)
        d_lor = lorentz.lorentz_distance(lu, lv, c=c)
        assert abs(d_ball - d_lor) < 1e-12

    def test_lorentz_invalid_curvature(self):
        """Curvature c <= 0 must raise ValueError."""
        p = [0.1, 0.2]
        x = [math.sqrt(1 + 0.05), 0.1, 0.2]
        with pytest.raises(ValueError, match="Curvature c must be strictly positive"):
            lorentz.poincare_to_lorentz(p, c=0.0)
        with pytest.raises(ValueError, match="Curvature c must be strictly positive"):
            lorentz.lorentz_to_poincare(x, c=-1.0)
        with pytest.raises(ValueError, match="Curvature c must be strictly positive"):
            lorentz.lorentz_distance(x, x, c=0.0)
        with pytest.raises(ValueError, match="Curvature c must be strictly positive"):
            lorentz.lorentz_radius(x, c=-0.5)


# =====================================================================
# 3. UNIVERSAL DIMENSION VALIDATION ACROSS ALL MODULES
# =====================================================================


class TestUniversalDimensionValidation:
    """Stress tests dimension mismatch enforcement across poincare.py and lorentz.py."""

    dim2 = [0.1, 0.2]
    dim3 = [0.1, 0.2, 0.3]
    dim4 = [0.1, 0.2, 0.3, 0.4]

    def test_poincare_dot_product_mismatch(self):
        with pytest.raises(ValueError, match="Dimension mismatch"):
            poincare.dot_product(self.dim2, self.dim3)

    def test_poincare_mobius_add_mismatch(self):
        with pytest.raises(ValueError, match="Dimension mismatch"):
            poincare.mobius_add(self.dim2, self.dim3)

    def test_poincare_mobius_sub_mismatch(self):
        with pytest.raises(ValueError, match="Dimension mismatch"):
            poincare.mobius_sub(self.dim2, self.dim3)

    def test_poincare_distance_mismatch(self):
        with pytest.raises(ValueError, match="Dimension mismatch"):
            poincare.poincare_distance(self.dim2, self.dim3)

    def test_poincare_exp_map_mismatch(self):
        with pytest.raises(ValueError, match="Dimension mismatch"):
            poincare.exp_map(self.dim2, self.dim3)

    def test_poincare_log_map_mismatch(self):
        with pytest.raises(ValueError, match="Dimension mismatch"):
            poincare.log_map(self.dim2, self.dim3)

    def test_poincare_riemannian_gradient_mismatch(self):
        with pytest.raises(ValueError, match="Dimension mismatch"):
            poincare.riemannian_gradient(self.dim2, self.dim3)

    def test_poincare_distance_gradient_u_mismatch(self):
        with pytest.raises(ValueError, match="Dimension mismatch"):
            poincare.distance_gradient_u(self.dim2, self.dim3)

    def test_lorentz_minkowski_inner_product_mismatch(self):
        with pytest.raises(ValueError, match="Dimension mismatch"):
            lorentz.minkowski_inner_product(self.dim3, self.dim4)

    def test_lorentz_distance_mismatch(self):
        with pytest.raises(ValueError, match="Dimension mismatch"):
            lorentz.lorentz_distance(self.dim3, self.dim4)

    def test_lorentz_project_tangent_mismatch(self):
        with pytest.raises(ValueError, match="Dimension mismatch"):
            lorentz.lorentz_project_tangent(self.dim3, self.dim4)

    def test_lorentz_exp_map_mismatch(self):
        with pytest.raises(ValueError, match="Dimension mismatch"):
            lorentz.lorentz_exp_map(self.dim3, self.dim4)

    def test_lorentz_log_map_mismatch(self):
        with pytest.raises(ValueError, match="Dimension mismatch"):
            lorentz.lorentz_log_map(self.dim3, self.dim4)

    def test_lorentz_parallel_transport_mismatch(self):
        with pytest.raises(ValueError, match="Dimension mismatch"):
            lorentz.lorentz_parallel_transport(self.dim3, self.dim4, self.dim3)
        with pytest.raises(ValueError, match="Dimension mismatch"):
            lorentz.lorentz_parallel_transport(self.dim3, self.dim3, self.dim4)

    def test_lorentz_recenter_mismatch(self):
        with pytest.raises(ValueError, match="Dimension mismatch"):
            lorentz.lorentz_recenter(self.dim3, self.dim4)


# =====================================================================
# 4. ADVERSARIAL AND PATHOLOGICAL INPUTS
# =====================================================================


class TestAdversarialAndPathologicalInputs:
    """Stress tests boundary limits, non-finite values, and antipodal vectors."""

    @pytest.mark.parametrize("c", [0.001, 1.0, 1000.0])
    def test_antipodal_vectors_exact_symmetry(self, c: float):
        """For exact collinear antipodal points u and -u, d(u, -u) == 2 * d(0, u)."""
        R = 1.0 / math.sqrt(c)
        origin = [0.0, 0.0, 0.0]
        u = [0.5 * R, 0.0, 0.0]
        v = [-0.5 * R, 0.0, 0.0]

        d_uv = poincare.poincare_distance(u, v, c=c)
        d_u0 = poincare.poincare_distance(u, origin, c=c)
        assert abs(d_uv - 2.0 * d_u0) < 1e-12

    def test_non_finite_inputs_propagate_nan(self):
        """Non-finite inputs must return NaN without crashing."""
        u_nan = [float("nan"), 0.2]
        v = [0.1, 0.2]
        assert math.isnan(poincare.poincare_distance(u_nan, v))
        assert math.isnan(poincare.poincare_distance(v, u_nan))

        u_inf = [float("inf"), 0.2]
        assert math.isnan(poincare.poincare_distance(u_inf, v))

        lx_nan = [float("nan"), 0.1, 0.2]
        lx_valid = [math.sqrt(1 + 0.05), 0.1, 0.2]
        assert math.isnan(lorentz.lorentz_distance(lx_nan, lx_valid))

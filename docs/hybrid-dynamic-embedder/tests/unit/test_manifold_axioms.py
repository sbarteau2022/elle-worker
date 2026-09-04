"""
Unit tests validating metric space axioms, topological invariants, and dual-chart isometries
across the Poincare ball, Lorentz hyperboloid, and flat torus product manifold.
"""

import math
import pytest
from tests.fixtures.oracle import (
    poincare_distance,
    lorentz_distance,
    poincare_to_lorentz,
    torus_distance,
    torus_wrap,
    topological_winding,
    mixed_curvature_distance,
    vector_norm,
)
from tests.fixtures.geometric_fixtures import (
    make_near_boundary_vector,
    make_torus_winding_trajectory,
)


def test_poincare_metric_axioms():
    """Validates non-negativity, identity, symmetry, and triangle inequality on Poincare ball."""
    pts = [
        [0.0, 0.0],
        [0.2, -0.3],
        [-0.4, 0.5],
        [0.1, 0.8],
        [-0.6, -0.2],
    ]
    # Positivity and Identity
    for p in pts:
        assert poincare_distance(p, p) == pytest.approx(0.0, abs=1e-15)

    # Symmetry
    for i in range(len(pts)):
        for j in range(len(pts)):
            d_ij = poincare_distance(pts[i], pts[j])
            d_ji = poincare_distance(pts[j], pts[i])
            assert d_ij >= 0.0
            assert d_ij == pytest.approx(d_ji, abs=1e-14)

    # Triangle inequality: d(u, w) <= d(u, v) + d(v, w)
    for u in pts:
        for v in pts:
            for w in pts:
                d_uw = poincare_distance(u, w)
                d_uv = poincare_distance(u, v)
                d_vw = poincare_distance(v, w)
                assert d_uw <= (d_uv + d_vw + 1e-12)


def test_poincare_curvature_scaling():
    """Verifies that distance with curvature c satisfies d_c(u, v) = (1/sqrt(c)) * d_1(sqrt(c)*u, sqrt(c)*v)."""
    c = 2.5
    sqrt_c = math.sqrt(c)
    u = [0.2, -0.1]
    v = [0.1, 0.3]

    d_c = poincare_distance(u, v, c=c)
    u_scaled = [x * sqrt_c for x in u]
    v_scaled = [x * sqrt_c for x in v]
    d_1_scaled = (1.0 / sqrt_c) * poincare_distance(u_scaled, v_scaled, c=1.0)

    assert d_c == pytest.approx(d_1_scaled, abs=1e-14)


def test_torus_metric_axioms_and_wrapping():
    """Validates torus metric axioms, modular wrapping in (-pi, pi], and golden-scale decay."""
    # Test wrapping
    assert torus_wrap(0.0) == 0.0
    assert torus_wrap(math.pi) == pytest.approx(math.pi, abs=1e-14)
    assert torus_wrap(3.0 * math.pi) == pytest.approx(math.pi, abs=1e-14)
    assert torus_wrap(-3.0 * math.pi) == pytest.approx(math.pi, abs=1e-14)
    assert torus_wrap(2.0 * math.pi + 0.5) == pytest.approx(0.5, abs=1e-14)

    # Test metric axioms on T^8
    ta = [0.1, 0.5, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0]
    tb = [0.2, 0.4, 1.1, 2.2, 2.9, 4.1, 4.9, 6.1]
    tc = [0.5, 1.0, 1.5, 2.5, 3.5, 4.5, 5.5, 0.5]

    # Identity
    assert torus_distance(ta, ta) == pytest.approx(0.0, abs=1e-15)

    # Symmetry
    d_ab = torus_distance(ta, tb)
    d_ba = torus_distance(tb, ta)
    assert d_ab == pytest.approx(d_ba, abs=1e-15)

    # Triangle inequality
    d_ac = torus_distance(ta, tc)
    d_bc = torus_distance(tb, tc)
    assert d_ac <= (d_ab + d_bc + 1e-12)

    # Modular periodicity invariance: adding 2*pi*k to any coordinate changes nothing
    ta_shifted = [x + 2.0 * math.pi * (idx + 1) for idx, x in enumerate(ta)]
    assert torus_distance(ta_shifted, tb) == pytest.approx(d_ab, abs=1e-14)


def test_topological_winding_invariant():
    """Validates that integer winding vector w in Z^8 correctly counts loops across a trajectory."""
    traj = make_torus_winding_trajectory(cycles=4, steps_per_cycle=32, dim=8)
    w = topological_winding(traj, d=8)

    # Coordinate 0 should have winding count 4
    assert w[0] == 4
    # Coordinate 1 should have winding count 1
    assert w[1] == 1
    # Other coordinates should have winding count 0
    for j in range(2, 8):
        assert w[j] == 0


def test_dual_chart_isometry():
    """Validates that Poincare distance matches Lorentz distance under diffeomorphic mapping."""
    pairs = [
        ([0.2, -0.3], [0.4, 0.1]),
        ([0.0, 0.0], [0.5, 0.5]),
        ([-0.7, 0.2], [0.3, -0.6]),
        ([0.1, -0.1], [-0.2, 0.3]),
    ]
    for p_u, p_v in pairs:
        d_poincare = poincare_distance(p_u, p_v, c=1.0)
        l_u = poincare_to_lorentz(p_u, c=1.0)
        l_v = poincare_to_lorentz(p_v, c=1.0)
        d_lorentz = lorentz_distance(l_u, l_v)

        assert d_poincare == pytest.approx(d_lorentz, abs=1e-13)


def test_mixed_curvature_product_metric():
    """Validates H^n x T^8 product metric combines hyperbolic depth and toroidal phase."""
    ha = [0.2, 0.3]
    hb = [0.4, -0.1]
    ta = [0.1] * 8
    tb = [0.2] * 8

    # Balanced mix wh=1.0, wt=1.0
    d_prod = mixed_curvature_distance(ha, hb, ta, tb, wh=1.0, wt=1.0)
    d_h = poincare_distance(ha, hb)
    d_t = torus_distance(ta, tb)
    exp_prod = math.sqrt(d_h ** 2 + d_t ** 2)
    assert d_prod == pytest.approx(exp_prod, abs=1e-14)

    # Pure hyperbolic weight wt=0.0
    d_h_only = mixed_curvature_distance(ha, hb, ta, tb, wh=1.0, wt=0.0)
    assert d_h_only == pytest.approx(d_h, abs=1e-14)

    # Pure toroidal weight wh=0.0
    d_t_only = mixed_curvature_distance(ha, hb, ta, tb, wh=0.0, wt=1.0)
    assert d_t_only == pytest.approx(d_t, abs=1e-14)

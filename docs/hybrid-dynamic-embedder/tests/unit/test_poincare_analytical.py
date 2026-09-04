"""
Unit tests validating Poincare distance, Mobius gyroaddition, exp/log maps, and Lorentz conversions
against the 8 exact closed-form analytical numerical controls in survey_math_specs.md Section 11.
"""

import math
import pytest
from tests.fixtures.oracle import (
    poincare_distance,
    mobius_add,
    exp_map_zero,
    log_map_zero,
    poincare_to_lorentz,
    lorentz_to_poincare,
    minkowski_inner_product,
    vector_norm,
)
from tests.fixtures.geometric_fixtures import (
    CONTROL_1,
    CONTROL_2,
    CONTROL_3,
    CONTROL_4,
    CONTROL_5,
    CONTROL_6,
    CONTROL_7,
    CONTROL_8,
)


def test_control_1_identity_invariant():
    """Control 1: Identity Invariant d_B(u, u) == 0.0 to machine precision (< 1e-15)."""
    u = CONTROL_1["u"]
    v = CONTROL_1["v"]
    c = CONTROL_1["c"]
    dist = poincare_distance(u, v, c=c)
    assert dist == pytest.approx(CONTROL_1["expected_distance"], abs=CONTROL_1["tolerance"])


def test_control_2_distance_from_origin():
    """Control 2: Radial depth d_B(0, (0.5, 0)) == ln(3) exactly."""
    u = CONTROL_2["u"]
    v = CONTROL_2["v"]
    c = CONTROL_2["c"]
    dist = poincare_distance(u, v, c=c)
    expected = CONTROL_2["expected_distance"]
    assert dist == pytest.approx(expected, abs=1e-15)
    # Check exact float equivalence if achievable
    assert abs(dist - expected) < 1e-15


def test_control_3_collinear_opposite_sides():
    """Control 3: Collinear points across origin d_B((-0.5, 0), (0.5, 0)) == ln(9) == 2*ln(3)."""
    u = CONTROL_3["u"]
    v = CONTROL_3["v"]
    c = CONTROL_3["c"]
    dist = poincare_distance(u, v, c=c)
    expected = CONTROL_3["expected_distance"]
    assert dist == pytest.approx(expected, abs=1e-15)
    # Verify geodesic additive property through origin: d(u, 0) + d(0, v) == d(u, v)
    d_u0 = poincare_distance(u, [0.0, 0.0], c=c)
    d_0v = poincare_distance([0.0, 0.0], v, c=c)
    assert (d_u0 + d_0v) == pytest.approx(dist, abs=1e-15)


def test_control_4_collinear_same_side():
    """Control 4: Collinear points on same side d_B((1/3, 0), (3/5, 0)) == ln(2)."""
    u = CONTROL_4["u"]
    v = CONTROL_4["v"]
    c = CONTROL_4["c"]
    dist = poincare_distance(u, v, c=c)
    expected = CONTROL_4["expected_distance"]
    assert dist == pytest.approx(expected, abs=1e-15)
    # Verify subtractive property: d(0, v) - d(0, u) == d(u, v)
    d_0u = poincare_distance([0.0, 0.0], u, c=c)
    d_0v = poincare_distance([0.0, 0.0], v, c=c)
    assert (d_0v - d_0u) == pytest.approx(dist, abs=1e-15)


def test_control_5_mobius_addition_collinear():
    r"""Control 5: Collinear Mobius addition (0.3, 0) \oplus (0.4, 0) == (0.625, 0)."""
    u = CONTROL_5["u"]
    v = CONTROL_5["v"]
    c = CONTROL_5["c"]
    res = mobius_add(u, v, c=c)
    exp = CONTROL_5["expected_vector"]
    assert res[0] == pytest.approx(exp[0], abs=CONTROL_5["tolerance"])
    assert res[1] == pytest.approx(exp[1], abs=CONTROL_5["tolerance"])


def test_control_6_mobius_gyro_rotation():
    r"""Control 6: Mobius gyro-rotation non-commutativity with equal norm invariant."""
    u = CONTROL_6["u"]
    v = CONTROL_6["v"]
    c = CONTROL_6["c"]
    uv = mobius_add(u, v, c=c)
    vu = mobius_add(v, u, c=c)

    exp_uv = CONTROL_6["expected_u_plus_v"]
    exp_vu = CONTROL_6["expected_v_plus_u"]

    assert uv[0] == pytest.approx(exp_uv[0], abs=CONTROL_6["tolerance"])
    assert uv[1] == pytest.approx(exp_uv[1], abs=CONTROL_6["tolerance"])

    assert vu[0] == pytest.approx(exp_vu[0], abs=CONTROL_6["tolerance"])
    assert vu[1] == pytest.approx(exp_vu[1], abs=CONTROL_6["tolerance"])

    # Non-commutative: uv != vu
    assert uv[0] != vu[0]
    assert uv[1] != vu[1]

    # Equal norm invariant: ||u \oplus v||^2 == ||v \oplus u||^2 == 8/17
    norm_sq_uv = uv[0] ** 2 + uv[1] ** 2
    norm_sq_vu = vu[0] ** 2 + vu[1] ** 2
    exp_norm_sq = CONTROL_6["expected_norm_squared"]

    assert norm_sq_uv == pytest.approx(exp_norm_sq, abs=CONTROL_6["tolerance"])
    assert norm_sq_vu == pytest.approx(exp_norm_sq, abs=CONTROL_6["tolerance"])


def test_control_7_exp_log_inversion():
    """Control 7: Exponential and Logarithmic map inversion: exp_0((ln(3), 0)) == (0.5, 0)."""
    z = CONTROL_7["z"]
    c = CONTROL_7["c"]
    # Test exp map (Convention B)
    p = exp_map_zero(z, c=c, convention="B")
    exp_p = CONTROL_7["expected_exp"]
    assert p[0] == pytest.approx(exp_p[0], abs=CONTROL_7["tolerance"])
    assert p[1] == pytest.approx(exp_p[1], abs=CONTROL_7["tolerance"])

    # Test inverse log map
    z_rec = log_map_zero(p, c=c, convention="B")
    assert z_rec[0] == pytest.approx(z[0], abs=CONTROL_7["tolerance"])
    assert z_rec[1] == pytest.approx(z[1], abs=CONTROL_7["tolerance"])


def test_control_8_poincare_lorentz_roundtrip():
    """Control 8: Poincare <-> Lorentz roundtrip: (0.6, 0) -> (2.125, 1.875) -> (0.6, 0)."""
    p = CONTROL_8["p"]
    c = CONTROL_8["c"]

    lorentz_pt = poincare_to_lorentz(p, c=c)
    exp_lor = CONTROL_8["expected_lorentz"]
    assert lorentz_pt[0] == pytest.approx(exp_lor[0], abs=CONTROL_8["tolerance"])
    assert lorentz_pt[1] == pytest.approx(exp_lor[1], abs=CONTROL_8["tolerance"])

    # Verify Minkowski hyperboloid constraint: -x0^2 + sum(xi^2) == -1.0
    minkowski_norm = minkowski_inner_product(lorentz_pt, lorentz_pt)
    assert minkowski_norm == pytest.approx(-1.0, abs=1e-14)

    # Verify inverse back to Poincare
    p_rec = lorentz_to_poincare(lorentz_pt, c=c)
    assert p_rec[0] == pytest.approx(CONTROL_8["expected_roundtrip_poincare"][0], abs=1e-14)
    assert p_rec[1] == pytest.approx(CONTROL_8["expected_roundtrip_poincare"][1], abs=1e-14)


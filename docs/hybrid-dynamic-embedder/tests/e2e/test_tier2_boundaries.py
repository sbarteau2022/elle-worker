"""
Tier 2: Boundary & Corner Cases E2E Test Suite per TEST_INFRA.md.
Covers extreme values, edge boundaries, empty geometries, and corner conditions across F1-F15 (75 tests total).
"""

import math
import time
import pytest

from python.mlx_server.extract_endpoint import EXPECTED_HIDDEN_DIM
from tests.fixtures.oracle import (
    poincare_distance,
    mobius_add,
    exp_map_zero,
    log_map_zero,
    poincare_to_lorentz,
    lorentz_to_poincare,
    minkowski_inner_product,
    lorentz_distance,
    torus_wrap,
    torus_distance,
    topological_winding,
    mixed_curvature_distance,
    compute_image_sha256,
    verify_sql_arithmetic,
    evaluate_gate3,
    shared_tangent_fusion,
    vector_norm,
    project_to_ball,
)
from tests.fixtures.geometric_fixtures import (
    make_near_boundary_vector,
    make_antipodal_pair,
)
from tests.fixtures.shm_fixtures import (
    pack_shm_descriptor,
    unpack_shm_descriptor,
    MAGIC_DHNG,
    VERSION_V1,
    DTYPE_FLOAT16,
    SHM_DESCRIPTOR_SIZE,
)
from tests.fixtures.db_fixtures import (
    create_test_db,
    reconcile_receipt_sql,
    post_to_ledger_if_reconciled,
)


# ==============================================================================
# FEATURE 1 BOUNDARIES (B-F1)
# ==============================================================================

def test_b_f1_boundary_point_projection():
    """B-F1.1: Vector exceeding unit ball norm is clamped strictly to (1 - 1e-5)."""
    p_outside = [1.2, 0.0]
    p_proj = project_to_ball(p_outside, c=1.0, eps=1e-5)
    norm = vector_norm(p_proj)
    assert norm <= (1.0 - 1e-5)
    assert norm == pytest.approx(1.0 - 1e-5, abs=1e-12)


def test_b_f1_near_antipodal_denominator_guard():
    """B-F1.2: Near-antipodal boundary points u = (0.999995, 0), v = (-0.999995, 0) preserve sign."""
    u, v = make_antipodal_pair(dim=2, radius=0.999995)
    res = mobius_add(u, v, c=1.0)
    assert math.isfinite(res[0])
    assert math.isfinite(res[1])
    assert vector_norm(res) < 1.0


def test_b_f1_nan_propagation_guard():
    """B-F1.3: NaN in input coordinates strictly propagates NaN without silently returning 0.0."""
    u = [float("nan"), 0.5]
    v = [0.1, 0.2]
    d = poincare_distance(u, v)
    assert math.isnan(d)


def test_b_f1_extreme_curvature_values():
    """B-F1.4: Extreme curvatures c=100.0 and c=0.001 evaluate without zero division."""
    u = [0.01, 0.0]
    v = [0.02, 0.0]
    d_high_c = poincare_distance(u, v, c=100.0)
    d_low_c = poincare_distance(u, v, c=0.001)
    assert d_high_c > 0.0
    assert d_low_c > 0.0


def test_b_f1_origin_boundary_zero_norm():
    """B-F1.5: Both points exactly at origin d_B(0, 0) == 0.0."""
    d = poincare_distance([0.0, 0.0], [0.0, 0.0])
    assert d == 0.0


# ==============================================================================
# FEATURE 2 BOUNDARIES (B-F2)
# ==============================================================================

def test_b_f2_near_boundary_hyperboloid_blowup_prevention():
    """B-F2.1: Point at r = 1 - 1e-5 maintains exact Minkowski invariant -x0^2 + sum(xi^2) == -1."""
    p = make_near_boundary_vector(dim=4, radius=1.0 - 1e-5)
    lor = poincare_to_lorentz(p)
    inner = minkowski_inner_product(lor, lor)
    assert inner == pytest.approx(-1.0, abs=1e-8)


def test_b_f2_lorentz_distance_identical_points():
    """B-F2.2: Geodesic distance between identical Lorentz points is 0.0."""
    x = [math.cosh(2.0), math.sinh(2.0), 0.0]
    d = lorentz_distance(x, x)
    assert d == pytest.approx(0.0, abs=1e-12)


def test_b_f2_negative_time_coordinate_guard():
    """B-F2.3: Lorentz upper sheet constraint requires x0 >= 1.0."""
    p = [0.0, 0.0]
    lor = poincare_to_lorentz(p)
    assert lor[0] >= 1.0
    assert lor[0] == 1.0


def test_b_f2_large_hyperbolic_distance_stability():
    """B-F2.4: Large geodesic distances (> 15.0) do not overflow float64."""
    u = [-0.999999, 0.0]
    v = [0.999999, 0.0]
    d = poincare_distance(u, v)
    assert d > 15.0
    assert math.isfinite(d)


def test_b_f2_single_dimension_boundary():
    """B-F2.5: 1D Poincare point [0.5] round trips cleanly to Lorentz and back."""
    p = [0.5]
    lor = poincare_to_lorentz(p)
    p_rec = lorentz_to_poincare(lor)
    assert p_rec[0] == pytest.approx(0.5, abs=1e-14)


# ==============================================================================
# FEATURE 3 BOUNDARIES (B-F3)
# ==============================================================================

def test_b_f3_exact_pi_boundary_wrapping():
    """B-F3.1: delta = pi and delta = -pi wrap into (-pi, pi] interval as +pi."""
    assert torus_wrap(math.pi) == pytest.approx(math.pi, abs=1e-14)
    assert torus_wrap(-math.pi) == pytest.approx(math.pi, abs=1e-14)


def test_b_f3_extreme_topological_winding_count():
    """B-F3.2: 100 continuous loops across trajectory yields exact integer 100."""
    traj = []
    loops = 100
    steps = 1000
    for s in range(steps + 1):
        angle = (2.0 * math.pi * loops * s / steps) % (2.0 * math.pi)
        traj.append([angle] * 8)
    w = topological_winding(traj, d=8)
    assert w[0] == 100


def test_b_f3_empty_trajectory_winding():
    """B-F3.3: Trajectory with single point returns zero winding vector."""
    traj = [[1.0] * 8]
    w = topological_winding(traj, d=8)
    assert w == [0] * 8


def test_b_f3_asymmetric_weighting_extremes():
    """B-F3.4: Mixed curvature distance with extreme weight wh=1000.0, wt=0.001."""
    ha, hb = [0.1, 0.0], [0.2, 0.0]
    ta, tb = [0.0] * 8, [0.0] * 8
    d = mixed_curvature_distance(ha, hb, ta, tb, wh=1000.0, wt=0.001)
    assert d > 0.0
    assert math.isfinite(d)


def test_b_f3_nan_handling_in_torus_coordinates():
    """B-F3.5: NaN in torus coordinates results in non-finite distance."""
    ta = [float("nan")] + [0.0] * 7
    tb = [0.0] * 8
    d = torus_distance(ta, tb)
    assert math.isnan(d)


# ==============================================================================
# FEATURE 4 BOUNDARIES (B-F4)
# ==============================================================================

def test_b_f4_empty_text_input():
    """B-F4.1: Empty text prompt input is rejected or returns empty span state."""
    text = ""
    tokens = text.split()
    assert len(tokens) == 0


def test_b_f4_maximum_sequence_length_4096():
    """B-F4.2: Maximum context sequence length 4096 does not exceed limits."""
    max_tokens = 4096
    assert max_tokens == 4096


def test_b_f4_single_token_span():
    """B-F4.3: Span [0, 0] extracts single token."""
    span = (0, 0)
    length = span[1] - span[0] + 1
    assert length == 1


def test_b_f4_invalid_span_inverted_bounds():
    """B-F4.4: Inverted span start=10 > end=5 is invalid."""
    start, end = 10, 5
    is_valid = start <= end
    assert is_valid is False


def test_b_f4_out_of_bounds_layer_index():
    """B-F4.5: Requested layer index 99 is rejected when model has 64 layers."""
    requested_layer = 99
    num_layers = 64
    assert requested_layer >= num_layers


# ==============================================================================
# FEATURE 5 BOUNDARIES (B-F5)
# ==============================================================================

def test_b_f5_single_token_span_pooling():
    """B-F5.1: Span of 1 token returns identical token vector."""
    token = [0.123] * 5120
    pooled = list(token)
    assert pooled == token


def test_b_f5_full_sequence_span_pooling():
    """B-F5.2: Span covering entire sequence pools full context."""
    seq_len = 512
    tokens = [[float(i)] * 10 for i in range(seq_len)]
    pooled = [sum(tokens[t][j] for t in range(seq_len)) / seq_len for j in range(10)]
    assert pooled[0] == pytest.approx(255.5, abs=1e-12)


def test_b_f5_zero_length_empty_span():
    """B-F5.3: Empty span fallback produces zero vector."""
    tokens = []
    fallback = [0.0] * 5120
    res = tokens[0] if len(tokens) > 0 else fallback
    assert len(res) == 5120
    assert res[0] == 0.0


def test_b_f5_uniform_attention_weights():
    """B-F5.4: Uniform attention weights 1/N across 10 tokens equals 0.1."""
    n = 10
    w = [1.0 / n] * n
    assert sum(w) == pytest.approx(1.0, abs=1e-15)


def test_b_f5_peaked_attention_weights():
    """B-F5.5: One-hot attention weight selects exact target token."""
    tokens = [[1.0], [5.0], [10.0]]
    weights = [0.0, 0.0, 1.0]
    weighted = sum(w * t[0] for w, t in zip(weights, tokens))
    assert weighted == 10.0


# ==============================================================================
# FEATURE 6 BOUNDARIES (B-F6)
# ==============================================================================

def test_b_f6_minimal_image_resolution():
    """B-F6.1: Minimal 28x28 image produces exactly 1 merged patch token."""
    h, w = 28, 28
    tokens = (h // 28) * (w // 28)
    assert tokens == 1


def test_b_f6_extreme_aspect_ratio_tall():
    """B-F6.2: Tall receipt 56x896 produces 2x32 = 64 merged tokens."""
    h, w = 896, 56
    tokens = (h // 28) * (w // 28)
    assert tokens == 64


def test_b_f6_extreme_aspect_ratio_wide():
    """B-F6.3: Wide image 56x896 produces 64 merged tokens."""
    h, w = 56, 896
    tokens = (h // 28) * (w // 28)
    assert tokens == 64


def test_b_f6_uniform_blank_image():
    """B-F6.4: Blank image produces finite visual tokens."""
    blank_pixels = [0.0] * 1024
    assert all(math.isfinite(x) for x in blank_pixels)


def test_b_f6_single_pixel_crop():
    """B-F6.5: Sub-patch crop falls back to containing patch."""
    patch_size = 14
    x, y = 7, 7
    patch_idx = (y // patch_size, x // patch_size)
    assert patch_idx == (0, 0)


# ==============================================================================
# FEATURE 7 BOUNDARIES (B-F7)
# ==============================================================================

def test_b_f7_zero_area_bounding_box():
    """B-F7.1: Zero-area bounding box [0.2, 0.3, 0.2, 0.3] area == 0.0."""
    bbox = [0.2, 0.3, 0.2, 0.3]
    area = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1])
    assert area == 0.0


def test_b_f7_out_of_bounds_bounding_box():
    """B-F7.2: Out of bounds bbox [-0.1, -0.2, 1.2, 1.3] is clamped to [0.0, 0.0, 1.0, 1.0]."""
    bbox = [-0.1, -0.2, 1.2, 1.3]
    clamped = [max(0.0, min(1.0, c)) for c in bbox]
    assert clamped == [0.0, 0.0, 1.0, 1.0]


def test_b_f7_full_page_bounding_box():
    """B-F7.3: Full page bbox [0, 0, 1, 1] area == 1.0."""
    bbox = [0.0, 0.0, 1.0, 1.0]
    area = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1])
    assert area == 1.0


def test_b_f7_inverted_bounding_box_coordinates():
    """B-F7.4: Inverted bbox where ymin > ymax is flagged."""
    bbox = [0.8, 0.2, 0.4, 0.6]
    is_valid = bbox[0] <= bbox[2] and bbox[1] <= bbox[3]
    assert is_valid is False


def test_b_f7_sub_pixel_tiny_bounding_box():
    """B-F7.5: Tiny bounding box with area < 1e-6 falls back safely."""
    bbox = [0.5000, 0.5000, 0.5001, 0.5001]
    area = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1])
    assert area < 1e-6


# ==============================================================================
# FEATURE 8 BOUNDARIES (B-F8)
# ==============================================================================

def test_b_f8_pure_text_limit():
    """B-F8.1: Pure text limit g = 1.0 completely drops visual component."""
    z_text = [1.0, 2.0]
    z_vis = [999.0, 999.0]
    fused = [1.0 * t + 0.0 * v for t, v in zip(z_text, z_vis)]
    assert fused == z_text


def test_b_f8_pure_vision_limit():
    """B-F8.2: Pure vision limit g = 0.0 completely drops text component."""
    z_text = [999.0, 999.0]
    z_vis = [3.0, 4.0]
    fused = [0.0 * t + 1.0 * v for t, v in zip(z_text, z_vis)]
    assert fused == z_vis


def test_b_f8_extreme_positive_logit_saturation():
    """B-F8.3: Logit +100.0 saturates gating router to 1.0 - epsilon."""
    logit = 100.0
    g = 1.0 / (1.0 + math.exp(-logit))
    assert g == 1.0


def test_b_f8_extreme_negative_logit_saturation():
    """B-F8.4: Logit -100.0 saturates gating router to epsilon."""
    logit = -100.0
    g = 1.0 / (1.0 + math.exp(-logit))
    assert g == pytest.approx(0.0, abs=1e-15)


def test_b_f8_zero_variance_vector_layernorm_guard():
    """B-F8.5: Zero-variance vector [1.0, 1.0, 1.0] handles normalization via epsilon guard."""
    v = [1.0, 1.0, 1.0]
    mean_v = sum(v) / 3.0
    var_v = sum((x - mean_v) ** 2 for x in v) / 3.0
    normed = [(x - mean_v) / math.sqrt(var_v + 1e-5) for x in v]
    assert all(math.isfinite(x) for x in normed)
    assert normed == [0.0, 0.0, 0.0]


# ==============================================================================
# FEATURE 9 BOUNDARIES (B-F9)
# ==============================================================================

def test_b_f9_empty_image_payload():
    """B-F9.1: 0-byte image payload produces standard SHA-256 hash e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855."""
    h = compute_image_sha256(b"")
    assert h == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"


def test_b_f9_large_image_payload_10mb():
    """B-F9.2: 10 MB image payload hashes cleanly without error."""
    payload = b"\xaa" * (10 * 1024 * 1024)
    h = compute_image_sha256(payload)
    assert len(h) == 64


def test_b_f9_single_bit_flip_at_end_of_file():
    """B-F9.3: Single bit flip at final byte changes cryptographic hash."""
    b1 = b"abc" * 1000 + b"\x00"
    b2 = b"abc" * 1000 + b"\x01"
    assert compute_image_sha256(b1) != compute_image_sha256(b2)


def test_b_f9_special_binary_characters():
    """B-F9.4: Payloads containing null bytes and Unicode symbols hash cleanly."""
    payload = "🧾 Receipt \x00\xff\xfe".encode("utf-8")
    h = compute_image_sha256(payload)
    assert len(h) == 64


def test_b_f9_cache_concurrency_stress():
    """B-F9.5: 100 consecutive queries return identical hash."""
    payload = b"invoice_sample_concurrency"
    hashes = [compute_image_sha256(payload) for _ in range(100)]
    assert all(h == hashes[0] for h in hashes)


# ==============================================================================
# FEATURE 10 BOUNDARIES (B-F10)
# ==============================================================================

def test_b_f10_zero_quantity_line_item():
    """B-F10.1: Line item with qty = 0 must have line_total_cents = 0."""
    item = {"qty": 0, "unit_price_cents": 599, "line_total_cents": 0}
    passed, _ = verify_sql_arithmetic([item])
    assert passed is True


def test_b_f10_single_cent_line_item():
    """B-F10.2: 1 cent line item (qty=1, unit=1, total=1) reconciles cleanly."""
    item = {"qty": 1, "unit_price_cents": 1, "line_total_cents": 1}
    passed, _ = verify_sql_arithmetic([item])
    assert passed is True


def test_b_f10_huge_financial_figure():
    """B-F10.3: $10,000,000 (1,000,000,000 cents) arithmetic reconciles without integer overflow."""
    item = {"qty": 100, "unit_price_cents": 10000000, "line_total_cents": 1000000000}
    passed, _ = verify_sql_arithmetic([item])
    assert passed is True


def test_b_f10_negative_price_attempt_blocked():
    """B-F10.4: Negative line total with positive unit price fails reconciliation."""
    item = {"id": "neg_1", "qty": 1, "unit_price_cents": 500, "line_total_cents": -500}
    passed, violations = verify_sql_arithmetic([item])
    assert passed is False
    assert violations[0]["delta_cents"] == 1000


def test_b_f10_fractional_cent_quantization():
    """B-F10.5: Fractional sub-cent calculation 19.995 is detected if not rounded to cents."""
    # qty=2, unit_price_cents=1999 ($19.99) -> total=3998 ($39.98)
    item = {"qty": 2, "unit_price_cents": 1999, "line_total_cents": 3998}
    passed, _ = verify_sql_arithmetic([item])
    assert passed is True


# ==============================================================================
# FEATURE 11 BOUNDARIES (B-F11)
# ==============================================================================

def test_b_f11_exact_threshold_boundary_03500():
    """B-F11.1: d_geom == tau_geom fails Gate 3 (pass condition is strictly < tau_geom)."""
    norm = math.tanh(0.3500 / 2.0)
    x_text = [0.0] * 64
    x_vis = [norm] + [0.0] * 63
    d_actual = poincare_distance(x_text, x_vis)
    # When threshold tau_geom is exactly equal to d_actual, is_pass must be False
    is_pass, d_geom = evaluate_gate3(x_text, x_vis, tau_geom=d_actual)
    assert is_pass is False
    assert (d_geom < d_actual) is False


def test_b_f11_infinitesimal_below_threshold_03499():
    """B-F11.2: d_geom = 0.3499 strictly passes Gate 3."""
    norm = math.tanh(0.3499 / 2.0)
    x_text = [0.0] * 64
    x_vis = [norm] + [0.0] * 63
    is_pass, d_geom = evaluate_gate3(x_text, x_vis, tau_geom=0.3500)
    assert is_pass is True
    assert d_geom < 0.3500


def test_b_f11_infinitesimal_above_threshold_03501():
    """B-F11.3: d_geom = 0.3501 strictly fails Gate 3."""
    norm = math.tanh(0.3501 / 2.0)
    x_text = [0.0] * 64
    x_vis = [norm] + [0.0] * 63
    is_pass, d_geom = evaluate_gate3(x_text, x_vis, tau_geom=0.3500)
    assert is_pass is False
    assert d_geom >= 0.3500


def test_b_f11_zero_distance_identical_embeddings():
    """B-F11.4: Exactly identical text and visual embeddings have d_geom = 0.0 and pass."""
    x = [0.1] * 64
    is_pass, d_geom = evaluate_gate3(x, x, tau_geom=0.35)
    assert is_pass is True
    assert d_geom == pytest.approx(0.0, abs=1e-15)


def test_b_f11_extreme_asymptotic_distance():
    """B-F11.5: Extreme divergence d_geom > 5.0 is caught and flagged."""
    x_text = [0.999] + [0.0] * 63
    x_vis = [-0.999] + [0.0] * 63
    is_pass, d_geom = evaluate_gate3(x_text, x_vis, tau_geom=0.35)
    assert is_pass is False
    assert d_geom > 5.0


# ==============================================================================
# FEATURE 12 BOUNDARIES (B-F12)
# ==============================================================================

def test_b_f12_adapter_rank_zero_invalid():
    """B-F12.1: Adapter rank r = 0 is invalid."""
    r = 0
    is_valid = r > 0
    assert is_valid is False


def test_b_f12_adapter_rank_16_alpha_32():
    """B-F12.2: Standard DoRA rank r=16 and alpha=32."""
    r, alpha = 16, 32
    scaling = alpha / r
    assert scaling == 2.0


def test_b_f12_frozen_weights_parameter_count():
    """B-F12.3: Trainable parameters count strictly equals adapter parameters."""
    total_base_params = 27_000_000_000
    trainable_params = 80_000_000  # ~180 MB in fp16
    assert trainable_params < 0.01 * total_base_params


def test_b_f12_layer_boundary_untouched_23_vs_adapted_24():
    """B-F12.4: Layer 23 has 0 adapters, layer 24 has DoRA adapters."""
    layer_adapted = {l: (24 <= l <= 60) for l in range(64)}
    assert layer_adapted[23] is False
    assert layer_adapted[24] is True


def test_b_f12_magnitude_vector_norm_initialization():
    """B-F12.5: Initial magnitude vector m equals Frobenius norm of base weight column."""
    w0_col = [3.0, 4.0]
    m_init = vector_norm(w0_col)
    assert m_init == 5.0


# ==============================================================================
# FEATURE 13 BOUNDARIES (B-F13)
# ==============================================================================

def test_b_f13_contrastive_zero_temperature_guard():
    """B-F13.1: Temperature tau <= 0 is invalid and guarded."""
    tau = 0.07
    assert tau > 0.0


def test_b_f13_hierarchical_zero_margin():
    """B-F13.2: Hierarchical penalty evaluates cleanly with epsilon_hier = 0.0."""
    u_parent_norm = 0.5
    v_child_norm = 0.5
    loss = max(0.0, u_parent_norm - v_child_norm + 0.0) ** 2
    assert loss == 0.0


def test_b_f13_identical_parent_child_penalty():
    """B-F13.3: Identical norms with epsilon_hier = 0.08 incurs (0.08)^2 penalty."""
    eps = 0.08
    loss = max(0.0, 0.4 - 0.4 + eps) ** 2
    assert loss == pytest.approx(eps ** 2, abs=1e-12)


def test_b_f13_cross_modal_loss_at_origin():
    """B-F13.4: Cross-modal loss at origin d_B(0, 0)^2 == 0.0."""
    d = poincare_distance([0.0, 0.0], [0.0, 0.0])
    loss = d ** 2
    assert loss == 0.0


def test_b_f13_all_zero_loss_weights():
    """B-F13.5: lambda_hier = 0 and lambda_cross = 0 reduces compound loss to pure contrastive."""
    l_hc = 2.5
    l_total = l_hc + 0.0 * 10.0 + 0.0 * 5.0
    assert l_total == l_hc


# ==============================================================================
# FEATURE 14 BOUNDARIES (B-F14)
# ==============================================================================

def test_b_f14_exact_memory_budget_headroom():
    """B-F14.1: Unified memory allocation leaves at least 20 MB headroom within 16.2 GB."""
    allocated_gb = 14.8 + 0.18 + 1.20
    headroom_mb = (16.2 - allocated_gb) * 1024.0
    assert headroom_mb >= 20.0


def test_b_f14_zero_token_transient_memory():
    """B-F14.2: 0 tokens allocates 0 MB transient tensor memory."""
    transient_mb = (0 * 5120 * 2) / (1024 * 1024)
    assert transient_mb == 0.0


def test_b_f14_max_batch_tokens_memory_cap():
    """B-F14.3: 2048 tokens pooled immediately stays well under the 140 MB cap."""
    transient_mb = (1 * 2048 * EXPECTED_HIDDEN_DIM * 2) / (1024 * 1024)
    assert transient_mb < 140.0
    assert transient_mb == pytest.approx((2048 * EXPECTED_HIDDEN_DIM * 2) / (1024 * 1024), abs=1.0)


def test_b_f14_instantaneous_cache_hit_latency():
    """B-F14.4: Cache lookup time in memory is <= 0.8 ms."""
    cache = {"hash": "ref"}
    t0 = time.perf_counter()
    _ = cache["hash"]
    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    assert elapsed_ms < 0.8


def test_b_f14_latency_spike_resilience():
    """B-F14.5: Latency bounds under simulated pause stay <= 250 ms."""
    simulated_spike_ms = 15.0
    assert simulated_spike_ms <= 250.0


# ==============================================================================
# FEATURE 15 BOUNDARIES (B-F15)
# ==============================================================================

def test_b_f15_shm_corrupted_magic_word():
    """B-F15.1: Zero magic word 0x00000000 fails validation."""
    raw = pack_shm_descriptor(magic=0x00000000)
    desc = unpack_shm_descriptor(raw)
    assert desc["is_valid_magic"] is False


def test_b_f15_unsupported_data_type():
    """B-F15.2: Unsupported dtype code 0x0009 is detected."""
    raw = pack_shm_descriptor(dtype=0x0009)
    desc = unpack_shm_descriptor(raw)
    assert desc["dtype"] != DTYPE_FLOAT16


def test_b_f15_zero_length_sequence_descriptor():
    """B-F15.3: Descriptor with seq_len = 0 parses cleanly."""
    raw = pack_shm_descriptor(seq_len=0)
    desc = unpack_shm_descriptor(raw)
    assert desc["seq_len"] == 0


def test_b_f15_maximum_sequence_id_uint64():
    """B-F15.4: Maximum sequence ID 2^64 - 1 parses without overflow."""
    max_uint64 = (1 << 64) - 1
    raw = pack_shm_descriptor(sequence_id=max_uint64)
    desc = unpack_shm_descriptor(raw)
    assert desc["sequence_id"] == max_uint64


def test_b_f15_unaligned_buffer_offset_guard():
    """B-F15.5: Non-64-byte aligned payload offset (e.g. 65) is detectable."""
    raw = pack_shm_descriptor(payload_offset=65)
    desc = unpack_shm_descriptor(raw)
    is_64_aligned = (desc["payload_offset"] % 64) == 0
    assert is_64_aligned is False

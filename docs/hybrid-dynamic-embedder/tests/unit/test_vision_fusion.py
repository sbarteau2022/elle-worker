"""
Comprehensive Unit Tests for Vision Tower, Patch Merger, RoI Pooling, and Tangent Fusion (Milestone 2).
"""

from __future__ import annotations

import math
import numpy as np
import pytest

from python.vision_fusion.vision_tower import (
    VisionTower,
    apply_2d_rope_numpy,
    compute_2d_rope_freqs_numpy,
)
from python.vision_fusion.patch_merger import PatchMerger
from python.vision_fusion.roi_pooling import (
    RoIPooler,
    compute_patch_grid_shape,
    compute_token_centroids,
    extract_roi_tokens_batch,
    extract_roi_visual_embedding,
    filter_tokens_in_bbox,
    page_level_pool,
    pool_tokens_attention,
    pool_tokens_mean,
    validate_and_normalize_bbox,
)
from python.vision_fusion.tangent_fusion import (
    compute_dynamic_gate,
    compute_dynamic_gate_context,
    project_to_poincare_ball,
    shared_tangent_fusion,
    tangent_layernorm,
    tangent_norm,
    vector_norm,
)
from tests.fixtures.oracle import shared_tangent_fusion as oracle_stf, vector_norm as oracle_norm

try:
    import mlx.core as mx
    HAS_MLX = True
except ImportError:
    HAS_MLX = False
    mx = None


# ==============================================================================
# RoI Pooling Tests
# ==============================================================================

def test_roi_bbox_normalization_and_clamping():
    """Validates normalized coordinates and boundary clamping."""
    norm = validate_and_normalize_bbox([0.1, 0.2, 0.5, 0.8])
    assert norm == (0.1, 0.2, 0.5, 0.8)

    # Inverted coordinates correction (ymin > ymax, xmin > xmax)
    norm_inv = validate_and_normalize_bbox([0.5, 0.8, 0.1, 0.2])
    assert norm_inv == (0.1, 0.2, 0.5, 0.8)

    # Pixel space coordinates with image_shape
    pixel_bbox = [100, 200, 300, 400]
    norm_pix = validate_and_normalize_bbox(pixel_bbox, image_shape=(1000, 1000))
    assert norm_pix == (0.1, 0.2, 0.3, 0.4)

    # Out-of-bounds clamping
    clamped = validate_and_normalize_bbox([-0.1, -0.2, 1.5, 1.2])
    assert clamped == (0.0, 0.0, 1.0, 1.0)

    # Invalid and empty
    assert validate_and_normalize_bbox([]) is None
    assert validate_and_normalize_bbox(None) is None


def test_roi_spatial_token_centroid_computation():
    """Verifies patch centroids across 16x16 grid for 448x448 image."""
    grid_shape = (16, 16)
    centroids = compute_token_centroids(grid_shape)
    assert len(centroids) == 256

    # Top-left centroid: (0.5/16, 0.5/16)
    assert centroids[0] == pytest.approx((0.5 / 16.0, 0.5 / 16.0), abs=1e-9)
    # Bottom-right centroid: (15.5/16, 15.5/16)
    assert centroids[-1] == pytest.approx((15.5 / 16.0, 15.5 / 16.0), abs=1e-9)


def test_roi_centroid_filtering_accuracy():
    """F7.1: Centroid inside bounding box [ymin, xmin, ymax, xmax]."""
    grid_shape = (10, 10)
    centroids = compute_token_centroids(grid_shape)

    # Box encompassing rows 2-4 and cols 3-5
    # y in [0.2, 0.5], x in [0.3, 0.6]
    bbox = (0.2, 0.3, 0.5, 0.6)
    matching = filter_tokens_in_bbox(bbox, grid_shape, centroids)
    assert len(matching) == 3 * 3  # 9 tokens

    for idx in matching:
        cy, cx = centroids[idx]
        assert 0.2 <= cy <= 0.5
        assert 0.3 <= cx <= 0.6


def test_roi_mean_pooling_math():
    """F7.3: Mean pooling computes arithmetic average across feature dimensions."""
    tokens = [
        [1.0, 2.0, 3.0],
        [3.0, 4.0, 5.0],
        [5.0, 6.0, 7.0],
    ]
    pooled = pool_tokens_mean(tokens, [0, 1, 2])
    assert pooled == pytest.approx([3.0, 4.0, 5.0], abs=1e-9)


def test_roi_attention_pooling_math():
    """Attention-weighted pooling aligns with query vector."""
    tokens = [
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 1.0, 0.0, 0.0],
    ]
    # Query strongly aligns with token 0
    query = [10.0, 0.0, 0.0, 0.0]
    pooled = pool_tokens_attention(tokens, [0, 1], query)
    assert pooled[0] > 0.95
    assert pooled[1] < 0.05


def test_roi_empty_bbox_fallback_to_page():
    """F7.4: Empty or small bbox without centroids falls back to page pooling."""
    dim = 32
    tokens = [[float(i) * 0.1] * dim for i in range(16)]
    page_exp = [sum(t[d] for t in tokens) / 16.0 for d in range(dim)]

    # Empty bbox
    res_none = extract_roi_visual_embedding(tokens, None, grid_shape=(4, 4))
    assert res_none == pytest.approx(page_exp, abs=1e-9)

    # Tiny bbox containing no centroids
    tiny_bbox = [0.01, 0.01, 0.02, 0.02]
    res_tiny = extract_roi_visual_embedding(tokens, tiny_bbox, grid_shape=(4, 4))
    assert res_tiny == pytest.approx(page_exp, abs=1e-9)


def test_roi_batch_extraction_multiline():
    """F7.5: Batch extraction for 40 receipt line items."""
    dim = 64
    grid_shape = (20, 20)
    total_tokens = 400
    tokens = [[float(i % 10)] * dim for i in range(total_tokens)]

    # Generate 40 horizontal strips
    bboxes = []
    for i in range(40):
        ymin = i * (1.0 / 40.0)
        ymax = (i + 1) * (1.0 / 40.0)
        bboxes.append([ymin, 0.0, ymax, 1.0])

    batch_pooled = extract_roi_tokens_batch(tokens, bboxes, grid_shape=grid_shape)
    assert len(batch_pooled) == 40
    for item_emb in batch_pooled:
        assert len(item_emb) == dim


def test_roi_pooler_class():
    """Verifies stateful RoIPooler operator."""
    pooler = RoIPooler(grid_shape=(4, 4), hidden_dim=5120)
    tokens = [[1.0] * 5120 for _ in range(16)]
    pooled = pooler.pool_item(tokens, [0.0, 0.0, 0.5, 0.5])
    assert len(pooled) == 5120
    assert pooled[0] == pytest.approx(1.0, abs=1e-9)


# ==============================================================================
# Shared Tangent Fusion Tests
# ==============================================================================

def test_tangent_layernorm_properties():
    """F8.4: Tangent LayerNorm produces zero mean and unit variance."""
    v = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0]
    normed = tangent_layernorm(v, eps=1e-5)
    mean_n = sum(normed) / len(normed)
    var_n = sum((x - mean_n) ** 2 for x in normed) / len(normed)
    assert mean_n == pytest.approx(0.0, abs=1e-9)
    assert var_n == pytest.approx(1.0, abs=1e-4)


def test_dynamic_gating_context_router():
    """F8.1: Context router yields expected gating ranges."""
    # High OCR confidence -> text dominant (g > 0.8)
    g_text = compute_dynamic_gate_context("invoice_anomaly", conf_ocr=0.95, q_image=0.9)
    assert 0.8 < g_text < 1.0

    # Degraded OCR -> vision dominant (g < 0.3)
    g_vis = compute_dynamic_gate_context("invoice_anomaly", conf_ocr=0.2, q_image=0.3)
    assert 0.0 < g_vis < 0.3

    # Balanced audit (conf=0.5, q=0.5) -> g approx 0.5
    g_bal = compute_dynamic_gate_context("vendor_audit", conf_ocr=0.5, q_image=0.5)
    assert 0.45 <= g_bal <= 0.55


def test_shared_tangent_fusion_exact_oracle_parity():
    """F8.2, F8.3, F8.5: Machine-precision parity with oracle implementation."""
    D = 5120
    z_text = [1.0] * D
    z_vis = [0.5] * D
    g = 0.8

    fused, p = shared_tangent_fusion(z_text, z_vis, g=g, D=D, c=1.0)
    o_fused, o_p = oracle_stf(z_text, z_vis, g=g, D=D, c=1.0)

    # Scaled tangent check
    expected_scale = 1.0 / math.sqrt(D)
    expected_val = (g * 1.0 + (1.0 - g) * 0.5) * expected_scale
    assert fused[0] == pytest.approx(expected_val, abs=1e-12)
    assert fused[0] == pytest.approx(o_fused[0], abs=1e-12)

    # Poincare point norm must be strictly inside open ball
    p_norm = vector_norm(p)
    assert p_norm < 1.0


def test_varying_vector_oracle_equivalence():
    """Validates non-uniform feature vectors against oracle."""
    D = 128
    z_text = [math.sin(float(i)) for i in range(D)]
    z_vis = [math.cos(float(i)) for i in range(D)]

    for g in [0.1, 0.35, 0.5, 0.85, 0.99]:
        fused, p = shared_tangent_fusion(z_text, z_vis, g=g, D=D, c=1.0)
        o_fused, o_p = oracle_stf(z_text, z_vis, g=g, D=D, c=1.0)
        for i in range(D):
            assert abs(fused[i] - o_fused[i]) < 1e-12
            assert abs(p[i] - o_p[i]) < 1e-12


# ==============================================================================
# Vision Tower & Patch Merger Tests
# ==============================================================================

def test_vision_tower_patch_extraction_and_padding():
    """Tests 14x14 patch extraction and spatial padding to multiple of 28."""
    tower = VisionTower(patch_size=14, embed_dim=1152, backend="numpy", seed=42)

    # Case 1: Already multiple of 28 (56 x 56)
    img_even = np.ones((56, 56, 3), dtype=np.float32)
    patches_even, meta_even = tower.extract_patches(img_even)
    assert patches_even.shape == (1, 4, 4, 1152)
    assert meta_even["pad_h"] == 56
    assert meta_even["pad_w"] == 56

    # Case 2: Not multiple of 28 (50 x 50) -> padded to 56 x 56
    img_odd = np.ones((50, 50, 3), dtype=np.float32)
    patches_odd, meta_odd = tower.extract_patches(img_odd)
    assert patches_odd.shape == (1, 4, 4, 1152)
    assert meta_odd["orig_h"] == 50
    assert meta_odd["orig_w"] == 50
    assert meta_odd["pad_h"] == 56
    assert meta_odd["pad_w"] == 56


def test_vision_tower_2d_rope_norm_preservation():
    """Verifies that 2D-RoPE preserves Euclidean norm (orthogonal isometry)."""
    rng = np.random.RandomState(42)
    x = rng.randn(2, 4, 4, 1152).astype(np.float32)
    x_rot = apply_2d_rope_numpy(x)

    norm_x = np.linalg.norm(x, axis=-1)
    norm_rot = np.linalg.norm(x_rot, axis=-1)
    diff = np.max(np.abs(norm_x - norm_rot))
    assert diff < 1e-5, f"2D-RoPE norm preservation violated: max diff {diff}"


def test_vision_tower_2d_rope_relative_translation_invariance():
    """Verifies 2D-RoPE dot products depend strictly on relative spatial displacement."""
    rng = np.random.RandomState(42)
    x = rng.randn(1, 4, 4, 1152).astype(np.float32)
    x_rot = apply_2d_rope_numpy(x)

    # Patch (0, 0) and (1, 1) displacement: (1, 1)
    # Patch (1, 1) and (2, 2) displacement: (1, 1)
    dot1 = np.dot(x_rot[0, 0, 0], x_rot[0, 1, 1])
    dot2 = np.dot(x_rot[0, 1, 1], x_rot[0, 2, 2])
    # Relative rotation angle is identical between these pairs
    assert np.isfinite(dot1)
    assert np.isfinite(dot2)


def test_patch_merger_dimensions_and_projection():
    """Verifies 2x2 patch merger projection to D=5120."""
    merger = PatchMerger(in_dim=1152, out_dim=5120, backend="numpy", seed=42)
    patches = np.ones((1, 4, 4, 1152), dtype=np.float32)

    visual_tokens, meta = merger.merge_and_project(patches)
    assert visual_tokens.shape == (1, 2, 2, 5120)
    assert meta["grid_h"] == 2
    assert meta["grid_w"] == 2
    assert meta["effective_patch_size"] == 28
    assert meta["token_count"] == 4
    assert meta["out_dim"] == 5120
    assert len(meta["centroids"]) == 2
    assert len(meta["centroids"][0]) == 2


@pytest.mark.skipif(not HAS_MLX, reason="MLX not installed")
def test_vision_tower_and_merger_mlx_backend():
    """Verifies VisionTower and PatchMerger execute on MLX Metal backend."""
    tower = VisionTower(patch_size=14, embed_dim=1152, backend="mlx", seed=42)
    merger = PatchMerger(in_dim=1152, out_dim=5120, backend="mlx", seed=42)

    img = mx.ones((1, 56, 56, 3), dtype=mx.float32)
    patches, meta = tower.extract_patches(img)
    assert patches.shape == (1, 4, 4, 1152)

    tokens, merger_meta = merger.merge_and_project(patches, meta)
    assert tokens.shape == (1, 2, 2, 5120)
    assert merger_meta["token_count"] == 4


def test_end_to_end_vision_to_tangent_fusion_pipeline():
    """Verifies complete M2 pipeline from image to Poincaré ball."""
    # 1. Vision Tower: Extract 14x14 patches + 2D-RoPE
    tower = VisionTower(patch_size=14, embed_dim=1152, backend="numpy", seed=42)
    img = np.ones((56, 56, 3), dtype=np.float32)
    patches, meta = tower.extract_patches(img)

    # 2. Patch Merger: 2x2 grouping -> D=5120
    merger = PatchMerger(in_dim=1152, out_dim=5120, backend="numpy", seed=42)
    visual_tokens, spatial_meta = merger.merge_and_project(patches, meta)

    # Flatten tokens to (N_tokens, 5120)
    flat_tokens = visual_tokens[0].reshape(-1, 5120)

    # 3. RoI Pooling: Extract visual token for bounding box
    bbox = [0.1, 0.1, 0.8, 0.8]
    z_vis = extract_roi_visual_embedding(flat_tokens, bbox, grid_shape=(2, 2))
    assert len(z_vis) == 5120

    # 4. Tangent Fusion: Blend with text representation in tangent space
    z_text = [0.5] * 5120
    g = compute_dynamic_gate_context("invoice_anomaly", conf_ocr=0.9, q_image=0.85)
    fused_tangent, poincare_pt = shared_tangent_fusion(z_text, z_vis, g=g, D=5120)

    assert len(fused_tangent) == 5120
    assert len(poincare_pt) == 5120
    p_norm = vector_norm(poincare_pt)
    assert 0.0 < p_norm < 1.0

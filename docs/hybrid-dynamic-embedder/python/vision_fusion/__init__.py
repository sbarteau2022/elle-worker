"""
Vision Tower & Tangent Space Fusion Module (Milestone 2).
"""

from python.vision_fusion.vision_tower import (
    VisionTower,
    apply_2d_rope_mlx,
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

__all__ = [
    "VisionTower",
    "apply_2d_rope_numpy",
    "apply_2d_rope_mlx",
    "compute_2d_rope_freqs_numpy",
    "PatchMerger",
    "RoIPooler",
    "compute_patch_grid_shape",
    "compute_token_centroids",
    "filter_tokens_in_bbox",
    "pool_tokens_mean",
    "pool_tokens_attention",
    "page_level_pool",
    "extract_roi_visual_embedding",
    "extract_roi_tokens_batch",
    "validate_and_normalize_bbox",
    "shared_tangent_fusion",
    "compute_dynamic_gate",
    "compute_dynamic_gate_context",
    "project_to_poincare_ball",
    "tangent_norm",
    "vector_norm",
    "tangent_layernorm",
]

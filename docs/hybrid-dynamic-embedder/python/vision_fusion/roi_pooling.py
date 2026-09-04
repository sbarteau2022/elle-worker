"""
Region-of-Interest (RoI) Pooling Module for Visual Patch Embeddings (R3).

Extracts and aggregates visual token representations for detected line-item
bounding boxes from Qwen-VL patch merger visual token representations.
Supports normalized coordinates [ymin, xmin, ymax, xmax], spatial centroid filtering,
mean and attention-weighted pooling, and deterministic fallback to global page pooling.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union

try:
    import numpy as np
except ImportError:
    np = None

try:
    import mlx.core as mx
except ImportError:
    mx = None


def validate_and_normalize_bbox(
    bbox: Optional[Sequence[float]],
    image_shape: Optional[Tuple[int, int]] = None,
) -> Optional[Tuple[float, float, float, float]]:
    """
    Validates and normalizes bounding box coordinates into [0.0, 1.0].

    Coordinates are assumed to be [ymin, xmin, ymax, xmax].
    If coordinates are in pixel space (> 1.0) and image_shape (H, W) is provided,
    normalizes them by height and width.

    Returns:
        (ymin, xmin, ymax, xmax) normalized in [0.0, 1.0], or None if invalid/empty.
    """
    if bbox is None or len(bbox) < 4:
        return None

    ymin, xmin, ymax, xmax = float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3])

    # Convert pixel space to normalized coordinates if needed
    if image_shape is not None and (ymin > 1.0 or xmin > 1.0 or ymax > 1.0 or xmax > 1.0):
        h, w = image_shape
        if h > 0:
            ymin /= float(h)
            ymax /= float(h)
        if w > 0:
            xmin /= float(w)
            xmax /= float(w)

    # Ensure min <= max
    if ymin > ymax:
        ymin, ymax = ymax, ymin
    if xmin > xmax:
        xmin, xmax = xmax, xmin

    # Clamp strictly to [0.0, 1.0]
    ymin = max(0.0, min(1.0, ymin))
    xmin = max(0.0, min(1.0, xmin))
    ymax = max(0.0, min(1.0, ymax))
    xmax = max(0.0, min(1.0, xmax))

    # Reject zero-area or degenerate boxes
    if ymin >= ymax and xmin >= xmax:
        return None

    return (ymin, xmin, ymax, xmax)


def compute_patch_grid_shape(
    image_shape: Tuple[int, int],
    patch_size: int = 14,
    merger_factor: int = 2,
) -> Tuple[int, int]:
    """
    Computes spatial grid dimensions (grid_h, grid_w) of merged visual tokens.

    For Qwen-VL:
      Raw ViT patch size = 14x14
      Patch merger compresses 2x2 patches -> effective receptive field = 28x28
      grid_h = H // (patch_size * merger_factor)
      grid_w = W // (patch_size * merger_factor)
    """
    effective_patch = patch_size * merger_factor
    h, w = image_shape
    grid_h = max(1, h // effective_patch)
    grid_w = max(1, w // effective_patch)
    return (grid_h, grid_w)


def compute_token_centroids(grid_shape: Tuple[int, int]) -> List[Tuple[float, float]]:
    """
    Computes normalized spatial centroids (cy, cx) for each merged visual token.

    Grid index (r, c) spans:
      y in [r / G_H, (r + 1) / G_H], centroid cy = (r + 0.5) / G_H
      x in [c / G_W, (c + 1) / G_W], centroid cx = (c + 0.5) / G_W

    Returns:
        List of (cy, cx) in row-major order of length G_H * G_W.
    """
    grid_h, grid_w = grid_shape
    centroids: List[Tuple[float, float]] = []
    for r in range(grid_h):
        cy = (r + 0.5) / float(grid_h)
        for c in range(grid_w):
            cx = (c + 0.5) / float(grid_w)
            centroids.append((cy, cx))
    return centroids


def filter_tokens_in_bbox(
    bbox: Tuple[float, float, float, float],
    grid_shape: Tuple[int, int],
    centroids: Optional[Sequence[Tuple[float, float]]] = None,
) -> List[int]:
    """
    Identifies token indices whose spatial centroids fall within the bounding box:
      ymin <= cy <= ymax and xmin <= cx <= xmax.
    """
    if centroids is None:
        centroids = compute_token_centroids(grid_shape)

    ymin, xmin, ymax, xmax = bbox
    matching_indices: List[int] = []
    for idx, (cy, cx) in enumerate(centroids):
        if ymin <= cy <= ymax and xmin <= cx <= xmax:
            matching_indices.append(idx)

    return matching_indices


def pool_tokens_mean(
    tokens: Sequence[Sequence[float]],
    indices: Sequence[int],
) -> List[float]:
    """
    Computes uniform mean pooling over selected token indices:
      z = (1 / |P|) * sum_{p in P} v_p
    """
    if not indices:
        raise ValueError("Cannot pool over empty indices list.")

    dim = len(tokens[indices[0]])
    count = float(len(indices))

    # Vectorized fast paths
    if np is not None and isinstance(tokens, np.ndarray):
        return np.mean(tokens[indices], axis=0).tolist()

    if mx is not None and isinstance(tokens, mx.array):
        idx_arr = mx.array(list(indices))
        selected = tokens[idx_arr]
        return mx.mean(selected, axis=0).tolist()

    # Pure Python fallback
    summed = [0.0] * dim
    for idx in indices:
        row = tokens[idx]
        for i in range(dim):
            summed[i] += row[i]

    return [x / count for x in summed]


def pool_tokens_attention(
    tokens: Sequence[Sequence[float]],
    indices: Sequence[int],
    query_vector: Sequence[float],
) -> List[float]:
    """
    Computes attention-weighted pooling over selected token indices (SPECIFICATION.md §3.3):
      alpha_p = softmax( (q^T v_p) / sqrt(D) )
      z = sum_{p in P} alpha_p * v_p
    """
    if not indices:
        raise ValueError("Cannot pool over empty indices list.")

    dim = len(tokens[indices[0]])
    scale = 1.0 / math.sqrt(float(dim))

    # Compute dot products
    logits = []
    for idx in indices:
        row = tokens[idx]
        dot = sum(q * v for q, v in zip(query_vector, row))
        logits.append(dot * scale)

    # Numerically stable softmax
    max_logit = max(logits)
    exp_logits = [math.exp(l - max_logit) for l in logits]
    sum_exp = sum(exp_logits)
    weights = [e / sum_exp for e in exp_logits]

    # Weighted sum
    pooled = [0.0] * dim
    for w, idx in zip(weights, indices):
        row = tokens[idx]
        for i in range(dim):
            pooled[i] += w * row[i]

    return pooled


def page_level_pool(tokens: Sequence[Sequence[float]]) -> List[float]:
    """
    Computes global page-level visual embedding by averaging all visual tokens.
    Used as fallback when bounding box is empty, invalid, or full page.
    """
    all_indices = list(range(len(tokens)))
    return pool_tokens_mean(tokens, all_indices)


def extract_roi_visual_embedding(
    visual_tokens: Sequence[Sequence[float]],
    bbox: Optional[Sequence[float]],
    grid_shape: Optional[Tuple[int, int]] = None,
    image_shape: Optional[Tuple[int, int]] = None,
    query_vector: Optional[Sequence[float]] = None,
    fallback_to_page: bool = True,
) -> List[float]:
    """
    Extracts RoI visual token embedding for a line-item bounding box (R3).

    1. Validates and normalizes bbox coordinates [ymin, xmin, ymax, xmax].
    2. Infers grid_shape (G_H, G_W) if not explicitly provided (assuming square grid).
    3. Finds patch tokens whose spatial centroids fall within bbox.
    4. Pools tokens via mean or attention weighting.
    5. Falls back to global page-level pooling if bbox is empty or captures zero tokens.

    Returns:
        5120-dimensional visual embedding vector z_vis.
    """
    total_tokens = len(visual_tokens)
    if total_tokens == 0:
        raise ValueError("visual_tokens must not be empty.")

    # Determine grid dimensions
    if grid_shape is None:
        side = int(math.isqrt(total_tokens))
        if side * side == total_tokens:
            grid_shape = (side, side)
        else:
            grid_shape = (1, total_tokens)

    norm_bbox = validate_and_normalize_bbox(bbox, image_shape=image_shape)

    # If bounding box is missing or invalid, fallback directly
    if norm_bbox is None:
        if fallback_to_page:
            return page_level_pool(visual_tokens)
        raise ValueError(f"Invalid bounding box: {bbox}")

    # Full image check: [0.0, 0.0, 1.0, 1.0]
    ymin, xmin, ymax, xmax = norm_bbox
    if ymin <= 0.001 and xmin <= 0.001 and ymax >= 0.999 and xmax >= 0.999:
        return page_level_pool(visual_tokens)

    matching_indices = filter_tokens_in_bbox(norm_bbox, grid_shape)

    # Empty RoI check
    if not matching_indices:
        if fallback_to_page:
            return page_level_pool(visual_tokens)
        raise ValueError(f"Bounding box {norm_bbox} contains zero visual token centroids.")

    # Aggregate
    if query_vector is not None:
        return pool_tokens_attention(visual_tokens, matching_indices, query_vector)
    return pool_tokens_mean(visual_tokens, matching_indices)


def extract_roi_tokens_batch(
    visual_tokens: Sequence[Sequence[float]],
    bboxes: Sequence[Optional[Sequence[float]]],
    grid_shape: Optional[Tuple[int, int]] = None,
    image_shape: Optional[Tuple[int, int]] = None,
) -> List[List[float]]:
    """
    Batch RoI extraction for multiple receipt line items from shared image tokens.
    """
    total_tokens = len(visual_tokens)
    if grid_shape is None:
        side = int(math.isqrt(total_tokens))
        grid_shape = (side, side) if side * side == total_tokens else (1, total_tokens)

    centroids = compute_token_centroids(grid_shape)
    page_embedding = page_level_pool(visual_tokens)

    results: List[List[float]] = []
    for bbox in bboxes:
        norm_bbox = validate_and_normalize_bbox(bbox, image_shape=image_shape)
        if norm_bbox is None:
            results.append(list(page_embedding))
            continue

        ymin, xmin, ymax, xmax = norm_bbox
        if ymin <= 0.001 and xmin <= 0.001 and ymax >= 0.999 and xmax >= 0.999:
            results.append(list(page_embedding))
            continue

        matching = filter_tokens_in_bbox(norm_bbox, grid_shape, centroids=centroids)
        if not matching:
            results.append(list(page_embedding))
        else:
            results.append(pool_tokens_mean(visual_tokens, matching))

    return results


class RoIPooler:
    """
    Stateful RoI Pooling operator maintaining precomputed spatial grids.
    """

    def __init__(
        self,
        grid_shape: Tuple[int, int] = (16, 16),
        hidden_dim: int = 5120,
        patch_size: int = 14,
        merger_factor: int = 2,
    ) -> None:
        self.grid_shape = grid_shape
        self.hidden_dim = hidden_dim
        self.patch_size = patch_size
        self.merger_factor = merger_factor
        self.centroids = compute_token_centroids(grid_shape)

    def pool_item(
        self,
        visual_tokens: Sequence[Sequence[float]],
        bbox: Optional[Sequence[float]],
        image_shape: Optional[Tuple[int, int]] = None,
        query_vector: Optional[Sequence[float]] = None,
    ) -> List[float]:
        """Pools a single bounding box."""
        return extract_roi_visual_embedding(
            visual_tokens,
            bbox,
            grid_shape=self.grid_shape,
            image_shape=image_shape,
            query_vector=query_vector,
            fallback_to_page=True,
        )

    def pool_batch(
        self,
        visual_tokens: Sequence[Sequence[float]],
        bboxes: Sequence[Optional[Sequence[float]]],
        image_shape: Optional[Tuple[int, int]] = None,
    ) -> List[List[float]]:
        """Pools a list of line item bounding boxes."""
        return extract_roi_tokens_batch(
            visual_tokens,
            bboxes,
            grid_shape=self.grid_shape,
            image_shape=image_shape,
        )

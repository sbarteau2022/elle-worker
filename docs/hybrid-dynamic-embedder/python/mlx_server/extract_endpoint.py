"""
Multi-Layer Extraction Endpoint (/v1/embed/layers) for Qwen3.8:27b on MLX (R2).

Implements server-side extraction logic to capture hidden states from layers
[0, 12, 24, 36, 48, 60, "final"] with immediate span-level pooling.
Avoids whole-sequence tensor bloat by computing span pooling on-the-fly and
calling mx.eval(h) immediately within-block, capping transient memory allocation
well below the <= 140 MB budget (and <= 40 MB for N <= 4096 at
hidden_dim 5120; this sub-budget was <= 30 MB when the tap width was 3584).
"""

from __future__ import annotations

import base64
import math
import os
import struct
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union

try:
    import mlx.core as mx
    import mlx.nn as nn
    _HAS_MLX = True
except ImportError:
    mx = None
    nn = None
    _HAS_MLX = False

# Where the 4-bit MLX weights live. Override with HDE_MODEL_PATH.
DEFAULT_MODEL_PATH = os.environ.get(
    "HDE_MODEL_PATH",
    os.path.expanduser("~/Desktop/ELLE_STACK__CURRENT_WORK/Elle/tools/mlx-serve/weights/Qwen3.8-27B-4bit"),
)

EXTRACTED_LAYERS: List[Union[int, str]] = [0, 12, 24, 36, 48, 60, "final"]
EXPECTED_LAYER_COUNT: int = 7
EXPECTED_HIDDEN_DIM: int = 5120
MAX_TRANSIENT_MEMORY_MB: float = 140.0

# Binary layout per PROJECT.md § M2/M3 <-> M4 Interface Contract:
# magic: u32 (4B) - 0x44484E47 ("DHNG")
# version: u16 (2B) - 0x0001
# dtype: u16 (2B) - 0x0001 (Float16)
# num_layers: u32 (4B) - 7 layers
# hidden_dim: u32 (4B) - 5120
# seq_len: u32 (4B)
# flags: u32 (4B) - Bit 0: Gated visual fusion, Bit 1: DoRA active
# payload_offset: u64 (8B)
# payload_bytes: u64 (8B) - 7 * 5120 * 2 = 71,680 bytes
# timestamp_ns: u64 (8B)
# sequence_id: u64 (8B)
# reserved / padding: 8 bytes to achieve 64-byte alignment
SHM_DESCRIPTOR_FORMAT = "<IHHI I I I Q Q Q Q 8s"
SHM_DESCRIPTOR_SIZE = struct.calcsize(SHM_DESCRIPTOR_FORMAT)  # 64 bytes
MAGIC_DHNG = 0x44484E47  # "DHNG" in ASCII little-endian
VERSION_V1 = 0x0001
DTYPE_FLOAT16 = 0x0001
PAYLOAD_BYTES_DEFAULT = EXPECTED_LAYER_COUNT * EXPECTED_HIDDEN_DIM * 2  # 71,680 bytes


def load_qwen_mlx(model_path: str = DEFAULT_MODEL_PATH) -> Tuple[Any, Any]:
    """
    Loads the Qwen3.8-27B 4-bit MLX weights and returns (decoder, tokenizer).

    mlx_vlm.load hands back the full multimodal wrapper; the transformer
    stack this module taps sits at `.language_model.model`, which is where
    embed_tokens / layers / norm actually live. Returning that inner object
    keeps _extract_mlx_live's attribute access flat.
    """
    if not _HAS_MLX:
        raise RuntimeError("MLX is not available in this interpreter.")
    try:
        from mlx_vlm import load as vlm_load
    except ImportError as e:
        raise RuntimeError(
            "mlx-vlm is required to load the multimodal coordinator: "
            "pip install mlx-vlm"
        ) from e
    if not os.path.isdir(model_path):
        raise FileNotFoundError(
            f"MLX weights not found at {model_path}. Fetch them with "
            "~/Desktop/ELLE_STACK__CURRENT_WORK/Elle/tools/mlx-serve/fetch_weights.sh, or set HDE_MODEL_PATH."
        )
    wrapper, processor = vlm_load(model_path)
    decoder = wrapper.language_model.model
    tokenizer = getattr(processor, "tokenizer", processor)

    measured = decoder.embed_tokens.weight.shape[0] if hasattr(decoder, "embed_tokens") else None
    n_blocks = len(decoder.layers)
    max_tap = max(l for l in EXTRACTED_LAYERS if isinstance(l, int))
    if n_blocks <= max_tap:
        raise ValueError(
            f"Model has {n_blocks} blocks but EXTRACTED_LAYERS taps index {max_tap}."
        )
    return decoder, tokenizer


def make_live_extractor(model_path: str = DEFAULT_MODEL_PATH) -> "LayerExtractor":
    """Loads the weights and returns an extractor wired for a live forward pass."""
    from mlx_vlm import load as vlm_load

    wrapper, processor = vlm_load(model_path)
    decoder = wrapper.language_model.model
    tokenizer = getattr(processor, "tokenizer", processor)
    ex = LayerExtractor(model=decoder, tokenizer=tokenizer)

    from mlx_lm.models.cache import make_prompt_cache
    ex._cache_factory = lambda: make_prompt_cache(wrapper.language_model)
    try:
        from mlx_vlm.models.qwen3_5.language import (
            _create_qwen3_5_attention_mask,
            _create_qwen3_5_ssm_mask,
        )
        ex._mask_fns = (_create_qwen3_5_attention_mask, _create_qwen3_5_ssm_mask)
    except ImportError:
        ex._mask_fns = None
    return ex


class LayerExtractor:
    """
    Manages multi-layer hidden state extraction, within-block step evaluation,
    and immediate span-level pooling across layers [0, 12, 24, 36, 48, 60, "final"].
    """

    def __init__(
        self,
        model: Optional[Any] = None,
        hidden_dim: int = EXPECTED_HIDDEN_DIM,
        layers: Optional[Sequence[Union[int, str]]] = None,
        query_vector: Optional[Sequence[float]] = None,
        tokenizer: Optional[Any] = None,
    ) -> None:
        self.model = model
        self.tokenizer = tokenizer
        self._cache_factory: Optional[Any] = None
        self._mask_fns: Optional[Tuple[Any, Any]] = None
        self.hidden_dim = hidden_dim
        self.layers = list(layers) if layers is not None else list(EXTRACTED_LAYERS)
        self.layer_count = len(self.layers)

        # Default query vector for attention-weighted pooling (dim = hidden_dim)
        if query_vector is not None:
            self.q_pool = list(query_vector)[: self.hidden_dim]
            if len(self.q_pool) < self.hidden_dim:
                self.q_pool.extend([1.0 / math.sqrt(self.hidden_dim)] * (self.hidden_dim - len(self.q_pool)))
        else:
            q_val = 1.0 / math.sqrt(self.hidden_dim)
            self.q_pool = [q_val] * self.hidden_dim

    def pool_span_mean(self, tokens: Sequence[Sequence[float]]) -> List[float]:
        """Computes coordinate-wise mean pooling over a sequence of token vectors."""
        if not tokens:
            return [0.0] * self.hidden_dim
        count = float(len(tokens))
        return [sum(tokens[t][i] for t in range(len(tokens))) / count for i in range(self.hidden_dim)]

    def pool_span_attention(
        self,
        tokens: Sequence[Sequence[float]],
        query: Optional[Sequence[float]] = None,
    ) -> List[float]:
        """
        Computes attention-weighted pooling over a sequence of token vectors:
        alpha_t = softmax(q_pool^T h_t / sqrt(D))
        h_pool = sum_t alpha_t h_t
        """
        if not tokens:
            return [0.0] * self.hidden_dim
        if len(tokens) == 1:
            return list(tokens[0])

        q = query if query is not None else self.q_pool
        scale = 1.0 / math.sqrt(self.hidden_dim)

        # Compute dot product logits
        scores = []
        for token in tokens:
            dot = sum(qi * hi for qi, hi in zip(q, token))
            scores.append(dot * scale)

        # Numerically stable softmax
        max_score = max(scores)
        exp_scores = [math.exp(s - max_score) for s in scores]
        sum_exp = sum(exp_scores) + 1e-15
        weights = [es / sum_exp for es in exp_scores]

        # Weighted sum across tokens
        pooled = [0.0] * self.hidden_dim
        for w, token in zip(weights, tokens):
            for i in range(self.hidden_dim):
                pooled[i] += w * token[i]
        return pooled

    def extract_span_pooled(
        self,
        token_count: int,
        span: Tuple[int, int],
        layer_generator: Optional[Sequence[Sequence[float]]] = None,
        pooling: str = "span_mean",
        input_ids: Optional[Any] = None,
    ) -> List[List[float]]:
        """
        Extracts pooled hidden states across all tapped layers for a specific token span.

        With a model attached, input_ids is required and drives a real forward
        pass. Without one, returns the deterministic simulation vectors used by
        the unit and contract suites.
        """
        start_idx, end_idx = span
        if start_idx > end_idx:
            raise ValueError(f"Invalid span bounds: start={start_idx} > end={end_idx}")

        if start_idx < 0:
            start_idx = 0
        if token_count > 0 and end_idx >= token_count:
            end_idx = token_count - 1

        if start_idx > end_idx:
            raise ValueError(f"Invalid span bounds after sequence clamping: start={start_idx} > end={end_idx}")

        span_len = max(1, end_idx - start_idx + 1)

        # If live MLX model is attached, execute actual MLX forward pass
        if _HAS_MLX and self.model is not None:
            if input_ids is None:
                raise ValueError(
                    "A model is attached but no input_ids were supplied; the live "
                    "path cannot run a forward pass without tokens."
                )
            return self._extract_mlx_live(
                span=(start_idx, end_idx), input_ids=input_ids, pooling=pooling
            )

        # High-fidelity deterministic simulation mode (for unit/integration testing)
        pooled_layers: List[List[float]] = []
        for idx, layer_id in enumerate(self.layers):
            if layer_generator is not None and idx < len(layer_generator):
                layer_rep = list(layer_generator[idx])
            else:
                scale = 0.05 * (idx + 1)
                layer_rep = [scale] * self.hidden_dim

            if len(layer_rep) != self.hidden_dim:
                layer_rep = (layer_rep * (self.hidden_dim // len(layer_rep) + 1))[: self.hidden_dim]

            if pooling == "attention_weighted" and span_len > 1:
                # Generate token variation across the span
                simulated_tokens = []
                for t in range(span_len):
                    t_scale = 1.0 + 0.01 * (t - span_len / 2.0)
                    simulated_tokens.append([x * t_scale for x in layer_rep])
                pooled = self.pool_span_attention(simulated_tokens)
            else:
                pooled = layer_rep

            pooled_layers.append(pooled)

        return pooled_layers

    def _extract_mlx_live(
        self,
        span: Tuple[int, int],
        input_ids: Any,
        pooling: str = "span_mean",
    ) -> List[List[float]]:
        """Executes live MLX forward pass with immediate mx.eval(h) within-block evaluation."""
        if not _HAS_MLX or self.model is None:
            raise RuntimeError("MLX is not available or model is not loaded.")
        if input_ids is None:
            raise ValueError("_extract_mlx_live requires input_ids.")

        start_idx, end_idx = span
        pooled_layers: List[Any] = []

        # Qwen3.5 is a hybrid stack: full-attention blocks and linear/SSM
        # blocks take DIFFERENT masks, and every block needs its own cache
        # entry (attention reads cache.offset). Reproduce what the model's
        # own __call__ does, so a tapped pass matches a generated one.
        cache = self._make_cache()
        h = self.model.embed_tokens(input_ids)
        fa_mask, ssm_mask = self._make_masks(h, cache)

        if 0 in self.layers:
            pooled = self._pool_mlx_slice(h[:, start_idx : end_idx + 1, :], pooling)
            mx.eval(pooled)
            pooled_layers.append(pooled)
        mx.eval(h)

        tapped = {l: i for i, l in enumerate(self.layers) if isinstance(l, int) and l != 0}
        for block_idx, block in enumerate(self.model.layers):
            mask = ssm_mask if getattr(block, "is_linear", False) else fa_mask
            h_next = block(h, mask=mask, cache=cache[block_idx] if cache else None)
            if isinstance(h_next, tuple):
                h_next = h_next[0]
            if block_idx in tapped:
                pooled = self._pool_mlx_slice(
                    h_next[:, start_idx : end_idx + 1, :], pooling
                )
                mx.eval(pooled)
                pooled_layers.append(pooled)
            mx.eval(h_next)
            h = h_next

        h_norm = self.model.norm(h)
        if "final" in self.layers:
            pooled = self._pool_mlx_slice(
                h_norm[:, start_idx : end_idx + 1, :], pooling
            )
            mx.eval(pooled)
            pooled_layers.append(pooled)

        # Convert MLX arrays to Python lists
        return [p.tolist()[0] for p in pooled_layers]

    def _make_cache(self) -> Optional[List[Any]]:
        """One cache entry per block; None if mlx_lm's cache helper is absent."""
        if self._cache_factory is None:
            return None
        return self._cache_factory()

    def _make_masks(self, h: Any, cache: Optional[List[Any]]) -> Tuple[Any, Any]:
        """The (full-attention, linear/SSM) mask pair the model selects between."""
        if self._mask_fns is None or cache is None:
            return None, None
        fa_fn, ssm_fn = self._mask_fns
        fa_idx = getattr(self.model, "fa_idx", 0)
        ssm_idx = getattr(self.model, "ssm_idx", 0)
        return fa_fn(h, cache[fa_idx]), ssm_fn(h, cache[ssm_idx])

    def encode(self, text: str) -> Any:
        """Tokenizes text to a [1, N] MLX array of ids."""
        if self.tokenizer is None:
            raise RuntimeError("No tokenizer attached to this LayerExtractor.")
        ids = self.tokenizer.encode(text)
        if hasattr(ids, "ids"):
            ids = ids.ids
        return mx.array([list(ids)])

    def _pool_mlx_slice(self, slice_tensor: Any, mode: str) -> Any:
        """Helper for MLX tensor pooling."""
        if mode == "attention_weighted":
            q = mx.array(self.q_pool, dtype=slice_tensor.dtype).reshape(1, 1, -1)
            scores = mx.sum(slice_tensor * q, axis=-1, keepdims=True) / math.sqrt(self.hidden_dim)
            weights = mx.softmax(scores, axis=1)
            return mx.sum(slice_tensor * weights, axis=1)
        elif mode == "span_max":
            return mx.max(slice_tensor, axis=1)
        else:  # span_mean
            return mx.mean(slice_tensor, axis=1)

    def compute_transient_memory_mb(self, seq_len: int, bytes_per_elem: int = 2) -> float:
        """Computes active transient memory required per step during immediate evaluation."""
        active_layer_bytes = 1 * seq_len * self.hidden_dim * bytes_per_elem
        return active_layer_bytes / (1024.0 * 1024.0)

    def to_float16_bytes(self, pooled_layers: Sequence[Sequence[float]]) -> bytes:
        """Packs 7x5120 floats into 71,680 bytes of little-endian float16."""
        flattened = [float(x) for layer in pooled_layers for x in layer]
        return struct.pack(f"<{len(flattened)}e", *flattened)

    def to_base64(self, pooled_layers: Sequence[Sequence[float]]) -> str:
        """Encodes float16 tensor as base64 string."""
        return base64.b64encode(self.to_float16_bytes(pooled_layers)).decode("ascii")

    def pack_shm_descriptor(
        self,
        seq_len: int,
        payload_offset: int = 64,
        flags: int = 0x0003,
        sequence_id: int = 1,
        timestamp_ns: int = 0,
    ) -> bytes:
        """Packs a 64-byte ShmTensorDescriptor."""
        padding = b"\x00" * 8
        return struct.pack(
            SHM_DESCRIPTOR_FORMAT,
            MAGIC_DHNG,
            VERSION_V1,
            DTYPE_FLOAT16,
            self.layer_count,
            self.hidden_dim,
            seq_len,
            flags,
            payload_offset,
            PAYLOAD_BYTES_DEFAULT,
            timestamp_ns,
            sequence_id,
            padding,
        )


def extract_layers_span_pooled(
    seq_len: int,
    span: Tuple[int, int],
    hidden_dim: int = EXPECTED_HIDDEN_DIM,
    simulated_hidden_states: Optional[Sequence[Sequence[float]]] = None,
    pooling: str = "span_mean",
) -> List[List[float]]:
    """Convenience wrapper matching integration test expectations."""
    extractor = LayerExtractor(hidden_dim=hidden_dim)
    return extractor.extract_span_pooled(
        token_count=seq_len,
        span=span,
        layer_generator=simulated_hidden_states,
        pooling=pooling,
    )

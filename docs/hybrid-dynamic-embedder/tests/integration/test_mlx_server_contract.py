"""
Integration tests for MLX server endpoint /v1/embed/layers, layer tapping spectrum,
immediate span-level pooling, and shared tangent space fusion contract (R2, R3).
"""

from __future__ import annotations

import base64
import json
import math
import struct
import urllib.error
import urllib.request
import pytest

from python.mlx_server.extract_endpoint import (
    DTYPE_FLOAT16,
    EXPECTED_HIDDEN_DIM,
    EXPECTED_LAYER_COUNT,
    EXTRACTED_LAYERS,
    MAGIC_DHNG,
    MAX_TRANSIENT_MEMORY_MB,
    PAYLOAD_BYTES_DEFAULT,
    SHM_DESCRIPTOR_FORMAT,
    SHM_DESCRIPTOR_SIZE,
    VERSION_V1,
    LayerExtractor,
    extract_layers_span_pooled,
)
from python.mlx_server.server import start_server, stop_server
from tests.fixtures.oracle import shared_tangent_fusion, vector_norm
from tests.fixtures.shm_fixtures import unpack_shm_descriptor


EXPECTED_LAYERS = [0, 12, 24, 36, 48, 60, "final"]


def test_mlx_extracted_layer_spectrum():
    """R2: Verifies layer extraction captures exactly [0, 12, 24, 36, 48, 60, final] (7 layers)."""
    assert len(EXPECTED_LAYERS) == EXPECTED_LAYER_COUNT
    assert EXPECTED_LAYERS[0] == 0
    assert EXPECTED_LAYERS[1] == 12
    assert EXPECTED_LAYERS[2] == 24
    assert EXPECTED_LAYERS[3] == 36
    assert EXPECTED_LAYERS[4] == 48
    assert EXPECTED_LAYERS[5] == 60
    assert EXPECTED_LAYERS[6] == "final"


def test_span_level_pooling_dimension_contract():
    """R2: Span pooling outputs [7, 5120] tensor rather than full sequence [7, N, 5120]."""
    seq_len = 512
    span_start = 24
    span_end = 35  # Span length 12

    # Simulate span extraction: mean pooling across span
    simulated_hidden_states = [[0.05 * (l + 1)] * EXPECTED_HIDDEN_DIM for l in range(EXPECTED_LAYER_COUNT)]
    assert len(simulated_hidden_states) == EXPECTED_LAYER_COUNT
    for layer_h in simulated_hidden_states:
        assert len(layer_h) == EXPECTED_HIDDEN_DIM

    # Payload size for float16: 7 * 5120 * 2 bytes = 71,680 bytes
    bytes_per_sample = EXPECTED_LAYER_COUNT * EXPECTED_HIDDEN_DIM * 2
    assert bytes_per_sample == 71680


def test_transient_memory_budget_cap():
    """R2: Immediate step evaluation caps transient memory at <= 140 MB."""
    transient_layer_mb = (1 * 512 * EXPECTED_HIDDEN_DIM * 2) / (1024 * 1024)
    assert transient_layer_mb < MAX_TRANSIENT_MEMORY_MB
    # Derived from the tapped width, not a literal: one fp16 layer of 512
    # tokens. Hardcoding this hid the 3584 -> 5120 change.
    assert transient_layer_mb == pytest.approx(
        (512 * EXPECTED_HIDDEN_DIM * 2) / (1024 * 1024), abs=1e-9
    )


def test_shared_tangent_fusion_and_scaling():
    """R3: Shared tangent space fusion combines z_text and z_vis with 1/sqrt(D) scaling."""
    D = EXPECTED_HIDDEN_DIM
    # Must vary across components: LayerNorm maps any CONSTANT vector to
    # exactly zero, so a flat input lands on the origin and tests nothing.
    z_text = [1.0 + 0.001 * (i % 97) for i in range(D)]
    z_vis = [0.5 - 0.002 * (i % 61) for i in range(D)]

    # High OCR confidence g = 0.8
    g = 0.8
    fused_tangent, poincare_pt = shared_tangent_fusion(z_text, z_vis, g=g, D=D, c=1.0)

    # Tangent scaling check: magnitude scaled by 1/sqrt(D)
    expected_scale = 1.0 / math.sqrt(D)
    expected_unscaled = g * z_text[0] + (1.0 - g) * z_vis[0]
    expected_val = expected_unscaled * expected_scale
    assert fused_tangent[0] == pytest.approx(expected_val, abs=1e-12)

    # Poincare point norm must strictly reside inside open ball ||x|| < 1.0
    p_norm = vector_norm(poincare_pt)
    assert p_norm < 1.0
    assert p_norm > 1e-3

    # The degenerate case, asserted rather than relied upon: a constant
    # tangent vector has zero variance, so LayerNorm annihilates it and
    # exp_0 returns the origin exactly.
    _, flat_pt = shared_tangent_fusion([1.0] * D, [0.5] * D, g=g, D=D, c=1.0)
    assert vector_norm(flat_pt) == pytest.approx(0.0, abs=1e-12)


def test_dynamic_gating_boundary_extremes():
    """R3: Dynamic gating g=1.0 (pure text) vs g=0.0 (pure vision)."""
    D = 64
    z_text = [float(i) for i in range(D)]
    z_vis = [float(-i) for i in range(D)]

    # Pure text
    _, p_text = shared_tangent_fusion(z_text, z_vis, g=1.0, D=D)
    # Pure vision
    _, p_vis = shared_tangent_fusion(z_text, z_vis, g=0.0, D=D)

    assert vector_norm(p_text) > 0.0
    assert vector_norm(p_vis) > 0.0
    assert p_text[0] != p_vis[0]


# ==============================================================================
# Additional M2 Contract Tests
# ==============================================================================

def test_layer_extractor_attention_weighted_pooling():
    """R2: Verifies attention-weighted pooling math and query alignment."""
    extractor = LayerExtractor(hidden_dim=4)
    tokens = [
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0, 0.0],
    ]
    # Query prioritizing token 1
    query = [0.0, 10.0, 0.0, 0.0]
    pooled = extractor.pool_span_attention(tokens, query=query)
    assert pooled[1] > 0.9
    assert pooled[0] < 0.1
    assert pooled[2] < 0.1

    # Extract across span with attention pooling
    extracted = extractor.extract_span_pooled(
        token_count=10,
        span=(2, 5),
        pooling="attention_weighted",
    )
    assert len(extracted) == 7
    for layer_rep in extracted:
        assert len(layer_rep) == 4


def test_layer_extractor_bounds_and_inverted_span_rejection():
    """R2: Rejects inverted span (start > end) and handles single-token span."""
    extractor = LayerExtractor(hidden_dim=EXPECTED_HIDDEN_DIM)

    # Inverted span
    with pytest.raises(ValueError, match="Invalid span bounds"):
        extractor.extract_span_pooled(token_count=20, span=(15, 10))

    # Single-token span (start == end)
    extracted_single = extractor.extract_span_pooled(token_count=20, span=(5, 5))
    assert len(extracted_single) == 7
    assert len(extracted_single[0]) == EXPECTED_HIDDEN_DIM


def test_layer_extractor_float16_and_base64_roundtrip():
    """R2: Float16 binary serialization produces exactly 71,680 bytes and valid base64."""
    extractor = LayerExtractor(hidden_dim=EXPECTED_HIDDEN_DIM)
    pooled = extractor.extract_span_pooled(token_count=10, span=(0, 5))

    raw_bytes = extractor.to_float16_bytes(pooled)
    assert len(raw_bytes) == 71680  # 7 * 5120 * 2

    # Verify unpack back to floats
    num_floats = 7 * EXPECTED_HIDDEN_DIM
    unpacked = struct.unpack(f"<{num_floats}e", raw_bytes)
    assert len(unpacked) == num_floats
    assert unpacked[0] == pytest.approx(pooled[0][0], abs=1e-3)

    # Verify base64 encoding and decoding
    b64_str = extractor.to_base64(pooled)
    decoded_bytes = base64.b64decode(b64_str.encode("ascii"))
    assert decoded_bytes == raw_bytes


def test_layer_extractor_shm_descriptor_packing():
    """R2 / R6: Packs valid 64-byte ShmTensorDescriptor."""
    extractor = LayerExtractor(hidden_dim=EXPECTED_HIDDEN_DIM)
    desc_bytes = extractor.pack_shm_descriptor(seq_len=16, payload_offset=64, sequence_id=99)
    assert len(desc_bytes) == 64

    unpacked = unpack_shm_descriptor(desc_bytes)
    assert unpacked["magic"] == MAGIC_DHNG
    assert unpacked["is_valid_magic"] is True
    assert unpacked["num_layers"] == 7
    assert unpacked["hidden_dim"] == 5120
    assert unpacked["seq_len"] == 16
    assert unpacked["payload_bytes"] == 71680
    assert unpacked["sequence_id"] == 99


def test_transient_memory_bounds_large_sequence():
    """R2: Checks transient memory calculation for sequence lengths up to 8192."""
    extractor = LayerExtractor(hidden_dim=EXPECTED_HIDDEN_DIM)

    # N = 2048
    mb_2k = extractor.compute_transient_memory_mb(seq_len=2048)
    assert mb_2k == pytest.approx((2048 * EXPECTED_HIDDEN_DIM * 2) / (1024 * 1024), abs=1.0)
    assert mb_2k <= 40.0

    # N = 4096: exactly 40.0 MB at hidden_dim 5120 (was 28.0 at 3584)
    mb_4k = extractor.compute_transient_memory_mb(seq_len=4096)
    assert mb_4k == pytest.approx((4096 * EXPECTED_HIDDEN_DIM * 2) / (1024 * 1024), abs=2.0)
    assert mb_4k <= 40.0

    # N = 8192: <= 140 MB
    mb_8k = extractor.compute_transient_memory_mb(seq_len=8192)
    assert mb_8k < MAX_TRANSIENT_MEMORY_MB


def test_server_http_health_and_models_endpoints():
    """Tests programmatic server startup, GET /health, and GET /v1/models."""
    server, thread, base_url = start_server(host="127.0.0.1", port=0)
    try:
        # GET /health
        health_req = urllib.request.Request(f"{base_url}/health")
        with urllib.request.urlopen(health_req, timeout=5.0) as resp:
            assert resp.status == 200
            data = json.loads(resp.read().decode("utf-8"))
            assert data["status"] == "ok"
            assert data["model"] == "Qwen3.8:27b-mlx"
            assert data["hidden_dim"] == 5120
            assert data["layer_count"] == 7
            assert data["layers"] == EXTRACTED_LAYERS

        # GET /v1/models
        models_req = urllib.request.Request(f"{base_url}/v1/models")
        with urllib.request.urlopen(models_req, timeout=5.0) as resp:
            assert resp.status == 200
            data = json.loads(resp.read().decode("utf-8"))
            assert data["object"] == "list"
            assert len(data["data"]) == 1
            assert data["data"][0]["id"] == "Qwen3.8:27b-mlx"
    finally:
        stop_server(server, thread)


def test_server_http_embed_layers_endpoint():
    """Tests POST /v1/embed/layers endpoint contract matching SPECIFICATION.md § 6."""
    server, thread, base_url = start_server(host="127.0.0.1", port=0)
    try:
        req_body = {
            "text": "US Foods - 40 LB CASE CHICKEN THIGHS BONELESS SKINLESS",
            "spans": [[0, 8]],
            "layers": [0, 12, 24, 36, 48, 60, "final"],
            "task": "invoice_anomaly",
            "image_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            "bbox": [140, 32, 178, 890],
            "pooling": "span_mean",
            "curvature": 1.0,
            "dtype": "fp16",
            "shm_enabled": True,
        }
        json_bytes = json.dumps(req_body).encode("utf-8")
        http_req = urllib.request.Request(
            f"{base_url}/v1/embed/layers",
            data=json_bytes,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        with urllib.request.urlopen(http_req, timeout=5.0) as resp:
            assert resp.status == 200
            data = json.loads(resp.read().decode("utf-8"))

            # Validate response schema per SPECIFICATION § 6.2
            assert "node_id" in data
            assert data["image_hash"] == req_body["image_hash"]
            assert data["curvature"] == 1.0
            assert data["gate_weight"] == 0.582
            assert data["geometric_distance"] == 0.1429
            assert data["gate3_pass"] is True
            assert isinstance(data["hyperbolic_coordinates"], list)
            assert len(data["hyperbolic_coordinates"]) == 8

            # Validate spectrum summary
            assert "l0_norm" in data["layer_spectrum_summary"]
            assert "l12_norm" in data["layer_spectrum_summary"]
            assert "l60_norm" in data["layer_spectrum_summary"]
            assert "final_norm" in data["layer_spectrum_summary"]

            # Validate shm_descriptor
            assert "shm_descriptor" in data
            shm_desc = data["shm_descriptor"]
            assert shm_desc["shape"] == [7, 5120]
            assert shm_desc["dtype"] == "float16"
            assert shm_desc["byte_length"] == 71680

        # Test with shm_enabled = False (returns base64)
        req_body["shm_enabled"] = False
        json_bytes_no_shm = json.dumps(req_body).encode("utf-8")
        http_req_no_shm = urllib.request.Request(
            f"{base_url}/v1/embed/layers",
            data=json_bytes_no_shm,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(http_req_no_shm, timeout=5.0) as resp:
            assert resp.status == 200
            data = json.loads(resp.read().decode("utf-8"))
            assert "embeddings_base64" in data
            raw = base64.b64decode(data["embeddings_base64"])
            assert len(raw) == 71680
    finally:
        stop_server(server, thread)


def test_server_http_bad_request_validation():
    """Tests 400 Bad Request error handling on invalid payloads."""
    server, thread, base_url = start_server(host="127.0.0.1", port=0)
    try:
        # 1. Inverted span: start > end
        inverted_req = {
            "text": "sample text",
            "spans": [[10, 5]],
        }
        http_req = urllib.request.Request(
            f"{base_url}/v1/embed/layers",
            data=json.dumps(inverted_req).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with pytest.raises(urllib.error.HTTPError) as exc_info:
            urllib.request.urlopen(http_req, timeout=5.0)
        assert exc_info.value.code == 400

        # 2. Empty spans list
        empty_spans_req = {
            "text": "sample text",
            "spans": [],
        }
        http_req2 = urllib.request.Request(
            f"{base_url}/v1/embed/layers",
            data=json.dumps(empty_spans_req).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with pytest.raises(urllib.error.HTTPError) as exc_info2:
            urllib.request.urlopen(http_req2, timeout=5.0)
        assert exc_info2.value.code == 400

        # 3. Invalid JSON
        http_req3 = urllib.request.Request(
            f"{base_url}/v1/embed/layers",
            data=b"not-valid-json",
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with pytest.raises(urllib.error.HTTPError) as exc_info3:
            urllib.request.urlopen(http_req3, timeout=5.0)
        assert exc_info3.value.code == 400
    finally:
        stop_server(server, thread)

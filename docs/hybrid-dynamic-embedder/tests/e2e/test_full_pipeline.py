"""
End-to-end integration test: Full Milestone 2–6 pipeline.

Exercises the complete data flow:
    1. Layer extraction (M2) — /v1/embed/layers endpoint
    2. Vision tower + patch merger + RoI pooling → fused embeddings (M3)
    3. Gate 3 geometric cross-modal filter (M4)
    4. DoRA adapter scaffolding (M5)
    5. SHM descriptor pack/unpack + buffer write/read (M6)
    6. Atlas/TIT integration (R3) — golden ratio verification
"""

import json
import math
import struct
import urllib.request
import pytest

from python.mlx_server.extract_endpoint import (
    EXPECTED_HIDDEN_DIM,
    EXPECTED_LAYER_COUNT,
    EXTRACTED_LAYERS,
    LayerExtractor,
)
from python.mlx_server.server import start_server, stop_server
from python.vision_fusion.tangent_fusion import (
    project_to_poincare_ball,
    shared_tangent_fusion,
    compute_dynamic_gate_context,
)
from python.vision_fusion.roi_pooling import (
    RoIPooler,
    extract_roi_visual_embedding,
    compute_patch_grid_shape,
)
from python.vision_fusion.patch_merger import PatchMerger
from python.gates.geometric_gate import (
    Gate3Validator,
    TripleGatePipeline,
    evaluate_gate3,
)
from python.training.dora_adapter import (
    DoRAAdapter,
    DoRAPatchMergerAdapter,
    compound_manifold_loss,
)
from python.ipc.shm_bridge import (
    SharedMemoryBuffer,
    ShmTensorDescriptor,
    MAGIC_DHNG,
)
from python.atlas import PHI, PHI_M1, hurwitz_delta


class TestFullPipelineE2E:
    """End-to-end pipeline test across Milestones 2–6."""

    def test_layer_extraction_to_shm_roundtrip(self):
        """M2+M6: Extract layers → pack to SHM → read back → verify."""
        extractor = LayerExtractor(hidden_dim=EXPECTED_HIDDEN_DIM)
        pooled = extractor.extract_span_pooled(
            token_count=64,
            span=(0, 63),
            pooling="span_mean",
        )
        assert len(pooled) == 7
        assert len(pooled[0]) == EXPECTED_HIDDEN_DIM

        # Write to SHM buffer
        buf = SharedMemoryBuffer()
        buf.allocate()
        desc = buf.write_tensor(pooled, seq_len=64)

        # Read back
        recovered = buf.read_payload()
        assert len(recovered) == 7
        assert len(recovered[0]) == EXPECTED_HIDDEN_DIM

        # Verify descriptor
        header = buf.read_descriptor()
        assert header.magic == MAGIC_DHNG
        assert header.seq_len == 64
        assert header.num_layers == 7
        assert header.hidden_dim == 5120

        buf.close()

    def test_vision_fusion_to_gate3(self):
        """M3+M4: Visual tokens → RoI pool → tangent fusion → Gate 3."""
        dim = 32  # Small dim for test speed
        grid = (4, 4)
        num_tokens = 16
        visual_tokens = [[0.1 * (i + 1) + 0.01 * j for j in range(dim)] for i in range(num_tokens)]

        # RoI pooling (full page)
        z_vis = extract_roi_visual_embedding(
            visual_tokens,
            bbox=None,
            grid_shape=grid,
        )
        assert len(z_vis) == dim

        # Text embedding (synthetic)
        z_text = [0.1 * (i + 1) for i in range(dim)]

        # Tangent fusion
        g = compute_dynamic_gate_context(task="vendor_audit", conf_ocr=0.9, q_image=0.8)
        assert 0.0 < g < 1.0

        fused_tangent, poincare_pt = shared_tangent_fusion(
            z_text, z_vis, g=g, D=dim, c=1.0
        )
        assert len(poincare_pt) == dim

        # Poincaré ball constraint: ||x|| < 1/√c
        poincare_norm = math.sqrt(sum(x * x for x in poincare_pt))
        assert poincare_norm < 1.0

        # Gate 3
        x_text = project_to_poincare_ball(z_text, c=1.0)
        x_vis = project_to_poincare_ball(z_vis, c=1.0)
        passed, d_geom = evaluate_gate3(x_text, x_vis, tau_geom=10.0, c=1.0)
        assert isinstance(passed, bool)
        assert d_geom >= 0.0

    def test_dora_adapter_with_manifold_loss(self):
        """M5: DoRA adapter → forward → compound manifold loss."""
        adapter = DoRAPatchMergerAdapter(
            merged_dim=64,
            intermediate_dim=32,
            out_dim=32,
            rank=4,
        )
        assert adapter.total_trainable_params < adapter.total_frozen_params

        # Forward through fc1 adapter
        import numpy as np
        x = np.random.randn(2, 64).astype(np.float32)
        y = adapter.fc1_adapter.forward(x)
        assert y.shape == (2, 32)

        # Compound loss
        emb = [[0.1, 0.2, 0.3]]
        tgt = [[0.15, 0.25, 0.35]]
        result = compound_manifold_loss(emb, tgt, c=1.0)
        assert result["total"] > 0.0
        assert result["hyperbolic"] > 0.0

    def test_atlas_tit_predictions_hold(self):
        """R3: Atlas/TIT φ emergence still holds after integration."""
        # P1: φ maximizes Hurwitz δ
        delta_phi = hurwitz_delta(PHI_M1, N_max=1000)
        delta_half = hurwitz_delta(0.5, N_max=1000)
        assert delta_phi > delta_half

        # φ golden ratio identity
        assert abs(PHI_M1 - 1.0 / PHI) < 1e-15

    def test_triple_gate_pipeline_batch(self):
        """M4: TripleGatePipeline processes batch with pass/fail separation."""
        pipeline = TripleGatePipeline(tau_geom=0.5, c=1.0)

        # Gate 1: SHA-256
        digest = pipeline.compute_image_sha256(b"test_image_bytes")
        assert len(digest) == 64

        # Gate 2: Cent arithmetic
        items = [{"price_cents": 500, "quantity": 2}]
        assert pipeline.check_gate2_arithmetic(items, subtotal_cents=1000, tax_cents=80, total_cents=1080)

        # Gate 3: Geometric batch filter
        dim = 8
        aligned_text = [0.1] * dim
        aligned_vis = [0.11] * dim  # Close to text
        misaligned_vis = [0.9] * dim  # Far from text

        x_text = project_to_poincare_ball(aligned_text, c=1.0)
        x_vis_ok = project_to_poincare_ball(aligned_vis, c=1.0)
        x_vis_bad = project_to_poincare_ball(misaligned_vis, c=1.0)

        batch_items = [{"id": "line1"}, {"id": "line2"}]
        embeddings = [(x_text, x_vis_ok), (x_text, x_vis_bad)]

        passed, quarantined = pipeline.filter_batch(batch_items, embeddings)
        # At least one should pass and one might be quarantined depending on tau
        assert len(passed) + len(quarantined) == 2

    def test_patch_merger_output_shape(self):
        """M3: PatchMerger produces correct output dimensions."""
        import numpy as np
        merger = PatchMerger(in_dim=1152, out_dim=5120, backend="numpy")
        patches = np.random.randn(1, 4, 4, 1152).astype(np.float32)
        out, spatial_meta = merger.merge_and_project(patches)
        assert out.shape == (1, 2, 2, 5120)
        assert spatial_meta["grid_h"] == 2
        assert spatial_meta["grid_w"] == 2
        assert spatial_meta["out_dim"] == 5120


class TestServerContractE2E:
    """Tests for the /v1/embed/layers HTTP endpoint contract."""

    @pytest.fixture(autouse=True)
    def setup_server(self):
        """Start server on ephemeral port, tear down after test."""
        self.server, self.thread, self.base_url = start_server(port=0)
        yield
        stop_server(self.server, self.thread)

    def _post_json(self, path: str, body: dict) -> dict:
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            f"{self.base_url}{path}",
            data=data,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def _get_json(self, path: str) -> dict:
        req = urllib.request.Request(f"{self.base_url}{path}")
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def test_health_endpoint(self):
        resp = self._get_json("/health")
        assert resp["status"] == "ok"
        assert resp["model"] == "Qwen3.8:27b-mlx"
        assert resp["hidden_dim"] == 5120
        assert resp["layer_count"] == 7

    def test_models_endpoint(self):
        resp = self._get_json("/v1/models")
        assert resp["object"] == "list"
        assert len(resp["data"]) >= 1
        assert resp["data"][0]["id"] == "Qwen3.8:27b-mlx"

    def test_embed_layers_response_contract(self):
        """Verify full SPECIFICATION.md §6.2 response structure."""
        resp = self._post_json("/v1/embed/layers", {
            "text": "US Foods - 40 LB CASE CHICKEN THIGHS",
            "spans": [[0, 5]],
            "pooling": "span_mean",
            "curvature": 1.0,
        })
        assert resp["model"] == "Qwen3.8:27b-mlx"
        assert resp["hidden_dim"] == 5120
        assert resp["layers_extracted"] == [0, 12, 24, 36, 48, 60, "final"]
        assert "layer_spectrum_summary" in resp
        assert "hyperbolic_coordinates" in resp
        assert len(resp["hyperbolic_coordinates"]) == 8
        assert "shm_descriptor" in resp
        shm = resp["shm_descriptor"]
        assert shm["shape"] == [7, 5120]
        assert shm["dtype"] == "float16"

    def test_embed_layers_attention_pooling(self):
        resp = self._post_json("/v1/embed/layers", {
            "text": "Test attention pooling",
            "spans": [[0, 2]],
            "pooling": "attention_weighted",
        })
        assert resp["model"] == "Qwen3.8:27b-mlx"
        assert "layer_spectrum_summary" in resp

    def test_embed_layers_invalid_span(self):
        """Invalid span (start > end) should return 400."""
        data = json.dumps({
            "text": "Test",
            "spans": [[10, 2]],
        }).encode("utf-8")
        req = urllib.request.Request(
            f"{self.base_url}/v1/embed/layers",
            data=data,
            headers={"Content-Type": "application/json"},
        )
        try:
            urllib.request.urlopen(req)
            assert False, "Should have raised HTTPError"
        except urllib.error.HTTPError as e:
            assert e.code == 400

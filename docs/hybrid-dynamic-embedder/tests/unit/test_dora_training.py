"""
Comprehensive tests for DoRA adapter and compound manifold loss (Milestone 5).

Tests:
    - DoRA adapter initialization and dimensions
    - Effective weight computation (W_eff = m * normalize(W_0 + scale * B @ A))
    - Forward pass correctness
    - Compression ratio calculation
    - Poincaré distance loss
    - Toroidal distance loss
    - Compound manifold loss composition
    - Frobenius regularization
    - DoRAPatchMergerAdapter fc1/fc2 scaffolding
"""

import math
import pytest
import numpy as np

from python.training.dora_adapter import (
    DoRAAdapter,
    DoRAPatchMergerAdapter,
    compound_manifold_loss,
    frobenius_regularization,
    poincare_distance_loss,
    toroidal_distance_loss,
)


class TestDoRAAdapter:
    """Tests for the DoRA (Weight-Decomposed Low-Rank Adaptation) adapter."""

    def test_init_dimensions(self):
        adapter = DoRAAdapter(in_dim=128, out_dim=64, rank=8)
        assert adapter.in_dim == 128
        assert adapter.out_dim == 64
        assert adapter.rank == 8
        assert adapter.W_0.shape == (64, 128)
        assert adapter.lora_A.shape == (8, 128)
        assert adapter.lora_B.shape == (64, 8)
        assert adapter.magnitude.shape == (64,)

    def test_trainable_param_count(self):
        adapter = DoRAAdapter(in_dim=128, out_dim=64, rank=8)
        # m: 64, A: 8*128=1024, B: 64*8=512 => 1600
        assert adapter.trainable_param_count == 64 + 1024 + 512

    def test_compression_ratio(self):
        adapter = DoRAAdapter(in_dim=128, out_dim=64, rank=8)
        full_params = 128 * 64
        expected = adapter.trainable_param_count / float(full_params)
        assert abs(adapter.compression_ratio - expected) < 1e-10

    def test_compression_ratio_less_than_one(self):
        """Low-rank adapter should use fewer params than full matrix."""
        adapter = DoRAAdapter(in_dim=5120, out_dim=5120, rank=16)
        assert adapter.compression_ratio < 0.02  # < 2% of full params

    def test_effective_weight_shape(self):
        adapter = DoRAAdapter(in_dim=32, out_dim=16, rank=4)
        W_eff = adapter.compute_effective_weight()
        assert W_eff.shape == (16, 32)

    def test_effective_weight_normalized_rows(self):
        """After DoRA, direction vectors should be unit norm (before magnitude scaling)."""
        adapter = DoRAAdapter(in_dim=32, out_dim=16, rank=4)
        # Check that effective weight rows have norms close to magnitude
        W_eff = adapter.compute_effective_weight()
        row_norms = np.sqrt(np.sum(W_eff ** 2, axis=1))
        for i in range(adapter.out_dim):
            assert abs(row_norms[i] - adapter.magnitude[i]) < 1e-5

    def test_forward_shape(self):
        adapter = DoRAAdapter(in_dim=32, out_dim=16, rank=4)
        x = np.random.randn(3, 32).astype(np.float32)
        y = adapter.forward(x)
        assert y.shape == (3, 16)

    def test_lora_b_init_zeros(self):
        """LoRA B should be initialized to zeros (no initial perturbation)."""
        adapter = DoRAAdapter(in_dim=64, out_dim=32, rank=8)
        assert np.allclose(adapter.lora_B, 0.0)

    def test_frozen_flag(self):
        adapter = DoRAAdapter(in_dim=64, out_dim=32, rank=8)
        assert adapter._frozen is True

    def test_deterministic_seed(self):
        """Same seed should produce identical weights."""
        a1 = DoRAAdapter(in_dim=64, out_dim=32, rank=8, seed=123)
        a2 = DoRAAdapter(in_dim=64, out_dim=32, rank=8, seed=123)
        assert np.allclose(a1.W_0, a2.W_0)
        assert np.allclose(a1.lora_A, a2.lora_A)

    def test_scale_factor(self):
        adapter = DoRAAdapter(in_dim=64, out_dim=32, rank=8, alpha=16.0)
        assert adapter.scale == 16.0 / 8.0


class TestPoincareLoss:
    """Tests for Poincaré ball geodesic distance loss."""

    def test_zero_distance_same_point(self):
        emb = [[0.1, 0.2, 0.3]]
        loss = poincare_distance_loss(emb, emb, c=1.0)
        assert loss < 1e-6

    def test_positive_distance_different_points(self):
        emb = [[0.1, 0.2]]
        tgt = [[0.3, 0.4]]
        loss = poincare_distance_loss(emb, tgt, c=1.0)
        assert loss > 0.0

    def test_empty_batch(self):
        assert poincare_distance_loss([], [], c=1.0) == 0.0

    def test_distance_increases_with_separation(self):
        """Points further apart on the ball should have higher loss."""
        close = poincare_distance_loss([[0.1, 0.0]], [[0.2, 0.0]], c=1.0)
        far = poincare_distance_loss([[0.1, 0.0]], [[0.8, 0.0]], c=1.0)
        assert far > close

    def test_boundary_divergence(self):
        """Points near boundary should have very large distance."""
        near_boundary = poincare_distance_loss(
            [[0.01, 0.0]], [[0.99, 0.0]], c=1.0
        )
        assert near_boundary > 2.0


class TestToroidalLoss:
    """Tests for toroidal angular distance loss."""

    def test_zero_distance_same_phase(self):
        phases = [[0.5, 1.0]]
        loss = toroidal_distance_loss(phases, phases)
        assert loss < 1e-10

    def test_wrap_around(self):
        """Distance from 0.1 to 2π-0.1 should be small (wrap around)."""
        phases = [[0.1]]
        target = [[2 * math.pi - 0.1]]
        loss = toroidal_distance_loss(phases, target)
        assert loss < 0.25  # Should be ~0.2, not ~6.0

    def test_empty_batch(self):
        assert toroidal_distance_loss([], []) == 0.0

    def test_maximal_distance(self):
        """Opposite points on circle should have distance ~π."""
        phases = [[0.0]]
        target = [[math.pi]]
        loss = toroidal_distance_loss(phases, target)
        assert abs(loss - math.pi) < 0.01


class TestCompoundManifoldLoss:
    """Tests for the composite H^n × T^d loss function."""

    def test_basic_structure(self):
        result = compound_manifold_loss(
            embeddings=[[0.1, 0.2]],
            targets=[[0.3, 0.4]],
        )
        assert "total" in result
        assert "hyperbolic" in result
        assert "toroidal" in result
        assert "regularization" in result

    def test_total_equals_sum(self):
        result = compound_manifold_loss(
            embeddings=[[0.1, 0.2]],
            targets=[[0.3, 0.4]],
            phases=[[0.5]],
            target_phases=[[1.0]],
            lambda_tor=0.1,
            lambda_reg=0.01,
        )
        expected = result["hyperbolic"] + 0.1 * result["toroidal"] + 0.01 * result["regularization"]
        assert abs(result["total"] - expected) < 1e-10

    def test_with_dora_regularization(self):
        adapter = DoRAAdapter(in_dim=32, out_dim=16, rank=4)
        result = compound_manifold_loss(
            embeddings=[[0.1, 0.2]],
            targets=[[0.3, 0.4]],
            adapter=adapter,
            lambda_reg=0.01,
        )
        # With B=zeros, regularization should be ~0
        assert result["regularization"] < 1e-10

    def test_hyperbolic_only(self):
        """Without phases or adapter, only hyperbolic component contributes."""
        result = compound_manifold_loss(
            embeddings=[[0.1, 0.2]],
            targets=[[0.3, 0.4]],
        )
        assert result["total"] == result["hyperbolic"]
        assert result["toroidal"] == 0.0
        assert result["regularization"] == 0.0


class TestFrobeniusRegularization:
    """Tests for ΔW Frobenius norm regularization."""

    def test_zero_with_zero_b(self):
        adapter = DoRAAdapter(in_dim=32, out_dim=16, rank=4)
        assert frobenius_regularization(adapter) < 1e-10

    def test_nonzero_with_nonzero_b(self):
        adapter = DoRAAdapter(in_dim=32, out_dim=16, rank=4)
        adapter.lora_B = np.ones((16, 4), dtype=np.float32)
        reg = frobenius_regularization(adapter)
        assert reg > 0.0


class TestDoRAPatchMergerAdapter:
    """Tests for the DoRA-wrapped PatchMerger adapter."""

    def test_default_dimensions(self):
        adapter = DoRAPatchMergerAdapter()
        assert adapter.merged_dim == 4608
        assert adapter.intermediate_dim == 5120
        assert adapter.out_dim == 5120
        assert adapter.rank == 16

    def test_fc1_fc2_shapes(self):
        adapter = DoRAPatchMergerAdapter()
        assert adapter.fc1_adapter.in_dim == 4608
        assert adapter.fc1_adapter.out_dim == 5120
        assert adapter.fc2_adapter.in_dim == 5120
        assert adapter.fc2_adapter.out_dim == 5120

    def test_total_trainable_params(self):
        adapter = DoRAPatchMergerAdapter(rank=16)
        total = adapter.total_trainable_params
        assert total > 0
        assert total < adapter.total_frozen_params  # Must be less than frozen

    def test_summary_keys(self):
        adapter = DoRAPatchMergerAdapter()
        s = adapter.summary()
        assert "fc1_adapter" in s
        assert "fc2_adapter" in s
        assert "total_trainable_params" in s
        assert "total_frozen_params" in s
        assert "efficiency" in s

    def test_efficiency_under_five_percent(self):
        """DoRA efficiency should be well under 5% for rank-16."""
        adapter = DoRAPatchMergerAdapter(rank=16)
        assert adapter.summary()["efficiency"] < 0.05

    def test_custom_rank(self):
        adapter = DoRAPatchMergerAdapter(rank=8)
        assert adapter.rank == 8
        assert adapter.fc1_adapter.rank == 8

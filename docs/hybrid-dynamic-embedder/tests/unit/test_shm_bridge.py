"""
Comprehensive tests for zero-copy shared memory IPC bridge (Milestone 6).

Tests:
    - ShmTensorDescriptor packing/unpacking roundtrip
    - Magic number validation
    - Flag bit extraction
    - SharedMemoryBuffer allocation and write/read
    - Payload float16 fidelity
    - Sequence counter monotonicity
    - Descriptor metadata correctness
"""

import math
import struct
import pytest
import numpy as np

from python.ipc.shm_bridge import (
    DESCRIPTOR_SIZE,
    DEFAULT_HIDDEN_DIM,
    DEFAULT_NUM_LAYERS,
    DEFAULT_PAYLOAD_BYTES,
    DTYPE_FLOAT16,
    FLAG_DORA_ACTIVE,
    FLAG_GATED_VISUAL_FUSION,
    MAGIC_DHNG,
    VERSION_V1,
    SharedMemoryBuffer,
    ShmTensorDescriptor,
)


class TestShmTensorDescriptor:
    """Tests for the 64-byte ShmTensorDescriptor."""

    def test_descriptor_size_is_64_bytes(self):
        desc = ShmTensorDescriptor()
        packed = desc.pack()
        assert len(packed) == 64

    def test_magic_number(self):
        desc = ShmTensorDescriptor()
        packed = desc.pack()
        magic = struct.unpack("<I", packed[:4])[0]
        assert magic == MAGIC_DHNG
        assert magic == 0x44484E47

    def test_roundtrip_pack_unpack(self):
        original = ShmTensorDescriptor(
            num_layers=7,
            hidden_dim=5120,
            seq_len=128,
            flags=0x0003,
            sequence_id=42,
        )
        packed = original.pack()
        recovered = ShmTensorDescriptor.unpack(packed)
        assert recovered.magic == MAGIC_DHNG
        assert recovered.version == VERSION_V1
        assert recovered.dtype == DTYPE_FLOAT16
        assert recovered.num_layers == 7
        assert recovered.hidden_dim == 5120
        assert recovered.seq_len == 128
        assert recovered.flags == 0x0003
        assert recovered.sequence_id == 42

    def test_flag_bits(self):
        desc = ShmTensorDescriptor(flags=FLAG_GATED_VISUAL_FUSION | FLAG_DORA_ACTIVE)
        assert desc.gated_visual_fusion is True
        assert desc.dora_active is True

    def test_flag_no_dora(self):
        desc = ShmTensorDescriptor(flags=FLAG_GATED_VISUAL_FUSION)
        assert desc.gated_visual_fusion is True
        assert desc.dora_active is False

    def test_shape_property(self):
        desc = ShmTensorDescriptor()
        assert desc.shape == (7, 5120)

    def test_strides_property(self):
        desc = ShmTensorDescriptor()
        assert desc.strides == (5120 * 2, 2)

    def test_to_dict(self):
        desc = ShmTensorDescriptor(seq_len=256, sequence_id=10)
        d = desc.to_dict()
        assert d["magic"] == "0x44484E47"
        assert d["dtype"] == "float16"
        assert d["num_layers"] == 7
        assert d["hidden_dim"] == 5120
        assert d["seq_len"] == 256
        assert d["sequence_id"] == 10
        assert d["shape"] == [7, 5120]

    def test_invalid_magic_raises(self):
        bad_data = b"\x00" * 64
        with pytest.raises(ValueError, match="Invalid magic"):
            ShmTensorDescriptor.unpack(bad_data)

    def test_buffer_too_small_raises(self):
        with pytest.raises(ValueError, match="Buffer too small"):
            ShmTensorDescriptor.unpack(b"\x00" * 32)

    def test_payload_bytes_default(self):
        desc = ShmTensorDescriptor()
        assert desc.payload_bytes == 7 * 5120 * 2  # 71,680

    def test_timestamp_ns_auto_set(self):
        desc = ShmTensorDescriptor()
        assert desc.timestamp_ns > 0


class TestSharedMemoryBuffer:
    """Tests for the anonymous mmap shared memory buffer."""

    def test_allocate(self):
        buf = SharedMemoryBuffer()
        buf.allocate()
        assert buf.is_allocated()
        buf.close()

    def test_total_bytes(self):
        buf = SharedMemoryBuffer()
        expected = 64 + 7 * 5120 * 2  # 50,240 bytes
        assert buf.total_bytes == expected

    def test_write_read_roundtrip(self):
        buf = SharedMemoryBuffer()
        buf.allocate()

        # Create synthetic 7×5120 tensor
        test_value = 0.125
        pooled = [[test_value] * 5120 for _ in range(7)]

        desc = buf.write_tensor(pooled, seq_len=100)
        assert desc.seq_len == 100
        assert desc.sequence_id == 1

        # Read back
        recovered_desc = buf.read_descriptor()
        assert recovered_desc.magic == MAGIC_DHNG
        assert recovered_desc.seq_len == 100

        recovered_payload = buf.read_payload()
        assert len(recovered_payload) == 7
        assert len(recovered_payload[0]) == 5120
        # float16 precision: check within tolerance
        for layer in recovered_payload:
            for val in layer[:10]:  # Check first 10 values
                assert abs(val - test_value) < 0.01

        buf.close()

    def test_write_read_numpy(self):
        buf = SharedMemoryBuffer()
        buf.allocate()

        pooled = [[float(i) * 0.01 + float(j) * 0.001 for j in range(5120)] for i in range(7)]
        buf.write_tensor(pooled, seq_len=50)

        arr = buf.read_payload_numpy()
        assert arr.shape == (7, 5120)
        assert arr.dtype == np.float16

        buf.close()

    def test_sequence_counter_monotonic(self):
        buf = SharedMemoryBuffer()
        buf.allocate()

        pooled = [[0.1] * 5120 for _ in range(7)]
        d1 = buf.write_tensor(pooled, seq_len=10)
        d2 = buf.write_tensor(pooled, seq_len=20)
        d3 = buf.write_tensor(pooled, seq_len=30)

        assert d1.sequence_id == 1
        assert d2.sequence_id == 2
        assert d3.sequence_id == 3

        buf.close()

    def test_flags_propagation(self):
        buf = SharedMemoryBuffer()
        buf.allocate()

        pooled = [[0.0] * 5120 for _ in range(7)]
        desc = buf.write_tensor(pooled, flags=FLAG_GATED_VISUAL_FUSION)
        assert desc.gated_visual_fusion is True
        assert desc.dora_active is False

        buf.close()

    def test_read_without_allocate_raises(self):
        buf = SharedMemoryBuffer()
        with pytest.raises(RuntimeError, match="not allocated"):
            buf.read_descriptor()

    def test_close_idempotent(self):
        buf = SharedMemoryBuffer()
        buf.allocate()
        buf.close()
        buf.close()  # Should not raise

    def test_descriptor_matches_payload_contract(self):
        """Descriptor shape/strides must match the actual payload layout."""
        buf = SharedMemoryBuffer()
        buf.allocate()

        pooled = [[0.5] * 5120 for _ in range(7)]
        desc = buf.write_tensor(pooled)

        assert desc.payload_offset == 64
        assert desc.payload_bytes == 7 * 5120 * 2
        assert desc.shape == (7, 5120)
        assert desc.strides == (DEFAULT_HIDDEN_DIM * 2, 2)

        buf.close()


class TestShmDescriptorEdgeCases:
    """Edge case tests for descriptor handling."""

    def test_custom_dimensions(self):
        desc = ShmTensorDescriptor(num_layers=3, hidden_dim=256)
        assert desc.shape == (3, 256)
        packed = desc.pack()
        recovered = ShmTensorDescriptor.unpack(packed)
        assert recovered.num_layers == 3
        assert recovered.hidden_dim == 256

    def test_max_sequence_id(self):
        desc = ShmTensorDescriptor(sequence_id=2**63 - 1)
        packed = desc.pack()
        recovered = ShmTensorDescriptor.unpack(packed)
        assert recovered.sequence_id == 2**63 - 1

    def test_zero_seq_len(self):
        desc = ShmTensorDescriptor(seq_len=0)
        packed = desc.pack()
        recovered = ShmTensorDescriptor.unpack(packed)
        assert recovered.seq_len == 0

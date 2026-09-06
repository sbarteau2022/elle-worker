"""
Integration tests for Rust Harness Shared-Memory Bridge (R6, AC5).
Validates the 64-byte ShmTensorDescriptor layout and runs harness-dhng cargo test suite.
"""

import subprocess
import pytest
from tests.fixtures.shm_fixtures import (
    pack_shm_descriptor,
    unpack_shm_descriptor,
    MAGIC_DHNG,
    VERSION_V1,
    DTYPE_FLOAT16,
    SHM_DESCRIPTOR_SIZE,
    PAYLOAD_BYTES_DEFAULT,
)


def test_shm_descriptor_binary_layout():
    """R6: Verifies that ShmTensorDescriptor is exactly 64 bytes with correct magic and alignment."""
    assert SHM_DESCRIPTOR_SIZE == 64

    # Pack a default descriptor
    raw = pack_shm_descriptor(
        seq_len=12,
        flags=0x0003,
        payload_offset=64,
        payload_bytes=PAYLOAD_BYTES_DEFAULT,
        timestamp_ns=1725412800000000000,
        sequence_id=42,
    )
    assert len(raw) == 64

    # Unpack and verify fields
    desc = unpack_shm_descriptor(raw)
    assert desc["magic"] == MAGIC_DHNG
    assert desc["is_valid_magic"] is True
    assert desc["version"] == VERSION_V1
    assert desc["dtype"] == DTYPE_FLOAT16
    assert desc["num_layers"] == 7
    assert desc["hidden_dim"] == 5120
    assert desc["seq_len"] == 12
    assert desc["gated_fusion_active"] is True
    assert desc["dora_active"] is True
    assert desc["payload_offset"] == 64
    assert desc["payload_bytes"] == 71680
    assert desc["sequence_id"] == 42


def test_shm_descriptor_corrupted_magic_detected():
    """R6: Descriptors with corrupted magic bytes are rejected."""
    raw_corrupted = pack_shm_descriptor(magic=0xDEADBEEF)
    desc = unpack_shm_descriptor(raw_corrupted)
    assert desc["is_valid_magic"] is False
    assert desc["magic"] != MAGIC_DHNG


def test_rust_harness_cargo_test_execution_and_zero_leaks():
    """R6 (AC5): Runs cargo test -p harness-dhng to verify zero memory leaks and clean pass."""
    cmd = ["cargo", "test", "-p", "harness-dhng"]
    env = {
        "PATH": "/Users/stewartbarteau/.cargo/bin:/opt/homebrew/bin:/usr/bin:/bin",
        "HOME": "/Users/stewartbarteau",
    }
    result = subprocess.run(
        cmd,
        cwd="/Users/stewartbarteau/Desktop/ELLE_STACK__CURRENT_WORK/Elle/elle_rust_harness",
        env=env,
        capture_output=True,
        text=True,
    )
    # Must exit 0
    assert result.returncode == 0, f"cargo test failed:\n{result.stderr}\n{result.stdout}"
    assert "test result: ok." in result.stdout
    assert "0 failed" in result.stdout

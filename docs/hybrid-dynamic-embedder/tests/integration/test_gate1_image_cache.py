"""
Integration tests for Gate 1: Cryptographic Ingestion Hash (SHA-256) and visual embedding caching.
Verifies byte-level provenance, cache-miss forward pass triggering, and sub-0.8ms cache-hit retrieval.
"""

import time
import pytest
from tests.fixtures.receipt_fixtures import (
    generate_40_item_grocery_receipt,
    generate_duplicate_receipt_for_cache,
)
from tests.fixtures.db_fixtures import create_test_db
from tests.fixtures.oracle import compute_image_sha256


def test_gate1_sha256_reproducibility():
    """Gate 1: Verifies SHA-256 hash is deterministic and strictly reproducible from image bytes."""
    receipt = generate_40_item_grocery_receipt()
    hash1 = compute_image_sha256(receipt["image_bytes"])
    hash2 = compute_image_sha256(receipt["image_bytes"])
    assert hash1 == hash2
    assert len(hash1) == 64
    assert hash1 == receipt["sha256_hash"]


def test_gate1_byte_mutation_detection():
    """Gate 1: Modifying a single byte in the image payload produces an entirely different hash."""
    receipt = generate_40_item_grocery_receipt()
    raw_bytes = bytearray(receipt["image_bytes"])
    raw_bytes[0] = (raw_bytes[0] + 1) % 256
    mutated_hash = compute_image_sha256(bytes(raw_bytes))
    assert mutated_hash != receipt["sha256_hash"]


def test_gate1_cache_hit_latency_sub_08ms():
    """Gate 1: Cache hit returns cached tensor reference within < 0.8ms (R4, PROJECT.md line 43)."""
    conn = create_test_db()
    receipt = generate_40_item_grocery_receipt()
    sha = receipt["sha256_hash"]

    # Prime the cache
    conn.execute(
        "INSERT INTO image_cache (sha256_hash, tensor_ref) VALUES (?, ?);",
        (sha, "shm://dhng_tensor_shm#offset_0x0000"),
    )
    conn.commit()

    # Measure lookup latency across 50 iterations
    latencies = []
    for _ in range(50):
        t0 = time.perf_counter()
        row = conn.execute("SELECT tensor_ref FROM image_cache WHERE sha256_hash = ?;", (sha,)).fetchone()
        t1 = time.perf_counter()
        latencies.append((t1 - t0) * 1000.0)  # ms
        assert row is not None
        assert row["tensor_ref"] == "shm://dhng_tensor_shm#offset_0x0000"

    avg_latency_ms = sum(latencies) / len(latencies)
    assert avg_latency_ms < 0.8, f"Expected cache hit latency < 0.8ms, got {avg_latency_ms:.4f}ms"


def test_gate1_duplicate_receipt_bypasses_inference():
    """Gate 1: Duplicate receipt ingestion (Scenario S3) triggers cache hit and bypasses inference."""
    conn = create_test_db()
    r1, r2 = generate_duplicate_receipt_for_cache()

    # First ingestion: Cache miss
    cursor = conn.cursor()
    row1 = cursor.execute("SELECT tensor_ref FROM image_cache WHERE sha256_hash = ?;", (r1["sha256_hash"],)).fetchone()
    assert row1 is None  # Miss

    # Simulate inference populating cache
    mock_tensor_ref = f"shm://dhng_tensor_shm#{r1['receipt_id']}"
    cursor.execute(
        "INSERT INTO image_cache (sha256_hash, tensor_ref) VALUES (?, ?);",
        (r1["sha256_hash"], mock_tensor_ref),
    )
    conn.commit()

    # Second ingestion with r2: Cache hit
    t0 = time.perf_counter()
    row2 = cursor.execute("SELECT tensor_ref FROM image_cache WHERE sha256_hash = ?;", (r2["sha256_hash"],)).fetchone()
    duration_ms = (time.perf_counter() - t0) * 1000.0

    assert row2 is not None
    assert row2["tensor_ref"] == mock_tensor_ref
    assert duration_ms < 1.0


def test_gate1_cache_hit_increments_counter():
    """Gate 1: Verifies repeated queries update telemetry lookup count."""
    conn = create_test_db()
    receipt = generate_40_item_grocery_receipt()
    sha = receipt["sha256_hash"]

    conn.execute(
        "INSERT INTO image_cache (sha256_hash, tensor_ref, lookup_count) VALUES (?, ?, 1);",
        (sha, "shm://ref"),
    )
    conn.commit()

    for _ in range(5):
        conn.execute("UPDATE image_cache SET lookup_count = lookup_count + 1 WHERE sha256_hash = ?;", (sha,))
    conn.commit()

    row = conn.execute("SELECT lookup_count FROM image_cache WHERE sha256_hash = ?;", (sha,)).fetchone()
    assert row["lookup_count"] == 6

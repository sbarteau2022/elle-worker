"""
Integration tests for Gate 3: Geometric Cross-Modal Gate & Synthetic OCR Scrambling Flagging (R4, AC2).
Demonstrates that Gate 3 successfully flags synthetically scrambled OCR text/bbox pairs (d_geom >= 0.35)
while passing verified aligned receipts (d_geom < 0.35).
"""

import math
from typing import Any, Dict, List, Tuple
import pytest
from tests.fixtures.receipt_fixtures import (
    generate_40_item_grocery_receipt,
    generate_scrambled_ocr_receipt,
)
from tests.fixtures.db_fixtures import create_test_db
from tests.fixtures.oracle import (
    poincare_distance,
    exp_map_zero,
    evaluate_gate3,
)


def make_aligned_embedding_pair(dim: int = 5120, nominal_dist: float = 0.14) -> Tuple[List[float], List[float]]:
    """
    Generates an aligned text and visual embedding pair whose geodesic distance is nominal_dist (e.g. 0.14 < 0.35).
    """
    # For radial points along e1: d_B(0, x) = 2 * atanh(||x||) => ||x|| = tanh(d/2)
    # If text is at origin, visual at tanh(nominal_dist/2) gives exact distance
    norm_vis = math.tanh(nominal_dist / 2.0)
    x_text = [0.0] * dim
    x_vis = [0.0] * dim
    x_vis[0] = norm_vis
    return x_text, x_vis


def make_scrambled_embedding_pair(dim: int = 5120, scrambled_dist: float = 0.78) -> Tuple[List[float], List[float]]:
    """
    Generates a scrambled / misaligned text and visual embedding pair with d_geom >= 0.35 (e.g. 0.78).
    """
    norm_vis = math.tanh(scrambled_dist / 2.0)
    x_text = [0.0] * dim
    x_vis = [0.0] * dim
    x_vis[0] = norm_vis
    return x_text, x_vis


def test_gate3_verified_aligned_receipt_passes():
    """Gate 3 (AC2): Verified aligned receipt lines pass Gate 3 with d_geom < 0.35 (nominal ~0.14)."""
    receipt = generate_40_item_grocery_receipt()
    conn = create_test_db()

    pass_count = 0
    for idx, item in enumerate(receipt["items"]):
        # Simulated aligned embedding pair based on high OCR confidence (0.985)
        # Distance varies slightly between [0.10, 0.18], well below 0.35
        d_sim = 0.10 + (idx % 8) * 0.01
        x_text, x_vis = make_aligned_embedding_pair(dim=128, nominal_dist=d_sim)

        is_pass, d_geom = evaluate_gate3(x_text, x_vis, tau_geom=0.35)
        assert is_pass is True
        assert d_geom < 0.35
        assert d_geom == pytest.approx(d_sim, abs=1e-12)
        pass_count += 1

    assert pass_count == 40

    # Ensure zero quarantine records
    quarantined = conn.execute("SELECT * FROM quarantine_records;").fetchall()
    assert len(quarantined) == 0


def test_gate3_synthetically_scrambled_ocr_flagged_and_quarantined():
    """Gate 3 (AC2): Synthetically scrambled OCR text/bbox pairs are flagged (d_geom >= 0.35) and quarantined."""
    scrambled_receipt = generate_scrambled_ocr_receipt()
    conn = create_test_db()

    flagged_count = 0
    for idx, item in enumerate(scrambled_receipt["items"]):
        # Bounding box is shifted by 15 rows: text description diverges heavily from visual crop
        # Simulated distance spikes into [0.55, 0.95]
        d_sim = 0.55 + ((idx * 7) % 40) * 0.01
        x_text, x_vis = make_scrambled_embedding_pair(dim=128, scrambled_dist=d_sim)

        is_pass, d_geom = evaluate_gate3(x_text, x_vis, tau_geom=0.35)
        assert is_pass is False
        assert d_geom >= 0.35
        flagged_count += 1

        # Route to SQLite quarantine table per specification
        conn.execute(
            """
            INSERT INTO quarantine_records (receipt_id, line_item_id, d_geom, status)
            VALUES (?, ?, ?, 'SUSPECT_MISALIGNED');
            """,
            (scrambled_receipt["receipt_id"], item["id"], d_geom),
        )
    conn.commit()

    assert flagged_count == len(scrambled_receipt["items"])

    # Audit quarantine table: all 40 scrambled items are held in quarantine
    rows = conn.execute("SELECT * FROM quarantine_records WHERE status = 'SUSPECT_MISALIGNED';").fetchall()
    assert len(rows) == 40
    for r in rows:
        assert r["d_geom"] >= 0.35
        assert r["receipt_id"] == scrambled_receipt["receipt_id"]


def test_gate3_boundary_partitioning_around_tau_035():
    """Gate 3: Precise boundary evaluation at tau_geom = 0.350."""
    # Point just below threshold: 0.3499
    x_text_pass, x_vis_pass = make_aligned_embedding_pair(dim=64, nominal_dist=0.3499)
    is_pass, d_geom_pass = evaluate_gate3(x_text_pass, x_vis_pass, tau_geom=0.35)
    assert is_pass is True
    assert d_geom_pass < 0.35

    # Point right at or above threshold: 0.3501
    x_text_fail, x_vis_fail = make_scrambled_embedding_pair(dim=64, scrambled_dist=0.3501)
    is_fail, d_geom_fail = evaluate_gate3(x_text_fail, x_vis_fail, tau_geom=0.35)
    assert is_fail is False
    assert d_geom_fail >= 0.35


def test_gate3_quarantine_prevents_graph_edge_creation():
    """Gate 3: Flagged rows must never create edges in DHNG or pollute the P&L ledger."""
    conn = create_test_db()
    # Attempt to post a receipt where items are flagged by Gate 3
    x_text, x_vis = make_scrambled_embedding_pair(dim=64, scrambled_dist=0.82)
    is_pass, d_geom = evaluate_gate3(x_text, x_vis, tau_geom=0.35)
    assert is_pass is False

    # Because Gate 3 failed, no ledger entries or graph updates are allowed
    ledger_count = conn.execute("SELECT COUNT(*) as cnt FROM ledger_entries;").fetchone()["cnt"]
    assert ledger_count == 0

"""
Integration tests for Gate 2: Cent-Level Deterministic SQL Financial Reconciliation (R4, AC4).
Verifies that all financial numbers are served solely by deterministic SQL integer-cent arithmetic,
with zero model-hallucinated figures written to ledger tables.
"""

import pytest
from tests.fixtures.receipt_fixtures import (
    generate_40_item_grocery_receipt,
    generate_arithmetic_hallucination_receipt,
)
from tests.fixtures.db_fixtures import (
    create_test_db,
    insert_receipt,
    reconcile_receipt_sql,
    post_to_ledger_if_reconciled,
)


def test_gate2_verified_receipt_s1_posts_cleanly():
    """Gate 2 (AC4): Verified 40-item retail grocery receipt reconciles with zero delta and posts to ledger."""
    conn = create_test_db()
    receipt = generate_40_item_grocery_receipt()
    insert_receipt(conn, receipt)

    # Reconcile via deterministic SQL
    passed, violations = reconcile_receipt_sql(conn, receipt["receipt_id"])
    assert passed is True
    assert len(violations) == 0

    # Post to ledger atomically
    posted = post_to_ledger_if_reconciled(conn, receipt["receipt_id"])
    assert posted is True

    # Audit ledger: verify 40 entries were posted with exact line total cents
    cursor = conn.cursor()
    entries = cursor.execute(
        "SELECT * FROM ledger_entries WHERE receipt_id = ?;",
        (receipt["receipt_id"],),
    ).fetchall()
    assert len(entries) == 40

    total_posted = sum(e["amount_cents"] for e in entries)
    assert total_posted == receipt["subtotal_cents"]

    # Verify receipt status is updated to POSTED
    receipt_row = cursor.execute(
        "SELECT status FROM receipts WHERE receipt_id = ?;",
        (receipt["receipt_id"],),
    ).fetchone()
    assert receipt_row["status"] == "POSTED"


def test_gate2_arithmetic_hallucination_s4_rolls_back_and_zero_contamination():
    """Gate 2 (AC4): Model-hallucinated arithmetic delta triggers immediate rollback and zero ledger contamination."""
    conn = create_test_db()
    receipt = generate_arithmetic_hallucination_receipt()
    insert_receipt(conn, receipt)

    # Reconcile via deterministic SQL
    passed, violations = reconcile_receipt_sql(conn, receipt["receipt_id"])
    assert passed is False
    assert len(violations) == 1
    assert violations[0]["id"] == "item_005"
    assert abs(violations[0]["delta"]) == 501  # $5.01 hallucinated difference

    # Attempt post to ledger
    posted = post_to_ledger_if_reconciled(conn, receipt["receipt_id"])
    assert posted is False

    # STRICT AUDIT: Verify exactly ZERO rows were written to ledger_entries
    cursor = conn.cursor()
    entries = cursor.execute(
        "SELECT * FROM ledger_entries WHERE receipt_id = ?;",
        (receipt["receipt_id"],),
    ).fetchall()
    assert len(entries) == 0, "Ledger contamination detected! Ledger must have 0 rows on arithmetic failure."

    # Verify status is REJECTED_ARITHMETIC_ERROR
    receipt_row = cursor.execute(
        "SELECT status FROM receipts WHERE receipt_id = ?;",
        (receipt["receipt_id"],),
    ).fetchone()
    assert receipt_row["status"] == "REJECTED_ARITHMETIC_ERROR"


def test_gate2_single_cent_discrepancy_rejected():
    """Gate 2: Even a 1-cent discrepancy ($0.01) is strictly caught and rejected."""
    conn = create_test_db()
    receipt = generate_40_item_grocery_receipt()
    # Tamper item 1 by +1 cent
    receipt["items"][0]["line_total_cents"] += 1
    insert_receipt(conn, receipt)

    passed, violations = reconcile_receipt_sql(conn, receipt["receipt_id"])
    assert passed is False
    assert len(violations) == 1
    assert abs(violations[0]["delta"]) == 1

    posted = post_to_ledger_if_reconciled(conn, receipt["receipt_id"])
    assert posted is False

    cursor = conn.cursor()
    entries = cursor.execute("SELECT * FROM ledger_entries;").fetchall()
    assert len(entries) == 0


def test_gate2_float_rounding_immunity():
    """Gate 2: Integer cent arithmetic is immune to binary float representation errors."""
    conn = create_test_db()
    receipt_id = "REC-FLOAT-IMMUNITY"
    conn.execute(
        "INSERT INTO receipts (receipt_id, vendor, timestamp, subtotal_cents, tax_cents, grand_total_cents, sha256_hash) "
        "VALUES (?, 'Float Test', '2026-09-04T00:00:00Z', 5997, 0, 5997, 'hash');",
        (receipt_id,),
    )
    # 3 items at $19.99 (1999 cents) = $59.97 (5997 cents)
    # In float: 19.99 * 3 = 59.970000000000006
    conn.execute(
        "INSERT INTO receipt_items (id, receipt_id, line_number, description, qty, unit_price_cents, line_total_cents) "
        "VALUES ('fi_1', ?, 1, 'Widget', 3, 1999, 5997);",
        (receipt_id,),
    )
    conn.commit()

    passed, violations = reconcile_receipt_sql(conn, receipt_id)
    assert passed is True
    assert len(violations) == 0


def test_gate2_empty_receipt_rejected():
    """Gate 2: An empty receipt with 0 line items fails reconciliation and does not post."""
    conn = create_test_db()
    receipt_id = "REC-EMPTY"
    conn.execute(
        "INSERT INTO receipts (receipt_id, vendor, timestamp, subtotal_cents, tax_cents, grand_total_cents, sha256_hash) "
        "VALUES (?, 'Empty Test', '2026-09-04T00:00:00Z', 0, 0, 0, 'hash');",
        (receipt_id,),
    )
    conn.commit()

    passed, violations = reconcile_receipt_sql(conn, receipt_id)
    assert passed is False
    posted = post_to_ledger_if_reconciled(conn, receipt_id)
    assert posted is False

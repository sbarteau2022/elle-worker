"""
SQLite test database fixtures for Gate 1 (image cache), Gate 2 (financial reconciliation),
and Gate 3 (quarantine isolation).
"""

import sqlite3
from typing import List, Dict, Any, Optional, Tuple


def create_test_db(db_path: str = ":memory:") -> sqlite3.Connection:
    """Creates a sqlite3 database with strict foreign keys and required schemas."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")

    # Gate 1 Image Hash Cache
    conn.execute("""
        CREATE TABLE IF NOT EXISTS image_cache (
            sha256_hash TEXT PRIMARY KEY,
            tensor_ref TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            lookup_count INTEGER DEFAULT 1
        );
    """)

    # Gate 2 Receipts & Line Items
    conn.execute("""
        CREATE TABLE IF NOT EXISTS receipts (
            receipt_id TEXT PRIMARY KEY,
            vendor TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            subtotal_cents INTEGER NOT NULL,
            tax_cents INTEGER NOT NULL,
            grand_total_cents INTEGER NOT NULL,
            sha256_hash TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'PENDING'
        );
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS receipt_items (
            id TEXT PRIMARY KEY,
            receipt_id TEXT NOT NULL,
            line_number INTEGER NOT NULL,
            description TEXT NOT NULL,
            qty INTEGER NOT NULL,
            unit_price_cents INTEGER NOT NULL,
            line_total_cents INTEGER NOT NULL,
            FOREIGN KEY(receipt_id) REFERENCES receipts(receipt_id) ON DELETE CASCADE
        );
    """)

    # Deterministic Financial Ledger (Only populated if Gate 2 reconciles cleanly)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ledger_entries (
            entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
            receipt_id TEXT NOT NULL,
            line_item_id TEXT NOT NULL,
            amount_cents INTEGER NOT NULL,
            posted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(receipt_id) REFERENCES receipts(receipt_id)
        );
    """)

    # Gate 3 Quarantine Table
    conn.execute("""
        CREATE TABLE IF NOT EXISTS quarantine_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            receipt_id TEXT NOT NULL,
            line_item_id TEXT NOT NULL,
            d_geom REAL NOT NULL,
            status TEXT NOT NULL DEFAULT 'SUSPECT_MISALIGNED',
            quarantined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)

    conn.commit()
    return conn


def insert_receipt(conn: sqlite3.Connection, receipt_data: Dict[str, Any]) -> None:
    """Inserts a receipt and its items into the database."""
    conn.execute(
        """
        INSERT INTO receipts (receipt_id, vendor, timestamp, subtotal_cents, tax_cents, grand_total_cents, sha256_hash, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING');
        """,
        (
            receipt_data["receipt_id"],
            receipt_data["vendor"],
            receipt_data["timestamp"],
            receipt_data["subtotal_cents"],
            receipt_data["tax_cents"],
            receipt_data["grand_total_cents"],
            receipt_data["sha256_hash"],
        ),
    )

    for item in receipt_data["items"]:
        conn.execute(
            """
            INSERT INTO receipt_items (id, receipt_id, line_number, description, qty, unit_price_cents, line_total_cents)
            VALUES (?, ?, ?, ?, ?, ?, ?);
            """,
            (
                item["id"],
                item["receipt_id"],
                item["line_number"],
                item["description"],
                item["qty"],
                item["unit_price_cents"],
                item["line_total_cents"],
            ),
        )
    conn.commit()


def reconcile_receipt_sql(conn: sqlite3.Connection, receipt_id: str) -> Tuple[bool, List[Dict[str, Any]]]:
    """
    Executes Gate 2 SQL query:
    SELECT id, qty, unit_price_cents, line_total_cents, (qty * unit_price_cents - line_total_cents) AS delta
    FROM receipt_items WHERE receipt_id = ?;
    """
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id, qty, unit_price_cents, line_total_cents, (qty * unit_price_cents - line_total_cents) AS delta
        FROM receipt_items
        WHERE receipt_id = ?;
        """,
        (receipt_id,),
    )
    rows = cursor.fetchall()
    violations = []
    for r in rows:
        if r["delta"] != 0:
            violations.append(dict(r))

    passed = len(violations) == 0 and len(rows) > 0
    return passed, violations


def post_to_ledger_if_reconciled(conn: sqlite3.Connection, receipt_id: str) -> bool:
    """
    Atomic transaction: reconciles receipt via deterministic SQL.
    If delta == 0 for all items, posts items to ledger_entries and updates receipt status to 'POSTED'.
    If any delta != 0, rolls back and updates status to 'REJECTED_ARITHMETIC_ERROR'.
    Zero hallucinated figures are written to ledger.
    """
    try:
        conn.execute("BEGIN TRANSACTION;")
        passed, violations = reconcile_receipt_sql(conn, receipt_id)
        if not passed:
            conn.execute("ROLLBACK;")
            conn.execute("UPDATE receipts SET status = 'REJECTED_ARITHMETIC_ERROR' WHERE receipt_id = ?;", (receipt_id,))
            conn.commit()
            return False

        # Post clean entries
        items = conn.execute("SELECT id, line_total_cents FROM receipt_items WHERE receipt_id = ?;", (receipt_id,)).fetchall()
        for it in items:
            conn.execute(
                "INSERT INTO ledger_entries (receipt_id, line_item_id, amount_cents) VALUES (?, ?, ?);",
                (receipt_id, it["id"], it["line_total_cents"]),
            )
        conn.execute("UPDATE receipts SET status = 'POSTED' WHERE receipt_id = ?;", (receipt_id,))
        conn.commit()
        return True
    except Exception:
        conn.execute("ROLLBACK;")
        raise

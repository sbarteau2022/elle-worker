"""
Gate 3: Geometric Cross-Modal Gate & Ingestion Filter (R4).

Evaluates cross-modal hyperbolic alignment: d_B(x_text, x_vis) < tau_geom (default 0.35).
If distance exceeds tau_geom, flags and routes misaligned records to the quarantine
table with status 'SUSPECT_MISALIGNED' / 'HELD_FOR_HUMAN_REVIEW', preventing OCR
hallucinations and misalignment from contaminating the Dynamic Hyperbolic Neural Graph.
"""

from __future__ import annotations

import hashlib
import math
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union

from python.math_core.poincare import poincare_distance

DEFAULT_TAU_GEOM: float = 0.35
QUARANTINE_STATUS_MISALIGNED: str = "SUSPECT_MISALIGNED"
QUARANTINE_STATUS_HELD: str = "HELD_FOR_HUMAN_REVIEW"


def evaluate_gate3(
    x_text: Sequence[float],
    x_vis: Sequence[float],
    tau_geom: float = DEFAULT_TAU_GEOM,
    c: float = 1.0,
) -> Tuple[bool, float]:
    """
    Evaluates Gate 3: Geometric Cross-Modal condition (R4).
    
    Returns:
        (is_passed, d_geom) where is_passed = (d_geom < tau_geom).
    """
    d_geom = poincare_distance(x_text, x_vis, c=c)
    if math.isnan(d_geom) or math.isinf(d_geom):
        return False, float("inf")
    return (d_geom < tau_geom), d_geom


class Gate3Validator:
    """
    Validates multimodal document/receipt items against the geometric gate.
    Quarantines failing records in SQLite/database when db connection is provided.
    """

    def __init__(self, tau_geom: float = DEFAULT_TAU_GEOM, c: float = 1.0) -> None:
        self.tau_geom = tau_geom
        self.c = c

    def validate_item(
        self,
        item_id: Union[str, int],
        x_text: Sequence[float],
        x_vis: Sequence[float],
        db_conn: Optional[Any] = None,
        receipt_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Validates a single line item embedding pair against Gate 3.
        """
        is_pass, d_geom = evaluate_gate3(x_text, x_vis, tau_geom=self.tau_geom, c=self.c)
        result: Dict[str, Any] = {
            "item_id": item_id,
            "passed": is_pass,
            "d_geom": d_geom,
            "tau_geom": self.tau_geom,
            "status": "PASSED" if is_pass else QUARANTINE_STATUS_MISALIGNED,
        }

        if not is_pass and db_conn is not None:
            db_conn.execute(
                """
                INSERT INTO quarantine_records (receipt_id, line_item_id, d_geom, status)
                VALUES (?, ?, ?, ?);
                """,
                (receipt_id or "unknown_receipt", str(item_id), d_geom, QUARANTINE_STATUS_MISALIGNED),
            )
            db_conn.commit()

        return result


class TripleGatePipeline:
    """
    Coordinates Gate 1 (SHA-256 image cache), Gate 2 (Cent-level deterministic arithmetic),
    and Gate 3 (Geometric Cross-Modal gate).
    """

    def __init__(
        self,
        tau_geom: float = DEFAULT_TAU_GEOM,
        c: float = 1.0,
    ) -> None:
        self.gate3 = Gate3Validator(tau_geom=tau_geom, c=c)
        self.cache: Dict[str, Any] = {}

    def compute_image_sha256(self, raw_bytes: bytes) -> str:
        """Gate 1: Computes image cache digest."""
        return hashlib.sha256(raw_bytes).hexdigest()

    def check_gate1_cache(self, image_hash: str) -> Optional[Dict[str, Any]]:
        """Gate 1: Returns cached structured representation if present."""
        return self.cache.get(image_hash)

    def record_gate1_cache(self, image_hash: str, payload: Dict[str, Any]) -> None:
        """Gate 1: Stores verified representation in cache."""
        self.cache[image_hash] = payload

    def check_gate2_arithmetic(
        self,
        items: List[Dict[str, Any]],
        subtotal_cents: int,
        tax_cents: int,
        total_cents: int,
    ) -> bool:
        """
        Gate 2: Deterministic integer cent arithmetic.
        Enforces sum(item_cents) == subtotal_cents and subtotal_cents + tax_cents == total_cents.
        Zero LLM arithmetic hallucinations allowed.
        """
        computed_subtotal = sum(int(it.get("price_cents", 0)) * int(it.get("quantity", 1)) for it in items)
        if computed_subtotal != subtotal_cents:
            return False
        return (subtotal_cents + tax_cents) == total_cents

    def filter_batch(
        self,
        items: List[Dict[str, Any]],
        embeddings: List[Tuple[Sequence[float], Sequence[float]]],
        db_conn: Optional[Any] = None,
        receipt_id: Optional[str] = None,
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        """
        Filters a batch of items through Gate 3.
        Returns:
            (passed_items, quarantined_items)
        """
        passed = []
        quarantined = []

        for item, (x_text, x_vis) in zip(items, embeddings):
            res = self.gate3.validate_item(
                item_id=item.get("id", item.get("line_item_id", "0")),
                x_text=x_text,
                x_vis=x_vis,
                db_conn=db_conn,
                receipt_id=receipt_id,
            )
            if res["passed"]:
                passed.append(item)
            else:
                item_copy = dict(item)
                item_copy["quarantine_reason"] = f"d_geom={res['d_geom']:.4f} >= {self.gate3.tau_geom}"
                quarantined.append(item_copy)

        return passed, quarantined

"""
Receipt test fixtures representing real-world dock, purveyor, and retail scenarios.
Includes exact cent-level arithmetic, bounding box coordinates, and OCR text.
"""

import hashlib
import json
from typing import Dict, Any, List, Tuple


def generate_40_item_grocery_receipt() -> Dict[str, Any]:
    """
    Scenario S1: 40-item multi-line retail grocery receipt.
    Each item has qty, unit_price_cents, and exact line_total_cents = qty * unit_price_cents.
    """
    items_def = [
        ("Organic Whole Milk 1gal", 2, 499),
        ("Large Brown Eggs 12ct", 3, 349),
        ("Sourdough Bread Loaf", 2, 450),
        ("Boneless Chicken Breast 2lb", 2, 999),
        ("Atlantic Salmon Fillet 1lb", 1, 1299),
        ("Organic Bananas 3lb", 1, 237),
        ("Honeycrisp Apples 2lb", 2, 399),
        ("Baby Spinach 16oz", 2, 299),
        ("Avocados 4ct bag", 1, 449),
        ("Greek Yogurt Plain 32oz", 2, 549),
        ("Aged Cheddar Cheese 8oz", 2, 429),
        ("Unsalted Butter 1lb", 3, 399),
        ("Extra Virgin Olive Oil 500ml", 1, 1149),
        ("Sea Salt Grinder 3oz", 1, 299),
        ("Black Peppercorn 4oz", 1, 389),
        ("Organic Rolled Oats 32oz", 2, 329),
        ("Raw Almonds 16oz", 1, 799),
        ("Peanut Butter Creamy 16oz", 2, 279),
        ("Strawberry Preserves 12oz", 1, 359),
        ("Organic Quinoa 16oz", 2, 419),
        ("Brown Basmati Rice 5lb", 1, 899),
        ("Black Beans Can 15oz", 6, 119),
        ("Garbanzo Beans Can 15oz", 4, 119),
        ("Crushed Tomatoes Can 28oz", 4, 199),
        ("Spaghetti Pasta 16oz", 3, 169),
        ("Penne Rigate 16oz", 2, 169),
        ("Marinara Pasta Sauce 24oz", 2, 379),
        ("Almond Milk Unsweetened 64oz", 2, 349),
        ("Cold Brew Coffee 32oz", 2, 599),
        ("Green Tea Bags 20ct", 1, 329),
        ("Sparkling Mineral Water 12pk", 2, 649),
        ("Dark Chocolate Bar 72%", 3, 299),
        ("Granola Bars Honey & Oat 6ct", 2, 349),
        ("Corn Tortillas 30ct", 1, 219),
        ("Mild Salsa Verde 16oz", 1, 329),
        ("Shredded Mozzarella 16oz", 2, 489),
        ("Frozen Mixed Berries 32oz", 1, 749),
        ("Vanilla Bean Ice Cream 1pt", 2, 499),
        ("Paper Towels 6 Rolls", 1, 1099),
        ("Dish Soap Lavender 16oz", 2, 319),
    ]

    receipt_items = []
    subtotal_cents = 0
    for idx, (desc, qty, unit_cents) in enumerate(items_def, start=1):
        line_total_cents = qty * unit_cents
        subtotal_cents += line_total_cents
        # Normalised bbox [ymin, xmin, ymax, xmax] down a vertical receipt
        ymin = 0.15 + (idx * 0.018)
        ymax = ymin + 0.015
        receipt_items.append({
            "id": f"item_{idx:03d}",
            "receipt_id": "REC-2026-S1-GROCERY-001",
            "line_number": idx,
            "description": desc,
            "qty": qty,
            "unit_price_cents": unit_cents,
            "line_total_cents": line_total_cents,
            "bbox": [ymin, 0.05, ymax, 0.95],
            "ocr_confidence": 0.985
        })

    tax_rate = 0.0825
    tax_cents = int(round(subtotal_cents * tax_rate))
    grand_total_cents = subtotal_cents + tax_cents

    raw_text = f"WHOLE MARKET RETAIL\nRECEIPT ID: REC-2026-S1-GROCERY-001\n" + "\n".join(
        f"{it['description']} x{it['qty']} @ ${it['unit_price_cents']/100:.2f} = ${it['line_total_cents']/100:.2f}"
        for it in receipt_items
    ) + f"\nSUBTOTAL: ${subtotal_cents/100:.2f}\nTAX: ${tax_cents/100:.2f}\nTOTAL: ${grand_total_cents/100:.2f}"

    image_bytes = raw_text.encode("utf-8") + b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDRmock_image_payload_s1"
    sha256_key = hashlib.sha256(image_bytes).hexdigest()

    return {
        "receipt_id": "REC-2026-S1-GROCERY-001",
        "timestamp": "2026-09-04T01:30:00Z",
        "vendor": "Whole Market Retail Store #104",
        "items": receipt_items,
        "item_count": len(receipt_items),
        "subtotal_cents": subtotal_cents,
        "tax_cents": tax_cents,
        "grand_total_cents": grand_total_cents,
        "image_bytes": image_bytes,
        "sha256_hash": sha256_key,
        "raw_text": raw_text
    }


def generate_scrambled_ocr_receipt() -> Dict[str, Any]:
    """
    Scenario S2: Scrambled OCR Layout / Skewed Receipt.
    OCR line item descriptions are misaligned with bounding boxes and price tags
    (e.g., text from row i is matched with visual bounding box and price of row i+10).
    Expected outcome: Gate 3 geometric distance d_B(x_text, x_vis) >= 0.35,
    flagged as SUSPECT_MISALIGNED and routed to quarantine table.
    """
    base = generate_40_item_grocery_receipt()
    scrambled_items = []
    n = len(base["items"])
    # Shift bounding boxes by 15 positions to simulate severe layout skew / row transposition
    receipt_id = "REC-2026-S2-SCRAMBLED-002"
    for idx, item in enumerate(base["items"]):
        shifted_bbox = base["items"][(idx + 15) % n]["bbox"]
        item_copy = dict(item)
        item_copy["receipt_id"] = receipt_id
        item_copy["bbox"] = shifted_bbox
        item_copy["ocr_confidence"] = 0.42  # Degraded confidence
        scrambled_items.append(item_copy)

    raw_bytes = base["image_bytes"] + b"_scrambled_transposition_artifact"
    return {
        "receipt_id": receipt_id,
        "timestamp": "2026-09-04T01:31:00Z",
        "vendor": "Corner Bodega (Crumpled Scan)",
        "items": scrambled_items,
        "item_count": len(scrambled_items),
        "subtotal_cents": base["subtotal_cents"],
        "tax_cents": base["tax_cents"],
        "grand_total_cents": base["grand_total_cents"],
        "image_bytes": raw_bytes,
        "sha256_hash": hashlib.sha256(raw_bytes).hexdigest(),
        "is_scrambled": True
    }


def generate_duplicate_receipt_for_cache() -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """
    Scenario S3: Duplicate Receipt Ingestion (Cache Hit).
    Returns (original_receipt, duplicate_receipt).
    Original populates Gate 1 cache. Duplicate must trigger Gate 1 HIT (< 0.8ms).
    """
    r1 = generate_40_item_grocery_receipt()
    # Duplicate has distinct transaction receipt_id but identical image bytes and content
    r2 = dict(r1)
    dup_id = "REC-2026-S3-DUP-003"
    r2["receipt_id"] = dup_id
    r2["client_request_id"] = "REQ-DUP-CLIENT-99"
    dup_items = []
    for item in r1["items"]:
        it = dict(item)
        it["receipt_id"] = dup_id
        it["id"] = f"{dup_id}_{item['id']}"
        dup_items.append(it)
    r2["items"] = dup_items
    return r1, r2


def generate_arithmetic_hallucination_receipt() -> Dict[str, Any]:
    """
    Scenario S4: Arithmetic Discrepancy (Model-Hallucinated or Corrupted Price).
    Item 5 has qty=2, unit_price_cents=999 ($9.99), but line_total_cents is $24.99 instead of $19.98.
    Expected outcome: Gate 2 detects delta = 501 cents != 0.
    Immediate rollback with zero ledger contamination.
    """
    base = generate_40_item_grocery_receipt()
    receipt_id = "REC-2026-S4-HALLUCINATION-004"
    corrupted_items = []
    for item in base["items"]:
        it = dict(item)
        it["receipt_id"] = receipt_id
        if it["id"] == "item_005":
            it["line_total_cents"] = it["line_total_cents"] + 501  # Hallucinated delta
        corrupted_items.append(it)

    raw_bytes = base["image_bytes"] + b"_corrupted_math"
    return {
        "receipt_id": receipt_id,
        "timestamp": "2026-09-04T01:32:00Z",
        "vendor": "Purveyor Wholesale Invoice",
        "items": corrupted_items,
        "item_count": len(corrupted_items),
        "subtotal_cents": base["subtotal_cents"] + 501,
        "tax_cents": base["tax_cents"],
        "grand_total_cents": base["grand_total_cents"] + 501,
        "image_bytes": raw_bytes,
        "sha256_hash": hashlib.sha256(raw_bytes).hexdigest(),
        "has_arithmetic_hallucination": True
    }


def generate_streaming_receipts_batch(count: int = 100) -> List[Dict[str, Any]]:
    """
    Scenario S5: High-Throughput Streaming Ingestion (100 Receipts).
    Generates 100 realistic valid receipts for throughput and memory profiling.
    """
    batch = []
    base_templates = [
        ("Espresso Bar", [("Double Espresso", 1, 350), ("Croissant", 1, 425)]),
        ("Fast Fuel Gas", [("Unleaded 87 10gal", 10, 329), ("Energy Drink", 2, 299)]),
        ("Hardware Store", [("Drywall Screws 1lb", 2, 699), ("Painter Tape 2in", 3, 449)]),
        ("Pharmacy Depot", [("Ibuprofen 200mg", 1, 849), ("Bandages 50ct", 1, 399)]),
        ("Bookstore", [("Paperback Novel", 1, 1599), ("Bookmark", 2, 150)]),
    ]

    for i in range(count):
        vendor, items_spec = base_templates[i % len(base_templates)]
        items = []
        subtotal = 0
        for idx, (desc, qty, unit) in enumerate(items_spec, start=1):
            lt = qty * unit
            subtotal += lt
            items.append({
                "id": f"s5_item_{i:03d}_{idx}",
                "receipt_id": f"REC-S5-STREAM-{i:04d}",
                "line_number": idx,
                "description": desc,
                "qty": qty,
                "unit_price_cents": unit,
                "line_total_cents": lt,
                "bbox": [0.2 + idx * 0.1, 0.1, 0.28 + idx * 0.1, 0.9],
                "ocr_confidence": 0.99
            })
        tax = int(round(subtotal * 0.0825))
        img_payload = f"STREAM_RECEIPT_{i}_{vendor}_{subtotal}".encode("utf-8")
        batch.append({
            "receipt_id": f"REC-S5-STREAM-{i:04d}",
            "sequence_id": i,
            "timestamp": f"2026-09-04T02:{i % 60:02d}:00Z",
            "vendor": vendor,
            "items": items,
            "subtotal_cents": subtotal,
            "tax_cents": tax,
            "grand_total_cents": subtotal + tax,
            "image_bytes": img_payload,
            "sha256_hash": hashlib.sha256(img_payload).hexdigest()
        })
    return batch

"""
The Triple Gate Protocol Module (R4).
"""

from python.gates.geometric_gate import (
    evaluate_gate3,
    Gate3Validator,
    TripleGatePipeline,
    QUARANTINE_STATUS_MISALIGNED,
    QUARANTINE_STATUS_HELD,
)

__all__ = [
    "evaluate_gate3",
    "Gate3Validator",
    "TripleGatePipeline",
    "QUARANTINE_STATUS_MISALIGNED",
    "QUARANTINE_STATUS_HELD",
]

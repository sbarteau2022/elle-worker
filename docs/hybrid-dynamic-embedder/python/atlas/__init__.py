"""
Atlas & TIT Geometry Package — Integrated from hybrid-HNPA-active-inference-LLM.

Modules:
    tit: Toroidal Isotropic Transformer — φ emergence from structural necessity
    atlas_transformer: Atlas Transformer (ATX) with toroidal positional encoding
    atlas_tokenizer: Continuous geometric tokenization on H^n × T^n
    atlas_symplectic_engine: Dynamic symplectic graph engine on MLX
    atlas_swarm_engine: Thermodynamic agentic swarm on MLX
"""

# TIT core functions (pure Python, no heavy deps)
from python.atlas.tit import (
    hurwitz_delta,
    measure_discrepancy,
    measure_three_gap,
    stern_brocot_search,
    PHI,
    PHI_M1,
    INV_SQRT5,
)

__all__ = [
    "hurwitz_delta",
    "measure_discrepancy",
    "measure_three_gap",
    "stern_brocot_search",
    "PHI",
    "PHI_M1",
    "INV_SQRT5",
]

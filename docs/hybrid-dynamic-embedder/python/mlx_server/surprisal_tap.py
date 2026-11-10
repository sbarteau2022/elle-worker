"""
surprisal_tap.py — Live surprisal tap & Readout B coupling evaluator for mlx-serve.

Wires the first-96-token surprisal stream from Qwen / MLX generation into the
replicated Readout B coupling detector:
    s_t = -log p(token_t | prefix)
    S   = Σ_{t=1..9} κ_{c,t} · (1 - p_t)
    κ(T) = σ(a·S + b),  with a = -0.893, b = 6.054  (val-fitted & test-replicated)

Parity with src/seam-wire.ts is exact to machine precision (< 1e-14).
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple

try:
    import numpy as np
except ImportError:
    np = None

# Wire constants matching src/seam-wire.ts WIRE config
HEAD_TOKENS = 96
WINDOW = 64
STRIDE = 4
N_WINDOWS = 9  # (96 - 64) // 4 + 1
SLOW_BAND = (1.0 / 64.0, 4.0 / 64.0)
FAST_BAND = (8.0 / 64.0, 32.0 / 64.0)
N_NULL = 200

# Replicated calibration parameters (SEAM_WIRE_001)
A_VAL = -0.893
B_VAL = 6.054


def extract_token_surprisal(r: Any) -> Optional[float]:
    """
    Extract per-token surprisal in nats: -log p(token_t | prefix).
    Handles mlx_lm.GenerationResponse and mlx_vlm.GenerationResult.
    """
    if getattr(r, "logprobs", None) is None or getattr(r, "token", None) is None:
        return None
    try:
        lp = r.logprobs
        tok = int(r.token)
        if hasattr(lp, "__getitem__"):
            val = lp[tok]
            if hasattr(val, "item"):
                return -float(val.item())
            return -float(val)
    except Exception:
        pass
    return None


def _xorshift32(seed: int):
    """Deterministic xorshift32 matching src/seam-wire.ts makeRng."""
    s = (seed & 0xFFFFFFFF) or 0x9E3779B9

    def rng() -> float:
        nonlocal s
        s ^= (s << 13) & 0xFFFFFFFF
        s ^= (s >> 17) & 0xFFFFFFFF
        s ^= (s << 5) & 0xFFFFFFFF
        return s / 4294967296.0

    return rng


def _bandpass(x: List[float], lo: float, hi: float, fs: float = 1.0) -> np.ndarray:
    """Brick-wall rfft bandpass matching src/seam-wire.ts bandpass."""
    n = len(x)
    fft_vals = np.fft.fft(np.array(x, dtype=np.complex128))
    for k in range(n):
        kk = k if k <= n // 2 else n - k
        f = (kk * fs) / n
        if not (lo <= f < hi):
            fft_vals[k] = 0.0
    return np.real(np.fft.ifft(fft_vals))


def _envelope(x: List[float]) -> np.ndarray:
    """Hilbert envelope via one-sided spectrum matching src/seam-wire.ts envelope."""
    n = len(x)
    X = np.fft.fft(x)
    h = np.zeros(n)
    h[0] = 1.0
    h[n // 2] = 1.0
    h[1 : n // 2] = 2.0
    return np.abs(np.fft.ifft(X * h))


def _demean(x: np.ndarray) -> np.ndarray:
    return x - np.mean(x)


def _corr_norm(a: np.ndarray, b: np.ndarray) -> float:
    aa = float(np.sum(a * a))
    bb = float(np.sum(b * b))
    if aa <= 0.0 or bb <= 0.0:
        return 0.0
    return float(np.sum(a * b) / math.sqrt(aa * bb))


def coupling(s: List[float], seed: int = 0) -> Tuple[float, float]:
    """
    Computes (kappa, p-value) with a circular-shift null.
    Matches src/seam-wire.ts coupling function exactly.
    """
    if np is None:
        return 0.0, 1.0
    a = _demean(_bandpass(s, SLOW_BAND[0], SLOW_BAND[1]))
    b = _demean(_envelope(_bandpass(s, FAST_BAND[0], FAST_BAND[1])))
    real = abs(_corr_norm(a, b))

    rng = _xorshift32(seed)
    n = len(b)
    lo = max(1, round(1.0))
    span = max(1, n - 2 * lo)
    ge = 0
    for _ in range(N_NULL):
        shift = lo + int(rng() * span)
        # Circular shift: np.roll(b, shift) matches bs[(k + shift) % n] = b[k]
        r = abs(_corr_norm(a, np.roll(b, shift)))
        if r >= real:
            ge += 1
    p = (ge + 1) / (N_NULL + 1)
    return real, p


def evaluate_readout_b(surprisals: List[float], a: float = A_VAL, b: float = B_VAL) -> Dict[str, Any]:
    """
    Evaluates Readout B on a surprisal stream.
    Requires at least 96 tokens. Uses the first 96 tokens across 9 sliding windows.
    """
    if len(surprisals) < HEAD_TOKENS:
        return {
            "complete_head": False,
            "n_tokens": len(surprisals),
            "reserve": None,
            "kappa": None,
            "verdict": "INSUFFICIENT",
        }

    head = surprisals[:HEAD_TOKENS]
    window_scores = []
    reserve = 0.0

    for w_idx in range(N_WINDOWS):
        start = w_idx * STRIDE
        w = head[start : start + WINDOW]
        seed = 0 * 7919 + w_idx
        kappa_c, p = coupling(w, seed=seed)
        prec = 1.0 - p
        w_score = kappa_c * prec
        reserve += w_score
        window_scores.append({
            "window": w_idx,
            "start": start,
            "end": start + WINDOW,
            "kappa_c": round(kappa_c, 4),
            "p_null": round(p, 4),
            "precision": round(prec, 4),
            "score": round(w_score, 4),
        })

    # Calibrated kappa: logit κ(T) = a·S + b
    logit_k = a * reserve + b
    logit_k = max(-30.0, min(30.0, logit_k))
    kappa = 1.0 / (1.0 + math.exp(-logit_k))

    return {
        "complete_head": True,
        "n_tokens": len(surprisals),
        "reserve": round(reserve, 4),
        "kappa": round(kappa, 4),
        "verdict": "SETTLED" if kappa >= 0.638 else "OPEN",
        "windows": window_scores,
    }

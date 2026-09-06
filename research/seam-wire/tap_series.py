#!/usr/bin/env python3
"""
tap_series.py — THE PRODUCER. Live per-token scalar series from Qwen3.8-27B's
layer taps, teacher-forced over the GSM8K control-baseline completions.

This is the numeric window that PREDICTION_OPERATOR_SPEC §7.1 and the PAMI
siege L1 both said did not exist in production. It is emitted from the same
weights, same taps (12 = early, 48 = late) and same prompt format the
baseline eval used, so every row is tied to a real, labeled generation.

Per completion token t (prompt tokens are excluded) we emit three streams:
  surprisal[t] = -log p(token_t | prefix)           (nats, from the final logits)
  norm12[t]    = ||h_12[t]||_2                       (hidden state after block 12)
  norm48[t]    = ||h_48[t]||_2                       (hidden state after block 48)

Labels carried through unchanged from the eval JSON: correct, truncated (at the
eval's own budget). Added here: open_at_512 = the completion's full token count
is >= 512, i.e. "did not close within 512 tokens" — the SAME event the val
baseline's `truncated` recorded (its budget was 512), so a fixture generated
at a larger budget stays label-compatible with SEAM_WIRE_001.

Pre-registered choices (fixed before any readout was run):
  * streams are truncated to the FIRST `--head` completion tokens (default 128)
    so a score can never learn the label from series length; rows shorter
    than `--head` are emitted with `short=true` and are excluded downstream.
  * no normalisation here — the readouts residualise; a producer that
    pre-whitens would be doing the operator's job for it.

Usage (mlx-serve must NOT be holding the weights — 51 GB box, 16 GB each):
  ~/Desktop/Elle/tools/mlx-serve/.venv/bin/python research/seam-wire/tap_series.py \
      --eval ~/Desktop/hybrid-HNPA-active-inference-LLM/runs/control-baseline/val_base_n100.json \
      --split ~/Desktop/hybrid-HNPA-active-inference-LLM/benchmarks/gsm8k/val_split.jsonl \
      --out test-fixtures/tap-series-gsm8k-n100.jsonl
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
HDE = HERE.parents[1] / "docs" / "hybrid-dynamic-embedder" / "python" / "mlx_server"
sys.path.insert(0, str(HDE))
HNPA = Path(os.environ.get("HNPA_DIR", Path.home() / "Desktop" / "hybrid-HNPA-active-inference-LLM"))
sys.path.insert(0, str(HNPA))

import mlx.core as mx  # noqa: E402

from prompts import build_prompt  # noqa: E402

TAPS = (12, 48)


def load_split(path: Path) -> dict[int, str]:
    """idx -> question, in file order (the eval indexed by position)."""
    out: dict[int, str] = {}
    with open(path) as f:
        for i, line in enumerate(f):
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            out[i] = row["question"]
    return out


def lm_head_fn(wrapper):
    lm = wrapper.language_model
    head = getattr(lm, "lm_head", None)
    if head is not None:
        return head
    # tied embeddings fallback
    emb = lm.model.embed_tokens
    if hasattr(emb, "as_linear"):
        return emb.as_linear
    raise RuntimeError("no lm_head and embed_tokens has no as_linear")


def forward_with_taps(ex, wrapper, ids: mx.array, taps=TAPS):
    """One teacher-forced pass. Returns ({tap: [1,N,D] hidden}, logits [1,N,V])."""
    model = ex.model
    cache = ex._make_cache()
    h = model.embed_tokens(ids)
    fa_mask, ssm_mask = ex._make_masks(h, cache)
    tapped: dict[int, mx.array] = {}
    for bi, block in enumerate(model.layers):
        mask = ssm_mask if getattr(block, "is_linear", False) else fa_mask
        h = block(h, mask=mask, cache=cache[bi] if cache else None)
        if isinstance(h, tuple):
            h = h[0]
        if bi in taps:
            tapped[bi] = h
        mx.eval(h)
    h = model.norm(h)
    logits = lm_head_fn(wrapper)(h)
    mx.eval(logits)
    return tapped, logits


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--eval", required=True)
    ap.add_argument("--split", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--head", type=int, default=128)
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    ev = json.load(open(args.eval))
    questions = load_split(Path(args.split))
    results = ev["results"][: args.limit or None]

    t0 = time.time()
    # One load only (16 GB). Mirrors make_live_extractor but keeps the wrapper
    # so the lm_head is reachable for surprisal.
    import extract_endpoint as ee
    from mlx_vlm import load as vlm_load
    from mlx_lm.models.cache import make_prompt_cache
    wrapper, processor = vlm_load(ee.DEFAULT_MODEL_PATH)
    tok = getattr(processor, "tokenizer", processor)
    ex = ee.LayerExtractor(model=wrapper.language_model.model, tokenizer=tok)
    ex._cache_factory = lambda: make_prompt_cache(wrapper.language_model)
    try:
        from mlx_vlm.models.qwen3_5.language import (
            _create_qwen3_5_attention_mask, _create_qwen3_5_ssm_mask)
        ex._mask_fns = (_create_qwen3_5_attention_mask, _create_qwen3_5_ssm_mask)
    except ImportError:
        ex._mask_fns = None
    print(f"[producer] weights up in {time.time()-t0:.1f}s; head={args.head}; n={len(results)}", flush=True)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    n_ok = n_short = 0
    with open(out_path, "w") as fo:
        for r in results:
            idx = int(r["idx"])
            q = questions[idx]
            prompt = build_prompt(tok, q)
            p_ids = tok.encode(prompt)
            p_ids = list(getattr(p_ids, "ids", p_ids))
            c_ids = tok.encode(r["completion"], add_special_tokens=False)
            c_ids = list(getattr(c_ids, "ids", c_ids))
            n_full = len(c_ids)
            c_ids = c_ids[: args.head]
            short = len(c_ids) < args.head
            ids = mx.array([p_ids + c_ids])
            tapped, logits = forward_with_taps(ex, wrapper, ids)
            P = len(p_ids)
            # surprisal of completion token t uses logits at position P+t-1
            lg = logits[0, P - 1 : P - 1 + len(c_ids), :].astype(mx.float32)
            lse = mx.logsumexp(lg, axis=-1)
            picked = mx.take_along_axis(lg, mx.array(c_ids)[:, None], axis=-1)[:, 0]
            surprisal = (lse - picked).tolist()
            streams = {"surprisal": [float(x) for x in surprisal]}
            for tap in TAPS:
                hs = tapped[tap][0, P : P + len(c_ids), :].astype(mx.float32)
                nrm = mx.sqrt(mx.sum(hs * hs, axis=-1)).tolist()
                streams[f"norm{tap}"] = [float(x) for x in nrm]
            row = {
                "idx": idx,
                "correct": bool(r["correct"]),
                "truncated": bool(r["truncated"]),
                "open_at_512": n_full >= 512,
                "n_completion_full": n_full,
                "n_prompt": P,
                "n_completion": len(c_ids),
                "short": short,
                "streams": streams,
            }
            fo.write(json.dumps(row) + "\n")
            fo.flush()
            n_short += short
            n_ok += not short
            if idx % 10 == 0:
                print(f"[producer] idx={idx} P={P} C={len(c_ids)} short={short} "
                      f"mean_surprisal={sum(surprisal)/max(1,len(surprisal)):.3f} "
                      f"t={time.time()-t0:.0f}s", flush=True)
    print(f"[producer] done: {n_ok} full rows, {n_short} short rows -> {out_path}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())

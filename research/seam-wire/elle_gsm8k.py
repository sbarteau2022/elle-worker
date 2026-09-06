#!/usr/bin/env python3
"""
elle_gsm8k.py — GSM8K through ELLE, not through the research evaluator.

Every earlier fixture came from HNPA eval.py loading the raw weights: greedy
decoding, no serving profile, no tap, a 512/1024 cap. This runner sends the
same problems through mlx-serve's coordinator tag `elle` — the model as Elle
serves it: the card's sampling (temperature 1.0, top_p 0.95, top_k 20), the
256K KV ceiling, num_predict 32,768, and the live surprisal tap on every
generated token — and writes BOTH an eval-shaped JSON (same schema as eval.py,
so gate.py/third_split_gate keep working) and a seam-wire fixture whose
`streams.surprisal` is the server's own per-token stream over the WHOLE
completion (heads are sliced downstream by horizon_atlas.ts).

Problems and split tags match the earlier fixtures exactly:
  val   = val_split.jsonl rows 0..99     test = test.jsonl rows 0..99
  train = train_split.jsonl rows 0..199
Sampling is stochastic (no seed option in mlx-serve); this is ONE sample per
problem, which is also how the card's numbers were produced.

Usage (server must be up on MLX_PORT, nothing else on the GPU):
  python research/seam-wire/elle_gsm8k.py --out-json <eval.json> --out-fixture <fixture.jsonl> [--workers 4]
"""
from __future__ import annotations
import argparse, json, os, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

HNPA = Path(os.environ.get("HNPA_DIR", os.path.expanduser("~/Desktop/hybrid-HNPA-active-inference-LLM")))
sys.path.insert(0, str(HNPA))
from eval import extract_number          # noqa: E402  (the same extractor every gate used)
from prompts import INSTRUCTION           # noqa: E402  (the same instruction; server applies the chat template)

SPLITS = [("val", "val_split.jsonl", 0, 100), ("test", "test.jsonl", 0, 100), ("train", "train_split.jsonl", 0, 200)]
URL = os.environ.get("ELLE_INFER_URL", f"http://127.0.0.1:{os.environ.get('MLX_PORT', '11437')}")
MODEL = os.environ.get("ELLE_MODEL_TAG", "elle")
MAX_TOKENS = int(os.environ.get("MLX_NUM_PREDICT", "32768"))

def gold_of(answer: str):
    if "####" in answer:
        try: return float(answer.split("####")[-1].strip().replace(",", ""))
        except ValueError: return None
    n, _ = extract_number(answer); return n

def load():
    rows = []
    for split, fn, a, b in SPLITS:
        with open(HNPA / "benchmarks" / "gsm8k" / fn) as f:
            lines = [json.loads(l) for l in f if l.strip()][a:b]
        for i, r in enumerate(lines):
            rows.append({"split": split, "idx": a + i, "question": r["question"], "gold": gold_of(r["answer"])})
    return rows

def ask(row):
    body = {"model": MODEL, "stream": False,
            "messages": [{"role": "user", "content": f"{row['question'].strip()}\n\n{INSTRUCTION}"}],
            "options": {"num_predict": MAX_TOKENS}}
    req = urllib.request.Request(URL + "/api/chat", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=4 * 3600) as r:
        d = json.loads(r.read())
    txt = d["message"]["content"]; n = int(d.get("eval_count") or 0)
    pred, parsed = extract_number(txt)
    return {**row, "completion": txt, "pred": pred, "parsed": parsed,
            "correct": row["gold"] is not None and pred is not None and abs(row["gold"] - pred) < 1e-5,
            "truncated": n >= MAX_TOKENS - 1 or d.get("done_reason") == "length",
            "n_completion_full": n, "surprisal": d.get("surprisal") or [], "seam": d.get("seam"),
            "seconds": time.time() - t0, "done_reason": d.get("done_reason")}

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out-json", required=True); ap.add_argument("--out-fixture", required=True)
    ap.add_argument("--workers", type=int, default=4); ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    rows = load(); rows = rows[: a.limit] if a.limit else rows
    print(f"[elle] {len(rows)} problems → {URL} model={MODEL} num_predict={MAX_TOKENS} workers={a.workers}", flush=True)
    out = [None] * len(rows); t0 = time.time(); done = 0; toks = 0
    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        futs = {ex.submit(ask, r): i for i, r in enumerate(rows)}
        for fut in as_completed(futs):
            i = futs[fut]; res = fut.result(); out[i] = res; done += 1; toks += res["n_completion_full"]
            if done % 10 == 0 or done == len(rows):
                c = sum(1 for o in out if o and o["correct"]); tr = sum(1 for o in out if o and o["truncated"])
                print(f"  [{done:4d}/{len(rows)}] acc {c}/{done} trunc {tr} | {toks / (time.time() - t0):.1f} tok/s aggregate | last {res['split']}:{res['idx']} n={res['n_completion_full']}", flush=True)
    n = len(out); correct = sum(o["correct"] for o in out); parsed = sum(o["parsed"] for o in out); trunc = sum(o["truncated"] for o in out)
    summary = {"checkpoint": "elle (mlx-serve coordinator, stock Qwen3.8-27B-4bit weights)", "is_base": True, "split": "val100+test100+train200",
               "total_problems": n, "correct": correct, "accuracy": correct / n, "parsed_count": parsed, "parse_rate": parsed / n,
               "truncated_count": trunc, "truncation_rate": trunc / n, "max_tokens": MAX_TOKENS, "toroidal": None,
               "prompt_format": "elle:mlx-serve:chat_template:cot", "sampling": {"temperature": 1.0, "top_p": 0.95, "top_k": 20, "seeded": False},
               "tokens_generated": toks, "elapsed_seconds": time.time() - t0, "tokens_per_second": toks / max(1e-9, time.time() - t0),
               "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
               "results": [{k: o[k] for k in ("split", "idx", "gold", "pred", "parsed", "correct", "truncated", "completion", "n_completion_full", "seconds", "done_reason")} for o in out]}
    Path(a.out_json).write_text(json.dumps(summary, indent=1))
    with open(a.out_fixture, "w") as f:
        for o in out:
            f.write(json.dumps({"idx": o["idx"], "split": o["split"], "correct": o["correct"], "truncated": o["truncated"],
                                "open_at_512": o["n_completion_full"] >= 512, "n_completion_full": o["n_completion_full"],
                                "n_completion": len(o["surprisal"]), "short": len(o["surprisal"]) < 96,
                                "seam_server": o["seam"], "streams": {"surprisal": o["surprisal"]}}) + "\n")
    print(f"[elle] done: acc {correct}/{n} parse {parsed}/{n} trunc {trunc}/{n} | {toks} tokens in {time.time() - t0:.0f}s", flush=True)

if __name__ == "__main__":
    main()

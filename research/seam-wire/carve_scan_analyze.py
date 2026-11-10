#!/usr/bin/env python3
"""carve_scan_analyze.py — rank every layer's removal cost and propose carves.

Reads runs/carve_layer_scan.json (64 single-layer-drop views × 16 sums) and
writes runs/carve_candidates.json: the per-layer cost table and candidate
specs that drop the CHEAPEST linear layers (attention layers are never
dropped — CARVE_DIAG_001 showed they are load-bearing), for k = 8, 12, 16,
20, 24, 32 dropped. Also emits the MLX_SPECIALISTS JSON for validating them.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SCAN = os.path.join(HERE, "runs", "carve_layer_scan.json")
OUT = os.path.join(HERE, "runs", "carve_candidates.json")
COORD = "/Users/stewartbarteau/Desktop/ELLE_STACK__CURRENT_WORK/Elle/tools/mlx-serve/weights/Qwen3.8-27B-4bit"
N = 64
FULL = lambda i: (i + 1) % 4 == 0


def spec(keep):
    keep = sorted(keep); out = []; a = b = keep[0]
    for i in keep[1:]:
        if i == b + 1:
            b = i
        else:
            out.append(f"{a}-{b}" if a != b else str(a)); a = b = i
    out.append(f"{a}-{b}" if a != b else str(a))
    return ",".join(out)


def main():
    r = json.load(open(SCAN))
    tags = r["tags"]
    base = tags.get("elle", {}).get("sums")
    n_sums = tags.get("elle", {}).get("sums_n", 16)
    cost = {}
    for i in range(N):
        t = tags.get(f"elle-x{i:02d}")
        if not t:
            continue
        cost[i] = (base if base is not None else n_sums) - t["sums"]      # sums lost when layer i is removed
    rows = [{"layer": i, "kind": "attn" if FULL(i) else "linear", "sums": tags[f"elle-x{i:02d}"]["sums"], "cost": cost[i]} for i in sorted(cost)]
    print(f"full model sums {base}/{n_sums}; scanned {len(cost)} layers")
    print("layer  kind    sums  cost")
    for x in rows:
        print(f"{x['layer']:>5}  {x['kind']:<6}  {x['sums']:>4}  {x['cost']:>4}{'  <-- costly' if x['cost'] >= 3 else ''}")
    linear = sorted((i for i in cost if not FULL(i)), key=lambda i: (cost[i], abs(i - N / 2)))    # cheapest first; ties: middle layers first (the scan is flat there; the diag showed 28-31 free, 48-55 critical)
    attn_cost = sum(cost[i] for i in cost if FULL(i)) / max(1, sum(1 for i in cost if FULL(i)))
    lin_cost = sum(cost[i] for i in cost if not FULL(i)) / max(1, sum(1 for i in cost if not FULL(i)))
    print(f"mean cost: attention {attn_cost:.2f}, linear {lin_cost:.2f}")
    cands = {}
    for k in (8, 12, 16, 20, 24, 32):
        drop = linear[:k]
        keep = [i for i in range(N) if i not in drop]
        cands[f"elle-k{k}"] = {"drop": sorted(drop), "keep": keep, "spec": spec(keep), "n": len(keep), "dropped_cost_sum": sum(cost[i] for i in drop)}
    specialists = {tag: {"repo": COORD, "layers": c["spec"]} for tag, c in cands.items()}
    json.dump({"scan": SCAN, "full_sums": base, "n_sums": n_sums, "cost": rows, "candidates": cands, "specialists": specialists}, open(OUT, "w"), indent=1)
    json.dump(specialists, open("/tmp/validate_specialists.json", "w"))
    print("candidates:")
    for tag, c in cands.items():
        print(f"  {tag}: keep {c['n']} (dropped cost sum {c['dropped_cost_sum']}) drop {c['drop']}")
    print(f"→ {OUT}\n→ /tmp/validate_specialists.json")


if __name__ == "__main__":
    sys.exit(main())

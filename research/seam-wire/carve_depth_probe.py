#!/usr/bin/env python3
"""carve_depth_probe.py — let the numbers pick the depth of the carved specialist.

For each tag (the full coordinator and its depth-carved views, all the SAME
weights, served by mlx-serve as views): (A) eight trivial sums, greedy; (B)
twenty held-out GSM8K test rows (300..319, never used by any run), greedy,
step-by-step with a '#### <number>' final line. Reports accuracy, generated
tokens and tokens/s per tag. Output: runs/carve_depth_probe.json.
"""
import json, os, re, sys, time, urllib.request
URL = os.environ.get("MLX_URL", "http://127.0.0.1:11437")
TAGS = (sys.argv[1] if len(sys.argv) > 1 else "elle,elle-c48,elle-c32,elle-c24,elle-c16,elle-c8").split(",")
DATA = os.environ["GSM8K_TEST"]
A, B = [int(x) for x in os.environ.get("ROWS", "300-320").split("-")]
OUT = os.environ.get("PROBE_OUT") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "runs", "carve_depth_probe.json")

def chat(tag, msgs, n, ctx=4096, temp=0.0, timeout=900):
    body = {"model": tag, "stream": False, "messages": msgs, "options": {"num_predict": n, "num_ctx": ctx, "temperature": temp}}
    req = urllib.request.Request(f"{URL}/api/chat", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    t0 = time.time()
    r = json.load(urllib.request.urlopen(req, timeout=timeout))
    return r["message"]["content"], int(r.get("eval_count") or 0), float(r.get("eval_duration") or 0) / 1e9, time.time() - t0

def final_number(text):
    m = re.findall(r"####\s*\$?(-?[\d,]*\.?\d+)", text)
    if m:
        try: return float(m[-1].replace(",", ""))
        except ValueError: return None
    nums = re.findall(r"-?\d[\d,]*(?:\.\d+)?", text)
    try: return float(nums[-1].replace(",", "")) if nums else None
    except ValueError: return None

def gold_of(row):
    a = row["answer"]; t = a.split("####")[-1] if "####" in a else a
    return float(re.sub(r"[^\d.\-]", "", t.strip()) or "nan")

rows = [json.loads(l) for l in open(DATA) if l.strip()][A:B]
SUMS = [("17*23", 391), ("19*21", 399), ("12*12", 144), ("45+78", 123), ("1000-357", 643), ("9*9*9", 729), ("144/12", 12), ("250*4", 1000),
        ("36+47", 83), ("81-29", 52), ("15*15", 225), ("7*8", 56), ("500/25", 20), ("123+456", 579), ("64*3", 192), ("1000/8", 125)]
SUMS = SUMS[:int(os.environ.get("N_SUMS", len(SUMS)))]
results = {}
for tag in TAGS:
    print(f"=== {tag}", flush=True)
    ok = 0; outs = []
    for q, g in SUMS:
        txt, ec, ed, wall = chat(tag, [{"role": "system", "content": "You are a terse calculator. Reply with the number only."}, {"role": "user", "content": f"What is {q}?"}], 24)
        clean = re.sub(r"</?think>", " ", txt)
        v = final_number(clean); ok += int(v is not None and abs(v - g) < 1e-6); outs.append(txt.strip()[:20])
    print(f"  sums {ok}/{len(SUMS)} {outs}", flush=True)
    correct = 0; toks = 0; secs = 0.0; walls = 0.0; per = []
    for i, row in enumerate(rows):
        prompt = row["question"].strip() + "\n\nSolve step by step, then give the final answer on its own line in exactly this form: #### <number>"
        try:
            txt, ec, ed, wall = chat(tag, [{"role": "user", "content": prompt}], 512)
        except Exception as e:
            print(f"  row {A+i}: ERROR {e}", flush=True); per.append({"idx": A + i, "error": str(e)}); continue
        v = final_number(txt); g = gold_of(row); c = v is not None and abs(v - g) < 1e-6
        correct += int(c); toks += ec; secs += ed; walls += wall
        per.append({"idx": A + i, "gold": g, "pred": v, "correct": c, "gen": ec, "s": round(wall, 1)})
        print(f"  row {A+i}: {'OK ' if c else 'XX '} gold={g:g} pred={v} gen={ec} {ec/ed if ed else 0:.1f} tok/s", flush=True)
    results[tag] = {"sums": ok, "sums_n": len(SUMS), "gsm8k_correct": correct, "gsm8k_n": len(rows), "gen_tokens": toks, "tok_per_s": round(toks / secs, 2) if secs else None, "wall_s": round(walls, 1), "rows": per}
    print(f"RESULT {tag}: sums {ok}/{len(SUMS)}, gsm8k {correct}/{len(rows)}, {results[tag]['tok_per_s']} tok/s, mean gen {toks/max(1,len(rows)):.0f}", flush=True)
    json.dump({"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "rows": [A, B], "tags": results}, open(OUT, "w"), indent=1)
print("DONE", OUT, flush=True)

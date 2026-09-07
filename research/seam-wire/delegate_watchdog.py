#!/usr/bin/env python3
"""delegate_watchdog.py — turn server OOM rows into retries instead of voids.

Polls the board for the posted seqs; when a row is blocked with a Metal OOM: restart mlx-serve
fresh (dead allocations are never released after an OOM), unload anything Ollama holds, reopen the
OOM rows (no model step completed on them) and bounce the bridge so it reloads the board. Stops
when every posted row is done without an OOM, or after max_restarts.
  delegate_watchdog.py <posted.json> <specialists.json> <server_log> [max_restarts=3]
"""
import json, os, subprocess, sys, time, urllib.request
posted = json.load(open(sys.argv[1])); spec = sys.argv[2]; slog = sys.argv[3]; max_restarts = int(sys.argv[4]) if len(sys.argv) > 4 else 3
seqs = {r["seq"] for r in posted["posted"]}
BOARD = os.path.expanduser("~/agent-bridge/data/board.json"); M = "/Users/stewartbarteau/Desktop/ELLE_STACK__CURRENT_WORK/Elle/tools/mlx-serve"
RUNS = os.path.dirname(os.path.abspath(sys.argv[1])) if "swarm-eval" not in sys.argv[1] else "/Users/stewartbarteau/Desktop/ELLE_STACK__CURRENT_WORK/elle-worker/research/seam-wire/runs"
restarts = 0

def board(): return json.load(open(BOARD))
def oom_rows(b): return [t for t in b["tasks"] if t["seq"] in seqs and t["status"] == "blocked" and "Insufficient Memory" in ((t.get("events") or [{}])[-1].get("body") or "")]
def health():
    try: return urllib.request.urlopen("http://127.0.0.1:11437/health", timeout=3).status == 200
    except Exception: return False

while True:
    b = board(); rows = [t for t in b["tasks"] if t["seq"] in seqs]
    done = [t for t in rows if t["status"] in ("approved", "blocked", "cancelled")]
    oom = oom_rows(b)
    if oom and restarts < max_restarts:
        restarts += 1
        print(f"[watchdog] {len(oom)} OOM row(s) → restart #{restarts}", flush=True)
        subprocess.run(["pkill", "-f", "server.py --port 11437"]); time.sleep(5)
        try:
            ps = json.load(urllib.request.urlopen("http://127.0.0.1:11434/api/ps", timeout=3))
            for m in ps.get("models", []):
                urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:11434/api/generate", data=json.dumps({"model": m["name"], "keep_alive": 0}).encode(), headers={"Content-Type": "application/json"}), timeout=20)
        except Exception: pass
        env = {**os.environ, "MLX_SPECIALISTS": spec, "MLX_CACHE_MAX_GB": "1", "APC_NUM_BLOCKS": "128"}
        subprocess.Popen(["./run.sh"], cwd=M, env=env, stdout=open(slog, "a"), stderr=subprocess.STDOUT, start_new_session=True)
        for _ in range(60):
            if health(): break
            time.sleep(2)
        now = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()); n = 0
        for t in b["tasks"]:
            if t["seq"] in {x["seq"] for x in oom}:
                t["status"] = "open"; t.pop("claimed_by", None)
                t.setdefault("events", []).append({"kind": "progress", "role": "architect", "ts": now, "body": f"watchdog: server OOM — mlx-serve restarted fresh (#{restarts}); reopened, no model step completed"}); n += 1
        json.dump(b, open(BOARD, "w"), indent=1)
        subprocess.run(["pkill", "-f", "agent-bridge/dist/bridge-server.js"]); time.sleep(4)
        print(f"[watchdog] reopened {n}; server {'up' if health() else 'DOWN'}", flush=True)
    elif len(done) >= len(rows):
        print(f"[watchdog] all {len(rows)} rows done; restarts used {restarts}", flush=True); break
    time.sleep(30)

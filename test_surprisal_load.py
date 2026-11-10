import urllib.request
import json
import time
import subprocess
from concurrent.futures import ThreadPoolExecutor

def fetch(i):
    payload = json.dumps({
        "model": "qwen2.5:3b-instruct-q4_K_M",
        "prompt": f"Write a brief haiku about testing number {i}."
    }).encode('utf-8')
    req = urllib.request.Request("http://127.0.0.1:11437/api/seam/surprisal", data=payload, method="POST")
    req.add_header("Content-Type", "application/json")
    try:
        start = time.time()
        with urllib.request.urlopen(req, timeout=30) as resp:
            text = resp.read()
            elapsed = time.time() - start
            return resp.status, len(text), elapsed
    except Exception as e:
        return 500, str(e), 0

def main():
    print("Starting MLX Server...")
    proc = subprocess.Popen(
        ["/Users/stewartbarteau/Desktop/ELLE_STACK__CURRENT_WORK/Elle/tools/mlx-serve/.venv/bin/python", "-m", "server", "--port", "11437"],
        cwd="/Users/stewartbarteau/Desktop/ELLE_STACK__CURRENT_WORK/Elle/tools/mlx-serve",
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )
    # Wait for startup
    for _ in range(15):
        try:
            with urllib.request.urlopen("http://127.0.0.1:11437/health", timeout=1) as resp:
                if resp.status == 200:
                    break
        except Exception:
            pass
        time.sleep(1)

    print("Server up. Blasting 30 concurrent requests to the Seam (surprisal tap)...")
    with ThreadPoolExecutor(max_workers=30) as ex:
        results = list(ex.map(fetch, range(30)))

    successes = sum(1 for status, _, _ in results if status == 200)
    print(f"Results: {successes}/30 succeeded.")
    for status, size, elapsed in results:
        print(f"  Status: {status} | RespSize: {size} | Time: {elapsed:.2f}s")
    
    proc.terminate()
    proc.wait()

main()

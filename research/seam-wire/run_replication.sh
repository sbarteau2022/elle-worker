#!/bin/bash
set -eo pipefail

EVAL_PID=11895
JSON_OUT="/Users/stewartbarteau/Desktop/hybrid-HNPA-active-inference-LLM/runs/control-baseline/test_base_n100_1024.json"
SPLIT_FILE="/Users/stewartbarteau/Desktop/hybrid-HNPA-active-inference-LLM/benchmarks/gsm8k/test.jsonl"
FIXTURE_OUT="/Users/stewartbarteau/Desktop/ELLE_STACK__CURRENT_WORK/elle-worker/test-fixtures/tap-series-gsm8k-test-n100.jsonl"
PYTHON_BIN="/Users/stewartbarteau/Desktop/ELLE_STACK__CURRENT_WORK/Elle/tools/mlx-serve/.venv/bin/python"
WORKER_DIR="/Users/stewartbarteau/Desktop/ELLE_STACK__CURRENT_WORK/elle-worker"

echo "[runner] $(date '+%Y-%m-%d %H:%M:%S') — Monitoring eval process (PID $EVAL_PID)..."

while kill -0 "$EVAL_PID" 2>/dev/null; do
    sleep 10
done

echo "[runner] $(date '+%Y-%m-%d %H:%M:%S') — Eval process exited. Checking output: $JSON_OUT"

if [ ! -f "$JSON_OUT" ]; then
    echo "[runner] ERROR: $JSON_OUT was not created!"
    exit 1
fi

echo "[runner] $(date '+%Y-%m-%d %H:%M:%S') — Generating tap series fixture with head=96..."
cd "$WORKER_DIR"
"$PYTHON_BIN" research/seam-wire/tap_series.py \
    --eval "$JSON_OUT" \
    --split "$SPLIT_FILE" \
    --out "$FIXTURE_OUT" \
    --head 96

echo "[runner] $(date '+%Y-%m-%d %H:%M:%S') — Fixture generated. Running replication vitest suite..."
npx vitest run src/seam-wire-replication.test.ts

echo "[runner] $(date '+%Y-%m-%d %H:%M:%S') — Replication suite complete."

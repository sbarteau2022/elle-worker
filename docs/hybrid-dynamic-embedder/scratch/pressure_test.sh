#!/usr/bin/env bash
# Milestone 2 acceptance gate: N sequential /v1/embed/layers requests against
# a live server, asserting every one returns 200 with a real embedding.
#
# Deliberately NOT `set -e`: a failed curl must be counted and reported, not
# abort the run. The previous version died silently on request 1 because
# `RESPONSE=$(curl ...)` takes curl's exit status, and `set -e` acted on it
# before the reporting branch could run.
set -uo pipefail

HOST=127.0.0.1
PORT="${PORT:-8000}"
BASE="http://$HOST:$PORT"
REQ_COUNT="${REQ_COUNT:-20}"
READY_TIMEOUT="${READY_TIMEOUT:-180}"

cd "$(dirname "${BASH_SOURCE[0]}")/.."

uv run python -m python.mlx_server.server --port "$PORT" &
WRAPPER_PID=$!

# `uv run` execs a CHILD python; killing the wrapper leaves the server bound
# to the port. Match on the module name instead, and always clean up.
cleanup() {
  pkill -f "python.mlx_server.server" 2>/dev/null || true
  kill "$WRAPPER_PID" 2>/dev/null || true
  wait "$WRAPPER_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Poll for readiness rather than sleeping a fixed interval: loading 16 GB of
# 4-bit weights takes longer than any constant worth hardcoding.
echo "waiting for $BASE/health (up to ${READY_TIMEOUT}s)..."
READY=0
for _ in $(seq 1 "$READY_TIMEOUT"); do
  if curl -sf "$BASE/health" -o /dev/null 2>/dev/null; then READY=1; break; fi
  sleep 1
done
if [ "$READY" -ne 1 ]; then
  echo "FAIL: server never became ready on $BASE"
  exit 1
fi

MODE=$(curl -sf "$BASE/health" | python3 -c "import json,sys;print(json.load(sys.stdin).get('mode','?'))")
echo "server ready (mode=$MODE)"

SUCCESS=0
FIRST_NORM=""
for i in $(seq 1 "$REQ_COUNT"); do
  BODY=$(curl -s --max-time 120 -X POST "$BASE/v1/embed/layers" \
    -H "Content-Type: application/json" \
    -d "{\"text\": \"Pressure test sentence number $i about hyperbolic geometry.\", \"pooling\": \"span_mean\", \"curvature\": 1.0, \"shm_enabled\": false}")
  CURL_RC=$?
  if [ $CURL_RC -ne 0 ]; then
    echo "  request $i: curl failed (rc=$CURL_RC)"
    continue
  fi
  NORM=$(printf '%s' "$BODY" | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
except Exception:
    print('BADJSON'); raise SystemExit
print(d['norm'] if 'norm' in d else 'ERR:'+str(d.get('error'))[:60])
")
  case "$NORM" in
    ERR:*|BADJSON) echo "  request $i: $NORM" ;;
    *) SUCCESS=$((SUCCESS+1)); [ -z "$FIRST_NORM" ] && FIRST_NORM="$NORM" ;;
  esac
done

echo "$SUCCESS / $REQ_COUNT requests returned an embedding (first norm=$FIRST_NORM)"
[ "$SUCCESS" -eq "$REQ_COUNT" ] || { echo "GATE FAILED"; exit 1; }
echo "GATE PASSED"

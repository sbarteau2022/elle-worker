#!/usr/bin/env bash
set -e

# Start the MLX extraction server in the background
uv run python -m python.mlx_server.server &
SERVER_PID=$!
echo "Started server with PID $SERVER_PID"

# Give the server a moment to bind to the port
sleep 2

REQ_COUNT=20
SUCCESS=0

for i in $(seq 1 $REQ_COUNT); do
  echo "Sending request $i/$REQ_COUNT..."
  RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:8000/v1/embed/layers \
    -H "Content-Type: application/json" \
    -d "{\"text\": \"Test text $i\", \"spans\": [[0,4]], \"pooling\": \"span_mean\", \"curvature\": 1.0}")
  if [ "$RESPONSE" -eq 200 ]; then
    SUCCESS=$((SUCCESS+1))
  else
    echo "⚠️ Request $i failed with HTTP $RESPONSE"
  fi
done

echo "✅ $SUCCESS / $REQ_COUNT requests succeeded."

# Shut down the server
kill $SERVER_PID || true
wait $SERVER_PID 2>/dev/null || true

echo "Server stopped."

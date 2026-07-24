#!/usr/bin/env bash
# ============================================================================
# set-sandbox-key.sh — bind the ONE shared sandbox secret to both sides.
#
# The code-execution sandbox authenticates with a single shared value carried
# under two different names (by design):
#
#   elle-worker   SANDBOX_AGENT_KEY   (Worker secret; compared to x-sandbox-key)
#   Elle app      ELLE_SANDBOX_KEY    (sent as the x-sandbox-key header)
#
# They must hold the SAME value. Without it the worker's sandbox routes return
# 503 and the Elle agent sits idle ("ELLE_SANDBOX_KEY not set; not polling").
#
# This script generates one strong value, sets it as the elle-worker PRODUCTION
# secret, mirrors it into ./.dev.vars for local `wrangler dev`, and prints the
# exact line to paste into the Elle app's .env. Run from the elle-worker root:
#
#   ./scripts/set-sandbox-key.sh
#
# Pass an existing value to reuse one you already have (e.g. rotating in sync):
#
#   ./scripts/set-sandbox-key.sh <existing-value>
# ============================================================================
set -euo pipefail

KEY="${1:-$(openssl rand -hex 32)}"

echo "==> Sandbox key: ${KEY}"
echo

# 1. Production Worker secret (the worker the packaged app actually calls).
echo "==> Setting elle-worker production secret SANDBOX_AGENT_KEY…"
printf '%s' "$KEY" | npx wrangler secret put SANDBOX_AGENT_KEY

# 2. Local dev — mirror into .dev.vars so `wrangler dev` matches production.
if [ -f .dev.vars ] && grep -q '^SANDBOX_AGENT_KEY=' .dev.vars; then
  # Replace the existing line in place (portable sed across macOS/Linux).
  tmp="$(mktemp)"
  grep -v '^SANDBOX_AGENT_KEY=' .dev.vars > "$tmp" || true
  printf 'SANDBOX_AGENT_KEY=%s\n' "$KEY" >> "$tmp"
  mv "$tmp" .dev.vars
  echo "==> Updated SANDBOX_AGENT_KEY in ./.dev.vars"
else
  printf 'SANDBOX_AGENT_KEY=%s\n' "$KEY" >> .dev.vars
  echo "==> Appended SANDBOX_AGENT_KEY to ./.dev.vars"
fi

# 3. Elle app — the operator sets the SAME value under its own tag.
cat <<EOF

==> Now bind the SAME value on the Elle side. Add this line to the Elle app's
    .env (repo root; loaded by electron/native/load-env.cjs), then restart Elle:

    ELLE_SANDBOX_KEY=${KEY}

Verify: the Elle agent log should flip from
    "idle — ELLE_SANDBOX_KEY not set; not polling"
to actively polling, and /api/sandbox-bus/* stops returning 401/503.
EOF

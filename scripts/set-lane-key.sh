#!/usr/bin/env bash
# ============================================================================
# set-lane-key.sh — mint the NARROW lane dispatch credential and bind it.
#
# ELLE_SERVICE_KEY is the god credential: full admin scope, and it already lives
# in five places (this worker, this repo's Actions secrets, rapid2ai-ai-worker,
# FlockIntelligence, VITE_ELLE_SERVICE_KEY). Handing it to a remote coding
# session so that session can delegate a prompt to the laptop is far more
# authority than the job needs — and rotating it later means updating all five
# in lockstep or silently 401-ing something.
#
# ELLE_LANE_DISPATCH_KEY is the least-privilege alternative. It authorizes
# exactly one thing: { action: 'dispatch' } on /api/elle-sandbox-lane, sent as
# the x-lane-dispatch-key header. It cannot create, remove, list, or report on
# lanes, and it opens no other route. Losing it costs you one revocation here
# and nothing anywhere else.
#
# This script generates one, sets it as the elle-worker PRODUCTION secret,
# mirrors it into ./.dev.vars for local `wrangler dev`, and prints the line to
# paste wherever the calling harness reads its environment. Run from the
# elle-worker root:
#
#   ./scripts/set-lane-key.sh
#
# Pass an existing value to reuse or rotate to a known one:
#
#   ./scripts/set-lane-key.sh <existing-value>
#
# To revoke: `npx wrangler secret delete ELLE_LANE_DISPATCH_KEY`. The route
# keeps working for the service key; the narrow key simply stops matching.
# ============================================================================
set -euo pipefail

KEY="${1:-$(openssl rand -hex 32)}"

echo "==> Lane dispatch key: ${KEY}"
echo

# 1. Production Worker secret.
echo "==> Setting elle-worker production secret ELLE_LANE_DISPATCH_KEY…"
printf '%s' "$KEY" | npx wrangler secret put ELLE_LANE_DISPATCH_KEY

# 2. Local dev — mirror into .dev.vars so `wrangler dev` matches production.
touch .dev.vars
if grep -q '^ELLE_LANE_DISPATCH_KEY=' .dev.vars; then
  tmp="$(mktemp)"
  grep -v '^ELLE_LANE_DISPATCH_KEY=' .dev.vars > "$tmp" || true
  printf 'ELLE_LANE_DISPATCH_KEY=%s\n' "$KEY" >> "$tmp"
  mv "$tmp" .dev.vars
  echo "==> Updated ELLE_LANE_DISPATCH_KEY in ./.dev.vars"
else
  printf 'ELLE_LANE_DISPATCH_KEY=%s\n' "$KEY" >> .dev.vars
  echo "==> Appended ELLE_LANE_DISPATCH_KEY to ./.dev.vars"
fi

# 3. The calling side — same value, same name.
cat <<EOF

==> Now give the SAME value to whatever calls the lane.

    Laptop (Elle app .env, or your shell profile):

        ELLE_LANE_DISPATCH_KEY=${KEY}

    Cloud coding session: paste it as an environment variable in the
    claude.ai/code environment settings. Variables apply to containers
    created AFTER the edit, so start a NEW session to pick it up.

Verify without a job running: an authorized-but-incomplete dispatch answers 400,
an unauthorized one answers 401.

    curl -s -o /dev/null -w '%{http_code}\\n' \\
      -X POST "\$ELLE_WORKER_URL/api/elle-sandbox-lane" \\
      -H 'content-type: application/json' \\
      -H "x-lane-dispatch-key: \$ELLE_LANE_DISPATCH_KEY" \\
      -d '{"action":"dispatch"}'

    400 = the key is good.  401 = it is not.
EOF

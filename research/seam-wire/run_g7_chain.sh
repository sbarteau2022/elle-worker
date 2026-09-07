#!/bin/bash
# G7 long-horizon experiment — the settling-time claim (T_lorentz ≤ φ⁻¹ · T_euclid) needs
# trajectories of eight or more turns; single GSM8K problems settle in two or three. This serves
# the coordinator alone (no specialists: the trajectory is the coordinator's own), launches the
# app with a 24-step cap, posts chain tasks (K consecutive problems worked in order in ONE task),
# waits for them, grades, then re-measures settling_time.cjs over the new ATLAS.jsonl files.
# Pre-registration: ELLE_GSM8K_001.md "G7 — pre-registered". Usage: run_g7_chain.sh [tasks=10] [offset=520] [K=6]
set -e
E=/Users/stewartbarteau/Desktop/ELLE_STACK__CURRENT_WORK/Elle; M=$E/tools/mlx-serve; W=/Users/stewartbarteau/Desktop/ELLE_STACK__CURRENT_WORK/elle-worker; RUNS=$W/research/seam-wire/runs; mkdir -p $RUNS
N=${1:-10}; OFF=${2:-520}; K=${3:-6}
pgrep -f "heal_carve.py" >/dev/null && { echo "a heal is still training — the GPU is not free"; exit 2; }
# server: coordinator only
cd $M; pkill -f "server.py --port 11437" || true; for i in $(seq 1 20); do pgrep -f "server.py --port 11437" >/dev/null || break; sleep 1; done
unset MLX_SPECIALISTS; MLX_SURPRISAL_LOG=$RUNS/surprisal_sidecar.jsonl MLX_CACHE_MAX_GB=1 APC_NUM_BLOCKS=128 nohup ./run.sh > $RUNS/mlx-serve.g7.log 2>&1 &
for i in $(seq 1 40); do curl -s -m 3 http://127.0.0.1:11437/health >/dev/null && break; sleep 2; done
curl -s http://127.0.0.1:11437/health | python3 -c "import json,sys; h=json.load(sys.stdin); print('served', list(h.get('roster',{}))[:6], 'carved', list(h.get('carved',{})))"
# app: two agents, 24 steps each (a 6-problem chain is ~2 steps per problem + done)
cd $E; pkill -f "npx electron ." || true; sleep 2
ELLE_DIST=1 ELLE_SWARM_SOVEREIGN=1 ELLE_SWARM_MAX=2 ELLE_SWARM_MAX_STEPS=24 ELLE_OLLAMA_URL=http://127.0.0.1:11437 ELLE_HYPER_MAP_DIR=$HOME/.elle/hyper-map ELLE_SWARM_LEDGER=agent nohup npx electron . > $RUNS/elle-app.g7.log 2>&1 &
for i in $(seq 1 45); do grep -q "atlas13 \[faculty\]" $RUNS/elle-app.g7.log && break; sleep 2; done
node electron/native/gsm8k-in-app.cjs post test $N $OFF $K | tee $RUNS/g7_chain.post.out; grep -o '/Users.*json' $RUNS/g7_chain.post.out > $RUNS/g7_chain.posted_path
echo "G7 chain battery posted: $N tasks × $K problems from test row $OFF → $(cat $RUNS/g7_chain.posted_path)"
node electron/native/gsm8k-in-app.cjs watch "$(cat $RUNS/g7_chain.posted_path)" 60
node electron/native/gsm8k-in-app.cjs grade "$(cat $RUNS/g7_chain.posted_path)" | tee $RUNS/g7_chain.grade.out
cd $W/research/seam-wire && node settling_time.cjs | tee $RUNS/g7_chain.settling.out

#!/bin/bash
# DELEGATE_005 — after HEAL_002: serve the loop-healed k16 view as elle-s7, launch the app
# with two agents, post 20 GSM8K rows (offset 500) and, once they are posted, confirm the
# coordinator's placements rode the Rosen-bridge lanes (LANE directives, not plain REGION).
# Pre-registration: ELLE_GSM8K_001.md "HEAL_002 — pre-registered". Usage: run_delegate_005.sh [rows] [offset]
set -e
E=/Users/stewartbarteau/Desktop/ELLE_STACK__CURRENT_WORK/Elle; M=$E/tools/mlx-serve; W=/Users/stewartbarteau/Desktop/ELLE_STACK__CURRENT_WORK/elle-worker
SPEC="0-21,23,27,31,35,39,43-63"; RUNS=$W/research/seam-wire/runs; mkdir -p $RUNS
test -f $M/adapters/sphere7-loop-k16/adapters.safetensors
echo "{\"elle-s7\": {\"repo\": \"$M/weights/Qwen3.8-27B-4bit\", \"layers\": \"$SPEC\", \"adapter\": \"$M/adapters/sphere7-loop-k16\"}}" > $RUNS/specialists_s7loop.json
cd $M; pkill -f "server.py --port 11437" || true; for i in $(seq 1 20); do pgrep -f "server.py --port 11437" >/dev/null || break; sleep 1; done
export MLX_SPECIALISTS=$RUNS/specialists_s7loop.json
MLX_SURPRISAL_LOG=$RUNS/surprisal_sidecar.jsonl MLX_CACHE_MAX_GB=1 APC_NUM_BLOCKS=128 nohup ./run.sh > $RUNS/mlx-serve.delegate005.log 2>&1 &
for i in $(seq 1 40); do curl -s -m 3 http://127.0.0.1:11437/health >/dev/null && break; sleep 2; done
curl -s http://127.0.0.1:11437/health | python3 -c "import json,sys; h=json.load(sys.stdin); print('carved', list(h.get('carved',{})))"
cd $E; ELLE_DIST=1 ELLE_SWARM_SOVEREIGN=1 ELLE_SWARM_MAX=2 ELLE_SWARM_MAX_STEPS=8 ELLE_OLLAMA_URL=http://127.0.0.1:11437 ELLE_HYPER_MAP_DIR=$HOME/.elle/hyper-map ELLE_SWARM_LEDGER=agent nohup npx electron . > $RUNS/elle-app.delegate005.log 2>&1 &
for i in $(seq 1 45); do grep -q "atlas13 \[faculty\]" $RUNS/elle-app.delegate005.log && break; sleep 2; done
node electron/native/gsm8k-in-app.cjs post test ${1:-20} ${2:-500} | tee $RUNS/delegate005.post.out; grep -o '/Users.*json' $RUNS/delegate005.post.out > $RUNS/delegate005.posted_path
echo "DELEGATE_005 posted → $(cat $RUNS/delegate005.posted_path)"
# the transport check: every posted task should carry a LANE directive (sealed on the 0→k lane) once the coordinator places it
sleep 60
node -e '
const fs=require("fs"); const L=require(process.argv[1]+"/electron/native/providers/sphere-lanes.cjs");
const posted=JSON.parse(fs.readFileSync(process.argv[2],"utf8")); const seqs=new Set((posted.posted||posted.rows||posted).map((r)=>r.seq));
const board=JSON.parse(fs.readFileSync(process.env.HOME+"/agent-bridge/data/board.json","utf8"));
const tasks=board.tasks.filter((t)=>seqs.has(t.seq)); let lane=0, plain=0, none=0;
for (const t of tasks){ const ev=(t.events||[]).filter((e)=>e.kind==="directive"); if(ev.some((e)=>L.isLaneDirective(e.body))) lane++; else if(ev.some((e)=>L.isRegionLike(e.body))) plain++; else none++; }
console.log(`transport check: ${tasks.length} posted tasks — LANE ${lane}, plain REGION ${plain}, unplaced ${none}`);
' $E "$(cat $RUNS/delegate005.posted_path)" || true

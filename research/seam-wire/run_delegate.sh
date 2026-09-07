#!/bin/bash
# Serve a healed k16 view as elle-s7 and run a DELEGATE batch against it.
# Usage: run_delegate.sh <adapter-name> <label> [rows=20] [offset=500]
#   adapter-name: directory under Elle/tools/mlx-serve/adapters (e.g. sphere7-loop-k16)
#   label: run tag for the logs (e.g. DELEGATE_005, DELEGATE_006A)
# Ends with the LANE transport check (how many posted tasks rode a lane).
set -e
E=/Users/stewartbarteau/Desktop/ELLE_STACK__CURRENT_WORK/Elle; M=$E/tools/mlx-serve; W=/Users/stewartbarteau/Desktop/ELLE_STACK__CURRENT_WORK/elle-worker; RUNS=$W/research/seam-wire/runs; mkdir -p $RUNS
A=${1:?adapter name}; L=${2:?label}; N=${3:-20}; OFF=${4:-500}; SPEC="0-21,23,27,31,35,39,43-63"
test -f $M/adapters/$A/adapters.safetensors && test -f $M/adapters/$A/adapter_config.json
pgrep -f "heal_carve.py" >/dev/null && { echo "a heal is still training — the GPU is not free"; exit 2; }
echo "{\"elle-s7\": {\"repo\": \"$M/weights/Qwen3.8-27B-4bit\", \"layers\": \"$SPEC\", \"adapter\": \"$M/adapters/$A\"}}" > $RUNS/specialists_$L.json
# GPU guard: a model resident in Ollama (the app once flipped to it and Ollama loaded a 17 GB GGUF of the
# coordinator) shares unified memory with mlx-serve and OOMs the specialist. Unload anything it holds.
for m in $(curl -s -m 3 http://127.0.0.1:11434/api/ps 2>/dev/null | python3 -c "import json,sys; print(' '.join(x['name'] for x in json.load(sys.stdin).get('models',[])))" 2>/dev/null); do
  echo "unloading $m from Ollama"; curl -s -m 20 -X POST http://127.0.0.1:11434/api/generate -d "{\"model\":\"$m\",\"keep_alive\":0}" >/dev/null; done
cd $M; pkill -f "server.py --port 11437" || true; for i in $(seq 1 20); do pgrep -f "server.py --port 11437" >/dev/null || break; sleep 1; done
export MLX_SPECIALISTS=$RUNS/specialists_$L.json
MLX_SURPRISAL_LOG=$RUNS/surprisal_sidecar.jsonl MLX_CACHE_MAX_GB=1 APC_NUM_BLOCKS=128 nohup ./run.sh > $RUNS/mlx-serve.$L.log 2>&1 &
for i in $(seq 1 60); do curl -s -m 3 http://127.0.0.1:11437/health >/dev/null && break; sleep 2; done
curl -s http://127.0.0.1:11437/health | python3 -c "import json,sys; h=json.load(sys.stdin); print('carved', list(h.get('carved',{})))"
# THE MODEL NUMBER FIRST, directly (minutes, no board): accuracy of the served view on the same rows
$M/.venv/bin/python $M/specialists/eval_specialist.py --tag elle-s7 --n $N --offset $OFF --label ${L}_direct 2>&1 | tail -3 | tee $RUNS/$L.direct.out
# smoke: one real generation must succeed before the board loop starts; a dead server is restarted once
if ! grep -q '"server_errors": 0' $RUNS/$L.direct.out; then echo "direct eval saw server errors — restarting the server once"; pkill -f "server.py --port 11437" || true; sleep 5; MLX_SURPRISAL_LOG=$RUNS/surprisal_sidecar.jsonl MLX_CACHE_MAX_GB=1 APC_NUM_BLOCKS=128 nohup ./run.sh > $RUNS/mlx-serve.$L.2.log 2>&1 & for i in $(seq 1 60); do curl -s -m 3 http://127.0.0.1:11437/health >/dev/null && break; sleep 2; done; fi
cd $E; pkill -f "npx electron ." || true; sleep 2
# ELLE_MLX_SERVE=0: the app must NOT run its own mlx-serve supervisor — with the external server on the port it flipped to "down → ELLE_OLLAMA_URL restored to Ollama" mid-run and DELEGATE_005 sat unclaimed for 3 h
# MAX=1: the healed view falls back from batch_generate to the sequential path; two concurrent prefills on it
# plus a coordinator call was where the OOMs started. One worker is slower and finishes.
ELLE_DIST=1 ELLE_MLX_SERVE=0 ELLE_SWARM_SOVEREIGN=1 ELLE_SWARM_MAX=2 ELLE_SWARM_MAX_STEPS=8 ELLE_OLLAMA_URL=http://127.0.0.1:11437 ELLE_HYPER_MAP_DIR=$HOME/.elle/hyper-map ELLE_SWARM_LEDGER=agent nohup npx electron . > $RUNS/elle-app.$L.log 2>&1 &
for i in $(seq 1 45); do grep -q "atlas13 \[faculty\]" $RUNS/elle-app.$L.log && break; sleep 2; done
node electron/native/gsm8k-in-app.cjs post test $N $OFF | tee $RUNS/$L.post.out; grep -o '/Users.*json' $RUNS/$L.post.out > $RUNS/$L.posted_path
echo "$L posted → $(cat $RUNS/$L.posted_path)"
node electron/native/gsm8k-in-app.cjs watch "$(cat $RUNS/$L.posted_path)" 60
node electron/native/gsm8k-in-app.cjs grade "$(cat $RUNS/$L.posted_path)" | tee $RUNS/$L.grade.out
node -e '
const fs=require("fs"); const L=require(process.argv[1]+"/electron/native/providers/sphere-lanes.cjs");
const posted=JSON.parse(fs.readFileSync(process.argv[2],"utf8")); const seqs=new Set(posted.posted.map((r)=>r.seq));
const board=JSON.parse(fs.readFileSync(process.env.HOME+"/agent-bridge/data/board.json","utf8"));
const tasks=board.tasks.filter((t)=>seqs.has(t.seq)); let lane=0, plain=0, none=0, sphere=0;
for (const t of tasks){ const ev=(t.events||[]).filter((e)=>e.kind==="directive"); if(ev.some((e)=>L.isLaneDirective(e.body))) lane++; else if(ev.some((e)=>L.isRegionLike(e.body))) plain++; else none++; if (ev.some((e)=>/"executor":"sphere"/.test(e.body))) sphere++; }
console.log(`transport check: ${tasks.length} tasks — LANE ${lane}, plain REGION ${plain}, unplaced ${none}; delegated to a sphere specialist: ${sphere}`);
' $E "$(cat $RUNS/$L.posted_path)" | tee -a $RUNS/$L.grade.out || true

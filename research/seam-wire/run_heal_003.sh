#!/bin/bash
# HEAL_003 — pre-registered in ELLE_GSM8K_001.md: two arms on the HEAL_002 data and view, 100 steps each,
# LoRA only on the top 21 kept layers (43–63, above the k16 gap):
#   A  lora            → adapters/sphere7-loop-k16-A-lora21
#   B  rosen-hypdora   → adapters/sphere7-loop-k16-B-rosen21   (cheap DoRA on attention, Lorentz bridge on post-gap MLPs)
# Then DELEGATE_006A / DELEGATE_006B: 20 rows each from test 540. Waits for any running heal first.
# Usage: run_heal_003.sh [arms=AB] [steps=100]
set -e
E=/Users/stewartbarteau/Desktop/ELLE_STACK__CURRENT_WORK/Elle; M=$E/tools/mlx-serve; W=/Users/stewartbarteau/Desktop/ELLE_STACK__CURRENT_WORK/elle-worker; RUNS=$W/research/seam-wire/runs; mkdir -p $RUNS
ARMS=${1:-AB}; STEPS=${2:-100}; SPEC="0-21,23,27,31,35,39,43-63"
while pgrep -f "heal_carve.py" >/dev/null; do sleep 120; done
pkill -f "server.py --port 11437" || true; pkill -f "npx electron ." || true; sleep 3
cd $M
heal() {  # name, extra args…
  local name=$1; shift
  echo "== HEAL_003 $name $(date '+%H:%M:%S')" | tee -a $RUNS/heal_003.log
  MLX_CACHE_SECRET_FILE=/tmp/elle-heal-kv-secret .venv/bin/python specialists/heal_carve.py --data specialists/data/sphere7-loop --layers "$SPEC" --name "$name" --iters $STEPS --max-seq 3072 --eval-rows 6 --lora-layers 21 "$@" 2>&1 | tee $RUNS/heal_$name.log | grep -E "\[heal\]" | tee -a $RUNS/heal_003.log
}
case "$ARMS" in *A*) heal sphere7-loop-k16-A-lora21 --adapter lora --nora init ;; esac
case "$ARMS" in *B*) heal sphere7-loop-k16-B-rosen21 --adapter rosen-hypdora --bridge-layers gap --nora init ;; esac
case "$ARMS" in *A*) bash $W/research/seam-wire/run_delegate.sh sphere7-loop-k16-A-lora21 DELEGATE_006A 20 540 ;; esac
case "$ARMS" in *B*) bash $W/research/seam-wire/run_delegate.sh sphere7-loop-k16-B-rosen21 DELEGATE_006B 20 540 ;; esac
echo "HEAL_003 done $(date '+%H:%M:%S')" | tee -a $RUNS/heal_003.log

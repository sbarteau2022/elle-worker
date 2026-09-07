#!/bin/bash
# The morning queue, unattended, in the pre-registered order:
#   1. wait for HEAL_002 (sphere7-loop-k16) to finish and copy its log into runs/
#   2. G7 chain battery on coordinator weights (run_g7_chain.sh)  — also posts the faculty briefs
#      batches present in briefs/ so the routing check happens while the app is up
#   3. DELEGATE_005 on the HEAL_002 adapter (run_delegate.sh)
#   4. HEAL_003 arms A/B + DELEGATE_006A/B (run_heal_003.sh)
# Usage: nohup run_after_heal.sh > runs/after_heal.log 2>&1 &
set -e
E=/Users/stewartbarteau/Desktop/ELLE_STACK__CURRENT_WORK/Elle; W=/Users/stewartbarteau/Desktop/ELLE_STACK__CURRENT_WORK/elle-worker; S=$W/research/seam-wire; RUNS=$S/runs; mkdir -p $RUNS
while pgrep -f "heal_carve.py" >/dev/null; do sleep 120; done
cp /tmp/heal_sphere7-loop-k16.log $RUNS/heal_sphere7-loop-k16.log 2>/dev/null || true
tail -3 $RUNS/heal_sphere7-loop-k16.log
test -f $E/tools/mlx-serve/adapters/sphere7-loop-k16/adapters.safetensors || { echo "HEAL_002 left no adapter — stopping"; exit 1; }
echo "== G7 $(date '+%H:%M:%S')"
# only the first batch (66 = 6 per sphere) rides the G7 window: the routing check needs placement, not completion,
# and 990 briefs ahead of DELEGATE_005 on the board would starve it; the rest are posted in their own run later
( sleep 240; node $E/electron/native/faculty-briefs.cjs post $S/briefs/gemini-batch-01.jsonl 2>&1 | tee -a $RUNS/briefs.post.out ) &
bash $S/run_g7_chain.sh 10 520 6 2>&1 | tee $RUNS/g7.run.log | tail -20
for p in "$HOME/Library/Application Support/elle/swarm-eval/"faculty-briefs-posted-*.json; do [ -f "$p" ] && node $E/electron/native/faculty-briefs.cjs check "$p" 2>&1 | tee -a $RUNS/briefs.check.out | head -12; done
echo "== DELEGATE_005 $(date '+%H:%M:%S')"
bash $S/run_delegate.sh sphere7-loop-k16 DELEGATE_005 20 500 2>&1 | tee $RUNS/delegate005.run.log | tail -8
echo "== HEAL_003 $(date '+%H:%M:%S')"
bash $S/run_heal_003.sh AB 100 2>&1 | tail -12
echo "QUEUE DONE $(date '+%H:%M:%S')"

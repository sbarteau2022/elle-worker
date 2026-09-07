#!/bin/bash
# G7 long-horizon experiment — the settling-time claim (T_lorentz ≤ φ⁻¹ · T_euclid) needs
# trajectories of eight or more turns; single GSM8K problems settle in two or three. This posts
# chain tasks (K consecutive problems worked in order in ONE task) to the running app, waits for
# them, then re-measures settling_time.cjs over the new ATLAS.jsonl files.
# Pre-registration: ELLE_GSM8K_001.md "G7 — pre-registered". Usage: run_g7_chain.sh [tasks=10] [offset=520] [K=6]
# Assumes the app and mlx-serve are already up (run_delegate_005.sh, or the launcher) and the bridge is healthy.
set -e
E=/Users/stewartbarteau/Desktop/ELLE_STACK__CURRENT_WORK/Elle; W=/Users/stewartbarteau/Desktop/ELLE_STACK__CURRENT_WORK/elle-worker; RUNS=$W/research/seam-wire/runs; mkdir -p $RUNS
N=${1:-10}; OFF=${2:-520}; K=${3:-6}
cd $E
node electron/native/gsm8k-in-app.cjs post test $N $OFF $K | tee $RUNS/g7_chain.post.out; grep -o '/Users.*json' $RUNS/g7_chain.post.out > $RUNS/g7_chain.posted_path
echo "G7 chain battery posted: $N tasks × $K problems from test row $OFF → $(cat $RUNS/g7_chain.posted_path)"
node electron/native/gsm8k-in-app.cjs watch "$(cat $RUNS/g7_chain.posted_path)" 60
node electron/native/gsm8k-in-app.cjs grade "$(cat $RUNS/g7_chain.posted_path)" | tee $RUNS/g7_chain.grade.out
cd $W/research/seam-wire && node settling_time.cjs | tee $RUNS/g7_chain.settling.out

# RUN DECLARATION — elle-siege-fixes-2026-08-31
Declared BEFORE tick 1. Nothing below may be edited by a worker.

## Baseline (MEASURED 2026-08-31, commit 4035607)
laneA_defects = 9   (node docs/observer_blanket_siege.cjs, exit 1)
laneB_defects = 7   (node docs/pami_dhng_siege.cjs,        exit 1)

## Pre-registered irreducible FLOOR — defects that NO code change can honestly clear
These are statements about a CLAIM THAT HAS NO DATA. They are cleared only by
running observer-live.ts forward in time to collect hindsight-free outcomes.
Any worker that makes one of these disappear has corrupted the instrument.
  A0  the headline +0.61 is asserted and evidenced in no file
  A5  +0.61 at n=10 fails two-sided 5% under every tie pattern
  A6  the 95% interval on +0.61 contains zero
=> laneA floor = 3.   laneB floor = 0 (all seven are geometry/code defects).
TARGET: 16 -> 3.  A run that reports fewer than 3 lane-A defects is a FAILED run.

## Kill-criteria (checked every tick, alongside the detector)
K1  any siege threshold/constant/assertion literal is weakened or deleted
    (git diff docs/*_siege.cjs touching a numeric threshold or a defect() call)
K2  the gate fails the same check 3x with no diff to the failing area
K3  laneA_defects or laneB_defects rises above baseline
K4  the same file is rewritten 5x without a passing gate
K5  a worker edits .swarm/RUN.md

## Budget
--max-stall 3   --wall-budget-seconds 14400

## Work-streams (disjoint file scopes; concurrency cap 4)
S1 hyper-radial   : src/hyper.ts, src/hyper.test.ts                 -> B0
S2 bridge         : src/pami-bridge.ts (NEW), src/pami-bridge.test.ts -> B1,B2,B3,B4  [after S1]
S3 scorer         : src/observer-blanket.ts, src/observer-blanket.test.ts -> A1,A2,A3,A7
S4 spec           : docs/PREDICTION_OPERATOR_SPEC.md (NEW)          -> L1  (design only, no patch)
S5 harness-power  : docs/observer_blanket_siege.cjs (dataPat only)  -> A0-dataPat, A4

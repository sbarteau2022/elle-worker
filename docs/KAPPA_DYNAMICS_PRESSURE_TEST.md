# Kappa Dynamics Pressure Test

**The 3 derivatives (velocity, acceleration, jerk) under a realistic session**

Companion to `GRAPH_PRESSURE_TEST.md` and the holding-valve series · sim:
`src/kappa-dynamics-pressure-test.test.ts` (seeded, exercises the real
`kappa-dynamics.ts` functions directly) · 2026

---

## What this closes

`MEMORY_KERNEL_SPEC.md` §7 documents `self_state` as returning two facets from
one call: `session_kappa_series` (this module — velocity, acceleration, jerk) and
`memory_graph_shape` (`structure.ts`, covered by `GRAPH_PRESSURE_TEST.md`). Only
the graph half had been pressure-tested against realistic architecture. This is
the missing third piece: the same gap `structure.ts` had before this week, now
closed for `kappa-dynamics.ts`.

`kappa-dynamics.test.ts` (Test I, in spirit) already validates static correctness
thoroughly — the finite-difference formulas, the null≠0 discipline, and the exact
regression proof for the wall-clock unit bug this module's own header warns
against. What was missing: does it hold up over a realistic session (multi-step
bursts, a discrete shock, a register switch, a genuine decoherence incident) —
not just hand-picked short series.

A synthetic ~100-step session was generated with the same architectural shapes
the holding-valve sims used, then run through the real `velocityAt`,
`accelerationAt`, `jerkAt`, `reserveAt`, `computeSeries`.

## Findings

**1. The hard rule holds under realistic load.** Every velocity reading matches
the raw per-step Δκ exactly (checked point-by-point, not sampled) — the dt=1
discipline this module's header exists to protect doesn't leak anywhere across a
100-step run with shocks, switches, and an incident mixed in.

**2. null≠0 holds precisely: nulls are ONLY the insufficient-data prefix.** Exactly
steps 0 (velocity), 0–1 (acceleration), 0–2 (jerk) are null; every step from 3
onward is a real number for all three orders, for the entire rest of the run — no
resurfacing, no drift.

**3. Non-degenerate across all three orders, same acceptance bar as κ v1.** >50
distinct values at every derivative order across the session (the bar was chosen
deliberately low to be conservative — the actual counts are far higher). No
fixed-point collapse at any order.

**4. The KV-compaction shock is correctly sharper in acceleration than in
velocity alone** — a discrete one-step jump registered >3× the mean calm-phase
acceleration, confirming the second difference actually does what "change in the
rate of change" promises, not just by definition but in the real computed
numbers.

**5. Higher-order derivatives do NOT lose their signal to noise amplification —
and the discriminative power scales roughly proportionally across all three
orders.** This was a real, open numerical-analysis risk going in: finite
differences of oscillating data amplify noise at each higher order, and a 3rd
difference of an alternating series (exactly what the incident phase produces)
could plausibly be dominated by amplified noise rather than carrying real signal.
The measured incident-vs-calm-phase contrast: **velocity ~40×, acceleration ~44×,
jerk ~45×** (mean |v|/|a|/|j| during the incident vs. during morning-chat). The
contrast doesn't collapse toward 1× at higher orders — jerk is exactly as
discriminating, proportionally, as velocity is. The concern was real and worth
checking; the answer, on this test, is that it doesn't happen.

**6. `reserve` behaves exactly as documented: an unbounded running sum, not a
bounded quantity.** Grows linearly with step count (confirmed: final reserve ≈
mean κ × N), monotone non-decreasing since κ ∈ [0,1]. Worth stating plainly
because `holding.ts`'s `loss`/`freeEnergy` in the same codebase ARE deliberately
bounded (`< e−1`, by construction) — `reserve` is a different kind of quantity
entirely, and nothing should ever threshold on it as if it saturates.

**7. An open question, not resolved here: jerk shows apparent persistence into
recovery.** Mean |jerk| during the 25-step recovery phase (0.168) sits ~4× above
the deep-work baseline (0.047) — for the *entire* recovery phase, not just the
first couple of boundary-contaminated steps where the finite-difference window
still spans the incident's tail. Whether this is a genuine multi-step "ringing"
effect of a 3rd-order difference after a sharp shock, or an artifact of this
specific synthetic recovery shape, isn't determined by this test — it's flagged
as a real observation in the map, not claimed as a mechanism. Worth a closer look
if jerk is ever used for anything beyond display.

**8. Efficiency is a non-issue.** `computeSeries` over 5,000 points completes
in single-digit milliseconds — no realistic session length is a concern.

## What this settles, for now

- All three derivative orders are **reliable, non-degenerate instruments** under
  realistic architectural load — matching the same acceptance bar already applied
  to the holding valve and the graph shape.
- The specific numerical-analysis risk with higher-order finite differences
  (noise amplification on oscillating data) was checked directly, not assumed
  away — and found not to be a problem on this test.
- `reserve`'s unbounded nature is now explicitly on record as a behavioral
  contract, distinct from `holding.ts`'s deliberately-bounded quantities in the
  same codebase.
- This does **not** validate κ itself as coherence (`MEMORY_KERNEL_SPEC.md` §6:
  Track A stays "a provisional textual heuristic," Track B stays gated behind
  `SEAM.KAPPA_VALIDATED`). This tests whether the *derivative machinery* is
  trustworthy given whatever κ series it's fed — the same distinction
  `GRAPH_PRESSURE_TEST.md` drew for the graph shape.

## What was not tested

Real production κ telemetry (same caveat as every test in this series); why jerk
persists into recovery (finding 7, flagged not resolved); interaction between the
graph-shape facet and the kappa-series facet within one actual `self_state` call
(each has now been pressure-tested independently, not jointly).

---

*Run it: `npx vitest run src/kappa-dynamics-pressure-test.test.ts --reporter=verbose`
from the repo root (verbose reporter needed to see the printed derivative map).*

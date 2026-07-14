# The Overlay, With Perturbation In It — Real Data, Round Two

**The two named next-experiments from the transfer test, run: de-risking
overlay + perturbation-weighted conviction**

Companion to `docs/RECOVERY_VS_ATR_REAL.md` (which retired the binary exit) ·
sim: `src/recovery-overlay-real-data.test.ts` · same fixture, same 591 paired
entries · 2026

---

## What this test is

The transfer test retired the φ-composition as a binary exit (expectancy
−0.08R vs ATR's +0.75R — it amputated the fat right tail) and named the next
experiments. Both are run here, on the identical 591 real paired entries and
the **identical Chandelier trade envelope** (all policies share A's exact
entry and exit bars — the comparison isolates one question: what does
conviction-*sizing* do to the same trade?):

- **The de-risking overlay**: position size each bar = conviction (sized with
  the *previous* bar's conviction — no lookahead), instead of binary in/out.
- **Perturbation-weighted conviction** (`stepKappaWeighted`, new in
  `recovery.ts`): bar magnitude enters the recursion itself —
  `κ_next = (1−w)·m + w·target`, `w = |ret|/(2·ATR)` — dissolving the
  arbitrary dead-band. `w=1` reproduces the binary step exactly, so every
  step-invariant minimum survives as the worst-case floor; boundedness holds
  by the same convex-combination argument as everything else in the module
  (proven in 6 new unit tests, incl. 50k-step fuzz with out-of-range weights).

## Results (591 paired trades, identical envelopes)

| policy | expectancy (R/trade) | per-unit-exposure | median exposure | worst trade | mean in-trade DD |
|---|---|---|---|---|---|
| A (size 1, Chandelier) | **+0.754** | **0.0222** | 23.0 | −1.92 | −0.599 |
| C_bin (binary conviction size) | +0.286 | 0.0156 | 11.6 | −1.46 | −0.350 |
| C_pert (perturbation-weighted size) | +0.366 | 0.0191 | 12.0 | **−1.08** | **−0.316** |

**NVDA (the tail that decides everything): A +2.918 · C_pert +1.478 · (the
retired binary exit: +0.137).**

## Pre-registered verdicts: 3 of 4 held

- **P1 FAILED** — the overlay is ~14% *less* efficient per unit of exposure
  (0.0191 vs 0.0222), not more. Third failed pre-registration of the series,
  pinned as a regression-locked assertion with the failure named in the test.
- **P2 held** — worst single trade 44% shallower (−1.08R vs −1.92R).
- **P3 held, and it is the rehabilitation that matters** — tail participation
  survives sizing: NVDA +1.48R/trade, ~51% of the incumbent's tail capture,
  versus the retired binary exit's ~5%. The overlay does NOT re-commit the
  amputation. Positive pooled expectancy (+0.366R) versus the binary exit's
  negative.
- **P4 held** — perturbation-weighting beats the binary+dead-band regulator on
  every column (expectancy +0.366 vs +0.286, per-unit 0.0191 vs 0.0156, worst
  trade −1.08 vs −1.46). Putting the magnitude *into* the recursion is a
  strict upgrade over the dead-band patch. The user's instinct — "put some
  perturbation in it" — is measured, confirmed, and now the canonical form.

## The honest verdict

On these trend entries, **constant full size + Chandelier remains the best
pure system** — nothing here dethrones it on efficiency, and P1's failure is
recorded plainly. What the perturbation-weighted overlay is, measured: **a
drawdown-shaping instrument** — 86% of the incumbent's per-unit efficiency at
half the deployed exposure, with a 44% shallower worst trade, a 47% shallower
mean in-trade drawdown, and the right tail preserved. The φ machinery's
measured identity after the full arc:

- binary exit → **retired** (negative expectancy, tail amputated)
- perturbation overlay → **viable risk-shaper** (positive expectancy, half
  the exposure and drawdown, modest efficiency cost)

That is a real rehabilitation, attributable to exactly the two changes the
transfer test prescribed — overlay-not-exit, and perturbation-in-the-
recursion — and it stops honestly short of claiming an efficiency win the
data doesn't show.

## What was not tested

Costs (would hurt the overlay's per-bar re-sizing more than A's two
transactions — the gap likely widens); leverage-normalized comparison
(levering C_pert to A's average exposure scales both return and tail back
up — whether the shape advantage survives normalization is a real open
question); the SHORT side; mean-reversion entries (still the untested niche
where the right tail isn't the payer); conviction floors/caps on the size
mapping (size = κ raw was the a-priori choice).

---

*Run it: `npx vitest run src/recovery-overlay-real-data.test.ts --reporter=verbose`.*

---

## Addendum — Round Three: The Asymmetric Regulator (first 4/4 pre-registration sweep)

Two further design constraints were specified and formalized:

1. **"The rate of collapse has to be inversely proportional to the rate of
   recovery."** → `S_collapse · S_recovery = s²` exactly, with φ supplying the
   canonical pair: `S_C = φ·s`, `S_R = φ⁻¹·s` (ratio φ² ≈ 2.618 — trust lost
   ~2.6× faster than earned; behaviorally verified: one violation takes 3
   confirmations to clear, ceil(φ²)).
2. **"The threshold must be dynamic and never let the loss function achieve
   complete failure or complete success."** → the state lives in log-odds
   space as a ρ-leaky integrator (`createAsymmetricRegulator`, ρ=0.10 per
   PT-II's fast clock, Z=3): |z| is bounded strictly by the same proof as the
   valve, so κ is confined to the OPEN interval — and the asymmetry makes the
   rails themselves asymmetric as a *consequence*: κ ∈ (0.047, 0.759). The
   success ceiling sits nearer neutral than the failure floor — complete
   success is structurally harder to approach than complete failure. All
   thresholds are fractions of the structural rails: change ρ or Z and they
   move with the structure (10 property tests, incl. 100k hostile-input fuzz).

**Raced as the fourth sizing rule on the identical 591 envelopes:**

| policy | expectancy (R/trade) | per-unit | median exposure | worst trade | mean in-trade DD |
|---|---|---|---|---|---|
| A (incumbent) | +0.754 | 0.0222 | 23.0 | −1.92 | −0.599 |
| C_pert (symmetric) | +0.366 | 0.0191 | 12.0 | −1.08 | −0.316 |
| **C_asym** | +0.321 | **0.0199** | 11.0 | **−0.89** | **−0.280** |

NVDA: A +2.918 · C_pert +1.478 · **C_asym +1.263**.

**All four pre-registered claims held — the first clean sweep of the series:**
PA1 (worst trade ≤ symmetric's: −0.89 vs −1.08 ✓), PA2 (in-trade DD improves:
−0.280 vs −0.316 ✓), PA3 (**the** question — φ²-slow recovery does NOT
re-amputate the tail: NVDA +1.263R, above the +1.0 bar ✓), PA4 (expectancy
solidly positive ✓).

**Verdict:** the asymmetric regulator is the best drawdown-shaper in the
series — better per-unit efficiency than the symmetric overlay (0.0199 vs
0.0191, closing to 90% of the incumbent's), the shallowest worst trade
(−0.89R, 54% shallower than the incumbent), the shallowest in-trade
drawdowns, at a modest tail cost (NVDA 1.26 vs 1.48) that stays well above
the amputation floor. The two specified constraints didn't just survive
contact with real data — they improved every risk metric they touched.

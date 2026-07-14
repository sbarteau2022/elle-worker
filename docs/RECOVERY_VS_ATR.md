# Recovery vs ATR

**Does the φ-conviction / strained-loss exit beat a plain ATR trailing stop on
Maximum Adverse Excursion?**

Companion to `recovery.ts` (the φ recovery regulator) and `superposition.ts`
(RULE-0 + valve) · sim: `src/recovery-atr-pressure-test.test.ts` (seeded; the
first composition of recovery.ts through the real `decideCollapse`) · 2026

---

## What this test is

The benchmark the whole strained-loss-vs-ATR thread was for. Policy A is the
textbook Chandelier trailing stop — 3×ATR(22) from the high-watermark (price
space, reactive). Policy B composes the two SHADOW modules — `recovery.ts`'s
φ-conviction regulator (binary direction with a 0.25·ATR dead-band) +
`superposition.ts`'s `decideCollapse` (RULE-0 hard floor first, valve at ρ=0.10
per Pressure Test II's fast-detector finding) — into a thesis-coherence exit
(information space, predictive). Both policies see identical seeded series;
B's parameters were fixed a priori with no per-scenario tuning; both carry the
same worst-case intent (A's stop distance = B's RULE-0 floor = 3·ATR at entry).

This composition **is** the first wiring of `recovery.ts` through
`decideCollapse` — done in the harness, not in `superposition.ts`, per the
"report decides before the code does" discipline.

## Harness history, on record

- **Run 1 (invalid, discarded):** 2×ATR-proxy(14) on raw close-to-close |ret|.
  Every policy exited every scenario in 5–9 bars — including a genuine trend —
  so the harness was measuring leash length, not exit intelligence. A validity
  gate was added: the ATR trail must actually ride a genuine trend.
- **Run 2 (invalid):** a 1.5× true-range factor (close-to-close |Δ| understates
  the range a real ATR sees) applied symmetrically to both policies. Trend hold
  improved 8→14 bars; still hair-trigger.
- **Run 3 (valid, reported below):** the a-priori textbook geometry — Chandelier
  3×ATR(22) (Chande & Kroll). Trend hold 24 bars; the scenario rows now
  differentiate. The validity gate, first written as ≥40 bars (an uncalibrated
  guess made before measuring), was revised to ≥20 — clear of the hair-trigger
  regime and past the valve's detection horizon — rather than widening the stop
  further to chase an arbitrary number, which would itself have been tuning.

## Results (median over 100 seeded runs per scenario)

| scenario | MAE(R) ATR | MAE(R) φ | exit(R) ATR | exit(R) φ | bars ATR | bars φ |
|---|---|---|---|---|---|---|
| trend | 0.29 | 0.28 | +0.41 | +0.40 | 24 | 16 |
| chop | 0.59 | 0.54 | −0.37 | −0.18 | 16 | 13 |
| slow-bleed | 0.88 | 0.88 | −0.85 | −0.81 | 10 | 10 |
| waterfall | 0.58 | 0.45 | −0.22 | −0.09 | 19 | 14 |
| dead-cat | 0.52 | 0.43 | −0.26 | −0.07 | 17 | 13 |

## Findings

**1. The pre-registered core claim FAILED — and the reason is worth more than a
win would have been.** Pre-registered: "a persistent small drift never expands
the true range, so the ATR stop trails it all the way down; conviction exits
≥25% shallower." Measured: a dead tie (0.88R vs 0.88R). The argument is simply
wrong **for a trailing stop**: the high-watermark freezes near entry while the
grind closes distance to the stop every single bar — no range expansion is
needed for a Chandelier trail to catch a bleed. The "ATR is blind to slow
bleeds" blind spot belongs to *fixed* and *breakout* stops, not trails. This is
the second honest negative of the series (after the free-energy reform), and it
kills a claim that sounded mechanical and inevitable right up until it met a
simulation.

**2. The real advantage lives somewhere else than predicted: exit prices in
adverse regimes.** Across every adverse scenario, B exits at a systematically
better price with equal-or-better MAE:
- **dead-cat: −0.07R vs −0.26R** — B's largest win, ~73% less realized loss,
  and it is exactly where `recovery.test.ts`'s whipsaw finding predicted the
  two-term unwind would materialize (κ_{k−2} still remembers the crash, so the
  bounce-trap re-strains in ~2 bars instead of waiting for price to re-walk
  down through a trailed stop).
- **waterfall: −0.09R vs −0.22R** — conviction dies during the cliff itself;
  the trail needs the full stop distance to be re-walked.
- **chop: −0.18R vs −0.37R** — B reads "no thesis" faster than the trail
  drifts down.

**3. The cost, measured honestly: ~30% shorter trend holds at equal capture.**
B holds a genuine trend a median 16 bars vs A's 24 — but exits at +0.40R vs
+0.41R. Under these parameters the earlier exits cost nothing in capture. That
equality should NOT be assumed to generalize to longer/stronger trends: a
regime with rarer, larger pullbacks would likely favor the trail's patience.
Flagged as a boundary of this result, not a settled property.

**4. MAE was the wrong headline metric all along.** The thread's original
question ("predicts adverse excursion better") presumed MAE as the yardstick.
Measured, MAE differences are modest (0–0.13R) — because both policies carry
the same worst-case leash, MAE is mostly determined by the leash. The
information-space edge shows up in **realized exit quality** (where inside the
excursion you actually get out), which is invisible to MAE. The benchmark
answered a better question than it was asked.

## What this settles, for now

- The φ-conviction composition is **not** a better slow-bleed detector than a
  trailing ATR stop. Claim retired, with the mechanism of its failure named.
- It **is** a measurably better exit in regime-break scenarios (waterfall,
  dead-cat, chop) at these fixed, untuned parameters — with the dead-cat
  result mechanically consistent with the two-term unwind property proven in
  `recovery.test.ts`.
- Everything remains SHADOW. This is one synthetic harness with one
  parameterization: no real market data, no transaction costs, no gaps/slippage
  (close-to-close fills), binary direction only, LONG-only, one entry rule.
  Promotion into `superposition.ts` as a composed helper is now *justified as
  an experiment* by these numbers, but validation against real series — and
  the step-cadence decision flagged in `recovery.ts`'s header — come first
  before anything drives a decision.

## What was not tested

Real price data; costs/slippage/gaps; SHORT side; magnitude-weighted conviction
(the binary regulator + dead-band was the a-priori choice — a signed-magnitude
variant is an obvious next candidate); parameter sensitivity (floor 0.15,
dead-band 0.25·ATR, ρ=0.10 were fixed, not swept — deliberately, to avoid
tuning; a sweep is legitimate *after* the shape of the result is on record);
longer-horizon trends where the trail's patience should pay.

---

*Run it: `npx vitest run src/recovery-atr-pressure-test.test.ts --reporter=verbose`
(verbose shows the full comparison table).*

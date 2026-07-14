# Recovery vs ATR — Real Data

**The transfer test: six real names, five real years, paired entries — and a
two-level verdict**

Companion to `docs/RECOVERY_VS_ATR.md` (the synthetic benchmark) · sim:
`src/recovery-atr-real-data.test.ts` · fixture:
`test-fixtures/real-ohlc-5yr.csv` (real S&P-constituent daily OHLC,
2013-02-08 → 2018-02-07, from the public plotly/datasets mirror) · 2026

---

## What this test is

The gate the whole SHADOW series was waiting for: no more synthetic series.
Six names chosen a priori from public market history (not scanned for
favorable windows): CHK (the definitive multi-year slow bleed, ~−90%), KMI
(the late-2015 waterfall), GE (chop, then the famous 2017 bleed), FCX
(commodity bleed then recovery trend), NVDA (the monster 2016-17 trend), WMT
(chop + the Oct-2015 one-day earnings crash) — plus the Aug-2015 flash crash
and Feb-2018 VIX-mageddon hitting all six inside the window.

Methodology fixed before running: shared mechanical entries (55-bar close
breakout, Turtle-classic), **paired per-signal evaluation** (591 identical
entries, each evaluated to exit under both policies independently), true
Wilder ATR(22) from real high/low (the synthetic harness's range-proxy factor
gone entirely), policy B's parameters byte-identical to the synthetic
benchmark — a transfer test, not a re-tune. Close-to-close fills, no costs;
same simplifications both sides.

## Results (591 paired trades)

| ticker | signals | median loser A / B | median winner A / B | median MAE A / B | median bars A / B |
|---|---|---|---|---|---|
| CHK | 62 | −0.87 / −0.98 | 0.83 / 0.48 | 0.76 / 0.64 | 17 / 14 |
| FCX | 79 | −0.72 / −0.72 | 0.55 / 0.52 | 0.53 / 0.48 | 24 / 17 |
| GE | 74 | −0.59 / −0.58 | 0.50 / 0.41 | 0.58 / 0.48 | 24 / 17 |
| KMI | 69 | −0.87 / −1.00 | 0.65 / 0.48 | 0.81 / 0.74 | 13 / 13 |
| NVDA | 189 | −0.79 / −0.67 | **2.34 / 0.68** | 0.52 / 0.30 | 32 / 21 |
| WMT | 118 | −0.75 / −0.70 | 0.76 / 0.53 | 0.46 / 0.40 | 22 / 19 |
| **POOLED** | **591** | **−0.81 / −0.74** | **0.96 / 0.57** | **0.58 / 0.45** | **23 / 17** |

**Expectancy (mean exit R per trade): A +0.754 · B −0.083.**
**Win rate: A 34.7% · B 41.6%.**
**NVDA alone: A +2.918 · B +0.137.**

## Findings

**1. All three pre-registered claims TRANSFERRED (3/3).** P1: B cuts losers
shallower (pooled median −0.74R vs −0.81R). P2: B's MAE is lower (0.45 vs
0.58). P3: B holds shorter (17 vs 23 bars). The synthetic exit-quality edge
is real on real data, at untouched parameters. The trade-level instrument
works as measured.

**2. And the system-level verdict is NEGATIVE — the most important finding
of the series.** As a standalone exit on trend-following entries, the
φ-composition destroys the system's edge: pooled expectancy **−0.083R/trade
vs +0.754R for the ATR trail**. The mechanism is classic and now measured:
trend-following's entire payout lives in the fat right tail — NVDA's monster
trend alone carries A's expectancy (+2.92R/trade there) — and B, cutting
"incoherent" stretches early, systematically amputates that tail (0.68R
median winner vs 2.34R; +0.14R expectancy on NVDA). B wins *more often*
(41.6% vs 34.7%) and earns *less* — the high-win-rate/small-edge trap,
exhibited cleanly.

**3. Both findings are true simultaneously, and the distinction is the
point.** "Better at exiting bad situations" (trade-level, transferred) and
"worse as a trend-system exit" (system-level, decisive) are not in tension —
they are the same behavior read at two levels. An exit that reliably
de-risks adverse regimes is exactly the exit that also de-risks the
drawdowns *inside* a monster trend, and on these entries the drawdowns
inside the trend were where the money was.

**4. What this measures the composition to actually be: an adverse-regime /
risk-off instrument, not a trend exit.** The honest, data-backed niches now
on record: (a) a de-risking overlay (reduce size on conviction collapse
rather than fully exit — preserving tail participation while cutting
adverse exposure); (b) exits for entry styles whose payout does NOT live in
the right tail (mean-reversion, short-horizon); (c) crash/dead-cat
protection layered onto a wider primary stop. Each is a hypothesis for a
future test, not a claim.

**5. The synthetic benchmark's flagged boundary was the real story.** The
synthetic result "equal trend capture at shorter holds" was explicitly
flagged as parameter-bound and not to be generalized. On real trends it did
not generalize: capture fell 71% on the name that mattered. The flag was
earned.

## What this settles

- The φ-conviction composition is **retired as a candidate standalone exit
  for trend-following entries** — measured, on real data, at pre-registered
  parameters, with the mechanism named.
- Its trade-level exit-quality properties are **confirmed on real data** and
  remain available for the three niches above.
- Everything stays SHADOW. Nothing here changes `superposition.ts` or
  `recovery.ts` — per the discipline, this report decides what the next
  code should be, and what it decides is: no promotion as a trend exit;
  the de-risking-overlay variant is the next legitimate experiment.

## What was not tested

Costs/slippage/gaps (would hurt B more — it trades exits more often); the
SHORT side; the de-risking-overlay variant (size reduction instead of
binary exit); mean-reversion entries; magnitude-weighted conviction;
parameter sweeps (deliberately — the transfer test had to be untouched
parameters or it measures nothing).

---

*Run it: `npx vitest run src/recovery-atr-real-data.test.ts --reporter=verbose`
(verbose shows the full table and expectancy lines).*

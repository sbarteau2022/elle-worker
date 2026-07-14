# The Three Final Gates — Costs, Leverage, the Mean-Reversion Niche

**The v3.0 spec wrote them as equations. Gates close by measurement.**

Companion to `docs/RECOVERY_OVERLAY_REAL.md` · sim:
`src/witness-gates-real-data.test.ts` · same fixture (six real names,
2013–2018), same 591 trend envelopes + 179 new mean-reversion entries · 2026

---

## What this test is

The three gates left open at the end of the overlay series, run on real data
with pre-registered claims. The spec's formulas, translated honestly into the
system's actual one-dimensional terms: Gate 1 is turnover friction
(cost ∝ |Δsize|; `d_H` in a 1-D conviction state is |Δκ|); Gate 2 is
inverse-variance de-levering (textbook vol-targeting with a φ scale,
de-lever-only); Gate 3 is a z-score band entry — the one place φ does real
structural work ([φ, φ²] ≈ [1.618, 2.618]σ brackets the classic 2σ trigger,
with a falling-knife exclusion below). The excluded knife cohort was also
measured, so the cutoff was tested, not assumed.

## Results

**Trend envelopes (591), Gates 1–2:**

| policy | exp(R) | cost(R) | turnover | worst | mean in-trade DD |
|---|---|---|---|---|---|
| A, base costs | +0.739 | 0.016 | 2.00 | −1.94 | −0.605 |
| A, 10× stress | +0.599 | 0.155 | 2.00 | −2.09 | −0.658 |
| C_asym, base costs | +0.310 | 0.011 | 1.37 | −0.90 | −0.284 |
| C_asym, 10× stress | +0.212 | 0.109 | 1.37 | −0.98 | −0.320 |
| C_asym vol-normed (Gate 2) | +0.100 | 0.006 | 0.89 | **−0.49** | **−0.164** |

**Mean-reversion niche (Gate 3): 179 in-band entries, 48 knife-excluded:**

| policy | exp(R) | worst | mean in-trade DD |
|---|---|---|---|
| MR full-size | −0.122 | −2.96 | −0.828 |
| MR asym overlay | −0.060 | −1.24 | −0.376 |
| MR knife cohort (the "excluded" zone) | **+0.112** | −2.57 | −0.739 |

## Findings — 7 of 10 pre-registrations held; the 3 failures are the headline

**1. GATE 1 CLOSES CLEAN — and refutes our own earlier speculation.** Costs
are second-order at daily cadence on liquid names (~0.01–0.016R/trade), the
ordering is unchanged, and C_asym survives 10× stress solidly positive
(+0.212R). The Round-2 doc guessed "costs hurt the overlay's per-bar
re-sizing more than A's two transactions." **Measured: backwards.** The
overlay churns *less* than the incumbent (turnover 1.37 vs 2.00 — it enters
at half size, drips small |Δκ| adjustments, exits small) and pays less
friction. Fourth refuted pre-registration of the series, this one refuting
our own document.

**2. GATE 2 FAILED AS SPEC'D — the formula re-amputates the tail through the
vol channel.** Pre-registered: NVDA stays > +1.0R under Λ = min(1, 1/(φ·V)).
Measured: **0.439R** (from 1.263 unnormalized). Mechanism: V = ATR_now/ATR_entry
in *dollars* — a monster trend's dollar-ATR grows with its price even at
constant percentage volatility, so the throttle crushes size precisely
through the payoff. "Price grew" is not "risk expanded"; the spec's formula
conflates them. What Gate 2 *did* buy, on record: the most defensive profile
of the entire series (worst trade −0.49R, mean in-trade DD −0.164R, expectancy
still positive) — an ultra-conservative instrument, at a steep tail price. A
%-of-price volatility measure is the registered next candidate.

**3. GATE 3 FAILED INVERTED — the knife zone beat the sanctioned niche.**
Pre-registered: the band [−φ², −φ] beats the excluded z < −φ² cohort.
Measured: in-band **−0.122R** mean (the niche loses money outright), knife
cohort **+0.112R** — the cutoff points the wrong way on this universe.
Mechanism, named honestly: these six names were chosen a priori as
bleeders/crashers for the *exit* tests (CHK, GE, KMI…) — buying 1.6–2.6σ dips
inside structural downtrends is exactly catching the knife the band claimed
to avoid, while deeper crosses often marked capitulation lows. Caveat on
record: this universe is adversarial for long-MR by construction; the band
may fare differently on genuinely mean-reverting instruments. On this data,
it fails, and no φ-dressing changes that.

**4. The niche efficiency question (G3b) is unanswerable here** — both
per-units are negative; there is no efficiency crown in a losing strategy.
But G3c held, and it matters: **the overlay halved the damage** (expectancy
−0.060 vs −0.122, worst −1.24 vs −2.96, in-trade DD −0.376 vs −0.828). The
drawdown-shaper identity held even inside a losing niche — the instrument
does the same job whether the strategy around it is winning or losing.

## What this settles

- **Gate 1 (costs): closed, favorably and surprisingly** — the overlay is
  *cheaper* to run than the incumbent, and everything survives 10× stress.
- **Gate 2 (leverage): closed against the spec's formula** — dollar-vol
  normalization re-amputates the tail; the defensive profile it buys is real
  but the formula needs a relative-vol repair before it's a candidate again.
- **Gate 3 (MR niche): closed against the niche, on this universe** — the
  band loses, its exclusion rule inverts, and the honest residual is that
  the overlay's damage-halving held even there.
- The φ machinery's final measured identity is unchanged by all three:
  **a drawdown-shaper** — cheaper than the incumbent to run, robust to
  costs, best-in-class left tail, and consistent about what it does across
  winning and losing regimes. Not an alpha source. Every claim that it was
  one has now been tested and retired with its mechanism named.
- Everything remains SHADOW. "Mathematically complete" was the spec's claim;
  what stands is narrower and real: **empirically characterized, boundary by
  boundary, with four refuted pre-registrations of our own on the record.**

## What was not tested

A %-of-price vol measure for Gate 2 (registered next candidate); Gate 3 on a
genuinely mean-reverting universe (pairs, ETF spreads — this fixture cannot
answer it); intraday cadences where turnover friction stops being
second-order; the SHORT side throughout.

---

*Run it: `npx vitest run src/witness-gates-real-data.test.ts --reporter=verbose`.*

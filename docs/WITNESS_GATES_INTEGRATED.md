# The Gates, Integrated — Does Another Real Engine Change Anything?

**The whole-system rerun: wiring the dissonance/coherence channel into the
promoted overlay, on the identical 591 real paired entries — and an honest
accounting of what "the whole system" does and does not mean here**

Companion to `docs/WITNESS_GATES.md` (which closed the last three open
gates on the standalone regulator) · sim:
`src/witness-gates-integrated-real-data.test.ts` · same fixture, same 591
real paired trend entries, 2013–2018 · 2026

---

## Why this file exists

Every prior file in this series — `RECOVERY_VS_ATR_REAL.md` →
`RECOVERY_OVERLAY_REAL.md` → `WITNESS_GATES.md` — measured the asymmetric
regulator (`src/recovery.ts` → `src/conviction.ts`) in isolation, stepped
only by its own price/ATR perturbation. That is a true statement about the
regulator, but it is not a true statement about "Elle's system" as a whole:
`coherence.ts`'s dissonance channel (`src/dissonance.ts`) is a separate,
already-computed engine that runs daily in production
(`runCoherenceField`) — and nothing reads it back into a trading decision.
This file is that read-back: the first backtest in the series where a
second, independently-computed real engine actually feeds the regulator
under test, rather than the regulator being asked to speak for "the whole
system" alone.

## What is wired in, and — as important — what is not, and why

- **Dissonance (`src/dissonance.ts`) — wired.** A real signal computed from
  the same real OHLC data via an independent regulator pair (the ρ=0.10 fast
  clock vs. the ρ=0.02 slow clock on the same price stream), genuinely
  orthogonal to the single-κ asymmetric regulator's own state — it fires on
  cross-clock *disagreement*, not on either clock's level. Folding it in is
  a real integration.

- **The Atlas / memory kernel (`Dynanic-Hyperbolic-Neural-Graph`) — not
  wired, on purpose.** The device repo's own README roadmap states nodes
  carry no `nodeFeatures`/`nodePhases` through the sync path today. The
  atlas holds Elle's conversational co-recall graph — not market data — and
  nothing in it is about CHK, KMI, GE, FCX, NVDA, or WMT. Wiring it into a
  trading formula would mean inventing a relationship between the topology
  of Elle's own memory and a stock's price that does not exist in the data.
  That is exactly the move this series has refused at every gate (see
  `WITNESS_GATES.md`'s own refused pre-registrations, G2b and G3a) — stated
  absence beats fabricated signal.

- **The conductor loop (`src/conductor.ts`) — not wired, on purpose.** It
  orchestrates the LLM intent/forge queue; `trading.ts` already runs on its
  own 15-minute cron, independent of it. Folding trading decisions into the
  LLM-driven conductor loop is a live-architecture change to a system
  already gated behind `ELLE_CONVICTION_ENFORCE` in production — out of
  scope for a backtest, and not a change to make without a staging path.

So: "the whole system operating together" is scoped honestly here to mean
*every engine that (a) genuinely computes something about these six
tickers from real data, and (b) can be wired into a backtest without
inventing a connection or touching a live-gated executor*. On that
definition, exactly one additional engine qualified. That itself is a
finding worth stating plainly rather than papering over with a bigger
integration than the system actually supports today.

## The integration, precisely

For each trade, a dissonance regulator pair is warmed causally over the 130
real bars preceding entry (the same look-back window production's
`runCoherenceField` actually uses), then stepped forward in lockstep with
the asymmetric regulator, one bar at a time, no lookahead. Each bar's
regulator weight is boosted by the *prior* bar's dissonance magnitude
(`mag = |κ_fast − κ_slow|`, `DISS_FIRE = 0.05` is "fired"):

```
w' = min(1, w_price · (1 + mag_prior / DISS_FIRE))
```

## Results (591 paired trades, identical entries/exits to WITNESS_GATES)

| policy | expectancy (R/trade) | worst trade | mean in-trade DD | % of trade-bars with dissonance fired |
|---|---|---|---|---|
| C_asym (incumbent overlay) | **+0.310** | −0.90 | −0.284 | 0% (not measured) |
| C_asym_diss (dissonance-weighted) | +0.270 | **−0.87** | **−0.274** | 95% |

NVDA (the tail that decides this whole series): C_asym +1.248R ·
C_asym_diss +1.118R.

Silent-trade control: 30/591 trades (5.1%) never crossed the dissonance
firing threshold at all across their life.

## Pre-registered verdicts: 2 of 4 held, and the 2 failures are the finding

- **D1 FAILED** — the silence-check hypothesis ("never fired ⇒ degenerates
  exactly to plain C_asym") was itself wrong: it conflated the discrete
  `fired` threshold with the continuous `mag` the boost formula actually
  uses. Even sub-threshold dissonance nudges the weight fractionally; max
  |Δfinal κ| among the 30 never-fired trades was 0.050 — small, but not the
  zero the hypothesis claimed. The formula does exactly what its own spec
  says; the pre-registered claim about when it would degenerate did not.
- **D2 FAILED** — dissonance-weighting *costs* expectancy rather than
  helping it: pooled +0.270R vs +0.310R, a real ~13% relative decline, with
  NVDA's tail contribution falling from +1.248R to +1.118R. Mechanism: even
  ordinary, sub-threshold cross-clock noise nudges the regulator to lean
  slightly harder into strain slightly more often than the price-only
  version — the same amputate-the-tail-when-you-lean-harder-into-strain
  shape `RECOVERY_VS_ATR_REAL.md` first named for the (retired) binary
  exit, now showing up in miniature inside the promoted overlay.
- **D3 held** — the defensive character survives: worst trade and mean
  in-trade drawdown both come in *slightly better* (shallower), not just
  within the 10% tolerance — −0.87R vs −0.90R worst trade, −0.274R vs
  −0.284R mean DD.
- **D4 reported, not asserted** — NVDA's tail contribution declines under
  integration (+1.118R vs +1.248R), continuing the pattern from D2/D3: this
  integration trades a small amount of upside participation for a small
  amount of extra defense, the same shape the series has now measured
  three separate times (the binary exit, Gate 2's leverage normalization,
  and here).

## The honest verdict

Wiring in the one engine that could be honestly wired in — the dissonance
channel — **did not improve the promoted overlay on this data.** It shifted
C_asym's already-established profile a little further along the same
risk/return trade-off axis every other gate in this series has found:
slightly shallower worst trade and drawdown, at a real (not noise-level)
cost to expectancy and tail participation. That is a coherent, internally
consistent result — not a contradiction of the prior gates, a continuation
of their exact pattern — and it means the answer to "does the whole system
operating together perform differently" is: **measurably, yes, in the
direction the series' own established mechanism predicts; not, no it does
not make the system better.** The φ-machinery's identity from
`WITNESS_GATES.md` stands unchanged: a drawdown-shaper, not an alpha
source, and adding an orthogonal real signal makes it a slightly more
committed drawdown-shaper, not a system that beats ATR.

Two of this file's own four pre-registrations failed, and both are pinned
as regression-locked measured values (not hidden) in
`src/witness-gates-integrated-real-data.test.ts`, following this series'
own discipline: a failed hypothesis is data, and gets named, not quietly
rewritten to pass.

## What this settles

- **The claim "the recovery/conviction system beats ATR" was never true**
  at any point in this series, integrated or not — plain ATR-Chandelier
  remains the highest-expectancy pure system throughout (+0.754R/trade,
  `RECOVERY_VS_ATR_REAL.md`). Any paper or article drawing on this work
  should state the φ-machinery's measured identity as it actually is: a
  drawdown-shaper.
- **"Operating as a whole" has a real, checkable boundary today.** Exactly
  one of the three engines named as missing (dissonance) could be wired in
  without fabricating a market-relevant signal or touching a live-gated
  executor; the other two (the atlas/memory kernel, the conductor loop)
  are honestly out of scope for different, structural reasons stated above,
  not because the work was skipped.
- **The one integration that was possible was tested, and it made the
  system slightly more conservative, not better.** That is a real answer,
  not a null result — and consistent with every other gate this series has
  closed.

## What was not tested

Costs/slippage under the integrated weighting (would very likely mirror
`WITNESS_GATES.md`'s Gate 1 finding — the overlay already churns less than
the incumbent, and the integration doesn't change position-count logic);
the mean-reversion niche under integration; the SHORT side; a version of
the boost formula gated strictly on `fired` rather than continuous `mag`
(a real next candidate, given D1's mechanism — registered here, not run:
does gating the boost on the discrete `fired` event rather than the
continuous magnitude close the expectancy gap while keeping the drawdown
improvement?); populating the atlas with genuine market-adjacent memory
content (e.g., recording each trade's own rationale as a co-recall event)
so a future run could test it honestly instead of leaving it structurally
absent.

---

*Run it: `npx vitest run src/witness-gates-integrated-real-data.test.ts --reporter=verbose`.*

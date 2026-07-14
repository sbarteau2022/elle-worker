# κ Backtest — Does It Flux Like the Market, and Does It Lead?

**The replay pinned κ at 0.5 (cold start, 6–8 bars). This asks the question
right: warm on half of years of real data, predict on the other half.**

Code: `src/backtest.ts` · pure tests: `src/backtest.test.ts` (9) · one-shot from
the trading cron → `elle_kappa_backtest` · SHADOW · 2026

---

## The design

1. **Warm** the regulator on the first half of ~6 years of Alpaca daily bars
   per symbol — it *stands on* real history, so κ enters the test half **live**,
   with an established volatility scale, not forced to 0.5.
2. On the **test** half, at every bar it throws a prediction; we measure whether
   κ fluxes with the market — **and whether the flux LEADS or only LAGS.**

It steps the **same `observeCycle`** the live conviction channel uses — the live
instrument on real out-of-sample history, not a re-implementation.

> Scope: the *spine's* Axis 17 needs LLM axes per run, so it can't step per-bar
> over years. But the spine's conviction is the **same κ regulator** over a
> different stream, so κ's predictive value on price directly tests the core.

## Pre-registered (before running)

| claim | statement | prior |
|---|---|---|
| **PT-BT1** | κ FLUXES: warmed test-half std(κ) ≫ 0; the pin was the cold short window, not the instrument | yes |
| **PT-BT2** | κ predicts forward **volatility**: strain magnitude (0.5−κ)⁺ correlates **+** with \|forward return\| (vol clusters) | **yes** |
| **PT-BT3** | κ does **not** predict forward **direction**: (κ−0.5) ≈ 0 correlation with signed forward return | **no** |
| sanity | contemporaneous corr(κ−0.5, trailing return) is strongly **+** — κ tracks what just happened | yes |

PT-BT3 is the honest null: everything the trading arc measured says κ is a
**drawdown-shaper** — it reacts to realized vol, it does not forecast returns.
If the direction correlation came back large on real out-of-sample data, *that*
would be the surprise worth chasing. The test is built to let the data overrule
the prior, not to protect it.

## What the pure tests already pin (no market data)

- **PT-BT1** holds synthetically: a volatile series gives real test-half κ
  variance; warming on an uptrend enters the test half **charged**, on a decline
  **strained** — neither pinned at 0.5.
- **PT-BT2** holds synthetically: on a series with clustered volatility, strain
  magnitude leads \|forward return\| (corr > 0.1).
- **PT-BT3** holds synthetically: on a pure random walk, \|corr(κ−0.5, forward
  return)\| < 0.15 — no directional edge where none exists.
- Two real properties re-confirmed and documented, not patched: a constant-σ
  walk **fluxes but borders the rails without crossing** (every bar normal-sized
  against its own vol); **rails are crossed by sustained direction, not mere
  high vol** (turbulence oscillates κ rather than accumulating the ~7 net-adverse
  steps a rail needs).

## Status

SHADOW. Runs once from the cron (guarded on the table being empty; clear
`elle_kappa_backtest` to re-run). Gates nothing. The live run over SPY/QQQ/NVDA/
AAPL/TSLA/GLD/TLT will report the three correlations per symbol — the real
answer to "does it flux like the market, and does it lead."

---

*Run the core: `npx vitest run src/backtest.test.ts --reporter=verbose`.*

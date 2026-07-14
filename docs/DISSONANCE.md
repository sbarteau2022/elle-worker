# Dissonance — The Signal Single-κ Couldn't Fire

**A self-referential regulator never crosses a rail. Dissonance comes from two
views that disagree — here, two clocks watching one stream.**

Code: `src/dissonance.ts` · pure tests: `src/dissonance.test.ts` (9) · one-shot
from the trading cron → `elle_dissonance_backtest` · SHADOW · 2026

---

## Why

The κ backtest (`docs/KAPPA_BACKTEST.md`) exposed the flaw: `frac_strained =
frac_charged = 0` on all seven symbols across three years. A single regulator
measures a stream against its **own** volatility (w = |ret|/2·ATR), so every
bar is normal-sized against itself — it re-scales to whatever regime it is in
and can never be surprised. **A self-referential signal cannot cross a rail.**

## The fix — signal from disagreement

Dissonance: the signal comes from two views that **disagree**, not one stream
measured against itself. Same primitive the spine's dissent and the council
reach for. The instance already latent in the architecture is **the two
clocks**, watching the *same* stream:

- **FAST** valve, ρ=0.10 — the smoke alarm (PT-II's detection clock)
- **SLOW** historian, ρ=0.02 — the leak-rate floor

Both equilibrate to the **same** level under steady state (z* = −w·zMax,
independent of ρ — proven), so when the market is calm *or* steadily trending
they converge and agree → **no signal**. During a regime **change** the fast
clock reacts and the slow one lags → they diverge. That gap,

```
D = κ_fast − κ_slow
```

is the dissonance — the beat frequency between two φ-regulators. Silent during
agreement, loud during change. It is a **transition** detector (responds to
the *change* of regime, not its level) — orthogonal to the single-κ level, and
it fires exactly where the self-normalized κ can't. The **sign** is an early
warning: D goes negative when the fast clock strains below the slow one — the
smoke alarm leading the historian.

## Pre-registered

| claim | statement | prior |
|---|---|---|
| **PT-D1** | dissonance **fires**: `frac_fired` > 0 (|D| crosses `DISS_FIRE`=0.05) where single-κ's rail count was 0 | yes |
| **PT-D2** | |D| leads forward **volatility**: corr(|D|, \|forward return\|) > 0 | plausible |
| **PT-D3** | signed D does **not** forecast **direction**: ~0 corr with signed forward return | no (it detects *change*, not *way*) |

## What the pure tests pin (no market data, 9 tests)

- Steady state → clocks **converge**, dissonance decays; a flat tape is silent.
- A calm→shock transition **spikes above the fire threshold** — the actionable
  event single-κ never produced.
- On a shock-bearing series, `frac_fired` > 0 and `diss_mag_max` > `DISS_FIRE`.
- The signed gap goes **negative** first on a decline — fast strains below slow
  (early warning), κ_fast < κ_slow.
- Random walk → signed-D direction correlation < 0.15 (no directional edge).

## Status

SHADOW. Runs once from the cron (guarded on the table being empty; clear
`elle_dissonance_backtest` to re-run). Gates nothing. The live run over the
same seven symbols answers the real question next to the single-κ table: **does
the two-clock beat give us the discrete, actionable signal the self-referential
regulator could not** — and does it lead volatility while (as expected) staying
blind to direction.

---

*Run the core: `npx vitest run src/dissonance.test.ts --reporter=verbose`.*

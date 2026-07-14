# Regime Analysis — Separating State from Transition

**Not "did it predict volatility." The right experiments: SNR + confidence
indexing, conditional transition cells, lead-time distribution, recovery clock.**

Code: `src/regime.ts` · pure tests: `src/regime.test.ts` (8) · one-shot from the
cron → `elle_regime_analysis` · SHADOW · 2026

---

## The reframe

κ and dissonance are two different observables, and the information lives in
their **interaction**, not in either alone:

- **κ level = STATE** — where the system sits in its stability landscape.
  Persistent, slow, vol-leading (SPY κ→vol +0.394). *Altitude.*
- **dissonance = TRANSITION** — the system is *changing*. Spiky, self-gating,
  not redundant with κ. *Acceleration.*

Neither replaces the other. So we measure what actually matters.

## The four experiments

**1. SNR + confidence indexing.** SNR = r²/(1−r²) vs forward vol, per signal. A
signal inside the SNR tolerance is trusted directly; below it, its contribution
is **indexed down** by a confidence multiplier (`min(1, SNR/tol)`) — not
discarded, weighted. This is the "tolerance window or confidence indexing" rule,
made concrete.

**2. Conditional transition cells — Risk = f(κ, Δκ, D), not f(D).** The same
dissonance means different things by κ context:

| cell | condition | reading |
|---|---|---|
| A | κ high · D rising | stable regime disturbed |
| B | κ low · D rising | already-unstable regime under more stress |
| C | κ low · D falling | recovery |
| D | κ high · D falling | stable & calm |

`interactionReal` = forward vol(B) > forward vol(A): if the unstable-plus-stress
cell is more dangerous than the stable-plus-disturbance cell, the interaction is
real and D-alone is the wrong model.

**3. Lead-time distribution.** When dissonance fires, forward vol at h ∈
{1,3,5,10,20} as a ratio to baseline. The **peak horizon** is the mechanism's
operating timescale — a curve, not a single correlation.

**4. Recovery clock.** κ's AR(1) mean-reversion **half-life** in bars — how fast
coherence returns after a disturbance. The third clock, measured. (State clock =
κ level; transition clock = dissonance; recovery clock = this half-life — the
three-clock decomposition, quantified.)

## What the pure tests pin (no market data, 8 tests)

Confidence index saturates at 1 above tolerance and scales linearly below; AR(1)
half-life recovers ~3 bars for φ=0.8 and collapses for white noise; the four
cells partition every bar; lead-time covers all horizons and names a peak; on a
vol-clustering series firing precedes above-baseline vol at the peak (ratio > 1).

## Status

SHADOW. One-shot from the cron over the same seven symbols; writes
`elle_regime_analysis`. The live run reports, per symbol: κ vs dissonance SNR and
their confidence indices; the A/B/C/D cell forward-vol table and whether the
κ×D interaction is real; the lead-time curve and its peak horizon; and κ's
recovery half-life. That answers "where does the information live" with data —
and tells us not to use the wrong variable for the wrong job.

---

*Run the core: `npx vitest run src/regime.test.ts --reporter=verbose`.*

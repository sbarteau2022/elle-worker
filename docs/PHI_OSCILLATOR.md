# The φ Oscillator — Dissonance as an Oscillator, Not a Constant

**The constant-gain perturbation froze on real data. A φ-frequency oscillator
is the fix — and the golden ratio is the right frequency for a deep reason.**

Code: `src/phi-oscillator.ts` · pure tests: `src/phi-oscillator.test.ts` (6) ·
one-shot from the cron → `elle_phi_perturbation_backtest` · SHADOW · 2026

---

## The correction

The constant-gain perturbation failed on real data — `frac_active_reg ≈ 0` on
five of seven symbols. A **constant** bias cannot lift a stuck needle off the
bottom. Dissonance is not a constant gain; it is a **φ oscillator** — the beat
between two φ-scaled clocks (S_C = φ·s, S_R = φ⁻¹·s). Applied as an oscillator
it does what a constant could not: **stochastic resonance** — a sub-threshold
drive plus an oscillation crosses the rail on the peaks where a static push
never would.

```
θ_{k+1} = θ_k + 2π·φ⁻¹   (mod 2π)          — the golden rotation
z_reg  = stepAsymmetricZ(z_reg, dir, w, ρ) + A·|D|·sin(θ)
```

## Why φ, specifically

The golden ratio is the **most irrational number**, so a φ-frequency rotation
is maximally **non-resonant** — `{k·φ⁻¹ mod 1}` is the most equidistributed
sequence there is; it never phase-locks and never repeats. In KAM theory the
**golden torus is the last invariant curve to break** under perturbation — the
most robust quasi-periodic orbit. So a φ oscillator keeps the needle perpetually
exploring — off the bottom — without ever driving it into a resonance that would
lock it (settle) or blow it up. It is the "alive, but never resonate to death"
perturbation. Any other frequency risks phase-locking with the market's own
periodicities; φ is the one that can't.

## Calibration (honest)

`|D|` gates the oscillator (silent in steady state), `A` is the amplitude. On a
choppy series — the real pathology, where the plain needle hovers **below** the
rail (|z|max ≈ 1.24, frozen) — the gain sweep is unambiguous:

| gain | active / 200 | rail breaches | \|z\|max |
|---|---|---|---|
| 0 (plain) | 0 | 0 | 1.24 |
| 8 (old constant scale) | 1 | 0 | 1.58 |
| **16 (chosen)** | **11** | **0** | 2.24 |
| 30 | 39 | 0 | 3.39 |

Gain 8 was too weak (why the constant version froze); **16** lifts one peak
injection at typical dissonance to ≈ one rail-height — enough to flick the
needle over during genuine dissonance, self-gated to ~0 when the clocks agree.
**Rail breaches stay 0 at every gain**: κ = logistic(z) ∈ (0,1) for any finite
z, so the open-rail invariant survives any bounded oscillator by construction.

## What the pure tests pin (no market data, 6 tests)

The golden rotation is quasi-periodic (≈ all-distinct phases over 500 steps, no
short period); on a choppy regime the plain needle stays frozen (< 3 active)
while the φ oscillator wakes it (> 5); a flat tape stays silent (self-gating);
100k hostile steps never push κ_reg to 0 or 1; the three-way backtest reports
plain/const/φ activity with zero rail breaches.

## Status

SHADOW. One-shot from the cron over the same seven symbols; writes
`elle_phi_perturbation_backtest` with the three-way `frac_active_plain` vs
`frac_active_const` vs `frac_active_phi`. The live run answers whether the
golden-frequency oscillator wakes the needle on **real** data where the constant
gain left it frozen — with `rail_breaches = 0` proving the invariant held.

---

*Run the core: `npx vitest run src/phi-oscillator.test.ts --reporter=verbose`.*

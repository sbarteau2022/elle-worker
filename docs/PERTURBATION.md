# Perturbation — Dissonance as Regulator, Not Forecaster

**The frame correction: dissonance isn't there to predict. It's the perturbation
that keeps the needle from settling on the bottom.**

Code: `src/perturbation.ts` · pure tests: `src/perturbation.test.ts` (7) · one-shot
from the cron → `elle_perturbation_backtest` · SHADOW · 2026

---

## The correction

The dissonance backtest judged the two-clock beat as a *forecaster* and found it
weaker than the κ level. Wrong yardstick. **Dissonance is perturbation** — a
regulator, not a predictor. Its job is to not let the needle settle on the
bottom.

The κ backtest showed the pathology exactly: a single self-normalized regulator
grades a stream against its *own* volatility, sinks below its own noise floor,
and goes quiet — `frac_strained = 0` on all seven symbols, three years. Nothing
crosses. Dissonance (|D| = |κ_fast − κ_slow|) is the perturbation that lifts the
sub-threshold signal back over the rail — **stochastic resonance** — wired back
IN as extra drive:

```
w_eff = min(1, w + G·|D|)
z_reg = stepAsymmetricZ(z_reg, dir, w_eff, ρ)
```

## Why it's a regulator and not just noise

- **Self-gating.** |D| ≈ 0 in steady state (calm *or* steady trend — the clocks
  agree), so the perturbation only fires during a **transition** — exactly when
  the needle must not be allowed to settle. And it gates to sustained
  **direction**, not raw volatility: directionless churn still cancels (dir
  alternates), so the needle wakes on a real regime move and stays quiet on
  noise *and* on chop.
- **Open rails preserved.** `w_eff` is clamped to 1, so the same leaky-integrator
  proof bounds |z_reg| < Z strictly. The perturbation keeps the needle **off the
  bottom**; it never slams it into the top. Complete failure and complete success
  stay structurally unreachable — the standing design constraint ("never let the
  loss function achieve complete failure or success") holds.
- **gain = 0 is the plain clock exactly.** With no dissonance gain, κ_reg ≡ the
  un-perturbed fast clock — the perturbation is a clean add-on, not a rewrite.

## Pre-registered

| claim | statement | prior |
|---|---|---|
| **PT-P1** | the needle stays alive: `frac_active_reg` ≥ `frac_active_plain`, and crosses (> 0) where the plain one froze | yes |
| **PT-P2** | self-gating: near-silent on a flat tape and on directionless churn; alive on a sustained regime | yes |
| **PT-P3** | open rails preserved: `rail_breaches` = 0 — κ_reg never reaches 0 or 1 | yes |

## What the pure tests pin (no market data, 7 tests)

gain=0 reproduces the plain clock bit-for-bit; a transition-bearing series wakes
the perturbed needle where the plain one froze; a flat tape and directionless
churn stay quiet while a sustained trend activates; 100k hostile steps never push
κ_reg to 0 or 1 (|z_reg| < Z strictly).

## Status

SHADOW. One-shot from the cron over the same seven symbols; writes
`elle_perturbation_backtest`. The live run answers the question that actually
matters — **does the needle now stay alive and cross where the self-referential
one froze, without breaking the open rails** — reported as `frac_active_reg` vs
`frac_active_plain` (which was 0), with `rail_breaches` proving the invariant
held on real data.

---

*Run the core: `npx vitest run src/perturbation.test.ts --reporter=verbose`.*

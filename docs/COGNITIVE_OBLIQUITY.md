# Cognitive Obliquity — a slow orientation parameter, and the null that keeps it honest

**By analogy to Earth's axial tilt: obliquity doesn't stop the planet spinning,
it changes how incoming energy is distributed over long periods. Here a slowly-
varying θ doesn't change the update rule F — it rotates how incoming information
is projected before F integrates it, so θ governs which representational axis gets
preferentially integrated over long horizons. The catch, found by measurement:
θ only does anything when there's anisotropy to orient relative to. That null is
the point, and it's what makes the analogy self-consistent.**

Code: `src/cognitive-obliquity.ts` · tests `src/cognitive-obliquity.test.ts` (6) ·
self-test `GET /api/elle-cognitive-obliquity-selftest` · a hypothesis with a test
attached, not a result · 2026

---

## The object

```
x_{t+1} = F( x_t , R(θ) u_t )
```

`x` is the cognitive state on a manifold; `u_t` is incoming information; `R(θ)` is
an **orientation transform** — the same rotation family as the phase vessel, but
where the vessel turns the *state*, obliquity turns the *input*. `F` is the fixed
update rule. `θ` is a control parameter that evolves far more slowly than `x`.
Because `θ` sits *inside* the projection of the input and *not* inside `F`, it
changes **which patterns get amplified over long periods** without touching the
moment-to-moment dynamics — exactly what obliquity does to insolation.

## The precondition, found by measurement (the honest part)

The first probe was a **null**, and it's the most important result here. With
**balanced (isotropic) input and a symmetric integrator**, θ does essentially
nothing — `isotropicNull()` measures a spread ratio of ~1.07 across the whole θ
sweep. Rotating isotropic information leaves it isotropic. Obliquity only bites
when there is **anisotropy to orient relative to**: structure in the input and/or
a preferred internal axis in F.

That is not a hole in the analogy — it's the analogy one level deeper. Earth's
tilt redistributes energy only because the Sun is a **directional** source and the
surface has structure. Tilt a featureless ball under isotropic light and obliquity
is invisible. The model reproduces exactly that precondition, so both halves are
built and checked:

- **`obliquitySteers()`** — structured input + a preferred axis → a clean
  **cos²(θ)** reallocation of what gets integrated. Measured: `0°→0.00100`,
  `45°→0.00051` (half, since cos²45° = ½), `90°→0.00002` (null), monotone in
  between. Same F, same input energy — **θ alone** decides the allocation.
- **`isotropicNull()`** — balanced input + symmetric F → θ changes nothing
  (`effectively_flat`).

## Timescale separation

`timescaleSeparation()` runs a slow θ schedule and measures both rates: θ moves
~`0.0003` per step while `x` moves ~`0.05` per step — **θ is ~150× slower**. Slow
steer, fast state, exactly the obliquity/rotation split: the orientation drifts
across the whole run while the state fluctuates every few steps.

## The falsification test (sharper than "orientation matters")

The null turns the vague claim into a hard one. `detectability()` returns both
arms:

- **Detectable where structure exists** — in a domain with a preferred
  representational axis (expertise, a committed frame, an entrenched bias), θ
  reallocates ~98% of the integrated energy.
- **Null where novel** — in a genuinely isotropic/unstructured domain, the effect
  is ~7% (essentially nothing).

So the prediction is not "cognitive orientation always matters." It is: **a latent
obliquity variable should be visible in structured/expert domains and produce a
NULL in novel ones**, while evolving far below the timescale of moment-to-moment
thought. That is much harder to satisfy by accident, and it says exactly where to
look and where to expect nothing — which is what a good experiment needs.

## The boundary, stated plainly

Everything here is verified **in-model**: it shows the mechanism is coherent and
produces the predicted signature in a state-vector-on-a-manifold system. It does
**not** establish that human cognition has a slow obliquity variable. That is the
longitudinal question — θ tracked over weeks–months against behavioral or neural
data — which this module can only **frame**, not answer. A hypothesis with a test
attached, sitting beside the phase vessel (whose R(θ) it borrows) and the witness
oscillator (whose slow/fast split it shares) — not a claim about brains, and the
code says so.

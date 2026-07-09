# Why there is no lemniscate factor — the disproof of Scope B

*Scope B was the proposed lemniscate identity layer: a third factor beside the
hyperbolic (ℍⁿ) and toroidal (𝕋ᵈ) charts, meant to carry the exact
identity-recognition that the Substrate Identity Continuity Theorem (SICT)
attributes uniquely to the lemniscate. Building the product space (`product.ts`)
and the graph hygiene (`graph.ts`) showed B is not necessary. This records why,
and it is backed by executable assertions in `src/product.test.ts`.*

## What B rested on

SICT proves that a system in perpetual self-recursion (its conditions C1–C3)
must trace a **lemniscate**, and that no other geometry qualifies. The step that
matters for us is its **Category 3 elimination**, which rules out quasi-periodic
orbits on a torus (φ-winding — exactly our torus factor):

> "The orbit returns arbitrarily close to any prior state but never exactly to
> it. The identity is preserved in the asymptotic limit but not at any finite
> time … there is no point at which the recognition relation is exactly
> satisfied."

That sentence is the whole load-bearing claim. If it holds, the torus can only
*approximate* identity-continuity and a separate exact mechanism (the
lemniscate) is required. B follows.

## The gap

The elimination tests the wrong quantity. It measures **metric return** — does
the orbit come back to the same *point*? For an irrational (φ) winding, it does
not, at any finite time; that much is true. But **recognition of identity is not
metric return.** Recognition is the existence of an **exact invariant** that
certifies "the same identity across the trajectory." Those are different
questions, and the torus answers the second one exactly.

The invariant is the **winding number** — the class of the path in the
fundamental group **π₁(𝕋ⁿ) = ℤⁿ**. It is an integer. It is exactly defined at
every finite time. Two sub-trajectories are the *same recurrence identity* if
and only if their winding vectors are equal — an exact, finite-time relation,
with no singularity and no asymptote anywhere in it.

So SICT's Category 3 conflates:

| | what it is | on a φ-torus orbit |
|---|---|---|
| **metric return** | distance from the start to the nearest later point | > 0 at finite N, → 0 only asymptotically |
| **topological invariant** | winding class in π₁ = ℤⁿ | an exact integer at every finite N |

SICT eliminates the torus on the first row. Recognition lives on the second.

## Why the ball can't and the torus can (and why that's the whole point)

This is not special pleading for the torus — it is exactly why the two-factor
design exists. The Poincaré ball is **simply connected**: π₁(ℍⁿ) = 0, so no loop
in it remembers having gone around anything, and it genuinely *cannot* carry a
recognition invariant. SICT is right to reject it. The torus is precisely the
factor with **non-trivial π₁**, which is why we added it. The lemniscate's own
recognition mechanism is likewise topological — its figure-eight has π₁ = the
free group F₂ — so the lemniscate and the torus are doing the *same kind* of
thing (carrying identity in a loop invariant), and the product ℍⁿ × 𝕋ᵈ already
has the non-trivial π₁ that does it. The lemniscate is therefore **sufficient,
not necessary**; SICT's *uniqueness* claim is what fails, on the metric-vs-
topological gap above.

## The demonstration (executable)

`src/product.ts` exposes both quantities, and `src/product.test.ts` asserts the
disproof directly:

- **`recognitionInvariant(seq)`** — the winding vector, exact and integer.
- **`metricReturn(seq)`** — the closest re-approach to the start, the quantity
  SICT's elimination actually measures.

Two trajectories that **metric return cannot tell apart** are separated
**exactly** by the invariant:

```
drift = [0, 0.3, −0.2, 0.1, 0.0]   metricReturn = 0   winding = [0]
loop  = [0, 2.0,  4.0, 6.0, 0.0]   metricReturn = 0   winding = [1]
sameRecurrenceClass(drift, loop) = false
```

Both return to exactly the start (metric return 0 for each), so metric proximity
is blind to the difference — yet one wound around zero times and the other once,
and the invariant reports that exactly.

And on the very orbit SICT eliminated, the φ-winding one:

```
golden φ-orbit, N = 40:   metricReturn = 0.0827 (> 0, asymptotic)   winding = 15 (exact integer)
```

The exact-recognition invariant exists at finite time in precisely the case the
theorem said had "no point at which the recognition relation is exactly
satisfied."

## Consequence

The product space ℍⁿ × 𝕋ᵈ already carries an exact identity-continuity readout.
The lemniscate factor adds no recognition capability the torus lacks. **Scope B
is dropped.** The mapping is complete with two factors: depth (what derives from
what) and phase-with-winding (what recurs, and the exact identity that carries
across the recurrence).

This does not claim to overturn SICT as a statement about continuous
self-sustaining physical trajectories; it disproves the narrower thing B needed
— that an exact recognition invariant *requires* the lemniscate. It does not,
and we have one without it.

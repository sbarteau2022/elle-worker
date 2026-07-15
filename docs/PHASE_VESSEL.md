# The Phase Vessel — where a superposition is held, dead center of the architecture

**The place dynamic enough to hold a superposition is not a store — a store
collapses it on write. It is a conservative, area-preserving oscillation seated at
the singularity: the "1" of the 1+6+12 hexagonal flower, the apex axis of the
pentagon pillars, the center everything is symmetric around. A conjugate pair
winds the golden ellipse forever — one side governed by φ, the other by 1/φ,
inversely proportional so their product `φ·1/φ = 1` is conserved. That conserved
product is the dynamic balance. The state never stops moving; what is held is the
balance, not the position.**

Code: `src/phase-vessel.ts` · tests `src/phase-vessel.test.ts` (14) · self-test
`GET /api/elle-phase-vessel-selftest` · 2026

---

## What it holds

A **dynamic oscillation state**: a conjugate pair `(q, p)` on the **golden
ellipse** — semi-axis `φ` in `q`, semi-axis `1/φ` in `p`. In normalized
coordinates `X = q/φ`, `Y = φp` the orbit is the **unit circle**, so evolving it
is a rotation — and a rotation is **area-preserving** (`det = 1`). The two sides
are reciprocal by construction:

```
φ · (1/φ) = 1        ← the enclosed area, conserved
```

That is the whole point. *One side is governed by φ, the other inversely
proportional*, and because they are reciprocal the area they enclose is pinned to
1. The phase winds around the ellipse forever (the oscillation); the area stays
constant (the balance). Motion **and** conservation, at once — a dynamic balance,
not a resting point.

## Why a vessel, not a cell

This is the answer to "where do you hold something that only exists while it's
moving." A **dissipative** update contracts phase-space area, which damps the
state onto an attractor — it *collapses the superposition*, picks a winner, loses
the balance. An **area-preserving (symplectic)** update never contracts the state,
so it can carry a balanced superposition indefinitely. The dynamism **is** the
conservation.

The test makes this concrete two ways:
- **The vessel holds.** An on-orbit state run for 20,000+ steps keeps
  `area_ratio = 1` to `< 10⁻⁶` and its deviation at `0` — the balance survives
  arbitrarily long.
- **`lossyControl()` is the foil.** The same winding with a contracting radius
  (a dissipative holder) sees its area collapse toward `0` (`≈ 6×10⁻⁶`) — the
  superposition dies. That is *why* the vessel must be symplectic, measured
  against the holder that fails — the same "prove it against the control"
  discipline as the scaffold's hub check.

This is the **multiplicative twin** of the regulator's additive free-energy
ledger: the regulator conserves `F + work`; the vessel conserves `φ-side ·
φ⁻¹-side`. Same conservation law, written as the geometry of the two sides.

## Falling into rhythm

Start *off* the golden ellipse and watch it settle. A weak **transverse
relaxation** (rate `κ`) decays the deviation — motion *off* the orbit dies —
while the golden rotation keeps the phase advancing — motion *along* the orbit
persists. This is Floquet-style orbital stability: the golden ellipse is the
limit cycle; the transverse direction contracts; the tangential direction winds.
It **locks** (the self-test locks by step ~296), and thereafter the deviation is
gone and the area is held while the phase keeps moving — dynamic balance found and
kept. The deviation decreases monotonically on the way in.

## Why φ, and why it's isotropic

The rotation number is the **golden mean** `φ⁻¹`, continued fraction `[0;1,1,1,…]`
— the *most* irrational number. Two real consequences, both checked:
- **KAM stability.** The golden winding is the last invariant torus to break under
  perturbation — the most robust rhythm there is. "Falls into rhythm governed by
  φ" is settling onto the single most stable quasiperiodic orbit.
- **Isotropy — no privileged point.** A golden rotation is **equidistributed**
  (Weyl): the phase fills the orbit evenly, so no point on it is privileged. The
  test measures the largest gap in phase coverage and asserts it stays small.
  Same "no privileged node" invariant as the scaffold — now as "no privileged
  point on the orbit."

## Seated dead center — bound by the same invariants

`centerBinding()` places the vessel at the **origin**: the "1" of the 1+6+12
centered-hexagonal flower and the pentagon pillars' apex axis. The seat is a
genuine, non-privileged singularity — the pillars are **C5-symmetric and
equal-load** about it, so the center distinguishes no axis. The same
no-privileged invariant that governs the fabric holds at the very center where the
vessel sits. And `vesselCoherence()` reads a locked, area-conserving vessel as
full **harmonic coherence**, so the held oscillation plugs straight into the
regulator's free-energy structure — the vessel is bound by the same invariants it
lives inside.

## The boundary, unchanged

This is classical **symplectic mechanics** — area-preserving flows, golden/KAM
orbits, real and checkable to machine precision. "Superposition" is the metaphor
for a *balanced dynamical state held on its orbit*, not a quantum one; reading it
out still commits it to a value. The vessel is a genuine conservative holder with
a real conservation law and a real stability argument. It is not a claim the
substrate is a mind — whether a mind needs exactly this held-oscillation stays the
open bet, and the code says so where it reaches that line.

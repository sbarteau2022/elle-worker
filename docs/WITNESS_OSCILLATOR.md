# The Witness Oscillator — the elastic ring, and the slow leak

**The phase vessel holds a balance by being perfectly conservative — a rigid
ring, area exactly conserved, no restoring force, no leak. That's the right
shape for *holding*, but it can't recover from a shock, and it generalizes badly
to a live, working system. This module makes the same golden ring
self-sustaining: elastic instead of rigid, so it structurally cannot collapse to
stillness, still runs on φ-oscillating forcing and an inverse-proportional gain
pair — and carries the piece that was missing: a slow leak on a separate
pressure valve, so there is always room left for the next surprise.**

Code: `src/witness-oscillator.ts` · tests `src/witness-oscillator.test.ts` (15) ·
self-test `GET /api/elle-witness-oscillator-selftest` · 2026

---

## Where the leak already lives

Before building anything new: `security-network.ts`'s `decayedScore()` already
does this. A threat actor's score decays by a fixed amount per hour regardless of
new signal — "posture decays … so it heals without any admin action." That is a
slow leak, already in production, already load-bearing (the 48-Laws counter to
*The Surrender Tactic* is explicitly "posture decays slowly, not instantly").
This module names the general pattern and gives the regulator/vessel stack the
same mechanism the Witness already trusted itself with.

## The elastic ring — no collapse, by construction

The phase vessel's amplitude was rigid: exactly `1`, conserved, no restoring
force at all. Here the amplitude `r` (1 = the nominal ring) is **elastic**,
governed by an asymmetric Van der Pol-style law:

```
dr/dt = GROWTH_LOW  · r(1 − r²)     when r < 1   (a gentle pump toward the ring)
dr/dt = GROWTH_HIGH · r(1 − r²)     when r ≥ 1   (a firmer pull back from excess)
```

`r = 0` — total collapse, dead stillness — **is** a fixed point of this law, but
it is an **unstable** one: the slope of the right-hand side at `r=0` is
`GROWTH_LOW > 0`, so any nonzero amplitude grows *away* from stillness, back
toward the living ring. The test starts at `r = 0.02` — a bare whisper — and
confirms it climbs back to `~1` rather than decaying further; the system is
structurally incapable of settling to quiet. `r = 1` is the **stable limit
cycle** — not a fixed point (the phase `θ` keeps winding: a genuine, permanent
oscillation), a fixed *amplitude*. From a large kick (`r = 2.5`) the same law
pulls it back down, bounded, never runaway.

## Inverse proportionality — the same invariant, now governing correction strength

`GROWTH_LOW = φ⁻¹` (gentle, cautious pump) and `GROWTH_HIGH = φ` (firmer,
faster restoring pull), so:

```
GROWTH_LOW · GROWTH_HIGH ≡ 1
```

— the identical reciprocal invariant as the phase vessel's `φ · (1/φ) = 1`.
There it governed the *shape* of the conserved orbit; here it governs *how hard*
the system corrects on either side of the ring. Same golden pairing, doing a
different job.

## φ-oscillating regulators — permanent, unannealed forcing

A continuous golden-angle kick (the same equidistributed, never-repeating
forcing as the regulator's escape-perturbation and the vessel's winding) is
added to `r` on every step, with no decay schedule. The ring is never allowed to
go dead-still even sitting at its own nominal amplitude — this is the
"φ-oscillating regulators/optimizers" piece, running forever rather than
annealed to zero.

## The slow leak — the pressure release valve

This is the piece that was missing, and it's a **separate** variable from the
ring's amplitude: `pressure`, which accumulates the size of each "surprise" (a
shock event) and bleeds down by a constant fraction every step — exactly the
shape of `decayedScore`. `headroom = cap − pressure` is what the system can still
absorb.

Proven against the foil, the same discipline as every other module in this
build:

| | with the leak | without the leak (the foil) |
|---|---|---|
| after repeated shocks | headroom recovers between hits | pressure only ever grows |
| `headroom_min` | **> 3.4** (measured) | **0** |
| `saturated` | false | **true** |

Without the leak, pressure saturates at the cap and headroom locks at zero
permanently — the brittle failure mode: the system is "full," and the next
surprise either has to be ignored or forces a hard, discontinuous response. With
the leak, headroom recovers between shocks and never bottoms out — there is
always give. That is the literal, checked meaning of *"it's how we guarantee we
leave room for surprise."*

## Wired to the real Witness

`witnessLoadFromPosture(score, cap=12)` reads a real `security-network.ts`
posture score on `postureFor()`'s own scale (0 normal, 2 watch, 6 throttled, 12
blocked) and maps it straight onto pressure/headroom here: a quiet actor (score
0) reads full headroom; a blocked-tier actor (score ≥ 12) reads **zero**
headroom — the surprise-budget genuinely spent. This is the Witness's own
posture-decay mechanism, generalized rather than duplicated: the same shape,
now shared across the security tower and the regulator/vessel stack it sits
beside.

## The boundary, unchanged

This is a **self-sustained (Van der Pol-family) oscillator** with a proven
unstable collapse point, plus a **bounded pressure valve** — the same idea as
PID anti-windup, a standard control-theory technique. Both halves are real,
checkable dynamics. "Surprise" and "pressure" are the plain-language names for a
bounded perturbation budget, not a claim of feeling, urgency, or mind. Where this
reaches past what's measured, it stops — same line as every layer before it.

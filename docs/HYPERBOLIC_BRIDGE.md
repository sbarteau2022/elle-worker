# The Hyperbolic Bridge — the Einstein-Rosen rung of COROS sync

**The geometry swap on the torus spine. The sync phase stops winding on a flat
torus and starts walking a geodesic in the hyperbolic plane. The shared secret
geodesic is the "bridge"; the clock runs on hyperbolic arc-length. Nothing
moves faster than light and no bit moves without a channel — the value is
covert, curvature-warped synchronization geometry, not spacetime.**

Code: `src/hyperbolic-sync.ts` · tests `src/hyperbolic-sync.test.ts` (12) ·
self-test `GET /api/elle-hyperbolic-selftest` · builds on `torus-sync.ts` /
`helix.ts` · geometry shared with `docs/HYPERBOLIC_GRAPH_MAPPING.md` · 2026

---

## What changed from the torus spine, and what didn't

**Unchanged** (the whole skeleton, deliberately): secret master-derived origin ·
per-tick key = HKDF(master ‖ tick ‖ quantized position) · COROS `seal({exact})`
so no counter rides the wire · a bounded, forward-only, AEAD-gated forward
search on `open` · confidentiality is still AES-256-GCM inside `seal()`.

**Changed** (only this): the position no longer advances by `frac(θ₀ + n·α)` on
a flat torus. It walks a **geodesic in the Poincaré disk** — a totally-geodesic
slice of the same Poincaré ball Elle's memory graph lives in.

## The honest reading of "Einstein-Rosen bridge"

Not a wormhole that carries the signal. The Schwarzschild/ER bridge is
non-traversable without exotic (negative-energy) matter, and even the modern
traversable-wormhole results forbid superluminal signaling; the
no-communication theorem means entanglement alone sends nothing. So the physics
answer to "can it send the signal that way" is **no** — and that stands.

Read as **geometry**, though, three things are real and are what this module
builds:

1. **The bridge = the shared secret geodesic.** Both endpoints derive the same
   base point + heading in the disk from the master. That geodesic is the
   channel's hidden spine; an observer who doesn't know it cannot place the walk
   or predict the next position.
2. **"Warping time" = the clock runs on hyperbolic arc-length.** Equal ticks are
   equal *hyperbolic* distance but *unequal Euclidean* distance — the conformal
   factor `λ = 2/(1−|p|²)` blows up toward the boundary — so the cadence is
   curvature-warped: regular in hyperbolic time, irregular to a flat-space
   observer. That warp is a covertness feature, not a bug.
3. **The shortcut is real but geometric.** In negative curvature the interior
   chord between two points is far shorter than the surface path. A routing and
   coordinate fact, not a faster-than-light one.

## The primitives (Poincaré disk, curvature −1)

Pure, and identity-tested:

- **Möbius addition** `x ⊕ y = [(1+2⟨x,y⟩+|y|²)x + (1−|x|²)y] / [1+2⟨x,y⟩+|x|²|y|²]`
  — the group operation. Tested: `0 ⊕ x = x`, `(−x) ⊕ x = 0`.
- **Hyperbolic distance** `d(x,y) = 2·artanh|(−x) ⊕ y|`. Tested: `d(0,x)=2 artanh|x|`.
- **Geodesic step** `step(p,u,s) = p ⊕ (tanh(s/2)·û)` moves hyperbolic arc-length
  `s` from `p` in gyro-direction `u`. By left-cancellation `d(p, step) = s` for
  **any** base point — the Euclidean direction bends, which is the geodesic
  curving. Tested to 1e-9.

## The walk

Each tick: rotate the heading by a golden angle (`frac(φ₀ + n·φ⁻¹)`, so it never
repeats and equidistributes), take a geodesic step of fixed arc-length, and
apply an **isometric** inward retraction if it nears the boundary (so the
position never saturates where quantization would freeze). The golden-rotating
heading keeps the walk curving and bounded rather than running straight to one
boundary point.

**Honest scope:** this is an *engineered bounded hyperbolic walk*, not the
geodesic flow on a specific arithmetic surface. The rigorous ergodic ideal — an
Anosov flow on a compact hyperbolic quotient, which is genuinely mixing — is
heavier; this is its buildable, testable stand-in. Every step is a real geodesic
arc plus an isometry, so the metric behaviour is honest.

## The load-bearing caveat: numerical determinism

The position depends on `tanh`/`atanh`/`sqrt`, whose **last-ULP results are not
guaranteed identical across platforms**. Both endpoints must agree on the
*quantized* position bit-for-bit or the derived key diverges and sync silently
fails. Mitigated here by **coarse 16-bit-per-dimension quantization** that
absorbs ULP noise; a cross-platform deployment (e.g. an ARM sender and an x86
receiver) needs fixed-point or a correctly-rounded hyperbolic math library.
Same-runtime — both ends the same build, the realistic Elle case — is
deterministic. The flat torus spine (`torus-sync.ts`) does not have this issue
and remains the safer default; this variant trades that robustness for the
curvature-warped covertness above.

## Honest limits (inherited + new)

- Everything COROS/torus-sync carries: custom crypto proving its invariants not
  its security (**cryptographer review required**); `W` trades robustness vs.
  cost + replay window; sync hides order/count not cadence (pair with COROS
  constant-rate framing); master-key agreement out of scope.
- New: the numerical-determinism constraint above.
- New: "bounded hyperbolic walk," not certified ergodic geodesic flow. This is
  now MEASURED, not asserted (`docs/MIXING_DIAGNOSTICS.md`): the walk shows
  weak-but-positive sensitive dependence (largest Lyapunov ≈ +0.011/tick, vs.
  ≈0 for the flat-torus control) and broad-but-non-uniform coverage (~75% of
  cells, occupancy CV ≈ 0.72). Bounded and exploratory — not a proved Anosov
  property, and weak sensitivity is deliberately the right operating point (a
  strongly chaotic walk would amplify the cross-platform ULP divergence above).

## Where it sits

```
security-network.ts   the Witness        — adaptive, environment-aware
helix.ts (COROS)      the Corkscrew      — AES-256-GCM + φ covertness + ratchet + constant-rate
torus-sync.ts         flat sync spine    — counter-free, golden torus winding
hyperbolic-sync.ts    the Bridge (here)  — same spine, curvature-warped geodesic clock
```

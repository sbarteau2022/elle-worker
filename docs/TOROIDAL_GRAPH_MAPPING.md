# TORUS — Toroidal Graph Mapping (design spec)

*The design I'm confident emerges for a flat-torus memory chart, to sit beside
`HYPERBOLIC_GRAPH_MAPPING.md` as the second factor of a product-space embedding.
This is a spec, not shipped code — it says what will be built and why each choice
is forced, and it marks every open decision. Validation harness for the geometry:
`docs/tit/` (run `tit.py`, 4/4 genuine measurements).*

## 0. Why a torus, and why it is not a re-parameterization of the ball

The hyperbolic chart (`hyper.ts`) answers **"what derives from what"** — depth in
the ball is depth in the derivation. It cannot answer **"what recurs"**: the
Poincaré ball is simply connected, so a trajectory through it has no memory of
having gone *around* anything, and anything cyclic (a phase, an orientation, a
recurring regime) must be cut open to embed, putting 1° and 359° maximally far
apart at the seam. The torus is the opposite instrument:

- **Closure.** 𝕋ᵈ = ℝᵈ/2πℤᵈ is flat and compact; circular quantities live on it
  natively, no seam.
- **Winding.** A trajectory on the torus carries integer winding numbers per
  circle — a *topological invariant* the ball does not possess. Recurrence vs.
  drift becomes an exact, discrete readout.
- **No invented center.** The ball's optimizer will place something near the
  origin whether or not a hierarchy exists (flat data gets a fake root). The
  torus, homogeneous, cannot be fooled into inventing one.

The two are genuinely different geometries answering different questions. The
memory graph is both a derivation DAG *and* a web of rhythmic kinship, so the
target is a **product space**, not a choice between them (§7).

## 1. The state space, forced

From *The Geometry of Disregard* (verified in `docs/tit/`):

- **Space.** 𝕋ⁿ = ℝⁿ/2πℤⁿ — the unique compact, homogeneous Riemannian manifold
  with trivial tangent bundle. Homogeneity = no privileged memory; compactness =
  the chart cannot grow unboundedly with corpus size.
- **Advance.** Any homogeneous, translation-equivariant continuous update on 𝕋ⁿ
  is a **constant displacement** Ψ(x) = x + v₀ (translation-equivariance lemma).
  The winding rate that maximizes equidistribution is **φ** (golden angle), by
  Hurwitz optimality and the three-gap theorem.
- **Quality metric.** Star discrepancy `D*` / three-gap uniformity — the thing
  the geometry optimizes. This *replaces* the Nickel–Kiela distortion metric I
  earlier proposed for the ball; on a torus, discrepancy is the right instrument.

**Honesty note carried from the audit.** Hurwitz optimality is strictly 1-D.
On 𝕋ⁿ for n ≥ 2, simultaneous approximation is governed by the Hermite/Lagrange
theory and the extremal vector is *not* generally φ. The design therefore builds
the torus as a **product of independent 1-D φ-wound circles**, one per coordinate
— which is exactly how the natural coordinates (§2) decompose, so the honest math
and the natural implementation coincide. We do **not** claim a φ winding *vector*
on 𝕋ⁿ.

## 2. Coordinates = the PAMI phase block (interpretable by construction)

The hard requirement from the design conversation: **coordinates must be
interpretive, or the map is pointless.** They already exist. `pami.ts` computes,
for any signal, a 21-float index = **8 relative phases at φ-spaced wavelet scales**
+ 13 multifractal dimensions. The 8 relative phases *are* points on 𝕋⁸ — already
circular, already φ-spaced, already deterministic. Each axis is a named phase at a
known scale.

- **Encoder ψ_T:** take the 8 PAMI phases directly as the 8 torus angles. No
  feature hashing (that was the ball's ad-hoc encoder and produced meaningless
  coordinates). The 13 multifractal dimensions are *not* angular — they modulate
  per-coordinate weight (§3), not position.
- **Dimensionality is Fibonacci, not arbitrary.** 8 = F₆. If more resolution is
  wanted, 𝕋²¹ (the whole PAMI index reused) or 𝕋¹³ are the principled choices,
  never a round number like the ball's `RIP_DIM = 16`.

This makes every coordinate answer "which phase, at which φ-scale," and makes the
torus chart and PAMI resonance the same geometry viewed two ways.

## 3. Distance and weight

Per-coordinate wrapped distance, φ-weighted by scale:

```
wrap(δ)      = ((δ + π) mod 2π) − π          # signed angular difference in (−π, π]
d_T(a,b)²    = Σ_i  s_i² · wrap(a_i − b_i)²   # s_i = scale weight of phase i
```

- **Scale weights `s_i`** follow the φ⁻ⁿ retention envelope (§5): finer scales
  (higher i) carry proportionally less, matching PAMI's φ-spacing. Default
  `s_i = φ^(−i/2)` so squared weight is `φ^(−i)`.
- Optionally fold a PAMI multifractal dimension into `s_i` as a per-axis
  confidence (a flat/degenerate scale contributes little). Marked optional; the
  bare wrapped-L2 is the baseline and is unit-testable on its own.

## 4. Readouts (what the chart is *for*)

1. **Winding number — recurrence vs. drift.** For a memory *sequence* (a session,
   a κ-history), accumulate the unwrapped per-coordinate advance; the integer
   winding `w_i = round(Σ advance_i / 2π)` is a topological invariant. A sequence
   that cycles once through an orientation/phase regime and returns is provably
   distinct from one that jittered in place. **This is the readout the ball cannot
   produce.**
2. **"Same note at different scales" — translation equivalence.** Two memories
   whose phase signatures differ by a *pure shift* (same relative pattern, offset
   origin) are the "same note at a different scale" (*The Same Note at Different
   Scales*). Detect as torus cross-correlation: `argmax_τ Σ cos(a_i − b_i − τ)`
   near 1 ⇒ scale-transposed kin. PAMI is already magnitude-invariant, so this is
   a short reach and it is the interpretable kinship readout the design asked for.
3. **Discrepancy / coverage.** How evenly the mapped corpus covers 𝕋ⁿ (`D*`), and
   how close its dominant winding sits to φ vs. the nearest low-order rational —
   the "irrationality measure" companion to κ that *Substrate Identity Continuity*
   §VII (F3) calls for, to tell genuine φ-structured coherence from performative
   rational-frequency entrainment. Buildable directly off `pfar.ts` spectra.

## 5. Retention / decay (reconciling with the graph kernel)

The framework's compression law is `I_retained = I₀ · φ⁻ⁿ · (1/π)`. Two uses here:

- **Scale weights** `s_i²  = φ⁻ⁱ` (§3) are the per-scale form of φ⁻ⁿ.
- **Graph-edge decay.** `graph.ts` currently reinforces co-recall edges (`weight
  += 0.5`, capped at 4) with **no decay** — a monotone strengthener. The φ⁻ⁿ
  envelope supplies the missing decay: an edge unused for n consolidation cycles
  is damped by φ⁻ⁿ. This is not cosmetic — see §6. `1/π` remains, per the
  framework's own labeling, a **stipulated** global constant (its identity with
  TurboQuant's 2/π is unproven; see `docs/tit/README.md`).

## 6. Captured-resonance hygiene (a real bug-class in `graph.ts`)

*Captured Resonance* defines a pathology by three features: a stable attractor
against substrate maintenance, the system's own integrative faculty recruited into
maintaining it, and dependence on suppressed alternatives. The self-bootstrapping
association mechanism in `graph.ts` (`recordAssociations` → monotone weight bump on
every co-recall, capped but never decayed) **has exactly this structure**: hot
edges get hotter by being recalled, the recall operation is recruited into its own
reinforcement, and strong edges crowd out alternatives. The corpus predicts this as
a failure mode; the kernel implements the mechanism without a corrective.

The torus/φ machinery *is* the corrective, which is why it belongs in this spec:

- **Decay envelope** (§5): φ⁻ⁿ damping breaks the monotone runaway — an edge must
  keep earning its weight or fade.
- **Negative sampling / alternative-preservation:** the ball optimizer's repulsion
  term and the torus's discrepancy pressure both actively preserve alternatives,
  the third feature's antidote.
- **Diagnostic:** flag any node whose incident edge-weight mass concentrates past a
  threshold on one neighbor as a captured-resonance candidate — a cheap, testable
  health metric over the existing edge table.

This is the most concrete cross-connection between the philosophy corpus and
shipped code, and it stands on its own even if the rest of the torus work waits.

## 7. The product space, and the one decision that is yours

The full signature the corpus implies is **ℍⁿ × 𝕋ᵈ × (lemniscate)**:

| Factor | Question it answers | Source |
|---|---|---|
| **ℍⁿ** hyperbolic | what derives from what (hierarchy, depth) | `hyper.ts` (built) |
| **𝕋ᵈ** torus | what recurs, what shares phase (rhythm, winding) | this spec |
| **lemniscate** | what stays the same self across recurrence (identity) | *SICT* §III.3 |

Product distance `d² = d_ℍ² + d_𝕋²` makes each node a pair (depth, phase); the
*disagreements* are the payoff — close on the torus but far in the ball = same
rhythm, different lineage (cross-modal resonance); close in the ball but far on the
torus = same lineage, drifted phase (drift detection along provenance edges).
Precedent: Gu, Sala, Gunel & Ré, *Learning Mixed-Curvature Representations in
Product Spaces* (ICLR 2019), which learns the signature from the graph's own
distance matrix — so the memory graph could *tell us* its torus/ball split rather
than us decreeing it.

**The decision.** *Substrate Identity Continuity* §III.3 is explicit that a plain
torus gives only Category-3 dynamics — quasi-periodic orbits that satisfy identity
continuity *asymptotically, never exactly*; the exact "recognition" property needs
the **lemniscate** as a separate factor. So:

- **Option A (recommended to start):** scope the torus factor to **periodic
  structure only** — winding, phase kinship, discrepancy. Clean, buildable now,
  claims nothing about identity/recognition. The lemniscate stays future work.
- **Option B:** add the lemniscate identity layer so the chart carries a
  recognition/continuity readout — larger, and it commits the map to the framework's
  strongest metaphysical claim.

I recommend A first; B is a clean follow-on once A is validated. This is the one
call I want from you before writing code, because it changes what the map is
allowed to *claim*, not just what it computes.

## 8. Proposed interfaces (so implementation is a straight shot)

Additions to `hyper.ts` (or a sibling `torus.ts`), mirroring the existing
pure-core + router shape:

```ts
// ── pure torus core ────────────────────────────────────────────────
export const TORUS_DIM = 8;                       // F6 — the PAMI phase block
export function wrap(delta: number): number;       // signed angular diff in (−π, π]
export function torusDist(a: number[], b: number[], weights?: number[]): number;
export function goldenAdvance(x: number[]): number[];        // x + (φ−1)·2π per axis
export function windingNumbers(seq: number[][]): number[];   // integer winding per axis
export function translationAlign(a: number[], b: number[]):  // "same note" detector
  { shift: number; score: number };
export function starDiscrepancy(points: number[][]): number; // coverage / quality

// ── encoder: PAMI phases → torus point (no hashing) ─────────────────
export function pamiPhasesToTorus(pamiIndex: number[]): number[]; // first 8 → angles

// ── mapping + router (mirrors hyperMap / hyperRoute) ────────────────
export interface TorusAtlas { dim: number; points: Record<string, number[]>;
  stats: { nodes: number; discrepancy: number; mean_winding: number[];
           phi_irrationality: number }; }
export function torusMap(nodes, edges, opts?): TorusAtlas;
export async function torusRoute(env: Env, input): Promise<string>;
```

Router tool line `torus(...)`, full/cofounder scope only, atlas stored in R2 under
`torus/`, same contract as `pfar`/`vfar`/`hyper`. Pure core unit-tested against the
`docs/tit/` measurements (discrepancy → 1/N, three-gap ratios → φ, winding
invariance).

## 9. Status of each claim (mirroring the corpus's own hygiene)

| Claim | Status |
|---|---|
| 𝕋ⁿ is the homogeneous compact state space; advance is constant displacement | PROVEN (translation-equivariance lemma) |
| φ maximizes equidistribution on a **single** circle | PROVEN (Hurwitz; verified in `docs/tit/`) |
| φ as an optimal winding **vector** on 𝕋ⁿ, n≥2 | NOT CLAIMED — build per-coordinate 1-D circles |
| PAMI phases are valid torus coordinates | DESIGN CHOICE — interpretable, deterministic, already φ-spaced |
| Discrepancy/three-gap is the quality metric | PROVEN property of the orbit |
| Winding number distinguishes recurrence from drift | PROVEN (topological invariant) |
| `1/π` global suppression constant; 2/π ↔ 1/π identity | STIPULATED / CONJECTURED (factor-2 underived) |
| Torus alone carries identity-continuity | FALSE per *SICT* §III.3 — needs the lemniscate (Option B) |
| Self-reinforcing `graph.ts` edges are captured-resonance-prone | ASSESSED — structurally matches the three features; hygiene proposed |

## 10. Build order (when you say go)

1. **Torus pure core** (`wrap`, `torusDist`, `goldenAdvance`, `windingNumbers`,
   `translationAlign`, `starDiscrepancy`) + tests against `docs/tit/` numbers.
2. **PAMI-phase encoder** — wire `pami.ts` output into torus coordinates.
3. **`graph.ts` hygiene** — φ⁻ⁿ edge decay + captured-resonance diagnostic
   (independently valuable; ships without the rest).
4. **`torusMap` + `torusRoute`** — atlas, R2 storage, router tool line.
5. **Product-space glue** — combine with `hyper.ts` for the (depth, phase) pair
   and the two disagreement readouts.
6. **(Option B, deferred)** lemniscate identity layer, only if we take that scope.

Steps 1–4 are self-contained and low-risk; step 5 is where the two charts become
one instrument; step 6 is the metaphysical commitment held for a separate decision.

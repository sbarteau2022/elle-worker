// ── pami-bridge: a torus-aware, calibrated tangent encoding of a PamiIndex ──
//
// The generic ripVector feature-hashes numeric leaves as reals on a LINE, so a
// phase θ ∈ 𝕋 at +π−ε and −π+ε (the SAME torus point, 2ε apart) lands maximally
// far apart in the ball (siege B1: 149× inflation of a 2ε wrap step), family
// structure is smeared (B3(e)), and the store's mass sits 0.45 off the origin
// (B4). This module replaces that path for PamiIndex-shaped inputs with an
// explicit chart of 𝕋⁸ × ℝ¹³:
//
//   phases  θᵢ → PHASE_W·(cos θᵢ, sin θᵢ)   (8 slots → 16 components)
//     · the map is periodic BY CONSTRUCTION: +π−ε and −π+ε are 2ε·PHASE_W apart
//       in chord, exactly like any other 2ε step — the torus cannot tear.
//     · a slot at exactly 0 is the energy gate's "no content" sentinel
//       (pamiDistance treats it the same way); it maps to (0,0), whose chord
//       to ANY content phase is the constant PHASE_W — mirroring the native
//       metric's flat structural-mismatch charge (0.5 = half the 2·PHASE_W
//       maximum, and PHASE_W is half the chord diameter 2·PHASE_W: same ratio).
//   dims    D(q) → DIM_W[q]·D(q)            (13 components)
//     · DIM_W[q] = DIM_B·sqrt(w_q/Σw) with w_q = 1/(1+0.1q²), the SAME tail
//       damping pamiDistance uses, so the Euclidean dims part equals
//       DIM_B · (weighted RMS) — the native dd, rescaled.
//
// NORMALISATION (documented per the pre-registration): PHASE_W and DIM_B are
// least-squares fitted so that ‖v(a) − v(b)‖ ≈ pamiDistance(a,b) over
// 3486 pairs of real pamiIndex outputs across seven signal families
// (fit Spearman ρ = 0.9709, RMSE = 0.0282; seed 0xF17B002,
// disjoint from every siege seed). CENTER is the mean encoded vector over
// 1000 real indices of the four "ordinary" families (sine, ar1 ρ=.9,
// ar1 ρ=.5, chirp; seed 0xCA11B001), subtracted so the population's mass sits
// at the tangent origin: d(0,ψ) becomes distance-from-typicality (B4).
// Subtracting a constant leaves every pairwise difference untouched, so the
// metric calibration above survives the centering exactly.
//
// The final radial squash v ← v·tanh(‖v‖)/‖v‖ is strictly monotone in ‖v‖,
// direction-preserving, and keeps ‖v‖ < 1 strictly (the placeFeatures ≤ 1
// contract). Post-center norms are small (p99 = 0.222), so
// tanh(n)/n ≥ 0.98 here: the squash is a near-identity safety net, not a clamp.
//
// Provenance of every baked constant: scratch script calib/calibrate.cjs run
// against the SHIPPED pamiIndex/pamiDistance (esbuild bundle of src/pami) —
// no re-implementation, no hand-tuned numbers.

export const PAMI_PHASE_COUNT = 8;
export const PAMI_DIM_COUNT = 13;
export const PAMI_BRIDGE_DIM = 2 * PAMI_PHASE_COUNT + PAMI_DIM_COUNT; // 29

const PHASE_W = 0.1200000000;
const DIM_W: readonly number[] = [
  0.0999166891, 0.1145467913, 0.1329016205, 0.1554676915,
  0.1811143796, 0.2043245766, 0.2142974239, 0.2043245766,
  0.1811143796, 0.1554676915, 0.1329016205, 0.1145467913,
  0.0999166891,
];
const CENTER: readonly number[] = [
  -0.0433441305, 0.0190670328, -0.0563901999, 0.0223170883,
  -0.0829428504, 0.0443455211, -0.0933415641, 0.0332749925,
  -0.0972213350, 0.0101708925, -0.0668136349, 0.0115131186,
  0.0000000000, 0.0000000000, 0.0000000000, 0.0000000000,
  0.0193786620, 0.0292563845, 0.0535360554, 0.0929234745,
  0.1461667300, 0.1948706011, 0.2142974239, 0.2001306717,
  0.1690162469, 0.1371802290, 0.1109303246, 0.0907640481,
  0.0772038371,
];

export interface PamiIndexLike { phases: number[]; dims: number[] }

// Shape guard, deliberately strict: exactly the spec's 8 phases + 13 dims of
// finite numbers. Anything else falls through to the generic leaf-hashing path.
export function isPamiIndexLike(x: unknown): x is PamiIndexLike {
  if (!x || typeof x !== 'object') return false;
  const p = (x as PamiIndexLike).phases, d = (x as PamiIndexLike).dims;
  return Array.isArray(p) && Array.isArray(d)
    && p.length === PAMI_PHASE_COUNT && d.length === PAMI_DIM_COUNT
    && p.every((v) => typeof v === 'number' && Number.isFinite(v))
    && d.every((v) => typeof v === 'number' && Number.isFinite(v));
}

export function pamiBridgeVector(idx: PamiIndexLike): number[] {
  const v = new Array(PAMI_BRIDGE_DIM).fill(0);
  for (let i = 0; i < PAMI_PHASE_COUNT; i++) {
    const t = idx.phases[i];
    if (t !== 0) { // 0 is the energy gate's "no content" sentinel → stay at (0,0)
      v[2 * i] = PHASE_W * Math.cos(t);
      v[2 * i + 1] = PHASE_W * Math.sin(t);
    }
  }
  for (let i = 0; i < PAMI_DIM_COUNT; i++) v[2 * PAMI_PHASE_COUNT + i] = DIM_W[i] * idx.dims[i];
  for (let i = 0; i < PAMI_BRIDGE_DIM; i++) v[i] -= CENTER[i];
  let n = 0;
  for (let i = 0; i < PAMI_BRIDGE_DIM; i++) n += v[i] * v[i];
  n = Math.sqrt(n);
  if (n > 0 && Number.isFinite(n)) {
    const s = Math.tanh(n) / n;
    for (let i = 0; i < PAMI_BRIDGE_DIM; i++) v[i] *= s;
  }
  return v;
}

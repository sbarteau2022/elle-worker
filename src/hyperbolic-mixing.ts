// ============================================================
// MIXING DIAGNOSTICS — src/hyperbolic-mixing.ts
//
// Turns "empirical mixing" from a claim into a measurement. Two quantities,
// exactly the two ways to ask the question:
//
//   1. DIVERGENCE OF ADJACENT STATES — a finite-time largest Lyapunov exponent
//      (Benettin method): seed two trajectories ε apart under the SAME heading
//      schedule, advance both, accumulate log(separation/ε), renormalize each
//      step. λ > 0 is sensitive dependence — the signature of mixing. In the
//      Poincaré disk this is not incidental: negative curvature makes nearby
//      geodesics diverge exponentially, so a positive λ is the curvature itself
//      showing up as a number. The flat torus, being integrable, must read λ≈0
//      — that contrast is the honest proof the geometry is doing real work.
//
//   2. STATE-SPACE COVERAGE — bin the reachable disk and measure how uniformly
//      the orbit fills it (visited-cell fraction + occupancy coefficient of
//      variation). Equidistribution from the "every point is the origin" fact:
//      an isometry carries any point to any other, so a mixing orbit has no
//      preferred cell.
//
// Separation is measured in HYPERBOLIC distance (the intrinsic metric), not
// Euclidean — the whole point is to read the geometry on its own terms.
// ============================================================

import { mobiusAdd, hyperDistance, geodesicStep, advancePoint } from './hyperbolic-sync';
import { phaseAt, windingVector } from './torus-sync';

const neg = (a: Float64Array): Float64Array => Float64Array.from(a, (x) => -x);
const enorm = (a: Float64Array): number => Math.hypot(a[0], a[1]);

// Place q at hyperbolic distance ε from p, along the geodesic p→q. Used to
// renormalize the perturbation each Benettin step so it never saturates.
function renormTo(p: Float64Array, q: Float64Array, eps: number): Float64Array {
  const w = mobiusAdd(neg(p), q);       // gyro-direction from p toward q
  const wn = enorm(w) || 1;
  return geodesicStep(p, Float64Array.from([w[0] / wn, w[1] / wn]), eps);
}

export interface Lyapunov { lambda: number; steps: number }

// Largest Lyapunov exponent per tick of the hyperbolic walk. λ > 0 ⇒ mixing.
export function lyapunovHyperbolic(steps = 3000, eps = 1e-9, phi0 = 0.3): Lyapunov {
  let p: Float64Array = Float64Array.from([0.1, 0.05]);
  let q: Float64Array = renormTo(p, Float64Array.from([0.1 + eps, 0.05]), eps);
  let sum = 0, count = 0;
  for (let n = 1; n <= steps; n++) {
    p = advancePoint(p, n, phi0);
    q = advancePoint(q, n, phi0);
    const d = hyperDistance(p, q);
    if (d > 0 && Number.isFinite(d)) {
      sum += Math.log(d / eps);
      count++;
      q = renormTo(p, q, eps); // pull the shadow trajectory back to ε
    }
  }
  return { lambda: count ? sum / count : 0, steps };
}

// Same measurement for the FLAT torus winding — must be ≈ 0 (integrable, no
// sensitive dependence). This is the control that proves the hyperbolic λ is
// the curvature, not an artifact of the estimator.
export function lyapunovTorus(steps = 3000, eps = 1e-9): Lyapunov {
  const alpha = windingVector(2);
  const wrap = (a: Float64Array, b: Float64Array): number => {
    // toroidal (wrap-around) distance in [0,1)^2
    let s = 0;
    for (let i = 0; i < 2; i++) { let d = Math.abs(a[i] - b[i]); d = Math.min(d, 1 - d); s += d * d; }
    return Math.sqrt(s);
  };
  const o1 = Float64Array.from([0.1, 0.05]);
  const o2 = Float64Array.from([0.1 + eps, 0.05]);
  let sum = 0, count = 0;
  for (let n = 1; n <= steps; n++) {
    const d = wrap(phaseAt(o1, alpha, n), phaseAt(o2, alpha, n));
    if (d > 0 && Number.isFinite(d)) { sum += Math.log(d / eps); count++; }
  }
  return { lambda: count ? sum / count : 0, steps };
}

export interface Coverage {
  steps: number; gridN: number; reachableCells: number; visitedCells: number;
  visitedFraction: number; occupancyCV: number; // coefficient of variation of per-cell counts
}

// How uniformly the orbit fills the reachable disk of radius R.
export function coverageHyperbolic(steps = 20000, gridN = 24, R = 0.9, phi0 = 0.3): Coverage {
  const counts = new Map<number, number>();
  let reachable = 0;
  // count reachable cells (centers within R)
  for (let iy = 0; iy < gridN; iy++) for (let ix = 0; ix < gridN; ix++) {
    const cx = -R + (2 * R) * (ix + 0.5) / gridN;
    const cy = -R + (2 * R) * (iy + 0.5) / gridN;
    if (cx * cx + cy * cy <= R * R) reachable++;
  }
  let p: Float64Array = Float64Array.from([0.1, 0.05]);
  for (let n = 1; n <= steps; n++) {
    p = advancePoint(p, n, phi0);
    const ix = Math.floor((p[0] + R) / (2 * R) * gridN);
    const iy = Math.floor((p[1] + R) / (2 * R) * gridN);
    if (ix < 0 || iy < 0 || ix >= gridN || iy >= gridN) continue;
    const k = iy * gridN + ix;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const visited = counts.size;
  const vals = Array.from(counts.values());
  const mean = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
  const varc = vals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (vals.length || 1);
  return {
    steps, gridN, reachableCells: reachable, visitedCells: visited,
    visitedFraction: reachable ? visited / reachable : 0,
    occupancyCV: mean ? Math.sqrt(varc) / mean : 0,
  };
}

export interface MixingReport {
  lyapunov_hyperbolic: number; lyapunov_torus: number; coverage: Coverage;
  sensitive_dependence: boolean; strength: 'none' | 'weak' | 'moderate' | 'strong'; verdict: string;
}

// Honest, measured verdict — no binary "mixing" claim. Sensitive dependence is
// confirmed only when the hyperbolic λ is clearly positive AND clearly above
// the integrable torus baseline; the STRENGTH label is graded by magnitude, and
// coverage is reported as broad-but-uniform vs. broad-but-clumped via the CV.
export function mixingReport(): MixingReport {
  const lh = lyapunovHyperbolic().lambda;
  const lt = lyapunovTorus().lambda;
  const cov = coverageHyperbolic();
  const sensitive = lh > 0.005 && Math.abs(lt) < 0.001 && lh > 10 * Math.abs(lt);
  const strength: MixingReport['strength'] =
    lh < 0.005 ? 'none' : lh < 0.05 ? 'weak' : lh < 0.2 ? 'moderate' : 'strong';
  const verdict =
    `λ_hyperbolic=${lh.toFixed(4)}/tick (${sensitive ? 'positive ⇒ sensitive dependence' : 'not clearly positive'}), ` +
    `λ_torus=${lt.toFixed(5)} (≈0, integrable control); ` +
    `coverage ${(cov.visitedFraction * 100).toFixed(0)}% of reachable cells, occupancy CV ${cov.occupancyCV.toFixed(2)} ` +
    `(${cov.occupancyCV < 0.35 ? 'fairly uniform' : 'broad but non-uniform'}). ` +
    `Bounded and exploratory, ${strength} sensitive dependence — not a certified ergodic flow.`;
  return { lyapunov_hyperbolic: lh, lyapunov_torus: lt, coverage: cov, sensitive_dependence: sensitive, strength, verdict };
}

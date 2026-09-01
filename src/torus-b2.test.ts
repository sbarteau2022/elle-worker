// ============================================================
// B2 GATE — winding-number integrality on closed loops over 𝕋⁸
//
// Contract (COGNITIVE_MAPPING_IMPLEMENTATION_PLAN.md, benchmark B2): for any
// CLOSED loop on the torus whose individual steps are each shorter than π per
// axis, the raw winding integral W_j = (Σ_k wrap(Δθ_j,k)) / 2π must land on an
// integer to within 1e−6 — the wrapped-increment telescope has no seam error.
//
// The `turns` field of windingNumbers() is rounded to 4dp for display, which is
// far too coarse for this gate, so every test recomputes the raw integral
// directly from wrap(). windingNumbers().winding must agree with round(raw).
//
// Constructions:
//   (i)   uniform loops with KNOWN winding w_j ∈ {−2..2} per axis (K=48 steps,
//         closed by literally re-appending the start point so float drift in
//         the parameterization cannot fake non-closure);
//   (ii)  seeded random-walk loops (steps U(−0.8, 0.8) < π), closed with p₀;
//   (iii) explicit seam-crossing oscillation around θ=0/2π (winding 0);
//   (iv)  goldenSequence trajectories closed with their own first point
//         (winding unknown a priori — integrality only).
// ============================================================

import { describe, expect, it } from 'vitest';
import { goldenSequence, norm2pi, TORUS_DIM, windingNumbers, wrap } from './torus';
import { mulberry32 } from './hyper';

const TWO_PI = Math.PI * 2;
const INTEGRALITY_EPS = 1e-6;

/** Raw winding integral per axis: Σ wrap(θ_k − θ_{k−1}) / 2π, no rounding. */
function rawWinding(seq: number[][]): number[] {
  const acc = new Array<number>(TORUS_DIM).fill(0);
  for (let k = 1; k < seq.length; k++) {
    for (let j = 0; j < TORUS_DIM; j++) acc[j] += wrap(seq[k][j] - seq[k - 1][j]);
  }
  return acc.map((a) => a / TWO_PI);
}

/** max_j |raw_j − round(raw_j)| — the quantity the gate bounds. */
function maxIntegralityDev(raw: number[]): number {
  let m = 0;
  for (const r of raw) m = Math.max(m, Math.abs(r - Math.round(r)));
  return m;
}

describe('B2 — winding integrality on closed loops (T^8)', () => {
  it('known-winding uniform loops: raw integral hits the constructed w_j within 1e-6', () => {
    const rand = mulberry32(0xb2b2b2);
    const K = 48; // step per axis ≤ 2π·2/48 = π/12 ≪ π — wrap() is exact per step
    const TRIALS = 200;
    let maxDev = 0;
    let wrongInt = 0;
    let windingMismatch = 0;
    for (let t = 0; t < TRIALS; t++) {
      const w = Array.from({ length: TORUS_DIM }, () => Math.floor(rand() * 5) - 2); // {−2..2}
      const theta0 = Array.from({ length: TORUS_DIM }, () => rand() * TWO_PI);
      const seq: number[][] = [];
      for (let k = 0; k < K; k++) {
        seq.push(theta0.map((th, j) => norm2pi(th + (TWO_PI * w[j] * k) / K)));
      }
      seq.push(seq[0].slice()); // literal closure — no float non-closure possible
      const raw = rawWinding(seq);
      maxDev = Math.max(maxDev, maxIntegralityDev(raw));
      const wn = windingNumbers(seq).winding;
      for (let j = 0; j < TORUS_DIM; j++) {
        if (Math.round(raw[j]) !== w[j]) wrongInt++;
        if (wn[j] !== w[j]) windingMismatch++;
      }
    }
    expect(maxDev).toBeLessThan(INTEGRALITY_EPS);
    expect(wrongInt).toBe(0);
    expect(windingMismatch).toBe(0);
  }, 30000);

  it('seeded random-walk loops closed with p0: integral is integer within 1e-6', () => {
    const rand = mulberry32(0x5eeded);
    const TRIALS = 120;
    let maxDev = 0;
    let windingMismatch = 0;
    for (let t = 0; t < TRIALS; t++) {
      const steps = 20 + Math.floor(rand() * 180); // 20..199 steps
      const p0 = Array.from({ length: TORUS_DIM }, () => rand() * TWO_PI);
      const seq: number[][] = [p0];
      let cur = p0;
      for (let k = 0; k < steps; k++) {
        cur = cur.map((th) => norm2pi(th + (rand() * 1.6 - 0.8))); // |step| < 0.8 < π
        seq.push(cur);
      }
      seq.push(p0.slice()); // close the loop
      const raw = rawWinding(seq);
      maxDev = Math.max(maxDev, maxIntegralityDev(raw));
      const wn = windingNumbers(seq).winding;
      for (let j = 0; j < TORUS_DIM; j++) {
        if (wn[j] !== Math.round(raw[j])) windingMismatch++;
      }
    }
    expect(maxDev).toBeLessThan(INTEGRALITY_EPS);
    expect(windingMismatch).toBe(0);
  }, 30000);

  it('seam-crossing oscillation around 0/2π: winding is exactly 0', () => {
    const rand = mulberry32(0xc0ffee);
    const TRIALS = 100;
    let maxDev = 0;
    let nonZero = 0;
    for (let t = 0; t < TRIALS; t++) {
      // Start just below the seam so every ± step crosses it.
      const theta0 = Array.from({ length: TORUS_DIM }, () => TWO_PI - 0.05 - rand() * 0.05);
      const seq: number[][] = [theta0];
      let cur = theta0;
      for (let k = 0; k < 40; k++) {
        const s = k % 2 === 0 ? 0.2 : -0.2; // oscillate across the seam
        cur = cur.map((th) => norm2pi(th + s));
        seq.push(cur);
      }
      seq.push(theta0.slice());
      const raw = rawWinding(seq);
      maxDev = Math.max(maxDev, maxIntegralityDev(raw));
      const wn = windingNumbers(seq).winding;
      for (let j = 0; j < TORUS_DIM; j++) {
        if (Math.round(raw[j]) !== 0 || wn[j] !== 0) nonZero++;
      }
    }
    expect(maxDev).toBeLessThan(INTEGRALITY_EPS);
    expect(nonZero).toBe(0);
  }, 30000);

  it('goldenSequence trajectories closed with their first point: integral within 1e-6 of an integer', () => {
    let maxDev = 0;
    let windingMismatch = 0;
    for (let s = 0; s < 20; s++) {
      const seq = goldenSequence(100, TORUS_DIM, 0.5 + s * 0.017);
      const closed = [...seq, seq[0].slice()];
      const raw = rawWinding(closed);
      maxDev = Math.max(maxDev, maxIntegralityDev(raw));
      const wn = windingNumbers(closed).winding;
      for (let j = 0; j < TORUS_DIM; j++) {
        if (wn[j] !== Math.round(raw[j])) windingMismatch++;
      }
    }
    expect(maxDev).toBeLessThan(INTEGRALITY_EPS);
    expect(windingMismatch).toBe(0);
  }, 30000);

  it('wrap stays in (−π, π] and norm2pi in [0, 2π) across a seeded sweep', () => {
    const rand = mulberry32(0x0b2a);
    let wrapOut = 0;
    let normOut = 0;
    for (let i = 0; i < 20000; i++) {
      const x = (rand() - 0.5) * 200; // wide sweep incl. many multiples of 2π
      const w = wrap(x);
      if (!(w > -Math.PI && w <= Math.PI)) wrapOut++;
      const n = norm2pi(x);
      if (!(n >= 0 && n < TWO_PI)) normOut++;
    }
    expect(wrap(Math.PI)).toBe(Math.PI); // boundary convention: wrap(π) = π
    expect(wrapOut).toBe(0);
    expect(normOut).toBe(0);
  }, 30000);
});

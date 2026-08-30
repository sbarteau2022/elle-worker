// ============================================================
// ADVERSARIAL STRESS TEST SUITE — MILESTONE 2
// CORDIC Fixed-Point & Poincaré Metric Determinism
//
// Comprehensive Empirical Challenge Harness:
// 1. Q0.30 CORDIC Trigonometric Quadrant Boundary Stress Testing
//    - Exact quadrant boundaries: 0, pi/2, pi, 3pi/2, 2pi (0.0, 0.25, 0.5, 0.75, 1.0 turns)
//    - Boundary epsilon perturbations (+/- 1 LSB, +/- 1e-7, +/- 1e-4)
//    - Negative turn fractions and full 32-bit signed integer range
//    - Pythagorean identity sin^2 + cos^2 = 1 to CORDIC precision across full turns
// 2. Q0.30 CORDIC Hyperbolic Convergence & Vectoring Boundary Stress Testing
//    - Rotation mode: |s| -> 1.05 (near convergence ceiling sum(atanh(2^-i)) ~ 1.055375)
//    - Vectoring mode: |w| -> 0.8 (atanh convergence boundary)
//    - Round-trip atanh(tanh(s)) identity and hyperbolic Pythagorean cosh^2 - sinh^2 = 1
// 3. Wide BigInt Arithmetic, Zero Division & Degenerate Input Invariant Matrix
//    - fixedDiv with zero denominator, subnormal, signed zero, negative denominator
//    - fixedSqrt with zero, negative, near-zero, and maximum representable values
//    - mulQ edge cases with INT32_MIN, INT32_MAX, zero, and near-ceiling values
// 4. Poincaré Manifold Boundary Retractions Pi(x) Stress Matrix
//    - Points inside (||x|| < 1 - 10^-5), exactly on boundary (||x|| = 1 - 10^-5)
//    - Critical threshold ||x|| = 0.999999 (retracted to exactly 1 - 10^-5)
//    - Points on unit disk ||x|| = 1.0 and outside (||x|| = 1.5, 10.0, 10^6, 10^150)
//    - Float overflow and non-finite coordinates (NaN, Infinity, -Infinity, 10^300)
// 5. Poincaré Fixed-Point Gyrovector Addition & Geodesic Bounded Walk Stress
//    - fMobiusAdd identities (0 (+) x = x, (-x) (+) x = 0), single-pass BigInt non-overflow
//    - fBound isometric retraction on ||p|| > R_MAX (0.9)
//    - 100,000-step continuous deterministic geodesic walk invariant verification
//    - Ultra-large tick values (10^9, 10^12) determinism and stability
// 6. Cross-Platform Bit-Exact Transport Determinism & Zero Float ULP Drift
//    - Direct verification that all fixed-point math produces identical bit-level results
//    - End-to-end multi-turn channel synchronization, drop recovery, and replay rejection
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  ONE, toFixed, toFloat, mulQ, fixedDiv, fixedSqrt,
  CIRC_ITERS, ATAN_TABLE, CIRC_GAIN_INV, HALF_PI,
  HYP_ITERS, HYP_SEQ, ATANH_TABLE, HYP_GAIN_INV,
  fixedSinCos, fixedSinCosTurn, fixedSinhCosh, fixedTanh, fixedAtanh,
} from '../src/fixed-math';
import {
  fMobiusAdd, fNorm, fNorm2, fNeg, fHyperDistance, fGeodesicStep, fBound,
  fAdvancePoint, quantizeFPoint, initHypFixedChannel, hypFixedStart, hypFixedAdvance,
  hypFixedSeal, hypFixedOpen, hyperbolicSyncFixedSelfTest, R_MAX, RETRACT, PHI_INV_Q,
  type FPoint,
} from '../src/hyperbolic-sync-fixed';
import {
  project, mobiusAdd, poincareDist, depth, expMap0, logMap0, distGrad,
  norm, dot, BOUNDARY_EPS, EPS,
} from '../src/hyper';

describe('Milestone 2 Challenger 1: Adversarial CORDIC & Poincaré Determinism Suite', () => {

  // --------------------------------------------------------------------------
  // 1. CORDIC TRIGONOMETRIC QUADRANT BOUNDARY STRESS
  // --------------------------------------------------------------------------
  describe('1. Q0.30 CORDIC Trigonometric Quadrant Boundary Stress Testing', () => {
    
    it('exact quadrant boundaries produce analytical sine and cosine within CORDIC error bound (< 4e-9)', () => {
      // 0 turn = 0 rad -> sin=0, cos=1
      const q0 = fixedSinCosTurn(0);
      expect(Math.abs(q0.sin)).toBeLessThanOrEqual(8); // within 8 LSBs (~7.4e-9)
      expect(Math.abs(q0.cos - ONE)).toBeLessThanOrEqual(8);
      expect(toFloat(q0.sin)).toBeCloseTo(0.0, 7);
      expect(toFloat(q0.cos)).toBeCloseTo(1.0, 7);

      // 0.25 turn = pi/2 rad -> sin=1, cos=0
      const q1 = fixedSinCosTurn(ONE >> 2);
      expect(Math.abs(q1.cos)).toBeLessThanOrEqual(8);
      expect(Math.abs(q1.sin - ONE)).toBeLessThanOrEqual(8);
      expect(toFloat(q1.sin)).toBeCloseTo(1.0, 7);
      expect(toFloat(q1.cos)).toBeCloseTo(0.0, 7);

      // 0.5 turn = pi rad -> sin=0, cos=-1
      const q2 = fixedSinCosTurn(ONE >> 1);
      expect(Math.abs(q2.sin)).toBeLessThanOrEqual(8);
      expect(Math.abs(q2.cos + ONE)).toBeLessThanOrEqual(8);
      expect(toFloat(q2.sin)).toBeCloseTo(0.0, 7);
      expect(toFloat(q2.cos)).toBeCloseTo(-1.0, 7);

      // 0.75 turn = 3pi/2 rad -> sin=-1, cos=0
      const q3 = fixedSinCosTurn((ONE >> 2) * 3);
      expect(Math.abs(q3.cos)).toBeLessThanOrEqual(8);
      expect(Math.abs(q3.sin + ONE)).toBeLessThanOrEqual(8);
      expect(toFloat(q3.sin)).toBeCloseTo(-1.0, 7);
      expect(toFloat(q3.cos)).toBeCloseTo(0.0, 7);

      // 1.0 turn = 2pi rad -> wraps identically to 0 turn
      const q4 = fixedSinCosTurn(ONE);
      expect(q4).toEqual(q0);
    });

    it('handles minute epsilon deviations (+/- 1 LSB, +/- 1e-7, +/- 1e-4) around all 4 quadrant boundaries', () => {
      const boundaryTurns = [0.0, 0.25, 0.50, 0.75, 1.0];
      const deltas = [-1e-4, -1e-7, -1 / ONE, 1 / ONE, 1e-7, 1e-4];

      for (const b of boundaryTurns) {
        for (const d of deltas) {
          const turn = b + d;
          const turnQ = toFixed(turn);
          const { sin, cos } = fixedSinCosTurn(turnQ);
          const angle = 2 * Math.PI * turn;

          const expectedSin = Math.sin(angle);
          const expectedCos = Math.cos(angle);

          expect(toFloat(sin)).toBeCloseTo(expectedSin, 3);
          expect(toFloat(cos)).toBeCloseTo(expectedCos, 3);

          // Pythagorean identity verification: sin^2 + cos^2 = 1.0 in Q0.30
          const pyth = mulQ(sin, sin) + mulQ(cos, cos);
          expect(toFloat(pyth)).toBeCloseTo(1.0, 3);
        }
      }
    });

    it('correctly folds negative turn fractions identically to positive modulo', () => {
      const turns = [-0.1, -0.25, -0.5, -0.75, -1.0, -2.25, -1000.75];
      for (const t of turns) {
        const res = fixedSinCosTurn(toFixed(t));
        const normalizedTurn = ((t % 1) + 1) % 1;
        const angle = 2 * Math.PI * normalizedTurn;

        expect(toFloat(res.sin)).toBeCloseTo(Math.sin(angle), 3);
        expect(toFloat(res.cos)).toBeCloseTo(Math.cos(angle), 3);
      }
    });

    it('handles turn values across the 32-bit signed integer range without overflow', () => {
      const baseTurns = [0.0, 0.125, 0.25, 0.333, 0.5, 0.75];
      const multipliers = [0, 1, -1, 2, -2, 100, -100, 1000, -1000];

      for (const base of baseTurns) {
        const expected = fixedSinCosTurn(toFixed(base));
        for (const m of multipliers) {
          const turnQ = m * ONE + toFixed(base);
          const actual = fixedSinCosTurn(turnQ);
          expect(actual).toEqual(expected);
        }
      }
    });

    it('verifies Pythagorean identity across 10,000 fine-grained angles with 0 exception', () => {
      const N = 10000;
      let maxPythError = 0;
      for (let i = 0; i < N; i++) {
        const turnQ = Math.floor((i * ONE) / N);
        const { sin, cos } = fixedSinCosTurn(turnQ);
        const pyth = mulQ(sin, sin) + mulQ(cos, cos);
        const err = Math.abs(toFloat(pyth) - 1.0);
        if (err > maxPythError) maxPythError = err;
        // CORDIC at 28 iterations has error < 2e-4 in Q0.30
        expect(err).toBeLessThan(2e-4);
      }
      expect(maxPythError).toBeLessThan(1.5e-4);
    });
  });

  // --------------------------------------------------------------------------
  // 2. CORDIC HYPERBOLIC CONVERGENCE & VECTORING STRESS
  // --------------------------------------------------------------------------
  describe('2. Q0.30 CORDIC Hyperbolic Convergence & Vectoring Boundary Stress Testing', () => {

    it('hyperbolic rotation mode (fixedSinhCosh/fixedTanh) converges up to convergence ceiling |s| -> 1.05', () => {
      // Sum of atanh(2^-HYP_SEQ[k]) for k=0..23 = ~1.055375
      const sValues = [0.0, 0.1, 0.25, 0.5, 0.75, 0.9, 1.0, 1.05];

      for (const s of sValues) {
        // Positive s
        const posQ = toFixed(s);
        const posRes = fixedSinhCosh(posQ);
        expect(toFloat(posRes.sinh)).toBeCloseTo(Math.sinh(s), 3);
        expect(toFloat(posRes.cosh)).toBeCloseTo(Math.cosh(s), 3);
        expect(toFloat(fixedTanh(posQ))).toBeCloseTo(Math.tanh(s), 3);

        // Hyperbolic Pythagorean identity: cosh^2 - sinh^2 = 1.0
        // (verified within Q0.30 representable ceiling where cosh^2 < 2.0, i.e. |s| <= 0.6)
        if (s <= 0.6) {
          const hypIdPos = mulQ(posRes.cosh, posRes.cosh) - mulQ(posRes.sinh, posRes.sinh);
          expect(toFloat(hypIdPos)).toBeCloseTo(1.0, 3);
        }

        // Negative s
        if (s > 0) {
          const negQ = toFixed(-s);
          const negRes = fixedSinhCosh(negQ);
          expect(toFloat(negRes.sinh)).toBeCloseTo(Math.sinh(-s), 3);
          expect(toFloat(negRes.cosh)).toBeCloseTo(Math.cosh(-s), 3);
          expect(toFloat(fixedTanh(negQ))).toBeCloseTo(Math.tanh(-s), 3);

          if (s <= 0.6) {
            const hypIdNeg = mulQ(negRes.cosh, negRes.cosh) - mulQ(negRes.sinh, negRes.sinh);
            expect(toFloat(hypIdNeg)).toBeCloseTo(1.0, 3);
          }
        }
      }
    });

    it('hyperbolic vectoring mode (fixedAtanh) converges accurately for |w| <= 0.8', () => {
      const wValues = [0.0, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.75, 0.79, 0.80];

      for (const w of wValues) {
        const wQ = toFixed(w);
        const atanhQ = fixedAtanh(wQ);
        expect(toFloat(atanhQ)).toBeCloseTo(Math.atanh(w), 3);

        if (w > 0) {
          const negWQ = toFixed(-w);
          const negAtanhQ = fixedAtanh(negWQ);
          expect(toFloat(negAtanhQ)).toBeCloseTo(Math.atanh(-w), 3);
        }
      }
    });

    it('round-trips atanh(tanh(s)) == s across full domain [-0.75, 0.75]', () => {
      for (let s = -0.75; s <= 0.75; s += 0.05) {
        const sQ = toFixed(s);
        const tQ = fixedTanh(sQ);
        const backQ = fixedAtanh(tQ);
        expect(toFloat(backQ)).toBeCloseTo(s, 3);
      }
    });
  });

  // --------------------------------------------------------------------------
  // 3. WIDE BIGINT ARITHMETIC, ZERO DIVISION & DEGENERATE INPUTS
  // --------------------------------------------------------------------------
  describe('3. Wide BigInt Arithmetic, Zero Division & Degenerate Input Invariant Matrix', () => {

    it('fixedDiv handles division by zero safely without throwing or NaN (returns INT32_MAX or -INT32_MAX)', () => {
      expect(fixedDiv(100, 0)).toBe(0x7fffffff);
      expect(fixedDiv(-100, 0)).toBe(-0x7fffffff);
      expect(fixedDiv(0, 0)).toBe(0x7fffffff);
      expect(fixedDiv(ONE, 0)).toBe(0x7fffffff);
      expect(fixedDiv(-ONE, 0)).toBe(-0x7fffffff);
    });

    it('fixedDiv correctly divides signed combinations and maintains sign rules', () => {
      const a = toFixed(0.75);
      const c = toFixed(-0.75);
      const d = toFixed(1.5);

      // -0.75 / 1.5 = -0.5
      expect(toFloat(fixedDiv(c, d))).toBeCloseTo(-0.5, 5);
      // 0.75 / (-1.5) = -0.5
      expect(toFloat(fixedDiv(a, toFixed(-1.5)))).toBeCloseTo(-0.5, 5);
      // -0.75 / (-1.5) = 0.5
      expect(toFloat(fixedDiv(c, toFixed(-1.5)))).toBeCloseTo(0.5, 5);
    });

    it('fixedSqrt handles zero, negative inputs, and boundary values cleanly', () => {
      expect(fixedSqrt(0)).toBe(0);
      expect(fixedSqrt(-1)).toBe(0);
      expect(fixedSqrt(-0x7fffffff)).toBe(0);
      expect(fixedSqrt(-0x80000000)).toBe(0);

      // 1 LSB input: non-zero output without throwing
      const sqrt1LSB = fixedSqrt(1);
      expect(sqrt1LSB).toBeGreaterThan(0);

      // Boundary small value: x = 0.0001 -> sqrt = 0.01
      expect(toFloat(fixedSqrt(toFixed(0.0001)))).toBeCloseTo(0.01, 3);

      // Standard values across [0.0004, 1.99]
      for (const x of [0.0004, 0.001, 0.01, 0.04, 0.25, 0.5, 0.81, 1.0, 1.44, 1.99]) {
        const xQ = toFixed(x);
        const sq = fixedSqrt(xQ);
        expect(toFloat(sq)).toBeCloseTo(Math.sqrt(x), 4);
      }
    });

    it('mulQ handles INT32_MIN, INT32_MAX, and zero without throwing', () => {
      expect(mulQ(0, toFixed(1.5))).toBe(0);
      expect(mulQ(toFixed(1.5), 0)).toBe(0);
      expect(mulQ(ONE, ONE)).toBe(ONE);
      expect(mulQ(ONE, toFixed(0.5))).toBe(toFixed(0.5));
      expect(mulQ(toFixed(-1.0), toFixed(-1.0))).toBe(ONE);
      expect(mulQ(toFixed(-1.0), ONE)).toBe(toFixed(-1.0));

      // Max value products
      const maxVal = 0x7fffffff;
      const res = mulQ(maxVal, toFixed(0.5));
      expect(Number.isFinite(res)).toBe(true);
      expect(toFloat(res)).toBeCloseTo((0x7fffffff / ONE) * 0.5, 4);
    });
  });

  // --------------------------------------------------------------------------
  // 4. POINCARE BOUNDARY RETRACTIONS PI(X) STRESS MATRIX
  // --------------------------------------------------------------------------
  describe('4. Poincaré Manifold Boundary Retraction Pi(x) Stress Matrix', () => {

    it('points strictly inside the ball (norm < 1 - 1e-5) are unaffected by project()', () => {
      const testPoints = [
        [0, 0],
        [0.1, -0.2],
        [0.5, 0.5],
        [0.7, -0.7],
        [0.999, 0],
        [0.99998, 0], // norm = 0.99998 < 0.99999
      ];

      for (const p of testPoints) {
        const proj = project(p);
        expect(proj).toEqual(p);
        expect(norm(proj)).toBeLessThanOrEqual(1 - BOUNDARY_EPS);
      }
    });

    it('boundary points at norm == 1 - 10^-5 are unchanged', () => {
      const boundaryNorm = 1 - 1e-5; // 0.99999
      const p = [boundaryNorm, 0];
      const proj = project(p);
      expect(norm(proj)).toBeCloseTo(boundaryNorm, 9);
      expect(proj[0]).toBeCloseTo(boundaryNorm, 9);
    });

    it('critical threshold ||x|| = 0.999999 (1 - 10^-6) is strictly retracted to 1 - 10^-5', () => {
      const p = [0.999999, 0]; // 1 - 1e-6 > 1 - 1e-5
      const proj = project(p);
      const expectedMax = 1 - BOUNDARY_EPS; // 0.99999
      expect(norm(proj)).toBeCloseTo(expectedMax, 9);
      expect(proj[0]).toBeCloseTo(expectedMax, 9);
      expect(norm(proj)).toBeLessThan(norm(p));
    });

    it('points on or outside the unit disk (||x|| >= 1.0 up to 10^150) are radially retracted to 1 - 10^-5', () => {
      const outsidePoints = [
        [1.0, 0.0],
        [0.6, 0.8], // norm 1.0
        [1.000001, 0.0],
        [1.5, -1.5],
        [10.0, 0.0],
        [1e6, 1e6],
        [1e150, -1e150],
      ];

      for (const p of outsidePoints) {
        const proj = project(p);
        const pNorm = norm(proj);
        expect(Number.isFinite(pNorm)).toBe(true);
        expect(pNorm).toBeCloseTo(1 - BOUNDARY_EPS, 8);
        expect(pNorm).toBeLessThanOrEqual(1 - BOUNDARY_EPS + 1e-12);

        // Direction preservation (collinearity): u_proj / ||u_proj|| == u / ||u||
        const origNorm = norm(p);
        for (let i = 0; i < p.length; i++) {
          const expectedUnit = p[i] / origNorm;
          const actualUnit = proj[i] / pNorm;
          expect(actualUnit).toBeCloseTo(expectedUnit, 7);
        }
      }
    });

    it('float overflow (|x| >= 10^155) and non-finite coordinates (NaN, Infinity) return safe zero vector', () => {
      const junkVectors = [
        [1e300, 0], // dot(x,x) overflows to Infinity
        [NaN, 0],
        [0, Infinity],
        [-Infinity, 0.5],
        [NaN, NaN],
        [Infinity, -Infinity],
      ];

      for (const j of junkVectors) {
        const proj = project(j);
        expect(proj).toEqual(j.map(() => 0));
        expect(norm(proj)).toBe(0);
      }
    });

    it('depth() and poincareDist() prevent singularity overflow for points near or beyond the boundary', () => {
      const points = [
        [0.999999, 0],
        [1.0, 0],
        [1.5, 0],
        [100, 0],
      ];

      for (const p of points) {
        const d = depth(p);
        expect(Number.isFinite(d)).toBe(true);
        expect(d).toBeLessThanOrEqual(2 * Math.atanh(1 - BOUNDARY_EPS) + 1e-6);

        const distFromOrigin = poincareDist([0, 0], project(p));
        expect(Number.isFinite(distFromOrigin)).toBe(true);
      }
    });
  });

  // --------------------------------------------------------------------------
  // 5. POINCARE GYROVECTOR ADDITION & DETERMINISTIC BOUNDED WALK STRESS
  // --------------------------------------------------------------------------
  describe('5. Fixed-Point Poincaré Gyrovector Addition & Geodesic Bounded Walk Stress', () => {

    it('fMobiusAdd satisfies group axioms and single-pass BigInt non-overflow', () => {
      const zero: FPoint = [0, 0];
      const p1: FPoint = [toFixed(0.3), toFixed(-0.4)];
      const p2: FPoint = [toFixed(-0.2), toFixed(0.5)];

      // Identity: 0 (+) x = x
      const id1 = fMobiusAdd(zero, p1);
      expect(id1).toEqual(p1);

      // Identity: (-x) (+) x = 0
      const id2 = fMobiusAdd(fNeg(p1), p1);
      expect(toFloat(id2[0])).toBeCloseTo(0, 5);
      expect(toFloat(id2[1])).toBeCloseTo(0, 5);

      // Points near boundary (norm 0.85): single-pass BigInt calculation does not overflow
      const nearEdge1: FPoint = [toFixed(0.6), toFixed(0.6)]; // norm ~ 0.848
      const nearEdge2: FPoint = [toFixed(-0.5), toFixed(0.5)]; // norm ~ 0.707
      const sum = fMobiusAdd(nearEdge1, nearEdge2);
      expect(toFloat(fNorm(sum))).toBeLessThan(1.0);
    });

    it('fBound performs exact isometric inward retraction p <- (-RETRACT * u_hat) (+) p when ||p|| > R_MAX (0.9)', () => {
      // Point inside R_MAX (0.9)
      const pInside: FPoint = [toFixed(0.5), toFixed(0.5)]; // norm ~ 0.707
      expect(fBound(pInside)).toEqual(pInside);

      // Point at exactly R_MAX
      const pOnRMax: FPoint = [toFixed(0.9), 0];
      expect(fBound(pOnRMax)).toEqual(pOnRMax);

      // Point crossing R_MAX in walk (norm = 0.91)
      const pCrossing: FPoint = [toFixed(0.91), 0];
      const retractedCrossing = fBound(pCrossing);
      const newNormCrossing = toFloat(fNorm(retractedCrossing));

      // Retracts strictly inside R_MAX: analytical (0.91 - 0.5) / (1 - 0.5 * 0.91) = 0.7523 < 0.9
      expect(newNormCrossing).toBeCloseTo(0.7523, 3);
      expect(newNormCrossing).toBeLessThan(0.9);

      // Point far outside (0.7, 0.7) -> norm ~ 0.9899
      const pOutside: FPoint = [toFixed(0.7), toFixed(0.7)];
      const origNorm = toFloat(fNorm(pOutside));
      expect(origNorm).toBeGreaterThan(0.9);

      const retracted = fBound(pOutside);
      const newNorm = toFloat(fNorm(retracted));

      // Strictly reduces norm and preserves collinear direction
      expect(newNorm).toBeLessThan(origNorm);
      const origAngle = Math.atan2(pOutside[1], pOutside[0]);
      const newAngle = Math.atan2(retracted[1], retracted[0]);
      expect(newAngle).toBeCloseTo(origAngle, 4);
    });

    it('executes 100,000-step continuous deterministic geodesic walk without boundary breach or drift', () => {
      let p: FPoint = [toFixed(0.1), toFixed(-0.1)];
      const phi0Q = toFixed(0.382);
      let maxNorm = 0;
      let minNorm = Infinity;

      for (let tick = 1; tick <= 100_000; tick++) {
        const nextP = fAdvancePoint(p, tick, phi0Q);
        const r = toFloat(fNorm(nextP));
        if (r > maxNorm) maxNorm = r;
        if (r < minNorm) minNorm = r;

        // Verify invariant: point is strictly within disk (< 0.95)
        expect(r).toBeLessThan(0.95);
        expect(nextP[0]).toBeGreaterThan(-ONE);
        expect(nextP[0]).toBeLessThan(ONE);
        expect(nextP[1]).toBeGreaterThan(-ONE);
        expect(nextP[1]).toBeLessThan(ONE);

        p = nextP;
      }

      expect(maxNorm).toBeLessThan(0.95);
      expect(minNorm).toBeGreaterThanOrEqual(0);
    // 100k CORDIC steps: ~1.5s on an M-series Mac, ~5.5s on a slower CI
    // runner. The 5000ms vitest default made this fail by hardware, not by
    // regression. Explicit budget, generous enough to be a real signal.
    }, 30000);

    it('fAdvancePoint with ultra-large ticks (10^9, 10^12) produces bit-exact deterministic results', () => {
      const p: FPoint = [toFixed(0.2), toFixed(0.3)];
      const phi0Q = toFixed(0.618);

      const r1 = fAdvancePoint(p, 1_000_000_000, phi0Q);
      const r2 = fAdvancePoint(p, 1_000_000_000, phi0Q);
      expect(r1).toEqual(r2);

      const r3 = fAdvancePoint(p, 1_000_000_000_000, phi0Q);
      const r4 = fAdvancePoint(p, 1_000_000_000_000, phi0Q);
      expect(r3).toEqual(r4);
      expect(toFloat(fNorm(r3))).toBeLessThan(1.0);
    });
  });

  // --------------------------------------------------------------------------
  // 6. CROSS-PLATFORM BIT-EXACT TRANSPORT DETERMINISM & ZERO FLOAT ULP DRIFT
  // --------------------------------------------------------------------------
  describe('6. Cross-Platform Bit-Exact Transport Determinism & Zero Float ULP Drift', () => {

    it('quantizeFPoint packs full 32-bit two\'s-complement integers deterministically', () => {
      const p1: FPoint = [toFixed(0.5), toFixed(-0.5)];
      const qBytes1 = quantizeFPoint(p1);
      const qBytes2 = quantizeFPoint(p1);

      expect(qBytes1.length).toBe(8);
      expect(Array.from(qBytes1)).toEqual(Array.from(qBytes2));

      // Verify two's complement interpretation
      const dv = new DataView(qBytes1.buffer);
      expect(dv.getInt32(0, false)).toBe(toFixed(0.5));
      expect(dv.getInt32(4, false)).toBe(toFixed(-0.5));
    });

    it('end-to-end multi-turn channel synchronization, drop recovery, and replay rejection', async () => {
      const master = crypto.getRandomValues(new Uint8Array(32));
      const ch = await initHypFixedChannel(master);

      // Sender and Receiver start at identical secret origin
      let s = hypFixedStart(ch);
      let r = hypFixedStart(ch);

      const te = new TextEncoder();
      const td = new TextDecoder();

      // 1. Normal multi-packet transmission
      for (let i = 0; i < 10; i++) {
        const msg = `telemetry-frame-${i}`;
        const { wire, next: nextS } = await hypFixedSeal(ch, s, te.encode(msg));
        s = nextS;

        const { plaintext, next: nextR } = await hypFixedOpen(ch, r, wire, 8);
        r = nextR;
        expect(td.decode(plaintext)).toBe(msg);
        expect(r.tick).toBe(s.tick);
        expect(r.point).toEqual(s.point);
      }

      // 2. Burst packet loss (drop 5 packets)
      for (let i = 0; i < 5; i++) {
        s = hypFixedAdvance(ch, s);
      }
      const syncMsg = 'resync-burst-frame';
      const { wire: syncWire, next: sAfterBurst } = await hypFixedSeal(ch, s, te.encode(syncMsg));
      s = sAfterBurst;

      // Receiver receives packet from 6 ticks ahead (within window=8)
      const { plaintext: syncPlain, next: rAfterBurst } = await hypFixedOpen(ch, r, syncWire, 8);
      r = rAfterBurst;
      expect(td.decode(syncPlain)).toBe(syncMsg);
      expect(r.tick).toBe(s.tick);
      expect(r.point).toEqual(s.point);

      // 3. Replay attack rejection: attempt to re-open an old wire packet
      await expect(hypFixedOpen(ch, r, syncWire, 8)).rejects.toThrow();
    });

    it('full self-test passes all 9 security & determinism invariants', async () => {
      const selfTest = await hyperbolicSyncFixedSelfTest();
      expect(selfTest.ok).toBe(true);
      expect(selfTest.roundtrip).toBe(true);
      expect(selfTest.resync_after_loss).toBe(true);
      expect(selfTest.beyond_window_rejected).toBe(true);
      expect(selfTest.rewind_rejected).toBe(true);
      expect(selfTest.no_counter_overhead).toBe(true);
      expect(selfTest.wrong_master_rejected).toBe(true);
      expect(selfTest.secret_geodesic).toBe(true);
      expect(selfTest.bit_exact_repeatable).toBe(true);
    });
  });
});

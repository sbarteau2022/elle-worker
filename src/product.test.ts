import { describe, it, expect } from 'vitest';
import {
  productPairs, productDist, disagreements,
  recognitionInvariant, sameRecurrenceClass, metricReturn,
} from './product';

describe('productPairs / productDist', () => {
  it('pairs only the shared node set into (depth, phase)', () => {
    const hyper = { a: [0, 0], b: [0.5, 0], c: [0.1, 0.1] };
    const torus = { a: [0, 0], b: [1, 1] }; // c missing from torus
    const pairs = productPairs(hyper, torus);
    expect(pairs.map((p) => p.id).sort()).toEqual(['a', 'b']);
    expect(pairs.find((p) => p.id === 'a')!.depth).toBe(0); // origin of the ball
    expect(pairs.find((p) => p.id === 'b')!.depth).toBeGreaterThan(0);
  });
  it('productDist combines both curvatures (adds the torus factor)', () => {
    const a = { ball: [0, 0], torus: [0, 0] }, b = { ball: [0.5, 0], torus: [2, 0] };
    const both = productDist(a, b, 1);
    const ballOnly = productDist(a, { ball: [0.5, 0], torus: [0, 0] }, 1);
    expect(both).toBeGreaterThan(ballOnly);
  });
});

describe('disagreements (the reason to hold both charts)', () => {
  it('separates same-rhythm/different-lineage from same-lineage/drifted-phase', () => {
    // p–q: far in the ball, close on the torus  → same rhythm, different lineage
    // p–r: close in the ball, far on the torus  → same lineage, drifted phase
    const hyper = { p: [0, 0], q: [0.9, 0], r: [0.02, 0], s: [0.4, 0.4] };
    const torus = { p: [0, 0], q: [0.05, 0.05], r: [3, 3], s: [1.5, 1.5] };
    const d = disagreements(hyper, torus, { topK: 3 });
    const rhythmTop = d.same_rhythm_diff_lineage[0];
    const lineageTop = d.same_lineage_drift_phase[0];
    expect(new Set([rhythmTop.a, rhythmTop.b])).toEqual(new Set(['p', 'q']));
    expect(new Set([lineageTop.a, lineageTop.b])).toEqual(new Set(['p', 'r']));
  });
});

// ── the disproof of Scope B, as executable assertions ─────────────────────
// SICT eliminates the torus (its Category 3) because a φ-winding orbit only
// returns to a prior state ASYMPTOTICALLY — no finite-time exact return. That
// tests METRIC return. Recognition is a topological INVARIANT (the winding
// number, π₁(𝕋ⁿ)=ℤⁿ), which is exact at every finite time. These tests show the
// invariant succeeding exactly where metric return is blind — so the lemniscate
// is sufficient, not necessary, and Scope B is dropped.
describe('exact recognition invariant (disproof of the lemniscate necessity)', () => {
  const drift = [[0], [0.3], [-0.2], [0.1], [0.0]]; // jitters, returns to start
  const loop = [[0], [2.0], [4.0], [6.0], [0.0]];   // goes once around, returns to start

  it('the invariant separates two trajectories that metric return CANNOT', () => {
    // Both come back to exactly the start — metric return is 0 for each.
    expect(metricReturn(drift)).toBe(0);
    expect(metricReturn(loop)).toBe(0);
    // Yet their identities differ exactly: drift wound 0 times, loop wound once.
    expect(recognitionInvariant(drift)).toEqual([0]);
    expect(recognitionInvariant(loop)).toEqual([1]);
    expect(sameRecurrenceClass(drift, loop)).toBe(false);
  });

  it('the invariant is an exact integer even on the φ-orbit SICT eliminated', () => {
    const PHI = (1 + Math.sqrt(5)) / 2;
    const ga = 2 * Math.PI * (2 - PHI); // golden angle
    const golden = Array.from({ length: 40 }, (_, k) => [(k * ga) % (2 * Math.PI)]);
    // Metric return is > 0 at finite N (asymptotic, exactly SICT's Category-3 point)…
    expect(metricReturn(golden)).toBeGreaterThan(0);
    // …while the winding invariant is a well-defined exact integer the whole time.
    const w = recognitionInvariant(golden);
    expect(w.length).toBe(1);
    expect(Number.isInteger(w[0])).toBe(true);
    expect(w[0]).toBe(15);
  });

  it('same trajectory ⇒ same recurrence class (reflexive, exact)', () => {
    expect(sameRecurrenceClass(loop, loop)).toBe(true);
  });
});

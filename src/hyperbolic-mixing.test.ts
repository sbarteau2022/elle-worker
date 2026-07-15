import { describe, it, expect } from 'vitest';
import { lyapunovHyperbolic, lyapunovTorus, coverageHyperbolic, mixingReport } from './hyperbolic-mixing';

// The walk is deterministic (fixed start, no randomness), so these numbers are
// exact and reproducible — the assertions pin the MEASURED behaviour, not a
// hoped-for one.
describe('divergence of adjacent states (largest Lyapunov exponent)', () => {
  it('the hyperbolic walk has a positive Lyapunov exponent (sensitive dependence)', () => {
    const l = lyapunovHyperbolic().lambda;
    expect(l).toBeGreaterThan(0.005); // measured ≈ 0.0113 / tick
    expect(l).toBeLessThan(0.05);     // …but weak — not strongly chaotic
  });
  it('the flat torus is integrable — its Lyapunov exponent is ≈ 0 (the control)', () => {
    expect(Math.abs(lyapunovTorus().lambda)).toBeLessThan(0.001); // measured ≈ −8e-6
  });
  it('the hyperbolic divergence is decisively above the flat baseline', () => {
    expect(lyapunovHyperbolic().lambda).toBeGreaterThan(10 * Math.abs(lyapunovTorus().lambda));
  });
});

describe('state-space coverage', () => {
  it('fills most of the reachable disk (broad exploration)', () => {
    const c = coverageHyperbolic();
    expect(c.visitedFraction).toBeGreaterThan(0.6); // measured ≈ 0.75
    expect(c.reachableCells).toBeGreaterThan(0);
  });
  it('reports the occupancy non-uniformity honestly (not claimed as uniform)', () => {
    const c = coverageHyperbolic();
    expect(c.occupancyCV).toBeGreaterThan(0); // measured ≈ 0.72 — broad but clumped
  });
});

describe('mixingReport — the honest measured verdict', () => {
  it('confirms weak sensitive dependence without overclaiming ergodicity', () => {
    const r = mixingReport();
    expect(r.sensitive_dependence).toBe(true);
    expect(r.strength).toBe('weak');
    expect(r.verdict).toContain('not a certified ergodic flow');
  });
});

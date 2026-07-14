// ============================================================
// ASYMMETRIC LOG-ODDS REGULATOR TESTS — the two design constraints,
// proven, not narrated:
//   1. collapse rate inversely proportional to recovery rate
//      (S_C · S_R = s² exactly; ratio φ²)
//   2. dynamic thresholds; complete failure and complete success
//      structurally unreachable (open rails, asymmetric by consequence)
//   npx vitest run src/recovery-asymmetric.test.ts
// ============================================================
import { describe, it, expect } from 'vitest';
import { PHI, createAsymmetricRegulator, ASYM_RHO_DEFAULT, ASYM_Z_MAX } from './recovery';

let seed = 20260716;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const logistic = (z: number) => 1 / (1 + Math.exp(-z));

describe('constraint 1 — the inverse-proportionality law', () => {
  it('S_COLLAPSE · S_RECOVER = s² exactly, and the ratio is φ² (collapse ≈2.618× faster than recovery)', () => {
    const reg = createAsymmetricRegulator();
    const { s, S_COLLAPSE, S_RECOVER } = reg.constants;
    expect(S_COLLAPSE * S_RECOVER).toBeCloseTo(s * s, 12);
    expect(S_COLLAPSE / S_RECOVER).toBeCloseTo(PHI * PHI, 12);
  });

  it('behaviorally: trust lost in 1 collapse step takes ~φ² recovery steps to re-earn (near neutral)', () => {
    // Near z=0 the leak is negligible, so steps compose almost additively:
    // one collapse = φ²·(one recovery), i.e., ~2.6 confirmations per violation.
    const reg = createAsymmetricRegulator();
    reg.observe('strain', 1);
    let k = 0;
    while (reg.state().z < -1e-9 && k < 10) { reg.observe('recover', 1); k++; }
    expect(k).toBe(3); // ceil(φ²) — two full recoveries leave you short; the third clears it
  });
});

describe('constraint 2 — open rails: complete failure and complete success unreachable', () => {
  it('1,000 consecutive MAXIMAL strains approach the collapse rail and never touch it', () => {
    const reg = createAsymmetricRegulator();
    let st = reg.state();
    for (let i = 0; i < 1000; i++) st = reg.observe('strain', 1);
    expect(st.z).toBeGreaterThan(-st.zMax);           // strictly above the rail
    expect(st.z).toBeLessThan(-st.zMax * 0.999);      // but asymptotically at it
    expect(st.kappa).toBeGreaterThan(0);               // complete failure: unreachable
    expect(st.kappa).toBeCloseTo(st.kappaMin, 3);
  });

  it('1,000 consecutive MAXIMAL confirmations approach the (lower!) recovery rail and never touch it', () => {
    const reg = createAsymmetricRegulator();
    let st = reg.state();
    for (let i = 0; i < 1000; i++) st = reg.observe('recover', 1);
    const zRecoverRail = st.zMax / (PHI * PHI);
    expect(st.z).toBeLessThan(zRecoverRail);
    expect(st.z).toBeGreaterThan(zRecoverRail * 0.999);
    expect(st.kappa).toBeLessThan(1);                  // complete success: unreachable
    expect(st.kappa).toBeCloseTo(st.kappaMax, 3);
  });

  it('the rails are themselves asymmetric — the success ceiling is nearer neutral than the failure floor (a consequence, not a choice)', () => {
    const st = createAsymmetricRegulator().state();
    // κ range at defaults: (logistic(−3), logistic(3/φ²)) ≈ (0.047, 0.759).
    expect(st.kappaMin).toBeCloseTo(logistic(-ASYM_Z_MAX), 10);
    expect(st.kappaMax).toBeCloseTo(logistic(ASYM_Z_MAX / (PHI * PHI)), 10);
    expect(1 - st.kappaMax).toBeGreaterThan(st.kappaMin); // distance-to-perfect-success > distance-to-perfect-failure
  });

  it('100k hostile random steps (random dirs, out-of-range and non-finite weights) never leave the open rails', () => {
    const reg = createAsymmetricRegulator();
    for (let i = 0; i < 100_000; i++) {
      const w = i % 997 === 0 ? NaN : rnd() * 3 - 1; // sprinkle NaN and out-of-range
      const st = reg.observe(rnd() < 0.5 ? 'strain' : 'recover', w);
      expect(st.z).toBeGreaterThan(-st.zMax);
      expect(st.z).toBeLessThan(st.zMax);
      expect(st.kappa).toBeGreaterThan(0);
      expect(st.kappa).toBeLessThan(1);
    }
  });

  it('thresholds are fractions of the structure, not constants: change ρ or Z and they move with it', () => {
    // Same fraction (half of each directional rail), different structures.
    const a = createAsymmetricRegulator(0.10, 3);
    const b = createAsymmetricRegulator(0.05, 2);
    // Drive both past their own strained thresholds by sustained strain.
    // The half-rail crossing needs (1−ρ)^k < 0.5: 7 steps at ρ=0.10, 14 at
    // ρ=0.05 — the threshold's STEP-COUNT moves with the structure too.
    let sa = a.state(), sb = b.state();
    for (let i = 0; i < 16; i++) { sa = a.observe('strain', 1); sb = b.observe('strain', 1); }
    // Both read strained relative to THEIR OWN rails — no shared hardcoded κ.
    expect(sa.status).toBe('strained');
    expect(sb.status).toBe('strained');
    expect(a.state().zMax).not.toBeCloseTo(b.state().zMax, 6);
  });
});

describe('the step invariant carries over — accumulation only, in both directions', () => {
  it('single-step-no-collapse: one maximal strain from neutral cannot reach the strained threshold', () => {
    const reg = createAsymmetricRegulator();
    const st = reg.observe('strain', 1);
    expect(st.status).toBe('holding');          // one blow does not collapse
    expect(Math.abs(st.z)).toBeLessThan(st.zMax / 2);
  });

  it('exact minimum: consecutive maximal strains from neutral to reach strained status', () => {
    const reg = createAsymmetricRegulator();
    let k = 0;
    while (reg.state().status !== 'strained' && k < 100) { reg.observe('strain', 1); k++; }
    // z after k max strains: −zMax·(1−(1−ρ)^k); strained needs > zMax/2 →
    // (1−ρ)^k < 0.5 → k > ln2/ln(1/0.9) ≈ 6.58 → 7 steps at ρ=0.10.
    expect(k).toBe(7);
  });

  it('and no single-step absolution either: from deep strain, one maximal confirmation moves κ only fractionally', () => {
    const reg = createAsymmetricRegulator();
    for (let i = 0; i < 50; i++) reg.observe('strain', 1);
    const before = reg.state().kappa;
    const after = reg.observe('recover', 1).kappa;
    expect(after - before).toBeLessThan(0.06);   // a sliver of trust, not absolution
    expect(after).toBeLessThan(0.12);            // still deep in distrust after one good bar
  });
});

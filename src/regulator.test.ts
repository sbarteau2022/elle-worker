import { describe, it, expect } from 'vitest';
import {
  freeEnergy,
  regulate,
  ruggedEscapeDemo,
  coherenceFromReports,
  regulatorSelfTest,
  PHI_WEIGHTS,
  type Coherence,
} from './regulator';

describe('freeEnergy — invariants as cost, homogeneity as entropy', () => {
  it('is zero only at full, balanced coherence c*=(1,1,1)', () => {
    expect(freeEnergy({ structural: 1, relational: 1, harmonic: 1 }, 0.5).F).toBe(0);
    expect(freeEnergy({ structural: 1, relational: 1, harmonic: 1 }, 0.5).A).toBe(0);
  });

  it('charges an anisotropy cost when coordinates disagree (no free lunch for a privileged direction)', () => {
    const flat = freeEnergy({ structural: 0.6, relational: 0.6, harmonic: 0.6 }, 0.5);
    const spiky = freeEnergy({ structural: 0.9, relational: 0.3, harmonic: 0.6 }, 0.5);
    expect(spiky.A).toBeGreaterThan(flat.A);           // spiky is anisotropic
    expect(spiky.F).toBeGreaterThan(flat.F);           // and pays for it in free energy
  });

  it('uses φ-partition regulator gains (1, 1/φ, 1/φ²), normalized', () => {
    const s = PHI_WEIGHTS[0] + PHI_WEIGHTS[1] + PHI_WEIGHTS[2];
    expect(s).toBeCloseTo(1, 10);
    expect(PHI_WEIGHTS[0]).toBeGreaterThan(PHI_WEIGHTS[1]);
    expect(PHI_WEIGHTS[1]).toBeGreaterThan(PHI_WEIGHTS[2]);
  });
});

describe('regulate — the Lyapunov descent (pure)', () => {
  const start: Coherence = { structural: 0.9, relational: 0.3, harmonic: 0.55 };

  it('F never increases: a genuine Lyapunov function', () => {
    const r = regulate(start, { perturb: 0 });
    for (let i = 1; i < r.trace.length; i++) {
      expect(r.trace[i].F).toBeLessThanOrEqual(r.trace[i - 1].F + 1e-12);
    }
    expect(r.monotone_descent).toBe(true);
  });

  it('conserves free energy exactly: F(t) + work(t) ≡ F0', () => {
    const r = regulate(start, { perturb: 0 });
    expect(r.conserved_ok).toBe(true);
    for (const s of r.trace) expect(Math.abs(s.conserved - r.F0)).toBeLessThan(1e-6);
  });

  it('suppresses anisotropy to ~0 (isotropic) and holds a balanced superposition', () => {
    const r = regulate(start, { perturb: 0 });
    expect(r.isotropic).toBe(true);
    expect(r.final.A).toBeLessThan(1e-3);
    expect(r.balanced_superposition).toBe(true);         // three coherences equal & full
    expect(r.final.coherence.structural).toBeGreaterThan(0.98);
  });

  it('resolves dissonance: the residual falls below tolerance', () => {
    const r = regulate(start, { perturb: 0 });
    expect(r.dissonance_final).toBeLessThan(1e-4);
    expect(r.converged).toBe(true);
  });

  it('reaches the fixed point from any deficient start', () => {
    const r = regulate({ structural: 0.1, relational: 0.2, harmonic: 0.05 }, { perturb: 0 });
    expect(r.converged).toBe(true);
    expect(r.final.F).toBeLessThan(1e-3);
  });
});

describe('perturbation-φ oscillation — escaping a dissonance well', () => {
  it('plain descent stalls below the barrier; the φ-perturbation crosses to the global well', () => {
    const d = ruggedEscapeDemo();
    expect(d.descent_only).toBeLessThan(d.barrier_x);    // stuck below the barrier top
    expect(d.with_perturbation).toBeGreaterThan(0.5);    // escaped to the global minimum
    expect(d.perturbation_escaped).toBe(true);
  });

  it('the barrier geometry is derived from the calculus, not tuned', () => {
    const d = ruggedEscapeDemo();
    // U(x) = (x²−1)² − tilt·x with tilt 1.2: the three critical points, in order
    expect(d.spurious_x).toBeLessThan(d.barrier_x);
    expect(d.barrier_x).toBeLessThan(d.target_x);
    expect(d.barrier_height).toBeGreaterThan(0);         // there really is a barrier to cross
    expect(d.target_x).toBeGreaterThan(0.9);             // global min near +1
  });

  it('the escape amplitude is MEASURED (a real threshold), and the demo runs just above it', () => {
    const d = ruggedEscapeDemo();
    expect(d.escape_threshold_amp).toBeGreaterThan(0);   // a real amplitude was found by the sweep
    expect(d.demo_amp).toBeCloseTo(d.escape_threshold_amp * 1.3, 6); // stated margin, not a magic constant
  });
});

describe('wired to the real invariants', () => {
  it('maps a hubless scaffold + a flower coherence report + a harmonic value into the state', () => {
    const c = coherenceFromReports(
      { degree_gini: 0.17, no_privileged_node: true, connected: true },
      { full: { nodes: 20, avg_path_len: 1.9, reachable_fraction: 1, within_2_fraction: 0.86 } } as any,
      0.78,
    );
    expect(c.structural).toBeCloseTo(0.83, 5);           // 1 − degree_gini
    expect(c.relational).toBeCloseTo(0.86, 5);           // within_2_fraction
    expect(c.harmonic).toBeCloseTo(0.78, 5);
  });

  it('a disconnected scaffold reads zero structural coherence', () => {
    const c = coherenceFromReports(
      { degree_gini: 0.1, no_privileged_node: false, connected: false },
      { full: { nodes: 5, avg_path_len: 0, reachable_fraction: 0.4, within_2_fraction: 0.5 } } as any,
      0.5,
    );
    expect(c.structural).toBe(0);
  });

  it('regulating the scaffold\'s own measured invariants converges', () => {
    const c = coherenceFromReports(
      { degree_gini: 0.17, no_privileged_node: true, connected: true },
      { full: { nodes: 20, avg_path_len: 1.9, reachable_fraction: 1, within_2_fraction: 0.86 } } as any,
      0.78,
    );
    const r = regulate(c, { perturb: 0 });
    expect(r.converged).toBe(true);
    expect(r.isotropic).toBe(true);
    expect(r.balanced_superposition).toBe(true);
  });
});

describe('regulatorSelfTest — the whole certificate green', () => {
  it('Lyapunov descent, conservation, isotropy, superposition, dissonance, escape, real invariants', () => {
    const st = regulatorSelfTest();
    expect(st.lyapunov_descent).toBe(true);
    expect(st.free_energy_conserved).toBe(true);
    expect(st.isotropic_suppression).toBe(true);
    expect(st.balanced_superposition).toBe(true);
    expect(st.dissonance_resolves).toBe(true);
    expect(st.perturbation_escapes).toBe(true);
    expect(st.from_real_invariants).toBe(true);
    expect(st.ok).toBe(true);
  });
});

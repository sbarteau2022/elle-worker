import { describe, it, expect } from 'vitest';
import { createSuperpositionValve } from './kappa-superposition';
import { RHO_DEFAULT } from './kappa-multimodal';

const E_MINUS_1 = Math.E - 1;

describe('kappa superposition', () => {
  // Proposition 1 carries to the disagreement ledger: spread ∈ [0,1] for
  // κ ∈ [0,1], so the same proof bounds it.
  it('keeps the alignment loss under e-1 under maximal sustained disagreement', () => {
    const v = createSuperpositionValve();
    let s = v.state();
    for (let i = 0; i < 5000; i++) s = v.observe({ acoustic: 1, visual: 0, agreement: i % 2 ? 1 : 0 });
    expect(s.spread).toBe(1);
    expect(s.alignment_loss).toBeLessThan(E_MINUS_1);
    expect(s.disagreement).toBeLessThan(1 / RHO_DEFAULT + 1e-6);
  });

  it('reads aligned channels as holding and split channels as diverging', () => {
    const aligned = createSuperpositionValve();
    let a = aligned.state();
    for (let i = 0; i < 60; i++) a = aligned.observe({ lexical: 0.62, acoustic: 0.60, visual: 0.61 });
    expect(a.status).toBe('holding');

    const split = createSuperpositionValve();
    let d = split.state();
    for (let i = 0; i < 60; i++) d = split.observe({ acoustic: 0.20, visual: 0.30, agreement: 0.95 });
    expect(d.status).toBe('diverging');
    expect(d.alignment_loss).toBeGreaterThan(a.alignment_loss);
  });

  // The point of holding rather than averaging: one aligned turn does not
  // erase a run of divergence. A per-turn scalar cannot express this.
  it('does not let a single aligned turn clear accumulated divergence', () => {
    const v = createSuperpositionValve();
    for (let i = 0; i < 40; i++) v.observe({ acoustic: 0.95, visual: 0.15 });
    const before = v.state().alignment_loss;
    const after = v.observe({ acoustic: 0.55, visual: 0.55 }).alignment_loss;
    expect(after).toBeGreaterThan(before * 0.9);   // barely moved
    expect(after).toBeGreaterThan(0.25);           // still reads diverging
  });

  // Proposition 3: history decays on a known clock rather than being erased.
  it('forgives divergence on the ~34-turn half-life', () => {
    const v = createSuperpositionValve();
    for (let i = 0; i < 200; i++) v.observe({ acoustic: 1, visual: 0 });
    const peak = v.state().disagreement;
    for (let i = 0; i < Math.round(v.state().half_life_turns); i++) v.observe({ acoustic: 0.5, visual: 0.5 });
    const halved = v.state().disagreement;
    expect(halved).toBeLessThan(peak * 0.55);
    expect(halved).toBeGreaterThan(peak * 0.45);
  });

  it('treats one channel as nothing to disagree with', () => {
    const v = createSuperpositionValve();
    const s = v.observe({ acoustic: 0.9 });
    expect(s.present).toBe(1);
    expect(s.spread).toBe(0);
    expect(s.status).toBe('quiescent');
  });

  it('carries a slot for content agreement without reshaping', () => {
    const v = createSuperpositionValve();
    const s = v.observe({ lexical: 0.95, acoustic: 0.92, visual: 0.90, agreement: 0.10 });
    expect(s.present).toBe(4);
    // delivery agrees with itself; the evidence does not agree with the claim
    expect(s.spread).toBeCloseTo(0.82, 6);
  });

  it('leaks an absent channel rather than freezing its ledger', () => {
    const v = createSuperpositionValve();
    for (let i = 0; i < 50; i++) v.observe({ lexical: i % 2 ? 1 : 0, acoustic: 0.5 });
    const held = v.state().channels.lexical.drift;
    for (let i = 0; i < 100; i++) v.observe({ acoustic: 0.5 });
    expect(v.state().channels.lexical.drift).toBeLessThan(held * 0.5);
  });
});

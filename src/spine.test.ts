// ============================================================
// THE SPINE — pure-core tests. The whole decision architecture proven
// without a single LLM call: three collapses held, dissent that never
// resolves, one-run-one-observation regulator, Axis 17's earned gate.
//   npx vitest run src/spine.test.ts
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  holdField, fieldAgreement, dissent, observeField, kappaOf, chargedKappa,
  axis17, runSpinePure, type TierCollapse,
} from './spine';
import { PHI, ASYM_Z_MAX } from './recovery';

const T = (tier: 1 | 2 | 3, direction: number, confidence: number): TierCollapse =>
  ({ tier, direction, confidence, thesis: `t${tier}`, claims: [] });

describe('the held field — three collapses, never merged', () => {
  it('holdField keeps all three separate and marks the field held-open', () => {
    const f = holdField([T(1, 0.8, 0.9), T(2, 0.6, 0.7), T(3, 0.4, 0.5)]);
    expect(f.collapses).toHaveLength(3);
    expect(f.heldOpen).toBe(true);
    expect(f.meanDirection).toBeGreaterThan(0);
  });

  it('agreement is 1 when the tiers all point one way, ~0 when they cancel', () => {
    expect(fieldAgreement([T(1, 1, 1), T(2, 0.8, 1), T(3, 0.6, 1)])).toBeCloseTo(1, 6);
    // equal-and-opposite → the signed sum vanishes
    expect(fieldAgreement([T(1, 1, 1), T(2, -1, 1)])).toBeCloseTo(0, 6);
  });

  it('confidence weights the mean: a low-confidence dissenter barely tilts it', () => {
    const f = holdField([T(1, 1, 1), T(2, 1, 1), T(3, -1, 0.05)]);
    expect(f.meanDirection).toBeGreaterThan(0.8);
  });

  it('degenerate collapses (non-finite) are dropped, not propagated', () => {
    const f = holdField([T(1, NaN, 0.9), T(2, 0.5, Infinity), T(3, 0.5, 0.5)]);
    expect(f.collapses).toHaveLength(1);
    expect(Number.isFinite(f.meanDirection)).toBe(true);
  });
});

describe('dissent — holds, observes, reports; NEVER collapses', () => {
  it('always carries the structural holds=true guarantee', () => {
    expect(dissent(holdField([T(1, 1, 1), T(2, 1, 1), T(3, 1, 1)])).holds).toBe(true);
    expect(dissent(holdField([T(1, 1, 1), T(2, -1, 1), T(3, 1, 1)])).holds).toBe(true);
  });

  it('names the split without overruling it — a coherent field has no contested tiers', () => {
    const d = dissent(holdField([T(1, 0.9, 1), T(2, 0.7, 1), T(3, 0.5, 1)]));
    expect(d.contested).toEqual([]);
    expect(d.aligned).toEqual([1, 2, 3]);
    expect(d.fieldDirection).toBe('up');
  });

  it('a dissenting tier is reported as contested — held open, not removed', () => {
    const d = dissent(holdField([T(1, 0.9, 1), T(2, 0.8, 1), T(3, -0.7, 1)]));
    expect(d.contested).toEqual([3]);
    expect(d.aligned).toEqual([1, 2]);
    expect(d.note).toContain('held open');
  });
});

describe('the decision regulator — one spine run = one observation', () => {
  it('a single coherent run cannot reach the charged rail (single-step-no-collapse, carried over)', () => {
    const { z, prediction } = runSpinePure([T(1, 1, 1), T(2, 1, 1), T(3, 1, 1)], 0);
    expect(prediction.kappa).toBeGreaterThan(0.5);   // it moved toward conviction
    expect(prediction.kappa).toBeLessThan(chargedKappa); // but did not earn "charged" in one run
    expect(prediction.act).toBe(false);
    expect(prediction.gate).toBe('hold');
    expect(z).toBeGreaterThan(0);
  });

  it('conviction is earned across REPEATED coherent runs — then Axis 17 acts', () => {
    let z = 0, acted = -1;
    for (let run = 0; run < 12; run++) {
      const out = runSpinePure([T(1, 1, 1), T(2, 1, 1), T(3, 1, 1)], z);
      z = out.z;
      if (out.prediction.act && acted < 0) acted = run;
    }
    expect(acted).toBeGreaterThan(0);   // not the first run — earned over time
  });

  it('one credible dissent flips a conviction-BUILDING run into a conviction-DRAINING one', () => {
    // Build some conviction first, then compare the same prior under a fully
    // coherent run vs one where Tier 3 dissents. The coherent run raises z; the
    // contested run LOWERS it — dissent doesn't merely dampen, it reverses the
    // sign of the update. (The raw φ² collapse/recover asymmetry is inherited
    // from stepAsymmetricZ and proven in recovery-asymmetric.test.ts; at the
    // spine level the strain is additionally throttled by lower agreement.)
    let z = 0;
    for (let i = 0; i < 5; i++) z = runSpinePure([T(1, 1, 1), T(2, 1, 1), T(3, 1, 1)], z).z;
    const coherent = runSpinePure([T(1, 1, 1), T(2, 1, 1), T(3, 1, 1)], z).z;
    const contested = runSpinePure([T(1, 1, 1), T(2, 1, 1), T(3, -1, 1)], z).z;
    expect(coherent).toBeGreaterThan(z);   // confirmation builds
    expect(contested).toBeLessThan(z);     // one dissent drains
  });

  it('a weak/split field barely moves κ — low agreement ⇒ tiny step', () => {
    const strong = runSpinePure([T(1, 1, 1), T(2, 1, 1), T(3, 1, 1)], 0).z;
    const weak = runSpinePure([T(1, 0.2, 0.2), T(2, 0.1, 0.2), T(3, 0.15, 0.2)], 0).z;
    expect(Math.abs(weak)).toBeLessThan(Math.abs(strong));
  });
});

describe('Axis 17 — the earned decision-collapse', () => {
  it('holds when a tier dissents, even if conviction were charged — dissent keeps the field open', () => {
    const field = holdField([T(1, 1, 1), T(2, 1, 1), T(3, -1, 1)]);
    const d = dissent(field);
    // Force a charged z artificially; the gate must STILL hold because contested.
    const p = axis17(field, d, ASYM_Z_MAX); // z well past the charged rail
    expect(p.act).toBe(false);
    expect(p.reason).toContain('dissent');
  });

  it('acts only when coherent AND charged AND no dissent', () => {
    const field = holdField([T(1, 1, 1), T(2, 0.9, 1), T(3, 0.8, 1)]);
    const d = dissent(field);
    expect(axis17(field, d, ASYM_Z_MAX).act).toBe(true);       // charged + coherent
    expect(axis17(field, d, 0).act).toBe(false);               // neutral κ → hold
  });

  it('an incoherent-but-uncontested field (all near zero) holds on low agreement', () => {
    const field = holdField([T(1, 0.01, 0.5), T(2, -0.01, 0.5), T(3, 0.01, 0.5)]);
    const d = dissent(field);
    const p = axis17(field, d, ASYM_Z_MAX);
    expect(p.act).toBe(false);
    expect(p.confidence).toBeLessThan(0.6);
  });

  it('the prediction is always PRODUCED even when it holds — direction + confidence + κ present', () => {
    const out = runSpinePure([T(1, 0.9, 1), T(2, 0.7, 0.8), T(3, 0.5, 0.6)], 0);
    expect(out.prediction.shadow).toBe(true);
    expect(Number.isFinite(out.prediction.direction)).toBe(true);
    expect(out.prediction.confidence).toBeGreaterThan(0);
    expect(out.prediction.kappa).toBeGreaterThan(0);
    expect(['act', 'hold']).toContain(out.prediction.gate);
  });
});

describe('the unification is literal — same κ machinery as the trading lane', () => {
  it('kappaOf is the asymmetric regulator logistic, and the charged rail matches recovery.ts', () => {
    expect(kappaOf(0)).toBeCloseTo(0.5, 12);
    // charged rail: z = (Z/φ²)/2 → κ ≈ 0.639
    expect(chargedKappa).toBeCloseTo(1 / (1 + Math.exp(-(ASYM_Z_MAX / (PHI * PHI) / 2))), 12);
    expect(chargedKappa).toBeGreaterThan(0.6);
    expect(chargedKappa).toBeLessThan(0.68);
  });
});

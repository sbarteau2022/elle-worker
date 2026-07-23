// Pure-logic tests for the blanket completeness scorer. No network, no D1.
import { describe, it, expect } from 'vitest';
import { completenessFromExtraction, type BlanketModel } from './observer-blanket';

const full: BlanketModel = {
  blankets: [
    { name: 'A', scale: 'institution', boundary_mechanism: 'credentials', internal_target_states: ['prestige'], defensive_behaviors: ['reject anomaly'], nested_within: 'B' },
    { name: 'B', scale: 'super_system', boundary_mechanism: 'polity', internal_target_states: ['stability'], defensive_behaviors: ['accept story'] },
    { name: 'C', scale: 'sub_organization', boundary_mechanism: 'capital', internal_target_states: ['solvency'], defensive_behaviors: ['hide debt'] },
  ],
  collisions: [{ sub_blanket_id: 'C', target_blanket_id: 'B', collision_mechanism: 'exports risk', risk_classification: 'structural_rupture', dissent_trough_signature: 'the anomaly' }],
  epistemic_suppression: { suppressed_signal: 's', beneficiary_blanket_id: 'A', cost_bearer_blanket_id: 'B' },
  systemic_alignment_verdict: { status: 'systemically_fragile', reasoning: 'why' },
};

describe('observer-blanket · completeness scorer', () => {
  it('a fully-specified extraction scores at/near 1', () => {
    expect(completenessFromExtraction(full)).toBeGreaterThan(0.95);
  });
  it('null / empty extraction scores 0', () => {
    expect(completenessFromExtraction(null)).toBe(0);
    expect(completenessFromExtraction({ blankets: [], collisions: [] })).toBe(0);
  });
  it('a thin model (one agent, no collision, no suppression) scores low', () => {
    const thin: BlanketModel = {
      blankets: [{ name: 'A', scale: 'institution', boundary_mechanism: 'x', internal_target_states: ['y'], defensive_behaviors: ['z'] }],
      collisions: [],
    };
    const s = completenessFromExtraction(thin);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(0.2);
  });
  it('blankets missing required fields do not count as well-formed', () => {
    const malformed: BlanketModel = {
      blankets: [{ name: 'A', scale: 'institution', boundary_mechanism: 'x', internal_target_states: [], defensive_behaviors: [] }],
      collisions: [{ collision_mechanism: 'm', risk_classification: 'institutional_capture' }],
    };
    // collision counts (0.20) but the blanket is not well-formed (0 from blankets)
    expect(completenessFromExtraction(malformed)).toBeCloseTo(0.20, 2);
  });
  it('is monotone — adding structure never lowers the score', () => {
    const base: BlanketModel = { blankets: [full.blankets[0]], collisions: [] };
    expect(completenessFromExtraction(full)).toBeGreaterThanOrEqual(completenessFromExtraction(base));
  });
});

// Pure-logic tests for the live-case logger. No network, no D1.
import { describe, it, expect } from 'vitest';
import { admissible, gatedFidelity, spearman, type GatedForecast, type ResolvedOutcome } from './observer-live';

describe('observer-live · admissibility firewall', () => {
  it('admits an open, post-cutoff case', () => {
    const r = admissible('2024-06-01', '2026-03-01', '2026-09-01');
    expect(r.ok).toBe(true);
  });
  it('rejects a case whose t0 precedes the training cutoff (memory risk)', () => {
    const r = admissible('2024-06-01', '2023-05-01', '2023-11-01');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/cutoff/);
  });
  it('rejects a case already decided at t0 (resolution not in the future)', () => {
    const r = admissible('2024-06-01', '2026-03-01', '2026-02-01');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/future/);
  });
});

describe('observer-live · gated fidelity', () => {
  const names = new Set(['Depositors', 'Regulator']);
  const forecasts: GatedForecast[] = [
    { predicted_change: 'deposit flight accelerates into a run', driving_agent: 'Depositors', prob: 0.6 },
    { predicted_change: 'regulator opens an emergency backstop line', driving_agent: 'Regulator', prob: 0.4 },
  ];
  it('credits a forecast only when driver AND prose match an occurred outcome', () => {
    const outcomes: ResolvedOutcome[] = [
      { description: 'deposit flight into a run', occurred: true, driving_agent: 'Depositors' },
      { description: 'regulator emergency backstop line opened', occurred: true, driving_agent: 'Regulator' },
    ];
    expect(gatedFidelity(names, forecasts, outcomes)).toBeCloseTo(1, 6);
  });
  it('ignores outcomes whose driver was never modelled (the gate keeps recall out)', () => {
    // driver 'Board' is not in the topology -> not gated truth -> zero, not credited
    const outcomes: ResolvedOutcome[] = [{ description: 'board ousts founder', occurred: true, driving_agent: 'Board' }];
    expect(gatedFidelity(names, forecasts, outcomes)).toBe(0);
  });
  it('does not credit an outcome that did not occur', () => {
    const outcomes: ResolvedOutcome[] = [{ description: 'deposit flight into a run', occurred: false, driving_agent: 'Depositors' }];
    expect(gatedFidelity(names, forecasts, outcomes)).toBe(0);
  });
});

describe('observer-live · spearman', () => {
  it('perfectly monotone series correlates at +1', () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 6);
  });
  it('perfectly anti-monotone series correlates at -1', () => {
    expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1, 6);
  });
  it('a single point yields 0 (undefined rank correlation)', () => {
    expect(spearman([1], [1])).toBe(0);
  });
});

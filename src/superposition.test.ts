import { describe, it, expect } from 'vitest';
import { createSuperposition } from './superposition';

// Drive the valve with a constant signed velocity for n steps.
function drive(v: number, n: number, pert = 0.2) {
  const sp = createSuperposition();
  let last = sp.state();
  for (let i = 0; i < n; i++) last = sp.observe({ kappa: 0.5, velocity: v, input_perturbation: pert });
  return { sp, last };
}

describe('superposition valve (mirrors holding.ts)', () => {
  it('accumulates drift and forms a bounded loss < e−1', () => {
    const { last } = drive(1, 60);
    expect(last.drift).toBeGreaterThan(0);
    expect(last.loss!).toBeGreaterThan(0);
    expect(last.loss!).toBeLessThan(Math.E - 1);
    expect(last.status).toBe('strained');
  });
  it('signed drift carries direction; unsigned drift does not', () => {
    const up = drive(1, 60).last;
    const down = drive(-1, 60).last;
    expect(up.driftSigned).toBeGreaterThan(0);
    expect(down.driftSigned).toBeLessThan(0);
    expect(up.drift).toBeGreaterThan(0);
    expect(down.drift).toBeGreaterThan(0); // unsigned strain is positive either way
  });
});

describe('collapse decision (derived from the one valve)', () => {
  it('RULE 0 hard-stops regardless of κ', () => {
    const { sp } = drive(1, 60);
    const d = sp.decideCollapse('LONG', 60, -1.5, 0.0);
    expect(d.action).toBe('HARD_STOP');
    expect(d.to).toBe('FLAT');
  });
  it('collapses LONG when the valve is strained and net-coherent up', () => {
    const { sp } = drive(1, 60);
    const d = sp.decideCollapse('SUPERPOSITION', 60, 0, 0.0, 'momentum');
    expect(d.action).toBe('COLLAPSE');
    expect(d.to).toBe('LONG');
  });
  it('does NOT collapse SHORT on adverse drift in a mean-reversion regime', () => {
    const { sp } = drive(-1, 60);
    const d = sp.decideCollapse('SUPERPOSITION', 60, 0, 0.0, 'meanrev');
    expect(d.to).not.toBe('SHORT');
  });
  it('resolves an unresolved window to FLAT', () => {
    const { sp } = drive(0, 4, 0.3); // tension up, ~no drift → not strained
    const d = sp.decideCollapse('SUPERPOSITION', 8, 0, 0.0);
    expect(d.action).toBe('COLLAPSE');
    expect(d.to).toBe('FLAT');
  });
});

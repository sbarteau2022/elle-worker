import { describe, it, expect } from 'vitest';
import { superpositionStop, DEFAULT_STOP_CONFIG, type Posture } from './superposition-stop';

const cfg = DEFAULT_STOP_CONFIG;

describe('superpositionStop — RULE 0 (outside κ, first)', () => {
  it('HARD_STOP when the risk-unit floor is hit, regardless of κ', () => {
    const d = superpositionStop('LONG', [0.9, 0.92, 0.95], 3, -1.2, 0.0);
    expect(d.action).toBe('HARD_STOP');
    expect(d.to).toBe('FLAT');
  });
  it('HARD_STOP when the theta budget is spent', () => {
    const d = superpositionStop('SUPERPOSITION', [0.5, 0.5], 2, 0, 0.35);
    expect(d.action).toBe('HARD_STOP');
  });
});

describe('superpositionStop — superposition resolution', () => {
  it('collapses LONG on sustained coherence above the high band', () => {
    const d = superpositionStop('SUPERPOSITION', [0.5, 0.6, 0.7, 0.8], 4, 0, 0.0, 'momentum');
    expect(d.action).toBe('COLLAPSE');
    expect(d.to).toBe('LONG');
  });
  it('resolves to FLAT when the observation window elapses unresolved', () => {
    const d = superpositionStop('SUPERPOSITION', [0.5, 0.5, 0.5, 0.5], cfg.maxHoldSteps, 0, 0.0);
    expect(d.action).toBe('COLLAPSE');
    expect(d.to).toBe('FLAT');
  });
  it('holds both legs while ambiguous', () => {
    const d = superpositionStop('SUPERPOSITION', [0.5, 0.51, 0.49], 2, 0, 0.0);
    expect(d.action).toBe('HOLD');
    expect(d.to).toBe('SUPERPOSITION');
  });
  it('does NOT collapse short on adverse κ in a mean-reversion regime', () => {
    const d = superpositionStop('SUPERPOSITION', [0.5, 0.4, 0.3, 0.2], 4, 0, 0.0, 'meanrev');
    expect(d.to).not.toBe('SHORT');
  });
});

describe('superpositionStop — directional trailing stop', () => {
  it('collapses a LONG to FLAT when κ de-phases below the low band (momentum)', () => {
    const d = superpositionStop('LONG', [0.7, 0.5, 0.4, 0.3], 4, -0.2, 0.0, 'momentum');
    expect(d.action).toBe('COLLAPSE');
    expect(d.to).toBe('FLAT');
  });
  it('holds a directional thesis while κ stays coherent', () => {
    const d = superpositionStop('LONG', [0.7, 0.75, 0.8], 3, 0.1, 0.0, 'momentum');
    expect(d.action).toBe('HOLD');
  });
});

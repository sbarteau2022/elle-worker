import { describe, it, expect } from 'vitest';
import { retention, decayedWeight, capturedResonanceScan, RETENTION_BASE, type MemEdge } from './graph';

const PHI = (1 + Math.sqrt(5)) / 2;

describe('retention / decay (φ⁻ⁿ envelope)', () => {
  it('RETENTION_BASE is φ and retention is φ⁻ⁿ', () => {
    expect(RETENTION_BASE).toBeCloseTo(PHI, 12);
    expect(retention(0)).toBe(1);
    expect(retention(1)).toBeCloseTo(1 / PHI, 9);
    expect(retention(2)).toBeCloseTo(Math.pow(PHI, -2), 9);
  });
  it('decays one cycle by φ⁻¹ and prunes below the floor', () => {
    expect(decayedWeight(1, 1)).toBeCloseTo(1 / PHI, 4);
    // 4 · φ⁻⁵ ≈ 0.36 stays; a small idle edge falls under the floor → 0
    expect(decayedWeight(0.1, 3, 0.05)).toBe(0);
    expect(decayedWeight(4, 1, 0.05)).toBeGreaterThan(0);
  });
  it('a re-earned edge keeps its weight; a monotone bump alone would not decay', () => {
    // 10 idle cycles collapse even a capped edge toward nothing
    expect(decayedWeight(4, 10, 0.05)).toBe(0);
  });
});

const e = (src: string, dst: string, weight: number, kind: MemEdge['kind'] = 'assoc'): MemEdge => ({ src, dst, kind, weight });

describe('capturedResonanceScan', () => {
  it('flags a well-connected node whose weight concentrates on one neighbor', () => {
    // hub h: one runaway edge (weight 4) plus three faint ones — dominance high
    const edges = [e('h', 'hot', 4), e('h', 'a', 0.2), e('h', 'b', 0.2), e('h', 'c', 0.2)];
    const flags = capturedResonanceScan(edges, { threshold: 0.6, minDegree: 3 });
    expect(flags.length).toBeGreaterThanOrEqual(1);
    const h = flags.find((f) => f.node === 'h')!;
    expect(h).toBeTruthy();
    expect(h.top).toBe('hot');
    expect(h.dominance).toBeCloseTo(4 / 4.6, 3);
  });
  it('does not flag a balanced node', () => {
    const edges = [e('n', 'a', 1), e('n', 'b', 1), e('n', 'c', 1), e('n', 'd', 1)];
    expect(capturedResonanceScan(edges, { threshold: 0.6, minDegree: 3 }).some((f) => f.node === 'n')).toBe(false);
  });
  it('ignores low-degree nodes and self-loops', () => {
    const edges = [e('x', 'x', 9), e('x', 'y', 1)];
    expect(capturedResonanceScan(edges).length).toBe(0);
  });
});

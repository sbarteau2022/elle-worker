// The Observer falsifier's self-test: the proof that the gate can come back
// NULL. Pure — no network, no D1, deterministic (seeded).
import { describe, it, expect } from 'vitest';
import { falsify, syntheticPairs, spearman, overlapMatch, POWER_FLOOR } from './observer-falsifier';

describe('observer-falsifier · the gate can return NULL', () => {
  it('PASS when coherence genuinely predicts accuracy (coupled)', () => {
    const r = falsify(syntheticPairs('coupled', 40, 1), { seed: 7 });
    expect(r.verdict).toBe('PASS');
    expect(r.rho).toBeGreaterThan(0);
    expect(r.p).toBeLessThan(r.alpha);
  });
  it('NULL on pure noise — coherence and accuracy independent', () => {
    const r = falsify(syntheticPairs('noise', 40, 2), { seed: 7 });
    expect(r.verdict).toBe('NULL');
  });
  it('NULL when a genuine coupling is shuffled away (permutation control)', () => {
    const r = falsify(syntheticPairs('shuffled', 40, 3), { seed: 7 });
    expect(r.verdict).toBe('NULL');
  });
  it('UNDERPOWERED below the floor — never a verdict on too little data', () => {
    const r = falsify(syntheticPairs('coupled', POWER_FLOOR - 1, 4), { seed: 7 });
    expect(r.verdict).toBe('UNDERPOWERED');
    expect(r.rho).toBeNull();
    expect(r.p).toBeNull();
  });
  it('is deterministic — same pairs and seed give the same verdict', () => {
    const pairs = syntheticPairs('coupled', 30, 5);
    expect(falsify(pairs, { seed: 9 })).toEqual(falsify(pairs, { seed: 9 }));
  });
});

describe('observer-falsifier · primitives', () => {
  it('spearman is +1 for a monotone-increasing pairing', () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 6);
  });
  it('spearman is -1 for a monotone-decreasing pairing', () => {
    expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1, 6);
  });
  it('overlapMatch: identical prose ~1, disjoint ~0', () => {
    const s = 'the doctrine was rejected for decades before vindication by germ theory';
    expect(overlapMatch(s, s)).toBeCloseTo(1, 6);
    expect(overlapMatch('continental drift matched coastlines fossils', 'securitization dispersed mortgage risk nationally')).toBe(0);
  });
});

// Pure-logic tests for The Lattice: axis roster integrity (32 axes total —
// 7 Seed of Life + 12 Flower of Life + 11 Fruit of Life, then Validation and
// The Reckoning as axes 31-32) and that the vocabulary bridging into
// security-network.ts / signal-collapse.ts is actually present in The
// Reckoning's own instructions. No network, no D1 — same convention as
// falcon.test.ts.
import { describe, it, expect } from 'vitest';
import { SEED_AXES, FLOWER_AXES, FRUIT_AXES } from './lattice';

describe('the lattice · the axis roster', () => {
  it('seven axes in the Seed of Life, twelve in the Flower of Life, eleven in the Fruit of Life', () => {
    expect(SEED_AXES).toHaveLength(7);
    expect(FLOWER_AXES).toHaveLength(12);
    expect(FRUIT_AXES).toHaveLength(11);
  });
  it('7 + 12 + 11 = 30, leaving 31 (Validation) and 32 (The Reckoning) for the closing pair', () => {
    expect(SEED_AXES.length + FLOWER_AXES.length + FRUIT_AXES.length).toBe(30);
  });
  it('numbered 1-30 with no gaps or duplicates, in layer order', () => {
    const all = [...SEED_AXES, ...FLOWER_AXES, ...FRUIT_AXES];
    expect(all.map((a) => a.n)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  });
  it('unique ids across all three layers', () => {
    const all = [...SEED_AXES, ...FLOWER_AXES, ...FRUIT_AXES];
    expect(new Set(all.map((a) => a.id)).size).toBe(all.length);
  });
  it('every axis carries a real system prompt instructing JSON-only output', () => {
    for (const a of [...SEED_AXES, ...FLOWER_AXES, ...FRUIT_AXES]) {
      expect(a.system.length).toBeGreaterThan(80);
      expect(a.system).toMatch(/Respond ONLY with valid JSON/);
    }
  });
  it('tier field matches which array the axis is in', () => {
    expect(SEED_AXES.every((a) => a.tier === 1)).toBe(true);
    expect(FLOWER_AXES.every((a) => a.tier === 2)).toBe(true);
    expect(FRUIT_AXES.every((a) => a.tier === 3)).toBe(true);
  });
  it('the seventh Seed axis is Duality — the deliberate counterweight built into the ring count itself', () => {
    expect(SEED_AXES[6].id).toBe('duality');
  });
  it('the Flower layer includes a Doctrine Match axis that cross-references the existing SECURITY_DECK vocabulary', () => {
    const doctrineAxis = FLOWER_AXES.find((a) => a.id === 'doctrine_match');
    expect(doctrineAxis).toBeDefined();
    expect(doctrineAxis?.system).toMatch(/SECURITY_DECK/);
  });
});

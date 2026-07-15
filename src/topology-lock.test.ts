import { describe, it, expect } from 'vitest';
import { linkingNumber, writhe, hopfLink, unlinkedCircles, stabilityCheck, topologySelfTest, type Curve } from './topology-lock';

describe('linkingNumber — proven against a known, textbook fact, not asserted', () => {
  it('the Hopf link (two circles, each threaded through the other once) has linking number exactly ±1', () => {
    const { a, b } = hopfLink();
    const raw = linkingNumber(a, b);
    expect(Math.abs(raw)).toBeGreaterThan(0.95);
    expect(Math.abs(raw)).toBeLessThan(1.05);
    expect(Math.round(Math.abs(raw))).toBe(1);
  });

  it('two disjoint circles have linking number exactly 0', () => {
    const { a, b } = unlinkedCircles();
    expect(Math.abs(linkingNumber(a, b))).toBeLessThan(0.01);
  });

  it('linking number is symmetric: Lk(a,b) = Lk(b,a)', () => {
    const { a, b } = hopfLink();
    expect(linkingNumber(a, b)).toBeCloseTo(linkingNumber(b, a), 3);
  });

  it('is invariant under a continuous rigid rotation (ambient isotopy) — the whole point', () => {
    const { a, b } = hopfLink();
    const before = linkingNumber(a, b);
    const theta = 0.7;
    const rotated: Curve = b.map(([x, y, z]) => [
      x * Math.cos(theta) - z * Math.sin(theta), y, x * Math.sin(theta) + z * Math.cos(theta),
    ]);
    const after = linkingNumber(a, rotated);
    expect(after).toBeCloseTo(before, 2); // rotation is a continuous deformation — the invariant must not move
  });
});

describe('stabilityCheck — the honest guarantee', () => {
  it('flags real entanglement (Hopf link) as entangled', () => {
    const { a, b } = hopfLink();
    expect(stabilityCheck(a, b).entangled).toBe(true);
  });

  it('clears genuine independence (disjoint circles) as not entangled', () => {
    const { a, b } = unlinkedCircles();
    expect(stabilityCheck(a, b).entangled).toBe(false);
  });
});

describe('writhe — self-linking of a single curve', () => {
  it('a flat planar circle has ~zero writhe (no self-twisting)', () => {
    const flat: Curve = Array.from({ length: 200 }, (_, i) => {
      const t = (i / 200) * 2 * Math.PI;
      return [Math.cos(t), Math.sin(t), 0] as [number, number, number];
    });
    expect(Math.abs(writhe(flat))).toBeLessThan(0.05);
  });
});

describe('topologySelfTest — the whole certificate green', () => {
  it('reproduces the Hopf link fact and the disjoint-circle negative control', () => {
    const st = topologySelfTest();
    expect(st.hopf_link_is_one).toBe(true);
    expect(st.unlinked_is_zero).toBe(true);
    expect(st.stability_flags_entanglement).toBe(true);
    expect(st.stability_clears_independence).toBe(true);
    expect(st.ok).toBe(true);
  });
});

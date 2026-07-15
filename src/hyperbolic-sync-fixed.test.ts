import { describe, it, expect } from 'vitest';
import {
  fMobiusAdd, fHyperDistance, fGeodesicStep, fAdvancePoint, quantizeFPoint,
  initHypFixedChannel, hypFixedStart, hypFixedAdvance, hypFixedSeal, hypFixedOpen,
  hyperbolicSyncFixedSelfTest, type FPoint,
} from './hyperbolic-sync-fixed';
import { toFixed, toFloat } from './fixed-math';
import { mobiusAdd, hyperDistance, geodesicStep } from './hyperbolic-sync';
import { seal } from './helix';

const fp = (x: number, y: number): FPoint => [toFixed(x), toFixed(y)];
const toFloatPoint = (p: FPoint): [number, number] => [toFloat(p[0]), toFloat(p[1])];

describe('fMobiusAdd — matches the floating version numerically', () => {
  it('agrees with mobiusAdd across several point pairs', () => {
    const cases: [FPoint, FPoint][] = [
      [fp(0.2, -0.3), fp(0.1, 0.15)],
      [fp(0, 0), fp(0.4, -0.2)],
      [fp(0.5, 0.3), fp(-0.5, 0.3)],
      [fp(-0.6, 0.1), fp(0.05, -0.05)],
    ];
    for (const [x, y] of cases) {
      const fixed = toFloatPoint(fMobiusAdd(x, y));
      const float = mobiusAdd(Float64Array.from([toFloat(x[0]), toFloat(x[1])]), Float64Array.from([toFloat(y[0]), toFloat(y[1])]));
      expect(fixed[0]).toBeCloseTo(float[0], 4);
      expect(fixed[1]).toBeCloseTo(float[1], 4);
    }
  });
  it('0 ⊕ x = x and (−x) ⊕ x ≈ 0 (the group identities)', () => {
    const x = fp(0.2, -0.3);
    const zero: FPoint = [0, 0];
    const r1 = fMobiusAdd(zero, x);
    expect(toFloat(r1[0])).toBeCloseTo(0.2, 5);
    expect(toFloat(r1[1])).toBeCloseTo(-0.3, 5);
    const r2 = fMobiusAdd([-x[0], -x[1]], x);
    expect(toFloat(r2[0])).toBeCloseTo(0, 5);
    expect(toFloat(r2[1])).toBeCloseTo(0, 5);
  });
});

describe('fHyperDistance — matches the floating version within CORDIC range', () => {
  it('agrees with hyperDistance for modest-magnitude points', () => {
    const x = fp(0.2, -0.1), y = fp(0.05, 0.15);
    const fixed = fHyperDistance(x, y);
    const float = hyperDistance(Float64Array.from([0.2, -0.1]), Float64Array.from([0.05, 0.15]));
    expect(toFloat(fixed)).toBeCloseTo(float, 3);
  });
});

describe('fGeodesicStep — matches the floating version', () => {
  it('agrees with geodesicStep for a representative direction and step', () => {
    const p = fp(0.2, -0.1);
    const u = fp(0.6, 0.8); // already a unit vector, matches the float test's fixture
    const fixed = toFloatPoint(fGeodesicStep(p, u, toFixed(0.5)));
    const float = geodesicStep(Float64Array.from([0.2, -0.1]), Float64Array.from([0.6, 0.8]), 0.5);
    expect(fixed[0]).toBeCloseTo(float[0], 3);
    expect(fixed[1]).toBeCloseTo(float[1], 3);
  });
});

describe('fAdvancePoint — the deterministic bounded walk', () => {
  it('is bit-for-bit repeatable', () => {
    const p = fp(0.1, 0.05);
    const a = fAdvancePoint(p, 1, toFixed(0.3));
    const b = fAdvancePoint(p, 1, toFixed(0.3));
    expect(a).toEqual(b);
  });
  it('stays bounded away from the boundary over a long run', () => {
    let p: FPoint = fp(0.1, 0.05);
    let maxR = 0;
    for (let n = 1; n <= 3000; n++) {
      p = fAdvancePoint(p, n, toFixed(0.3));
      const r = Math.hypot(toFloat(p[0]), toFloat(p[1]));
      maxR = Math.max(maxR, r);
    }
    expect(maxR).toBeLessThan(0.95);
  });
});

describe('quantizeFPoint', () => {
  it('produces 8 deterministic bytes (full 32-bit precision per dimension)', () => {
    const p = fp(0.25, -0.5);
    expect(quantizeFPoint(p).length).toBe(8);
    expect(Array.from(quantizeFPoint(p))).toEqual(Array.from(quantizeFPoint(p)));
  });
});

describe('hyperbolic-sync-fixed — counter-free transport, bit-exact', () => {
  const master = new Uint8Array(32).fill(6);

  it('round-trips in lock-step', async () => {
    const ch = await initHypFixedChannel(master);
    let s = hypFixedStart(ch), r = hypFixedStart(ch);
    const td = new TextDecoder();
    for (const m of ['alpha', 'beta', 'z'.repeat(200)]) {
      const o = await hypFixedSeal(ch, s, new TextEncoder().encode(m)); s = o.next;
      const d = await hypFixedOpen(ch, r, o.wire, 8); r = d.next;
      expect(td.decode(d.plaintext)).toBe(m);
    }
  });

  it('re-locks after dropped messages inside the window', async () => {
    const ch = await initHypFixedChannel(master);
    let s = hypFixedStart(ch); for (let i = 0; i < 5; i++) s = hypFixedAdvance(ch, s);
    const w = (await hypFixedSeal(ch, s, new TextEncoder().encode('resync'))).wire;
    let r = hypFixedStart(ch); for (let i = 0; i < 2; i++) r = hypFixedAdvance(ch, r);
    const d = await hypFixedOpen(ch, r, w, 8);
    expect(new TextDecoder().decode(d.plaintext)).toBe('resync');
    expect(d.next.tick).toBe(6);
  });

  it('refuses loss beyond the window', async () => {
    const ch = await initHypFixedChannel(master);
    let s = hypFixedStart(ch); for (let i = 0; i < 20; i++) s = hypFixedAdvance(ch, s);
    const w = (await hypFixedSeal(ch, s, new TextEncoder().encode('far'))).wire;
    await expect(hypFixedOpen(ch, hypFixedStart(ch), w, 4)).rejects.toThrow();
  });

  it('is forward-only — a past-tick frame is never re-opened', async () => {
    const ch = await initHypFixedChannel(master);
    let s3 = hypFixedStart(ch); for (let i = 0; i < 3; i++) s3 = hypFixedAdvance(ch, s3);
    let r10 = hypFixedStart(ch); for (let i = 0; i < 10; i++) r10 = hypFixedAdvance(ch, r10);
    const w = (await hypFixedSeal(ch, s3, new TextEncoder().encode('old'))).wire;
    await expect(hypFixedOpen(ch, r10, w, 8)).rejects.toThrow();
  });

  it('puts no counter on the wire', async () => {
    const ch = await initHypFixedChannel(master);
    const pt = new TextEncoder().encode('identical');
    const wire = (await hypFixedSeal(ch, hypFixedStart(ch), pt)).wire;
    const plain = await seal(new Uint8Array(32).fill(1), pt, { exact: true });
    expect(wire.length).toBe(plain.length);
  });

  it('rejects the wrong master and derives a secret geodesic', async () => {
    const ch = await initHypFixedChannel(master);
    const chOther = await initHypFixedChannel(new Uint8Array(32).fill(9));
    const w = (await hypFixedSeal(ch, hypFixedStart(ch), new TextEncoder().encode('secret'))).wire;
    await expect(hypFixedOpen(chOther, hypFixedStart(chOther), w, 8)).rejects.toThrow();
    expect(ch.origin).not.toEqual(chOther.origin);
  });
});

describe('hyperbolicSyncFixedSelfTest — end-to-end invariant check', () => {
  it('passes every invariant, including bit-exact repeatability', async () => {
    const r = await hyperbolicSyncFixedSelfTest();
    expect(r.roundtrip).toBe(true);
    expect(r.resync_after_loss).toBe(true);
    expect(r.beyond_window_rejected).toBe(true);
    expect(r.rewind_rejected).toBe(true);
    expect(r.no_counter_overhead).toBe(true);
    expect(r.wrong_master_rejected).toBe(true);
    expect(r.secret_geodesic).toBe(true);
    expect(r.bit_exact_repeatable).toBe(true);
    expect(r.ok).toBe(true);
  });
});

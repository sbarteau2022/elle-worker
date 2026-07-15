import { describe, it, expect } from 'vitest';
import {
  mobiusAdd, hyperDistance, geodesicStep, advancePoint, quantizePoint,
  initHypChannel, hypStart, hypAdvance, hypSeal, hypOpen, hyperbolicSyncSelfTest,
} from './hyperbolic-sync';
import { seal } from './helix';

const v = (a: number, b: number) => Float64Array.from([a, b]);
const norm = (p: Float64Array) => Math.hypot(p[0], p[1]);

describe('Poincaré-disk primitives (hyperbolic identities)', () => {
  it('0 ⊕ x = x and (−x) ⊕ x = 0', () => {
    const x = v(0.2, -0.3);
    expect(Array.from(mobiusAdd(v(0, 0), x))).toEqual(Array.from(x));
    expect(norm(mobiusAdd(v(-0.2, 0.3), x))).toBeLessThan(1e-12);
  });
  it('d(0, x) = 2·artanh|x|', () => {
    const x = v(0.4, 0.1);
    expect(hyperDistance(v(0, 0), x)).toBeCloseTo(2 * Math.atanh(norm(x)), 10);
  });
  it('a geodesic step moves exactly its arc-length, from any base point', () => {
    for (const p of [v(0, 0), v(0.3, 0.2), v(-0.5, 0.4)]) {
      const q = geodesicStep(p, v(0.6, 0.8), 0.7);
      expect(hyperDistance(p, q)).toBeCloseTo(0.7, 9);
    }
  });
  it('quantizePoint maps the disk to 16-bit-per-dim material', () => {
    expect(quantizePoint(v(0, 0)).length).toBe(4);
    const dv = new DataView(quantizePoint(v(0, 0)).buffer);
    expect(dv.getUint16(0, false)).toBe(32768); // 0 → mid-range
  });
});

describe('the hyperbolic walk', () => {
  it('is deterministic and stays bounded away from the boundary', () => {
    let p: Float64Array = v(0.1, 0.05);
    let maxr = 0;
    for (let n = 1; n <= 3000; n++) { p = advancePoint(p, n, 0.3); maxr = Math.max(maxr, norm(p)); }
    expect(maxr).toBeLessThan(0.999);
    // determinism: recomputing a step gives the identical point
    expect(Array.from(advancePoint(v(0.1, 0.05), 1, 0.3))).toEqual(Array.from(advancePoint(v(0.1, 0.05), 1, 0.3)));
  });
});

describe('hyperbolic-geodesic sync — counter-free transport over COROS', () => {
  const master = new Uint8Array(32).fill(4);

  it('round-trips in lock-step', async () => {
    const ch = await initHypChannel(master);
    let s = hypStart(ch), r = hypStart(ch);
    const td = new TextDecoder();
    for (const m of ['alpha', 'beta', 'gamma', 'z'.repeat(300)]) {
      const o = await hypSeal(ch, s, new TextEncoder().encode(m)); s = o.next;
      const d = await hypOpen(ch, r, o.wire, 8); r = d.next;
      expect(td.decode(d.plaintext)).toBe(m);
    }
  });

  it('re-locks after dropped messages inside the window', async () => {
    const ch = await initHypChannel(master);
    let s = hypStart(ch); for (let i = 0; i < 5; i++) s = hypAdvance(ch, s);
    const w = (await hypSeal(ch, s, new TextEncoder().encode('resync'))).wire;
    let r = hypStart(ch); for (let i = 0; i < 2; i++) r = hypAdvance(ch, r);
    const d = await hypOpen(ch, r, w, 8);
    expect(new TextDecoder().decode(d.plaintext)).toBe('resync');
    expect(d.next.tick).toBe(6);
  });

  it('refuses loss beyond the window', async () => {
    const ch = await initHypChannel(master);
    let s = hypStart(ch); for (let i = 0; i < 20; i++) s = hypAdvance(ch, s);
    const w = (await hypSeal(ch, s, new TextEncoder().encode('far'))).wire;
    await expect(hypOpen(ch, hypStart(ch), w, 4)).rejects.toThrow();
  });

  it('is forward-only — a past-tick frame is never re-opened', async () => {
    const ch = await initHypChannel(master);
    let s3 = hypStart(ch); for (let i = 0; i < 3; i++) s3 = hypAdvance(ch, s3);
    let r10 = hypStart(ch); for (let i = 0; i < 10; i++) r10 = hypAdvance(ch, r10);
    const w = (await hypSeal(ch, s3, new TextEncoder().encode('old'))).wire;
    await expect(hypOpen(ch, r10, w, 8)).rejects.toThrow();
  });

  it('puts no counter on the wire (sync frame == plain COROS frame size)', async () => {
    const ch = await initHypChannel(master);
    const pt = new TextEncoder().encode('identical');
    const wire = (await hypSeal(ch, hypStart(ch), pt)).wire;
    // a plain COROS exact frame of the same payload, for the size comparison
    const plain = await seal(new Uint8Array(32).fill(1), pt, { exact: true });
    expect(wire.length).toBe(plain.length);
  });

  it('rejects the wrong master and derives a secret (master-dependent) geodesic', async () => {
    const ch = await initHypChannel(master);
    const chOther = await initHypChannel(new Uint8Array(32).fill(9));
    const w = (await hypSeal(ch, hypStart(ch), new TextEncoder().encode('secret'))).wire;
    await expect(hypOpen(chOther, hypStart(chOther), w, 8)).rejects.toThrow();
    expect(Array.from(ch.origin)).not.toEqual(Array.from(chOther.origin));
  });
});

describe('hyperbolicSyncSelfTest — end-to-end invariant check', () => {
  it('passes every invariant', async () => {
    const r = await hyperbolicSyncSelfTest();
    expect(r.primitives).toBe(true);
    expect(r.bounded).toBe(true);
    expect(r.roundtrip).toBe(true);
    expect(r.resync_after_loss).toBe(true);
    expect(r.beyond_window_rejected).toBe(true);
    expect(r.rewind_rejected).toBe(true);
    expect(r.no_counter_overhead).toBe(true);
    expect(r.wrong_master_rejected).toBe(true);
    expect(r.secret_geodesic).toBe(true);
    expect(r.ok).toBe(true);
  });
});

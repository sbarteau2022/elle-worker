import { describe, it, expect } from 'vitest';
import {
  generalizedGolden, windingVector, phaseAt, quantizePhase,
  initChannel, keyAt, syncSeal, syncOpen, torusSyncSelfTest, type SyncState,
} from './torus-sync';
import { seal } from './helix';

describe('generalized golden ratio (the D-dimensional corkscrew)', () => {
  it('reduces to φ at D=1', () => {
    expect(generalizedGolden(1)).toBeCloseTo(1.6180339887, 8);
    expect(windingVector(1)[0]).toBeCloseTo(0.6180339887, 8);
  });
  it('solves x^{D+1} = x + 1 for higher D', () => {
    for (const D of [2, 3, 4]) {
      const g = generalizedGolden(D);
      expect(Math.pow(g, D + 1)).toBeCloseTo(g + 1, 6);
    }
  });
});

describe('phaseAt — the winding (pure, equidistributed, never-repeating)', () => {
  const origin = new Float64Array([0.1, 0.2, 0.3]);
  const alpha = windingVector(3);

  it('is deterministic and lives in [0,1)^D', () => {
    for (let n = 0; n < 20; n++) {
      const p = phaseAt(origin, alpha, n);
      for (const v of p) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
      expect(Array.from(phaseAt(origin, alpha, n))).toEqual(Array.from(p));
    }
  });
  it('equidistributes — each dimension averages toward 1/2', () => {
    const N = 4000; const sum = new Float64Array(3);
    for (let n = 0; n < N; n++) { const p = phaseAt(origin, alpha, n); for (let i = 0; i < 3; i++) sum[i] += p[i]; }
    for (let i = 0; i < 3; i++) expect(Math.abs(sum[i] / N - 0.5)).toBeLessThan(0.02);
  });
  it('quantizes to per-dimension u32 byte material', () => {
    expect(quantizePhase(new Float64Array([0, 0.5])).length).toBe(8);
    const dv = new DataView(quantizePhase(new Float64Array([0.5])).buffer);
    expect(dv.getUint32(0, false)).toBe(0x80000000);
  });
});

describe('torus sync — counter-free transport over COROS', () => {
  const master = new Uint8Array(32).fill(3);

  it('round-trips in lock-step across several messages', async () => {
    const ch = await initChannel(master, 3);
    let s: SyncState = { tick: 0 }; let r: SyncState = { tick: 0 };
    const td = new TextDecoder();
    for (const m of ['alpha', 'beta', 'gamma', 'z'.repeat(400)]) {
      const wire = await syncSeal(ch, s.tick, new TextEncoder().encode(m)); s = { tick: s.tick + 1 };
      const o = await syncOpen(ch, r, wire, 8); r = o.next;
      expect(td.decode(o.plaintext)).toBe(m);
    }
  });

  it('re-locks after dropped messages inside the window', async () => {
    const ch = await initChannel(master, 2);
    const wire = await syncSeal(ch, 5, new TextEncoder().encode('resync'));
    const o = await syncOpen(ch, { tick: 2 }, wire, 8); // receiver lagged by 3
    expect(new TextDecoder().decode(o.plaintext)).toBe('resync');
    expect(o.next.tick).toBe(6);
  });

  it('refuses loss beyond the window (re-acquisition needed)', async () => {
    const ch = await initChannel(master, 2);
    const wire = await syncSeal(ch, 20, new TextEncoder().encode('far'));
    await expect(syncOpen(ch, { tick: 0 }, wire, 4)).rejects.toThrow();
  });

  it('is forward-only — a past-tick message is never re-opened (rewind guard)', async () => {
    const ch = await initChannel(master, 2);
    const wire = await syncSeal(ch, 3, new TextEncoder().encode('old'));
    await expect(syncOpen(ch, { tick: 10 }, wire, 8)).rejects.toThrow();
  });

  it('puts no counter on the wire — a sync frame is the size of a plain COROS frame', async () => {
    const ch = await initChannel(master, 3);
    const pt = new TextEncoder().encode('identical');
    const wire = await syncSeal(ch, 0, pt);
    const plain = await seal(await keyAt(ch, 0), pt, { exact: true });
    expect(wire.length).toBe(plain.length);
  });

  it('rejects the wrong master and derives a secret (master-dependent) origin', async () => {
    const ch = await initChannel(master, 3);
    const chOther = await initChannel(new Uint8Array(32).fill(9), 3);
    const wire = await syncSeal(ch, 0, new TextEncoder().encode('secret'));
    await expect(syncOpen(chOther, { tick: 0 }, wire, 8)).rejects.toThrow();
    expect(Array.from(ch.origin)).not.toEqual(Array.from(chOther.origin));
  });
});

describe('torusSyncSelfTest — end-to-end invariant check', () => {
  it('passes every invariant', async () => {
    const r = await torusSyncSelfTest();
    expect(r.ok).toBe(true);
    expect(r.roundtrip).toBe(true);
    expect(r.resync_after_loss).toBe(true);
    expect(r.beyond_window_rejected).toBe(true);
    expect(r.rewind_rejected).toBe(true);
    expect(r.no_counter_overhead).toBe(true);
    expect(r.wrong_master_rejected).toBe(true);
    expect(r.secret_origin).toBe(true);
  });
});

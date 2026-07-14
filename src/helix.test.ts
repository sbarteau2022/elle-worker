import { describe, it, expect } from 'vitest';
import {
  PHI_INV, golden, goldenPad, xorBytes, BLOCK, LEN_PREFIX,
  seal, open, corosSelfTest,
} from './helix';

describe('golden — the corkscrew (equidistribution, determinism, non-repeat)', () => {
  it('is deterministic and lives in [0,1)', () => {
    for (let n = 0; n < 50; n++) {
      const v = golden(n);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(golden(n)).toBe(v); // deterministic
    }
  });
  it('equidistributes — the mean over many steps approaches 1/2 (homogeneity)', () => {
    let sum = 0; const N = 4000;
    for (let n = 0; n < N; n++) sum += golden(n, 0.123);
    expect(Math.abs(sum / N - 0.5)).toBeLessThan(0.02);
  });
  it('never repeats consecutively (φ is irrational, so no fixed period)', () => {
    const seen = new Set<number>();
    for (let n = 0; n < 1000; n++) seen.add(Math.round(golden(n) * 1e9));
    expect(seen.size).toBe(1000);
  });
  it('PHI_INV is 1/φ', () => {
    expect(PHI_INV).toBeCloseTo(0.6180339887, 9);
  });
});

describe('goldenPad — length band suppression', () => {
  it('always leaves room for the payload + length header, in whole blocks', () => {
    for (const L of [0, 1, 10, 200, 255, 256, 1000]) {
      const p = goldenPad(L, 7);
      expect(p).toBeGreaterThanOrEqual(L + LEN_PREFIX);
      expect(p % BLOCK).toBe(0);
    }
  });
  it('a 10-byte and a 200-byte payload can share a size band', () => {
    // same index → same golden jitter; both fit the first block → equal padded size
    expect(goldenPad(10, 3)).toBe(goldenPad(200, 3));
  });
});

describe('xorBytes', () => {
  it('is its own inverse', () => {
    const a = new Uint8Array([1, 2, 3, 250, 128]);
    const k = new Uint8Array([9, 9, 9, 9, 9]);
    expect(Array.from(xorBytes(xorBytes(a, k), k))).toEqual(Array.from(a));
  });
});

describe('seal / open — round-trip and the whole-or-nothing gate', () => {
  const master = new Uint8Array(32).fill(7);

  it('round-trips payloads of every shape, including empty and large', async () => {
    const te = new TextEncoder(); const td = new TextDecoder();
    for (const s of ['', 'a', 'the corkscrew winds but never closes', 'z'.repeat(1024)]) {
      const back = await open(master, await seal(master, te.encode(s)));
      expect(td.decode(back)).toBe(s);
    }
  });

  it('produces a different wire each call (random nonce) for the same plaintext', async () => {
    const pt = new TextEncoder().encode('same input');
    const w1 = await seal(master, pt);
    const w2 = await seal(master, pt);
    expect(Array.from(w1)).not.toEqual(Array.from(w2));
  });

  it('rejects a tampered wire wholesale (GCM tag — no partial decode)', async () => {
    const w = await seal(master, new TextEncoder().encode('sealed'));
    w[w.length - 5] ^= 0x80;
    await expect(open(master, w)).rejects.toThrow();
  });

  it('rejects the wrong key', async () => {
    const other = new Uint8Array(32).fill(9);
    const w = await seal(master, new TextEncoder().encode('sealed'));
    await expect(open(other, w)).rejects.toThrow();
  });

  it('hides exact length — the wire size is a constant band, not the payload length', async () => {
    const band = (n: number) => (n - 16 /*nonce*/ - 16 /*tag*/) % BLOCK;
    const wA = await seal(master, new Uint8Array(10));
    const wB = await seal(master, new Uint8Array(200));
    expect(band(wA.length)).toBe(0);
    expect(band(wB.length)).toBe(0);
  });
});

describe('corosSelfTest — the end-to-end invariant check', () => {
  it('passes every invariant', async () => {
    const r = await corosSelfTest();
    expect(r.ok).toBe(true);
    expect(r.roundtrips).toBe(4);
    expect(r.tamper_rejected).toBe(true);
    expect(r.wrong_key_rejected).toBe(true);
    expect(r.wire_band_ok).toBe(true);
  });
});

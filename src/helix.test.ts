import { describe, it, expect } from 'vitest';
import {
  PHI_INV, golden, goldenPad, xorBytes, BLOCK, LEN_PREFIX,
  seal, open, corosSelfTest,
  ratchetInit, ratchetStep, ratchetSeal, ratchetOpen,
  packFrames, coverFrame, unpackFrames, FRAME_PAYLOAD,
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

describe('forward ratchet — REGULATOR 1 (heal, homeostatic)', () => {
  const master = new Uint8Array(32).fill(11);

  it('sender and receiver walk in lock-step across many messages', async () => {
    let rs = await ratchetInit(master);
    let rr = await ratchetInit(master);
    const td = new TextDecoder();
    for (const m of ['a', 'bb', 'ccc', 'd'.repeat(300)]) {
      const s = await ratchetSeal(rs, new TextEncoder().encode(m)); rs = s.next;
      const o = await ratchetOpen(rr, s.wire); rr = o.next;
      expect(td.decode(o.plaintext)).toBe(m);
    }
  });

  it('advances one-way — each step yields a distinct message key and chain key', async () => {
    const r0 = await ratchetInit(master);
    const s1 = await ratchetStep(r0);
    const s2 = await ratchetStep(s1.next);
    expect(Array.from(s1.messageKey)).not.toEqual(Array.from(s2.messageKey));
    expect(Array.from(s1.next.chainKey)).not.toEqual(Array.from(r0.chainKey));
    expect(s2.next.counter).toBe(2);
  });

  it('refuses to rewind — a stale counter is rejected (forward secrecy guard)', async () => {
    let rr = await ratchetInit(master);
    let rs = await ratchetInit(master);
    const s0 = await ratchetSeal(rs, new TextEncoder().encode('first')); rs = s0.next;
    const s1 = await ratchetSeal(rs, new TextEncoder().encode('second'));
    // receiver consumes message 1 first, advancing past 0
    const o1 = await ratchetOpen(rr, s1.wire); rr = o1.next;
    await expect(ratchetOpen(rr, s0.wire)).rejects.toThrow(/stale|rewind/);
  });
});

describe('constant-rate framing — REGULATOR 2 (balance, homeostatic)', () => {
  const master = new Uint8Array(32).fill(5);

  it('carves a payload into fixed-size frames and reassembles it', () => {
    const payload = new Uint8Array(1500).map((_, i) => i & 0xff);
    const frames = packFrames(payload);
    for (const f of frames) expect(f.length).toBe(FRAME_PAYLOAD);
    expect(Array.from(unpackFrames(frames))).toEqual(Array.from(payload));
  });

  it('a cover frame carries nothing', () => {
    expect(unpackFrames([coverFrame()]).length).toBe(0);
    expect(coverFrame().length).toBe(FRAME_PAYLOAD);
  });

  it('every data and cover frame seals (exact) to one identical wire size', async () => {
    const frames = [...packFrames(new Uint8Array(1500)), coverFrame()];
    const wires = await Promise.all(frames.map(f => seal(master, f, { exact: true })));
    expect(new Set(wires.map(w => w.length)).size).toBe(1);
  });

  it('an empty payload still produces one whole frame', () => {
    const frames = packFrames(new Uint8Array(0));
    expect(frames.length).toBe(1);
    expect(frames[0].length).toBe(FRAME_PAYLOAD);
    expect(unpackFrames(frames).length).toBe(0);
  });
});

describe('corosSelfTest — the end-to-end invariant check', () => {
  it('passes every invariant, including both regulators', async () => {
    const r = await corosSelfTest();
    expect(r.ok).toBe(true);
    expect(r.roundtrips).toBe(4);
    expect(r.tamper_rejected).toBe(true);
    expect(r.wrong_key_rejected).toBe(true);
    expect(r.wire_band_ok).toBe(true);
    expect(r.ratchet_ok).toBe(true);
    expect(r.constant_rate_ok).toBe(true);
  });
});

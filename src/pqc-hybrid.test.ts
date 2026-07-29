import { describe, it, expect } from 'vitest';
import {
  pqcHybridKeygen, pqcHybridEncaps, pqcHybridDecaps, pqcHybridSelfTest,
} from './pqc-hybrid';
import {
  qcmdpcKeygen, qcmdpcEncaps, qcmdpcDecaps, polyInv, polyMulSparse, polySupport,
  sampleSparse, QCMDPC_R,
} from './pqc-qcmdpc';

const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

describe('QC-MDPC leg (experimental, hand-rolled)', () => {
  it('inverts a sparse polynomial in F2[x]/(x^r - 1)', () => {
    const r = QCMDPC_R;
    const a = sampleSparse(r, 45);            // odd weight ⇒ (x+1) does not divide it
    const inv = polyInv(a, r);
    expect(inv).not.toBeNull();
    const prod = polyMulSparse(inv!, polySupport(a), r);
    expect(prod[0]).toBe(1);                  // a · a⁻¹ = 1
    expect(prod.slice(1).every((v) => v === 0)).toBe(true);
  });

  it('encapsulates and decapsulates to the same secret', () => {
    const { publicKey, secretKey } = qcmdpcKeygen();
    const { ciphertext, sharedSecret } = qcmdpcEncaps(publicKey);
    expect(same(qcmdpcDecaps(secretKey, ciphertext), sharedSecret)).toBe(true);
  });

  it('implicitly rejects a tampered ciphertext (no decrypt oracle)', () => {
    const { publicKey, secretKey } = qcmdpcKeygen();
    const { ciphertext, sharedSecret } = qcmdpcEncaps(publicKey);
    const bad = { c0: Uint8Array.from(ciphertext.c0), c1: ciphertext.c1 };
    bad.c0[0] ^= 1;
    const k = qcmdpcDecaps(secretKey, bad);
    // A pseudo-random key, NOT an error and NOT the real key — that is what
    // makes the FO transform CCA2 rather than merely CPA.
    expect(same(k, sharedSecret)).toBe(false);
    expect(k.length).toBe(32);
  });

  it('a different secret key never recovers the secret', () => {
    const a = qcmdpcKeygen(), b = qcmdpcKeygen();
    const { ciphertext, sharedSecret } = qcmdpcEncaps(a.publicKey);
    expect(same(qcmdpcDecaps(b.secretKey, ciphertext), sharedSecret)).toBe(false);
  });
});

describe('hybrid KEM — vetted profile (ML-KEM-768 + X25519)', () => {
  it('round-trips', async () => {
    const { publicKey, secretKey } = pqcHybridKeygen('vetted');
    const { ciphertext, sharedSecret } = await pqcHybridEncaps(publicKey);
    const out = await pqcHybridDecaps(secretKey, publicKey, ciphertext);
    expect(same(out, sharedSecret)).toBe(true);
    expect(sharedSecret.length).toBe(32);
  });

  it('uses a fresh ephemeral per encapsulation (forward secrecy shape)', async () => {
    const { publicKey } = pqcHybridKeygen('vetted');
    const a = await pqcHybridEncaps(publicKey);
    const b = await pqcHybridEncaps(publicKey);
    expect(same(a.ciphertext.epk, b.ciphertext.epk)).toBe(false);
    expect(same(a.sharedSecret, b.sharedSecret)).toBe(false);
  });

  it('refuses a profile mismatch', async () => {
    const v = pqcHybridKeygen('vetted');
    const x = pqcHybridKeygen('experimental');
    const { ciphertext } = await pqcHybridEncaps(x.publicKey);
    await expect(pqcHybridDecaps(v.secretKey, v.publicKey, ciphertext)).rejects.toThrow(/profile mismatch/);
  });
});

describe('hybrid KEM — experimental profile (three legs)', () => {
  it('round-trips with all three legs', async () => {
    const { publicKey, secretKey } = pqcHybridKeygen('experimental');
    const { ciphertext, sharedSecret } = await pqcHybridEncaps(publicKey);
    expect(ciphertext.qcmdpc).toBeDefined();
    const out = await pqcHybridDecaps(secretKey, publicKey, ciphertext);
    expect(same(out, sharedSecret)).toBe(true);
  });
});

describe('self-test — the claimed properties, including OR-security', () => {
  it('passes every check', async () => {
    const t = await pqcHybridSelfTest();
    // The OR-security checks are the point of the whole construction: holding
    // ONE leg's secret must not yield the session key.
    expect(t.or_security_mlkem_only).toBe(true);
    expect(t.or_security_x25519_only).toBe(true);
    expect(t.or_security_qcmdpc_only).toBe(true);
    expect(t.tamper_rejected).toBe(true);
    expect(t.transcript_bound).toBe(true);
    expect(t.vetted_roundtrip).toBe(true);
    expect(t.experimental_roundtrip).toBe(true);
    expect(t.ok).toBe(true);
  });
});

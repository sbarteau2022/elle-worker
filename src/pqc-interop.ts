// ============================================================
// PQC INTEROP VECTORS — src/pqc-interop.ts
//
// Serialization for cross-runtime KEM test vectors, so the worker and the
// laptop can PROVE they derive identical shared secrets instead of assuming
// it. The older Rosen-bridge port's cross-runtime check was only ever done by
// hand (see the note atop Elle's rosen-bridge.test.cjs); this closes that gap
// with fixtures that run in CI on both sides:
//
//   worker → laptop : this module exports vectors; Elle's
//                     electron/native/providers/pqc-hybrid.test.cjs
//                     decapsulates them and compares the shared secret.
//   laptop → worker : Elle exports vectors the same way;
//                     src/pqc-hybrid.test.ts decapsulates them here.
//
// A vector deliberately carries the SECRET key. These are throwaway keys
// generated for the fixture and never used to protect anything — publishing
// them is the point, since decapsulation is what's being tested.
//
// Hex, not base64: diffable in review and free of padding ambiguity between
// runtimes. No Buffer — this has to run in the Workers isolate too.
// ============================================================

import type { PqcPublicKey, PqcSecretKey, PqcCiphertext, PqcProfile } from './pqc-hybrid';
import { packPoly, type Poly } from './pqc-qcmdpc';

export interface PqcVector {
  profile: PqcProfile;
  publicKey: { mlkem: string; x25519: string; qcmdpc?: { h: string; r: number } };
  secretKey: { mlkem: string; x25519: string; qcmdpc?: { h0: string; h1: string; r: number; sigma: string } };
  ciphertext: { mlkem: string; epk: string; qcmdpc?: { c0: string; c1: string } };
  shared_secret: string;
}

export function toHex(u8: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u8.length; i++) s += u8[i].toString(16).padStart(2, '0');
  return s;
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.trim();
  if (clean.length % 2 !== 0) throw new Error('pqc-interop: odd-length hex string');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

// Bit i of the polynomial lives in bit (i & 7) of byte (i >> 3) — the same
// little-endian-within-byte convention packPoly writes.
export function unpackPoly(bytes: Uint8Array, r: number): Poly {
  const out = new Uint8Array(r);
  for (let i = 0; i < r; i++) out[i] = (bytes[i >> 3] >> (i & 7)) & 1;
  return out;
}

export function exportVector(
  pk: PqcPublicKey, sk: PqcSecretKey, ct: PqcCiphertext, sharedSecret: Uint8Array,
): PqcVector {
  const v: PqcVector = {
    profile: pk.profile,
    publicKey: { mlkem: toHex(pk.mlkem), x25519: toHex(pk.x25519) },
    secretKey: { mlkem: toHex(sk.mlkem), x25519: toHex(sk.x25519) },
    ciphertext: { mlkem: toHex(ct.mlkem), epk: toHex(ct.epk) },
    shared_secret: toHex(sharedSecret),
  };
  if (pk.profile === 'experimental' && pk.qcmdpc && sk.qcmdpc && ct.qcmdpc) {
    v.publicKey.qcmdpc = { h: toHex(packPoly(pk.qcmdpc.h)), r: pk.qcmdpc.r };
    v.secretKey.qcmdpc = {
      h0: toHex(packPoly(sk.qcmdpc.h0)), h1: toHex(packPoly(sk.qcmdpc.h1)),
      r: sk.qcmdpc.r, sigma: toHex(sk.qcmdpc.sigma),
    };
    v.ciphertext.qcmdpc = { c0: toHex(packPoly(ct.qcmdpc.c0)), c1: toHex(ct.qcmdpc.c1) };
  }
  return v;
}

export function importVector(v: PqcVector): {
  pk: PqcPublicKey; sk: PqcSecretKey; ct: PqcCiphertext; sharedSecret: Uint8Array;
} {
  const pk: PqcPublicKey = { profile: v.profile, mlkem: fromHex(v.publicKey.mlkem), x25519: fromHex(v.publicKey.x25519) };
  const sk: PqcSecretKey = { profile: v.profile, mlkem: fromHex(v.secretKey.mlkem), x25519: fromHex(v.secretKey.x25519) };
  const ct: PqcCiphertext = { profile: v.profile, mlkem: fromHex(v.ciphertext.mlkem), epk: fromHex(v.ciphertext.epk) };
  if (v.profile === 'experimental') {
    if (!v.publicKey.qcmdpc || !v.secretKey.qcmdpc || !v.ciphertext.qcmdpc) {
      throw new Error('pqc-interop: experimental vector is missing its qcmdpc leg');
    }
    const r = v.publicKey.qcmdpc.r;
    pk.qcmdpc = { h: unpackPoly(fromHex(v.publicKey.qcmdpc.h), r), r };
    sk.qcmdpc = {
      h0: unpackPoly(fromHex(v.secretKey.qcmdpc.h0), r),
      h1: unpackPoly(fromHex(v.secretKey.qcmdpc.h1), r),
      r, sigma: fromHex(v.secretKey.qcmdpc.sigma),
    };
    ct.qcmdpc = { c0: unpackPoly(fromHex(v.ciphertext.qcmdpc.c0), r), c1: fromHex(v.ciphertext.qcmdpc.c1) };
  }
  return { pk, sk, ct, sharedSecret: fromHex(v.shared_secret) };
}

// ============================================================
// QC-MDPC KEM — src/pqc-qcmdpc.ts   ⚠️ EXPERIMENTAL THIRD LEG ⚠️
//
// READ THIS BEFORE USING IT ANYWHERE:
//
// This is a HAND-ROLLED, UNREVIEWED implementation of a BIKE-shaped
// code-based KEM. Everything else in this repo's crypto follows the rule
// "never roll your own" — ML-KEM and X25519 come from an audited library.
// This file deliberately breaks that rule, and it is only defensible for ONE
// structural reason:
//
//   In a SOUND HYBRID COMBINER, an extra leg can never REDUCE security below
//   the other legs. The session key is HKDF(ss_A ‖ ss_B ‖ ss_C ‖ transcript),
//   so an attacker must break EVERY leg. A total break of this file leaves
//   ML-KEM-768 + X25519 still standing. A bug here costs AVAILABILITY
//   (a failed handshake), not CONFIDENTIALITY.
//
// Therefore: this leg may only ever be ADDED to the vetted legs, NEVER used
// alone and NEVER as a replacement for one. `pqc-hybrid.ts` enforces that —
// the 2-leg vetted profile is the default and this leg is opt-in.
//
// WHY A CODE-BASED LEG AT ALL: ML-KEM rests on lattices (Module-LWE). This
// rests on SYNDROME DECODING of a quasi-cyclic code — NP-hard in general,
// unrelated mathematics, no known quantum shortcut. A cryptanalytic collapse
// of lattices would not touch it, and vice versa. That independence is the
// whole value; two post-quantum legs from the SAME family would buy nothing.
//
// THE CONSTRUCTION (BIKE, Round-4 NIST candidate family):
//   ring R  = F₂[x]/(xʳ − 1), r prime
//   private : h₀, h₁ sparse, odd weight d_v each (the parity checks)
//   public  : h = h₁·h₀⁻¹
//   encaps  : error (e₀,e₁) of weight t;  c₀ = e₀ + e₁·h
//   decaps  : c₀·h₀ = e₀·h₀ + e₁·h₁ — the syndrome under H = [h₀|h₁];
//             a bit-flipping decoder recovers (e₀,e₁).
//   CCA2    : FO-style re-derivation + implicit rejection (never a decrypt
//             oracle: a bad ciphertext yields a pseudo-random key, not an error).
//
// KNOWN GAPS vs. production BIKE (all deliberate, all documented):
//   • NOT constant-time. The decoder branches on secret-dependent data, so it
//     leaks through timing. Real BIKE uses constant-time black-gray decoders.
//   • Nonzero decoding-failure rate. Real BIKE drives DFR to ~2⁻¹²⁸ because a
//     detectable failure is an attack surface (GJS reaction attacks recover
//     the private key from failure patterns). Ours is empirical, not proven.
//   • Modulo bias in the error sampler.
//   • Toy-grade parameters (the historical r=4801 set, ~80-bit class).
//
// Representation: polynomials are Uint8Array bit-arrays (one byte per
// coefficient). Deliberate — the decoder's hot loop is random-access indexed,
// which bit-arrays do in O(1) while a packed bitset would need per-bit shifts.
// BigInt appears exactly once, for the one-off inversion at keygen.
// ============================================================

import { shake256 } from '@noble/hashes/sha3.js';

export const QCMDPC_R = 4801;   // prime; x^r − 1 factors as (x+1)·(irreducible)
export const QCMDPC_DV = 45;    // weight of each h_i — ODD, so h_i(1)=1 ⇒ (x+1)∤h_i
export const QCMDPC_T = 84;     // total error weight

export type Poly = Uint8Array;  // length r, entries 0/1

export interface QcmdpcPublicKey { h: Poly; r: number }
export interface QcmdpcSecretKey { h0: Poly; h1: Poly; r: number; sigma: Uint8Array }
export interface QcmdpcCiphertext { c0: Poly; c1: Uint8Array }

// ── polynomial helpers in R = F₂[x]/(xʳ − 1) ────────────────────────────────

export function polySupport(a: Poly): Int32Array {
  const idx: number[] = [];
  for (let i = 0; i < a.length; i++) if (a[i]) idx.push(i);
  return Int32Array.from(idx);
}

// dense × sparse, cyclic. Iterating the SPARSE operand's support keeps this
// O(r · weight) instead of O(r²) — every multiply in this file has one sparse side.
export function polyMulSparse(dense: Poly, sparseSupport: Int32Array, r: number): Poly {
  const out = new Uint8Array(r);
  for (let s = 0; s < sparseSupport.length; s++) {
    const k = sparseSupport[s];
    const split = r - k;
    for (let j = 0; j < split; j++) out[j + k] ^= dense[j];
    for (let j = split; j < r; j++) out[j + k - r] ^= dense[j];
  }
  return out;
}

export function polyXor(a: Poly, b: Poly): Poly {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
  return out;
}

export function polyIsZero(a: Poly): boolean {
  for (let i = 0; i < a.length; i++) if (a[i]) return false;
  return true;
}

// ── one-off inversion at keygen ─────────────────────────────────────────────
// The "almost inverse" (binary extended Euclid) over F₂, on packed Uint32
// bitsets. Every step is a SHIFTED XOR — no polynomial multiplication and no
// BigInt, which matters: a BigInt version needs a degree query per iteration,
// and `bigint.toString(2)` is quadratic, so it dominated everything else.
type BS = Uint32Array<ArrayBufferLike>;

function bsFrom(a: Poly, words: number): BS {
  const b = new Uint32Array(words);
  for (let i = 0; i < a.length; i++) if (a[i]) b[i >>> 5] |= 1 << (i & 31);
  return b;
}
function bsDeg(b: BS): number {
  for (let w = b.length - 1; w >= 0; w--) {
    if (b[w] !== 0) return (w << 5) + (31 - Math.clz32(b[w]));
  }
  return -1;                                       // the zero polynomial
}
// dst ^= src << shift
function bsXorShift(dst: BS, src: BS, shift: number): void {
  const ws = shift >>> 5, bs = shift & 31;
  if (bs === 0) {
    for (let i = dst.length - 1; i >= ws; i--) dst[i] ^= src[i - ws];
  } else {
    for (let i = dst.length - 1; i >= ws; i--) {
      let v = src[i - ws] << bs;
      if (i - ws - 1 >= 0) v |= src[i - ws - 1] >>> (32 - bs);
      dst[i] ^= v;
    }
  }
}
// Unpack, folding xʳ ≡ 1 so the result is reduced into the ring.
function bsToPolyFold(b: BS, r: number): Poly {
  const out = new Uint8Array(r);
  const total = b.length << 5;
  for (let i = 0; i < total; i++) {
    if ((b[i >>> 5] >>> (i & 31)) & 1) out[i % r] ^= 1;
  }
  return out;
}

// Inverse of `a` mod (xʳ − 1), or null when not invertible.
export function polyInv(a: Poly, r: number): Poly | null {
  const W = ((r + 64) >>> 5) + 1;
  let U: BS = bsFrom(a, W);
  let V: BS = new Uint32Array(W);
  V[0] |= 1; V[r >>> 5] |= 1 << (r & 31);          // V = xʳ + 1 (≡ xʳ − 1 over F₂)
  let GU: BS = new Uint32Array(W); GU[0] = 1;      // tracks the cofactor of `a`
  let GV: BS = new Uint32Array(W);
  let dU = bsDeg(U), dV = bsDeg(V);
  if (dU < 0) return null;                         // a = 0

  while (dU > 0) {
    if (dU < dV) {                                  // keep U the higher-degree side
      const tU = U; U = V; V = tU;
      const tG = GU; GU = GV; GV = tG;
      const td = dU; dU = dV; dV = td;
    }
    bsXorShift(U, V, dU - dV);
    bsXorShift(GU, GV, dU - dV);
    dU = bsDeg(U);
  }
  if (dU !== 0) return null;                        // gcd ≠ 1 ⇒ no inverse
  return bsToPolyFold(GU, r);
}

// ── sampling ────────────────────────────────────────────────────────────────
function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n); crypto.getRandomValues(b); return b;
}

// Exactly `weight` distinct positions, from the OS CSPRNG.
export function sampleSparse(r: number, weight: number): Poly {
  const out = new Uint8Array(r);
  let set = 0;
  while (set < weight) {
    const buf = new Uint32Array(64); crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && set < weight; i++) {
      const p = buf[i] % r;                       // modulo bias — see header
      if (!out[p]) { out[p] = 1; set++; }
    }
  }
  return out;
}

// Deterministic weight-t error split across the two blocks, derived from a seed.
// Determinism is what makes the FO re-derivation check possible.
export function sampleError(seed: Uint8Array, r: number, t: number): { e0: Poly; e1: Poly } {
  const e0 = new Uint8Array(r), e1 = new Uint8Array(r);
  let set = 0, ctr = 0;
  while (set < t) {
    const ctrBytes = new Uint8Array(4);
    new DataView(ctrBytes.buffer).setUint32(0, ctr++, true);
    const blk = shake256(concatBytes(utf8('bike-err'), seed, ctrBytes), { dkLen: 1024 });
    const dv = new DataView(blk.buffer, blk.byteOffset, blk.byteLength);
    for (let i = 0; i + 4 <= blk.length && set < t; i += 4) {
      const v = dv.getUint32(i, true) % (2 * r);
      if (v < r) { if (!e0[v]) { e0[v] = 1; set++; } }
      else { const p = v - r; if (!e1[p]) { e1[p] = 1; set++; } }
    }
  }
  return { e0, e1 };
}

// ── byte helpers ────────────────────────────────────────────────────────────
const utf8 = (s: string) => new TextEncoder().encode(s);
function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let n = 0; for (const p of parts) n += p.length;
  const out = new Uint8Array(n); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
export function packPoly(a: Poly): Uint8Array {
  const out = new Uint8Array((a.length + 7) >> 3);
  for (let i = 0; i < a.length; i++) if (a[i]) out[i >> 3] |= 1 << (i & 7);
  return out;
}
function xorBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const n = Math.min(a.length, b.length), out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = a[i] ^ b[i];
  return out;
}
function polyEq(a: Poly, b: Poly): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ── the bit-flipping decoder ────────────────────────────────────────────────
// counter[j] counts how many unsatisfied parity checks position j participates
// in: counter₀[j] = Σ_{k ∈ supp(h₀)} syn[(j+k) mod r]. Positions with the most
// unsatisfied checks are the likeliest error positions, so we flip those and
// repeat. NOT constant-time (see header).
function counters(syn: Poly, supp: Int32Array, r: number): Int32Array {
  const c = new Int32Array(r);
  for (let s = 0; s < supp.length; s++) {
    const k = supp[s], split = r - k;
    for (let j = 0; j < split; j++) c[j] += syn[j + k];
    for (let j = split; j < r; j++) c[j] += syn[j + k - r];
  }
  return c;
}

export function bfDecode(
  synIn: Poly, h0: Poly, h1: Poly, r: number, maxIter = 40,
): { e0: Poly; e1: Poly } | null {
  const s0 = polySupport(h0), s1 = polySupport(h1);
  const syn = Uint8Array.from(synIn);
  const e0 = new Uint8Array(r), e1 = new Uint8Array(r);
  const floor = (QCMDPC_DV >> 1) + 1;

  const flip = (pos: number, supp: Int32Array) => {           // syn ^= rot(h_i, pos)
    for (let s = 0; s < supp.length; s++) {
      let idx = pos + supp[s]; if (idx >= r) idx -= r;
      syn[idx] ^= 1;
    }
  };

  for (let iter = 0; iter < maxIter; iter++) {
    if (polyIsZero(syn)) return { e0, e1 };
    const c0 = counters(syn, s0, r), c1 = counters(syn, s1, r);
    let max = 0;
    for (let j = 0; j < r; j++) { if (c0[j] > max) max = c0[j]; if (c1[j] > max) max = c1[j]; }
    if (max === 0) return null;
    const thr = Math.max(max - 1, floor);
    let flipped = false;
    for (let j = 0; j < r; j++) {
      if (c0[j] >= thr) { e0[j] ^= 1; flip(j, s0); flipped = true; }
      if (c1[j] >= thr) { e1[j] ^= 1; flip(j, s1); flipped = true; }
    }
    if (!flipped) return null;
  }
  return polyIsZero(syn) ? { e0, e1 } : null;
}

// ── the KEM ─────────────────────────────────────────────────────────────────

export function qcmdpcKeygen(r = QCMDPC_R, dv = QCMDPC_DV): {
  publicKey: QcmdpcPublicKey; secretKey: QcmdpcSecretKey;
} {
  for (let attempt = 0; attempt < 64; attempt++) {
    const h0 = sampleSparse(r, dv);
    const inv = polyInv(h0, r);
    if (!inv) continue;                                  // vanishingly rare with odd dv
    const h1 = sampleSparse(r, dv);
    const h = polyMulSparse(inv, polySupport(h1), r);     // h = h₁·h₀⁻¹
    return {
      publicKey: { h, r },
      secretKey: { h0, h1, r, sigma: randomBytes(32) },
    };
  }
  throw new Error('qcmdpc: keygen failed to find an invertible h0');
}

const L = (e0: Poly, e1: Poly) =>
  shake256(concatBytes(utf8('bike-L'), packPoly(e0), packPoly(e1)), { dkLen: 32 });
const KDF = (m: Uint8Array, ct: QcmdpcCiphertext) =>
  shake256(concatBytes(utf8('bike-K'), m, packPoly(ct.c0), ct.c1), { dkLen: 32 });

export function qcmdpcEncaps(pk: QcmdpcPublicKey): {
  ciphertext: QcmdpcCiphertext; sharedSecret: Uint8Array;
} {
  const r = pk.r;
  const m = randomBytes(32);
  const { e0, e1 } = sampleError(m, r, QCMDPC_T);
  const c0 = polyXor(e0, polyMulSparse(pk.h, polySupport(e1), r));   // e₀ + e₁·h
  const c1 = xorBytes(m, L(e0, e1));
  const ct: QcmdpcCiphertext = { c0, c1 };
  return { ciphertext: ct, sharedSecret: KDF(m, ct) };
}

export function qcmdpcDecaps(sk: QcmdpcSecretKey, ct: QcmdpcCiphertext): Uint8Array {
  const r = sk.r;
  const syn = polyMulSparse(ct.c0, polySupport(sk.h0), r);           // c₀·h₀
  const dec = bfDecode(syn, sk.h0, sk.h1, r);
  if (dec) {
    const m2 = xorBytes(ct.c1, L(dec.e0, dec.e1));
    const re = sampleError(m2, r, QCMDPC_T);                         // FO re-derivation
    if (polyEq(re.e0, dec.e0) && polyEq(re.e1, dec.e1)) return KDF(m2, ct);
  }
  // Implicit rejection: a pseudo-random key, never a distinguishable error.
  return shake256(concatBytes(utf8('bike-reject'), sk.sigma, packPoly(ct.c0), ct.c1), { dkLen: 32 });
}

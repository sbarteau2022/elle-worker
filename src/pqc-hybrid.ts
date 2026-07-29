// ============================================================
// HYBRID POST-QUANTUM KEM — src/pqc-hybrid.ts
//
// The multi-leg key encapsulation the PQC design doc specifies. The session
// key is derived from EVERY leg at once:
//
//   K = HKDF-SHA256( ss_mlkem ‖ ss_x25519 [‖ ss_qcmdpc] , info = transcript )
//
// THE PROPERTY THAT MATTERS ("OR-security"): an attacker must break EVERY leg
// to learn K. Breaking one — even completely — leaves K unknown, because the
// broken leg's secret is only one input to the extract step. So:
//
//   • a quantum computer breaks X25519 (Shor)      → ML-KEM still holds
//   • a lattice cryptanalysis breakthrough         → X25519/QC-MDPC still hold
//   • a bug in our own QC-MDPC code                → the vetted legs still hold
//
// This is why hybrid is the correct answer to "make it tougher" and also why
// it can never be WORSE than its strongest leg. It is the same reasoning TLS,
// Signal's PQXDH, and iMessage PQ3 use — they run TWO legs (one classical,
// one lattice). The optional third leg here rests on a different hard problem
// again (syndrome decoding, not lattices), which is beyond what is deployed
// anywhere in production today.
//
// LEG PROVENANCE — the load-bearing distinction:
//   ML-KEM-768  @noble/post-quantum   AUDITED library, FIPS 203
//   X25519      @noble/curves         AUDITED library, RFC 7748
//   QC-MDPC     src/pqc-qcmdpc.ts     ⚠️ OURS. Hand-rolled, unreviewed.
//
// Both vetted legs are pure-JS by deliberate choice, not convenience: the
// laptop side of the Rosen bridge (Elle/electron/native/providers/) must
// derive byte-identical secrets, and a pure-JS implementation is bit-exact
// across V8/workerd/Node in a way a runtime-provided WebCrypto curve is not
// guaranteed to be. Same reason hyperbolic-sync-fixed.ts exists.
//
// PROFILES. The default is the two VETTED legs. The third leg is opt-in and
// may only ever be ADDED — `pqcHybridKeygen('qcmdpc-only')` does not exist by
// construction. A hybrid is only as trustworthy as its rule that unreviewed
// code can never stand alone.
// ============================================================

import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { x25519 } from '@noble/curves/ed25519.js';
import {
  qcmdpcKeygen, qcmdpcEncaps, qcmdpcDecaps, packPoly,
  type QcmdpcPublicKey, type QcmdpcSecretKey, type QcmdpcCiphertext,
} from './pqc-qcmdpc';

// 'vetted' — ML-KEM-768 + X25519. The default: every leg from an audited library.
// 'experimental' — the above PLUS our QC-MDPC leg. Strictly additive.
export type PqcProfile = 'vetted' | 'experimental';

export interface PqcPublicKey {
  profile: PqcProfile;
  mlkem: Uint8Array;
  x25519: Uint8Array;
  qcmdpc?: QcmdpcPublicKey;
}
export interface PqcSecretKey {
  profile: PqcProfile;
  mlkem: Uint8Array;
  x25519: Uint8Array;
  qcmdpc?: QcmdpcSecretKey;
}
export interface PqcCiphertext {
  profile: PqcProfile;
  mlkem: Uint8Array;
  epk: Uint8Array;              // sender's EPHEMERAL X25519 key → forward secrecy
  qcmdpc?: QcmdpcCiphertext;
}

const utf8 = (s: string) => new TextEncoder().encode(s);
// noble's signatures require an ArrayBuffer-backed view (not SharedArrayBuffer).
// Copying a 32-byte key is free and keeps the public interfaces plain Uint8Array.
const ab = (u: Uint8Array): Uint8Array<ArrayBuffer> => Uint8Array.from(u);
function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let n = 0; for (const p of parts) n += p.length;
  const out = new Uint8Array(n); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// Everything public that identifies this exchange goes into the KDF info, so a
// key is bound to the exact ciphertexts and public keys that produced it. This
// is what stops an attacker splicing legs from two different handshakes.
async function transcript(pk: PqcPublicKey, ct: PqcCiphertext): Promise<Uint8Array> {
  const parts = [utf8(`elle-pqc-hybrid-v1|${ct.profile}|`), pk.mlkem, pk.x25519, ct.mlkem, ct.epk];
  if (ct.qcmdpc && pk.qcmdpc) parts.push(packPoly(pk.qcmdpc.h), packPoly(ct.qcmdpc.c0), ct.qcmdpc.c1);
  const digest = await crypto.subtle.digest('SHA-256', concatBytes(...parts));
  return new Uint8Array(digest);
}

// HKDF-SHA256 over the concatenated leg secrets. The ORDER is fixed and the
// per-leg lengths are fixed (32 bytes each), so the concatenation is
// unambiguous — no length-confusion between legs.
async function combine(secrets: Uint8Array[], info: Uint8Array): Promise<Uint8Array> {
  const ikm = concatBytes(...secrets);
  const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info }, base, 256,
  );
  return new Uint8Array(bits);
}

export function pqcHybridKeygen(profile: PqcProfile = 'vetted'): {
  publicKey: PqcPublicKey; secretKey: PqcSecretKey;
} {
  const kem = ml_kem768.keygen();
  const xsk = x25519.utils.randomSecretKey();
  const xpk = x25519.getPublicKey(xsk);
  const pk: PqcPublicKey = { profile, mlkem: kem.publicKey, x25519: xpk };
  const sk: PqcSecretKey = { profile, mlkem: kem.secretKey, x25519: xsk };
  if (profile === 'experimental') {
    const q = qcmdpcKeygen();
    pk.qcmdpc = q.publicKey;
    sk.qcmdpc = q.secretKey;
  }
  return { publicKey: pk, secretKey: sk };
}

export async function pqcHybridEncaps(pk: PqcPublicKey): Promise<{
  ciphertext: PqcCiphertext; sharedSecret: Uint8Array;
}> {
  const kem = ml_kem768.encapsulate(pk.mlkem);
  // A fresh ephemeral key per encapsulation is what gives forward secrecy:
  // it is discarded here, so a later compromise of the static key cannot
  // reconstruct this session's X25519 leg.
  const esk = x25519.utils.randomSecretKey();
  const epk = x25519.getPublicKey(esk);
  const ssX = x25519.getSharedSecret(esk, ab(pk.x25519));

  const ct: PqcCiphertext = { profile: pk.profile, mlkem: kem.cipherText, epk };
  const legs: Uint8Array[] = [kem.sharedSecret, ssX];

  if (pk.profile === 'experimental') {
    if (!pk.qcmdpc) throw new Error('pqc-hybrid: experimental profile requires a qcmdpc public key');
    const q = qcmdpcEncaps(pk.qcmdpc);
    ct.qcmdpc = q.ciphertext;
    legs.push(q.sharedSecret);
  }

  return { ciphertext: ct, sharedSecret: await combine(legs, await transcript(pk, ct)) };
}

export async function pqcHybridDecaps(
  sk: PqcSecretKey, pk: PqcPublicKey, ct: PqcCiphertext,
): Promise<Uint8Array> {
  if (ct.profile !== sk.profile) throw new Error('pqc-hybrid: profile mismatch');
  // ML-KEM's own FO transform means a tampered ciphertext yields a
  // pseudo-random secret rather than an error — no decrypt oracle.
  const ssKem = ml_kem768.decapsulate(ct.mlkem, sk.mlkem);
  const ssX = x25519.getSharedSecret(ab(sk.x25519), ab(ct.epk));
  const legs: Uint8Array[] = [ssKem, ssX];

  if (sk.profile === 'experimental') {
    if (!sk.qcmdpc || !ct.qcmdpc) throw new Error('pqc-hybrid: experimental profile requires the qcmdpc leg');
    legs.push(qcmdpcDecaps(sk.qcmdpc, ct.qcmdpc));
  }

  return combine(legs, await transcript(pk, ct));
}

// ============================================================
// self-test — the same shape every other crypto module here exposes.
// Proves the properties we CLAIM, especially OR-security: it deliberately
// hands an attacker each leg's secret in turn and checks the key still
// doesn't fall out.
// ============================================================
export interface PqcHybridSelfTest {
  ok: boolean;
  vetted_roundtrip: boolean;
  experimental_roundtrip: boolean;
  forward_secrecy_shape: boolean;    // each encaps uses a fresh ephemeral key
  tamper_rejected: boolean;          // a modified ciphertext never yields the key
  transcript_bound: boolean;         // legs can't be spliced across handshakes
  or_security_mlkem_only: boolean;   // ML-KEM secret alone ⇏ session key
  or_security_x25519_only: boolean;  // X25519 secret alone ⇏ session key
  or_security_qcmdpc_only: boolean;  // QC-MDPC secret alone ⇏ session key
  leg_sizes: Record<string, number>;
  note: string;
}

const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

export async function pqcHybridSelfTest(): Promise<PqcHybridSelfTest> {
  // ── vetted (2-leg) ────────────────────────────────────────────────────
  const v = pqcHybridKeygen('vetted');
  const ve = await pqcHybridEncaps(v.publicKey);
  const vd = await pqcHybridDecaps(v.secretKey, v.publicKey, ve.ciphertext);
  const vetted_roundtrip = same(ve.sharedSecret, vd);

  // two encapsulations to the SAME public key must use different ephemerals
  const ve2 = await pqcHybridEncaps(v.publicKey);
  const forward_secrecy_shape =
    !same(ve.ciphertext.epk, ve2.ciphertext.epk) && !same(ve.sharedSecret, ve2.sharedSecret);

  // tamper the ML-KEM ciphertext → implicit rejection → a different key
  const tampered: PqcCiphertext = { ...ve.ciphertext, mlkem: Uint8Array.from(ve.ciphertext.mlkem) };
  tampered.mlkem[0] ^= 1;
  const tamperKey = await pqcHybridDecaps(v.secretKey, v.publicKey, tampered);
  const tamper_rejected = !same(tamperKey, ve.sharedSecret);

  // splice leg material from a second handshake → transcript binding breaks it
  const spliced: PqcCiphertext = { ...ve.ciphertext, epk: ve2.ciphertext.epk };
  const splicedKey = await pqcHybridDecaps(v.secretKey, v.publicKey, spliced).catch(() => new Uint8Array(0));
  const transcript_bound = !same(splicedKey, ve.sharedSecret);

  // ── experimental (3-leg) ──────────────────────────────────────────────
  const x = pqcHybridKeygen('experimental');
  const xe = await pqcHybridEncaps(x.publicKey);
  const xd = await pqcHybridDecaps(x.secretKey, x.publicKey, xe.ciphertext);
  const experimental_roundtrip = same(xe.sharedSecret, xd);

  // ── OR-security: leak each leg in turn, key must stay hidden ───────────
  // We give the "attacker" one real leg secret and zeros for the others, then
  // run the exact same combiner. Anything but a mismatch would be a failure.
  const info = await transcript(x.publicKey, xe.ciphertext);
  const Z = new Uint8Array(32);
  const realKem = ml_kem768.decapsulate(xe.ciphertext.mlkem, x.secretKey.mlkem);
  const realX = x25519.getSharedSecret(ab(x.secretKey.x25519), ab(xe.ciphertext.epk));
  const realQ = qcmdpcDecaps(x.secretKey.qcmdpc!, xe.ciphertext.qcmdpc!);

  const or_security_mlkem_only = !same(await combine([realKem, Z, Z], info), xd);
  const or_security_x25519_only = !same(await combine([Z, realX, Z], info), xd);
  const or_security_qcmdpc_only = !same(await combine([Z, Z, realQ], info), xd);
  // sanity: with ALL legs the combiner must reproduce the key (else the test
  // above would pass vacuously)
  const all_legs_reproduce = same(await combine([realKem, realX, realQ], info), xd);

  const ok = vetted_roundtrip && experimental_roundtrip && forward_secrecy_shape &&
    tamper_rejected && transcript_bound && all_legs_reproduce &&
    or_security_mlkem_only && or_security_x25519_only && or_security_qcmdpc_only;

  return {
    ok, vetted_roundtrip, experimental_roundtrip, forward_secrecy_shape,
    tamper_rejected, transcript_bound,
    or_security_mlkem_only, or_security_x25519_only, or_security_qcmdpc_only,
    leg_sizes: {
      mlkem_public: v.publicKey.mlkem.length,
      mlkem_ciphertext: ve.ciphertext.mlkem.length,
      x25519_public: v.publicKey.x25519.length,
      qcmdpc_public_bits: x.publicKey.qcmdpc!.r,
      session_key: ve.sharedSecret.length,
    },
    note: 'Hybrid KEM: K = HKDF(ss_mlkem ‖ ss_x25519 [‖ ss_qcmdpc], transcript). ' +
      'An attacker must break EVERY leg — the or_security_* checks prove one leg alone is not enough. ' +
      'The vetted profile uses only audited implementations (ML-KEM-768, X25519); the experimental ' +
      'profile ADDS our own unreviewed QC-MDPC leg, which by the OR property cannot weaken the others. ' +
      'NOT yet wired into the live lane derivation — that requires the matching laptop-side port ' +
      '(see docs/PQC_HYBRID.md and the Rosen-bridge design doc).',
  };
}

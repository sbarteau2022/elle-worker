// ============================================================
// LANE DOUBLE RATCHET (wire format v3) — src/lane-ratchet.ts, the worker's twin of
// Elle's electron/native/providers/lane-ratchet.cjs and
// elle_rust_harness/crates/harness-crypto/src/ratchet.rs, byte-for-byte.
//
// This is the "wire braided from both ends". The geodesic channel (rosen-
// bridge.cjs) labels every message key with a position on a deterministic
// walk from one master key that never changes — a compromise of that master
// reads everything, past and future, and the walk adds no secrecy. This
// module gives the lane the two properties that construction cannot have:
//
//   forward secrecy      each message key comes from a symmetric chain
//                        advanced by a one-way KDF and overwritten in place;
//                        a captured state cannot reach keys already used.
//   post-compromise      every time a peer sees a new ratchet public key it
//   security             mixes a fresh X25519 Diffie-Hellman output into the
//                        root key, so a captured state loses the channel
//                        again after one round trip of fresh randomness.
//
// Same primitives the bridge already uses (WebCrypto HKDF-SHA256 and
// AES-256-GCM, @noble/curves x25519), same HKDF info strings as the Rust
// crate, so a wire sealed on either side opens on the other — asserted by
// lane-ratchet.test.cjs driving the Rust `lane_interop` example live.
//
// Wire v3 (all integers big-endian; bytes 0..41 are AAD):
//   0     1   version 0x03
//   1     32  sender's current ratchet public key
//   33    4   pn — length of the previous sending chain
//   37    4   n  — message number in the current sending chain
//   41    12  AES-GCM nonce (random)
//   53    ..  ciphertext ‖ 16-byte tag
//
// Roles must agree out of band: whoever finished the lane handshake as the
// client is the INITIATOR; whoever accepted is the RESPONDER. The responder's
// initial keypair and bootstrap sending chain derive from root_lane so the
// initiator can speak first without an extra round trip; the responder's
// first `open` performs a DH ratchet that replaces that deterministic key.
//
// `open` never mutates the state unless the tag verifies: it works on a
// staged copy and commits only on success. A forged, replayed or tampered
// packet leaves the channel exactly where it was.
// ============================================================

import { x25519 } from '@noble/curves/ed25519.js';

const VERSION = 0x03;
const HEADER_BYTES = 41;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const MIN_WIRE_BYTES = HEADER_BYTES + NONCE_BYTES + TAG_BYTES;
const MAX_SKIP = 1000;
const MAX_SKIPPED_KEYS = 2000;

const INFO_ROOT = 'elle-lane-ratchet-root-v3';
const INFO_CHAIN = 'elle-lane-chain-v3';
const INFO_MSG = 'elle-lane-msg-v3';
const INFO_INIT = 'elle-lane-ratchet-init-v3';
const INFO_RK0 = 'elle-lane-ratchet-rk0-v3';
const INFO_BOOT = 'elle-lane-boot-r2i-v3';

const enc = (s: string) => new TextEncoder().encode(s);
const subtle = crypto.subtle;
function b64(bytes: Uint8Array): string { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 8192))); return btoa(s); }
function unb64(s: string): Uint8Array { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); }

export class RatchetError extends Error { kind: string; constructor(kind: string, msg: string) { super(msg); this.kind = kind; } }

export type LaneRole = 'initiator' | 'responder';
export interface RatchetState {
  rootKey: Uint8Array; dhs: Uint8Array; dhr: Uint8Array | null; cks: Uint8Array | null; ckr: Uint8Array | null;
  ns: number; nr: number; pn: number; skipped: Map<string, Uint8Array>;
}
export interface OpenResult { plaintext: Uint8Array; next: RatchetState; ratcheted?: boolean; gap?: number; skippedUsed?: boolean }

// ── KDFs (identical to ratchet.rs) ───────────────────────────────────────
async function hkdf(ikm: Uint8Array, salt: Uint8Array | null, info: string, bytes: number): Promise<Uint8Array> {
  const base = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt || new Uint8Array(0), info: enc(info) }, base, 8 * bytes);
  return new Uint8Array(bits);
}
const hkdf32 = (ikm: Uint8Array, info: string) => hkdf(ikm, null, info, 32);

function isAllZero(u: Uint8Array): boolean { let acc = 0; for (const b of u) acc |= b; return acc === 0; }

// kdf_rk(rk, dh) -> (rk', ck): HKDF(salt = rk, ikm = dh, info = ROOT, 64) split 32/32.
async function kdfRk(rk: Uint8Array, ourSecret: Uint8Array, theirPub: Uint8Array): Promise<{ rk: Uint8Array; ck: Uint8Array }> {
  const shared = x25519.getSharedSecret(ourSecret, theirPub);
  if (isAllZero(shared)) throw new RatchetError('invalid_key', 'lane ratchet: non-contributory X25519 output (low-order peer key)');
  const bits = await hkdf(shared, rk, INFO_ROOT, 64);
  shared.fill(0);
  return { rk: bits.slice(0, 32), ck: bits.slice(32, 64) };
}

// kdf_ck(ck) -> mk, and the next chain key (the caller overwrites in place).
async function kdfCk(ck: Uint8Array): Promise<{ mk: Uint8Array; next: Uint8Array }> {
  const mk = await hkdf32(ck, INFO_MSG);
  const next = await hkdf32(ck, INFO_CHAIN);
  return { mk, next };
}

// ── AEAD ─────────────────────────────────────────────────────────────────
async function aeadSeal(mk: Uint8Array, nonce: Uint8Array, aad: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array> {
  const key = await subtle.importKey('raw', mk, { name: 'AES-GCM' }, false, ['encrypt']);
  return new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad, tagLength: 128 }, key, plaintext));
}
async function aeadOpen(mk: Uint8Array, nonce: Uint8Array, aad: Uint8Array, ct: Uint8Array): Promise<Uint8Array> {
  const key = await subtle.importKey('raw', mk, { name: 'AES-GCM' }, false, ['decrypt']);
  try { return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad, tagLength: 128 }, key, ct)); }
  catch { throw new RatchetError('auth', 'lane ratchet: authentication failed'); }
}

function randomBytes(n: number): Uint8Array { const u = new Uint8Array(n); crypto.getRandomValues(u); return u; }

// ── header ───────────────────────────────────────────────────────────────
function u32be(n: number): Uint8Array { return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]); }
function readU32(u: Uint8Array, o: number): number { return ((u[o] << 24) >>> 0) + (u[o + 1] << 16) + (u[o + 2] << 8) + u[o + 3]; }
function encodeHeader(pk: Uint8Array, pn: number, n: number): Uint8Array { const h = new Uint8Array(HEADER_BYTES); h[0] = VERSION; h.set(pk, 1); h.set(u32be(pn), 33); h.set(u32be(n), 37); return h; }
function parseHeader(wire: Uint8Array): { pk: Uint8Array; pn: number; n: number } {
  if (wire.length < MIN_WIRE_BYTES) throw new RatchetError('short', `lane ratchet: wire too short (${wire.length} < ${MIN_WIRE_BYTES})`);
  if (wire[0] !== VERSION) throw new RatchetError('version', `lane ratchet: wire version 0x${wire[0].toString(16)}, expected 0x03`);
  return { pk: wire.slice(1, 33), pn: readU32(wire, 33), n: readU32(wire, 37) };
}
export const hex = (u: Uint8Array): string => Array.from(u, (b) => b.toString(16).padStart(2, '0')).join('');
export const unhex = (s: string): Uint8Array => Uint8Array.from(s.match(/../g) || [], (h) => parseInt(h, 16));
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
const skipKey = (pk: Uint8Array, n: number) => `${hex(pk)}:${n}`;

// ── state ────────────────────────────────────────────────────────────────
// { rootKey, dhs (secret), dhr (peer pk | null), cks, ckr, ns, nr, pn, skipped: Map<"pkhex:n", mk> }
function clone(s: RatchetState): RatchetState {
  return { rootKey: s.rootKey.slice(), dhs: s.dhs.slice(), dhr: s.dhr ? s.dhr.slice() : null, cks: s.cks ? s.cks.slice() : null, ckr: s.ckr ? s.ckr.slice() : null,
    ns: s.ns, nr: s.nr, pn: s.pn, skipped: new Map(s.skipped) };
}

// Build a ratchet for `role` ('initiator' | 'responder') from the 32-byte
// root_lane the hybrid handshake agreed. root_lane is not retained.
export async function create(rootLane: Uint8Array, role: LaneRole): Promise<RatchetState> {
  if (!(rootLane instanceof Uint8Array) || rootLane.length !== 32) throw new RatchetError('invalid_key', 'lane ratchet: root_lane must be 32 bytes');
  const rk0 = await hkdf32(rootLane, INFO_RK0);
  const boot = await hkdf32(rootLane, INFO_BOOT);
  const seed = await hkdf32(rootLane, INFO_INIT);
  const responderSk = seed;                         // x25519 clamps on use, as x25519-dalek's StaticSecret::from does
  const responderPk = x25519.getPublicKey(responderSk);
  if (role === 'responder') {
    return { rootKey: rk0, dhs: responderSk, dhr: null, cks: boot, ckr: null, ns: 0, nr: 0, pn: 0, skipped: new Map() };
  }
  if (role === 'initiator') {
    const dhs = randomBytes(32);
    const { rk, ck } = await kdfRk(rk0, dhs, responderPk);
    return { rootKey: rk, dhs, dhr: responderPk, cks: ck, ckr: boot, ns: 0, nr: 0, pn: 0, skipped: new Map() };
  }
  throw new RatchetError('role', `lane ratchet: unknown role ${role}`);
}

export function publicKey(s: RatchetState): Uint8Array { return x25519.getPublicKey(s.dhs); }

// Completes a deferred DH step on the SEND path (never reachable from the wire).
async function openSendingChain(s: RatchetState): Promise<RatchetState> {
  if (s.cks) return s;
  if (!s.dhr) throw new RatchetError('protocol', 'lane ratchet: no sending chain yet; receive one message first');
  const newDhs = randomBytes(32);
  const { rk, ck } = await kdfRk(s.rootKey, newDhs, s.dhr!);
  s.dhs.fill(0); s.dhs = newDhs; s.rootKey.fill(0); s.rootKey = rk; s.cks = ck;
  return s;
}

// seal(state, plaintext) -> { wire, next }. Pure over the state (returns a new one).
export async function seal(state: RatchetState, plaintext: Uint8Array): Promise<{ wire: Uint8Array; next: RatchetState }> {
  const s = clone(state);
  await openSendingChain(s);
  const n = s.ns;
  if (n === 0xffffffff) throw new RatchetError('protocol', 'lane ratchet: sending chain exhausted');
  const { mk, next } = await kdfCk(s.cks!);
  const nonce = randomBytes(NONCE_BYTES);
  const header = encodeHeader(publicKey(s), s.pn, n);
  const ct = await aeadSeal(mk, nonce, header, plaintext);
  mk.fill(0);
  s.cks = next; s.ns = n + 1;
  const wire = new Uint8Array(header.length + nonce.length + ct.length);
  wire.set(header, 0); wire.set(nonce, header.length); wire.set(ct, header.length + nonce.length);
  return { wire, next: s };
}

async function skipTo(s: RatchetState, until: number): Promise<void> {
  if (until <= s.nr) return;
  if (!s.ckr) throw new RatchetError('protocol', `lane ratchet: header claims message ${until} with no receiving chain`);
  const count = until - s.nr;
  if (count > MAX_SKIP) throw new RatchetError('protocol', `lane ratchet: header claims a skip of ${count} messages, MAX_SKIP is ${MAX_SKIP}`);
  if (s.skipped.size + count > MAX_SKIPPED_KEYS) throw new RatchetError('protocol', `lane ratchet: retaining ${count} more keys would exceed MAX_SKIPPED_KEYS`);
  if (!s.dhr) throw new RatchetError('protocol', 'lane ratchet: receiving chain has no peer key');
  for (let i = 0; i < count; i++) {
    const { mk, next } = await kdfCk(s.ckr);
    s.skipped.set(skipKey(s.dhr, s.nr), mk);
    s.ckr = next; s.nr++;
  }
}

async function dhRatchet(s: RatchetState, theirPk: Uint8Array): Promise<void> {
  const { rk, ck } = await kdfRk(s.rootKey, s.dhs, theirPk);
  s.pn = s.ns; s.ns = 0; s.nr = 0; s.dhr = theirPk.slice();
  if (s.ckr) s.ckr.fill(0);
  if (s.cks) s.cks.fill(0);
  s.ckr = ck; s.cks = null; s.rootKey.fill(0); s.rootKey = rk;
}

// open(state, wire) -> { plaintext, next }. State is untouched on any failure.
export async function open(state: RatchetState, wire: Uint8Array): Promise<OpenResult> {
  const header = parseHeader(wire);
  const aad = wire.slice(0, HEADER_BYTES);
  const nonce = wire.slice(HEADER_BYTES, HEADER_BYTES + NONCE_BYTES);
  const ct = wire.slice(HEADER_BYTES + NONCE_BYTES);
  const s = clone(state);

  const slot = skipKey(header.pk, header.n);
  if (s.skipped.has(slot)) {
    const mk = s.skipped.get(slot)!;
    const pt = await aeadOpen(mk, nonce, aad, ct);     // throws → state untouched
    s.skipped.delete(slot); mk.fill(0);
    return { plaintext: pt, next: s, skippedUsed: true };
  }

  let ratcheted = false;
  if (!s.dhr || !eq(s.dhr, header.pk)) {
    await skipTo(s, header.pn);
    await dhRatchet(s, header.pk);
    ratcheted = true;
  }
  await skipTo(s, header.n);
  if (header.n < s.nr) throw new RatchetError('replay', `lane ratchet: message ${header.n} already consumed (receiving chain at ${s.nr})`);
  if (!s.ckr) throw new RatchetError('protocol', 'lane ratchet: no receiving chain for this message');
  const { mk, next } = await kdfCk(s.ckr);
  const pt = await aeadOpen(mk, nonce, aad, ct);       // throws → state untouched
  mk.fill(0);
  s.ckr = next; s.nr = header.n + 1;
  return { plaintext: pt, next: s, ratcheted, gap: header.n - state.nr };
}

// ── persistence (private files; the caller sets modes) ───────────────────
export function encodeState(s: RatchetState): string {
  const b = (u: Uint8Array | null) => (u ? b64(u) : null);
  return JSON.stringify({ v: 3, rootKey: b(s.rootKey), dhs: b(s.dhs), dhr: b(s.dhr), cks: b(s.cks), ckr: b(s.ckr), ns: s.ns, nr: s.nr, pn: s.pn,
    skipped: [...s.skipped.entries()].map(([k, mk]) => [k, b(mk)]) });
}
export function decodeState(raw: string): RatchetState {
  const o = JSON.parse(raw);
  if (!o || o.v !== 3) throw new RatchetError('state', 'lane ratchet: not a v3 state');
  const u = (x: string | null) => (x ? unb64(x) : null);
  return { rootKey: u(o.rootKey)!, dhs: u(o.dhs)!, dhr: u(o.dhr), cks: u(o.cks), ckr: u(o.ckr), ns: o.ns, nr: o.nr, pn: o.pn, skipped: new Map((o.skipped || []).map(([k, mk]: [string, string]) => [k, u(mk)!])) };
}

export const LANE_RATCHET_VERSION = VERSION;
export { HEADER_BYTES, NONCE_BYTES, MIN_WIRE_BYTES, MAX_SKIP, MAX_SKIPPED_KEYS, hkdf32, kdfRk, kdfCk, parseHeader, encodeHeader };

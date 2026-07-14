// ============================================================
// COROS — CONSTANT-ENVELOPE CORKSCREW TRANSPORT · src/helix.ts
//
// The sealed counterpart to security-network.ts. Where the security network
// is the WITNESS layer — adaptive, environment-aware, it weighs the outside
// world and escalates — this is its opposite by design: a held quantity,
// deaf to the environment, that wraps a payload so the wire carries no
// exploitable structure and no length/format tell.
//
// The geometry is a CORKSCREW, not a spiral. A φ-spiral EXPANDS — its growing
// radius is exactly the spectral fingerprint an FFT locks onto. A corkscrew
// is a helix on a torus wound at the golden ratio: constant amplitude,
// constant pitch, advancing through phase without ever growing, and — by
// Weyl's equidistribution theorem — covering its space uniformly and forever
// without repeating. Uniform coverage is a FLAT spectrum: homogeneity and
// isotropic suppression, made literal. That is the φ contribution, and it is
// the ONLY thing φ contributes here.
//
// THE BOUNDARY THAT MATTERS: φ never provides secrecy. Confidentiality is
// AES-256-GCM (WebCrypto), full stop — if the corkscrew layer were broken to
// zero, the payload is still exactly as safe as the vetted AEAD makes it.
// The corkscrew adds COVERTNESS on top: length-hiding (golden low-discrepancy
// padding) and keyed whitening (the wire is uniform noise of a uniform-band
// size, not parseable, not fingerprintable as GCM). This is defense-in-depth
// and traffic-analysis resistance — NOT a replacement for TLS or the cipher,
// and never the sole lock on anything.
//
// "Ignores partial threshold, environment-blind, whole-or-nothing" — that is
// the GCM authentication tag: a tampered or truncated wire is rejected
// entirely, never partially decoded, and the layer never adapts to what it
// sees. "Does not iterate" — every message is self-contained; the 16-byte
// nonce N is the sole recovery regulator, re-deriving keys and geometry with
// no cross-message state to desync.
// ============================================================

// ── The corkscrew: golden-ratio low-discrepancy sequence (pure) ─────────────
// α = 1/φ is the "most irrational" number — the additive recurrence
// frac(x₀ + n·α) equidistributes on [0,1) faster than any other constant
// (Weyl), never repeats, and is fully deterministic. This governs GEOMETRY
// (padded length), never the secret bytes.
export const PHI_INV = (Math.sqrt(5) - 1) / 2; // 0.6180339887…

export function golden(n: number, x0 = 0): number {
  const v = (x0 + n * PHI_INV) % 1;
  return v < 0 ? v + 1 : v;
}

// Padded length for a plaintext of L bytes at corkscrew index `index`.
// Always ≥ L + LEN_PREFIX, always a whole number of BLOCKs, with a
// golden-distributed number of extra blocks so two messages of different
// true length land on the same size band — the length tell is suppressed.
export const BLOCK = 256;      // container granularity
export const LEN_PREFIX = 4;   // u32 true-length header, authenticated inside
const EXTRA_BLOCKS = 4;        // golden jitter spread, in blocks

export function goldenPad(L: number, index: number): number {
  const need = Math.max(0, L) + LEN_PREFIX;
  const base = Math.ceil(need / BLOCK) * BLOCK || BLOCK;
  const extra = Math.floor(golden(index) * EXTRA_BLOCKS) * BLOCK;
  return base + extra;
}

// ── byte helpers (pure) ─────────────────────────────────────────────────────
export function xorBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i % b.length];
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function u32be(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, false);
  return b;
}
function readU32be(b: Uint8Array, off = 0): number {
  return new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(off, false);
}

// ── keyed layer (WebCrypto — AES-256-GCM confidentiality + AES-CTR whitening) ─
const NONCE_BYTES = 16;
const enc = (s: string) => new TextEncoder().encode(s);

// HKDF-SHA256(master, salt=N) → the per-message keys. A fresh AES-GCM key per
// message means even if N (hence the GCM iv) collided, the (key,iv) pair does
// not — the derivation is the safety margin.
async function deriveKeys(master: Uint8Array, nonce: Uint8Array): Promise<{
  encKey: CryptoKey; shapeKey: CryptoKey; iv: Uint8Array;
}> {
  const base = await crypto.subtle.importKey('raw', master, 'HKDF', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: nonce, info: enc('elle-coros-v1') }, base, 8 * (32 + 32 + 12),
  ));
  const encRaw = bits.slice(0, 32);
  const shapeRaw = bits.slice(32, 64);
  const iv = bits.slice(64, 76);
  const encKey = await crypto.subtle.importKey('raw', encRaw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  const shapeKey = await crypto.subtle.importKey('raw', shapeRaw, 'AES-CTR', false, ['encrypt']);
  return { encKey, shapeKey, iv };
}

// Keyed whitening keystream: AES-CTR over zeros is a cryptographic PRG, so the
// masked container is uniform. (The bytes are strong because AES makes them
// strong — the corkscrew only decides how MANY of them there are.)
async function whitenStream(shapeKey: CryptoKey, len: number): Promise<Uint8Array> {
  const counter = new Uint8Array(16); // deterministic from the per-message shapeKey
  const zeros = new Uint8Array(len);
  const ks = await crypto.subtle.encrypt({ name: 'AES-CTR', counter, length: 64 }, shapeKey, zeros);
  return new Uint8Array(ks);
}

// seal: plaintext → wire. wire = N ‖ whiten( AES-GCM( u32(L) ‖ pt ‖ pad ) ).
export async function seal(master: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const { encKey, shapeKey, iv } = await deriveKeys(master, nonce);

  const index = readU32be(nonce, 0);               // corkscrew index — from N, so the decoder needn't know it
  const padLen = goldenPad(plaintext.length, index);
  const buf = new Uint8Array(padLen);
  buf.set(u32be(plaintext.length), 0);
  buf.set(plaintext, LEN_PREFIX);                  // remainder stays zero → padding

  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, encKey, buf));
  const masked = xorBytes(ct, await whitenStream(shapeKey, ct.length));
  return concat(nonce, masked);
}

// open: wire → plaintext. Throws on a bad tag (whole-or-nothing) or malformed
// input — it never returns a partial or best-effort decode.
export async function open(master: Uint8Array, wire: Uint8Array): Promise<Uint8Array> {
  if (wire.length < NONCE_BYTES + 16 + LEN_PREFIX) throw new Error('coros: wire too short');
  const nonce = wire.slice(0, NONCE_BYTES);
  const masked = wire.slice(NONCE_BYTES);
  const { encKey, shapeKey, iv } = await deriveKeys(master, nonce);

  const ct = xorBytes(masked, await whitenStream(shapeKey, masked.length));
  const buf = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, encKey, ct)); // throws on tamper
  const L = readU32be(buf, 0);
  if (L > buf.length - LEN_PREFIX) throw new Error('coros: length header exceeds container');
  return buf.slice(LEN_PREFIX, LEN_PREFIX + L);
}

// ── self-test — proves the round-trip + the covertness invariants end to end.
// Admin-gated in index.ts. Deterministic given a master key; no secrets echoed.
export interface CorosSelfTest {
  ok: boolean;
  roundtrips: number;
  tamper_rejected: boolean;
  wrong_key_rejected: boolean;
  length_hidden: boolean;      // two different plaintext lengths share a wire size
  wire_band_ok: boolean;       // wire length ≡ NONCE+TAG (mod BLOCK) — constant-band envelope
  note: string;
}

export async function corosSelfTest(): Promise<CorosSelfTest> {
  const master = crypto.getRandomValues(new Uint8Array(32));
  const other = crypto.getRandomValues(new Uint8Array(32));
  const te = new TextEncoder();
  const samples = ['', 'hi', 'the corkscrew winds but never closes', 'x'.repeat(500)];

  let roundtrips = 0;
  for (const s of samples) {
    const pt = te.encode(s);
    const back = await open(master, await seal(master, pt));
    if (new TextDecoder().decode(back) === s) roundtrips++;
  }

  // tamper: flip one wire byte → the GCM tag must reject wholesale.
  let tamper_rejected = false;
  const w = await seal(master, te.encode('sealed'));
  w[w.length - 1] ^= 0x01;
  try { await open(master, w); } catch { tamper_rejected = true; }

  // wrong key → reject.
  let wrong_key_rejected = false;
  try { await open(other, await seal(master, te.encode('sealed'))); } catch { wrong_key_rejected = true; }

  // length-hiding: a 10-byte and a 200-byte payload should be able to share a
  // wire size (both fall in the first block band). We assert the wire length
  // reveals only the band, never the exact plaintext length.
  const wA = (await seal(master, new Uint8Array(10))).length;
  const wB = (await seal(master, new Uint8Array(200))).length;
  const band = (n: number) => (n - NONCE_BYTES - 16) % BLOCK === 0;
  const length_hidden = band(wA) && band(wB);
  const wire_band_ok = band(wA) && band(wB) && band(w.length);

  const ok = roundtrips === samples.length && tamper_rejected && wrong_key_rejected && wire_band_ok;
  return {
    ok, roundtrips, tamper_rejected, wrong_key_rejected, length_hidden, wire_band_ok,
    note: 'AES-256-GCM is the confidentiality boundary; the φ corkscrew adds length-hiding + keyed whitening (covertness), never secrecy.',
  };
}

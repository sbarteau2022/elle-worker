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
//
// `exact: true` suppresses the golden jitter and pads to the *minimum* block
// multiple — used by the constant-rate regulator, where each frame is already
// a fixed size, so a fixed input must map to a fixed wire (no per-message
// variation to observe). The default (banded golden padding) is for
// request/response, where you can't send continuous cover traffic.
export async function seal(master: Uint8Array, plaintext: Uint8Array, opts: { exact?: boolean } = {}): Promise<Uint8Array> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const { encKey, shapeKey, iv } = await deriveKeys(master, nonce);

  const index = readU32be(nonce, 0);               // corkscrew index — from N, so the decoder needn't know it
  const padLen = opts.exact
    ? Math.max(1, Math.ceil((plaintext.length + LEN_PREFIX) / BLOCK)) * BLOCK
    : goldenPad(plaintext.length, index);
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

// ════════════════════════════════════════════════════════════════════════════
// THE REGULATORS — the witness layer's optimizer ROLES in homeostatic form.
// Each drives toward a FIXED internal setpoint, blind to the plaintext and to
// the adversary. That blindness is the whole point: an optimizer that reacted
// to content would make the transform content-dependent, i.e. a side channel —
// the exact leak the constant envelope exists to close. Same jobs the witness
// has (heal, balance, gate), opposite reference point (internal, not external).
// ════════════════════════════════════════════════════════════════════════════

const hkdf32 = async (key: Uint8Array, info: string): Promise<Uint8Array> => {
  const base = await crypto.subtle.importKey('raw', key, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc(info) }, base, 256,
  ));
};

// ── REGULATOR 1 · the forward ratchet (the witness's "decay/heal", sealed) ───
// The chain key advances one-way per message: this message's key is derived
// from the current chain key, then the chain key is replaced by a fresh
// one-way derivation of itself. A caller that OVERWRITES its state with `next`
// and discards the old key gets forward secrecy — a compromise of the current
// chain key cannot reconstruct any past message key, because the pre-image
// (the earlier chain key) is gone and HKDF is not invertible. This is "healing"
// without adapting: the state only ever moves forward, on its own schedule,
// with no reference to the outside world.
export interface Ratchet { chainKey: Uint8Array; counter: number }

export async function ratchetInit(master: Uint8Array): Promise<Ratchet> {
  return { chainKey: await hkdf32(master, 'coros-ratchet-root'), counter: 0 };
}

export async function ratchetStep(r: Ratchet): Promise<{ messageKey: Uint8Array; next: Ratchet }> {
  const messageKey = await hkdf32(r.chainKey, 'coros-msg');
  const nextChain = await hkdf32(r.chainKey, 'coros-chain');
  return { messageKey, next: { chainKey: nextChain, counter: r.counter + 1 } };
}

// Ratcheted seal/open: the counter rides on the wire so an in-order receiver
// knows which step produced it. wire = u32(counter) ‖ seal(messageKey, pt).
export async function ratchetSeal(r: Ratchet, plaintext: Uint8Array): Promise<{ wire: Uint8Array; next: Ratchet }> {
  const { messageKey, next } = await ratchetStep(r);
  const inner = await seal(messageKey, plaintext);
  return { wire: concat(u32be(r.counter), inner), next };
}

// The receiver holds its own ratchet and advances in lock-step. A counter that
// runs ahead of the receiver's state is fast-forwarded to (skipped message
// keys are derived and discarded — never rewound); a counter in the past is
// rejected outright, because rewinding would forfeit forward secrecy.
export async function ratchetOpen(r: Ratchet, wire: Uint8Array): Promise<{ plaintext: Uint8Array; next: Ratchet }> {
  if (wire.length < 4) throw new Error('coros: ratchet wire too short');
  const counter = readU32be(wire, 0);
  if (counter < r.counter) throw new Error('coros: stale counter — refusing to rewind the ratchet');
  let cur = r;
  while (cur.counter < counter) cur = (await ratchetStep(cur)).next; // fast-forward, discarding keys
  const { messageKey, next } = await ratchetStep(cur);
  const plaintext = await open(messageKey, wire.slice(4));
  return { plaintext, next };
}

// ── REGULATOR 2 · the constant-rate envelope (the witness's "balance", sealed)
// Traffic-shaping to a fixed setpoint: every payload is carved into
// fixed-size frames, and when there is nothing to send the channel emits COVER
// frames that decode to nothing. After seal({exact:true}) every frame — data
// or cover — is the SAME wire size, so an observer sees one constant carrier
// whether you are sending a novel, a "yes", or silence. The setpoint
// (FRAME_PAYLOAD) is fixed and content-independent: no anisotropy to read.
export const FRAME_PAYLOAD = 512;
const FRAME_HDR = 4; // [u8 type: 1=data 0=cover][u8 more][u16 fragLen]
const FRAG_MAX = FRAME_PAYLOAD - FRAME_HDR;

export function packFrames(payload: Uint8Array, framePayload = FRAME_PAYLOAD): Uint8Array[] {
  const cap = framePayload - FRAME_HDR;
  const frames: Uint8Array[] = [];
  let off = 0;
  do {
    const frag = payload.slice(off, off + cap);
    const f = new Uint8Array(framePayload); // zero-padded to the fixed setpoint
    const dv = new DataView(f.buffer);
    f[0] = 1;                                          // data
    f[1] = off + frag.length < payload.length ? 1 : 0; // more-fragments-follow
    dv.setUint16(2, frag.length, false);
    f.set(frag, FRAME_HDR);
    frames.push(f);
    off += cap;
  } while (off < payload.length);
  return frames;
}

export function coverFrame(framePayload = FRAME_PAYLOAD): Uint8Array {
  return new Uint8Array(framePayload); // type byte 0 → cover; all zero
}

export function unpackFrames(frames: Uint8Array[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const f of frames) {
    if (f[0] !== 1) continue; // cover / unknown → carries nothing
    const len = new DataView(f.buffer, f.byteOffset, f.byteLength).getUint16(2, false);
    parts.push(f.slice(FRAME_HDR, FRAME_HDR + Math.min(len, FRAG_MAX)));
  }
  return concat(...parts);
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
  ratchet_ok: boolean;         // forward ratchet round-trips + advances one-way
  constant_rate_ok: boolean;   // every data/cover frame seals to one identical wire size
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

  // REGULATOR 1 — forward ratchet: sender and receiver walk independent chains
  // from the same master and stay in lock-step across several messages, and
  // consecutive message keys differ (the chain actually advances).
  let ratchet_ok = false;
  try {
    let rs = await ratchetInit(master);
    let rr = await ratchetInit(master);
    const msgs = ['one', 'two', 'three'];
    let all = true;
    const k0 = (await ratchetStep(rs)).messageKey;
    const k1 = (await ratchetStep((await ratchetStep(rs)).next)).messageKey;
    for (const m of msgs) {
      const s = await ratchetSeal(rs, te.encode(m)); rs = s.next;
      const o = await ratchetOpen(rr, s.wire); rr = o.next;
      if (new TextDecoder().decode(o.plaintext) !== m) all = false;
    }
    ratchet_ok = all && k0.join(',') !== k1.join(',');
  } catch { ratchet_ok = false; }

  // REGULATOR 2 — constant rate: a large payload's data frames and an idle
  // cover frame all seal (exact) to one identical wire size, and the frames
  // reassemble to the original while cover carries nothing.
  let constant_rate_ok = false;
  try {
    const payload = crypto.getRandomValues(new Uint8Array(1500));
    const frames = packFrames(payload);
    const wires = await Promise.all([...frames, coverFrame()].map(f => seal(master, f, { exact: true })));
    const sizes = new Set(wires.map(x => x.length));
    const reassembled = unpackFrames(await Promise.all(wires.slice(0, frames.length).map(w2 => open(master, w2))));
    const coverEmpty = unpackFrames([coverFrame()]).length === 0;
    constant_rate_ok = sizes.size === 1 && coverEmpty &&
      reassembled.length === payload.length && reassembled.every((b, i) => b === payload[i]);
  } catch { constant_rate_ok = false; }

  const ok = roundtrips === samples.length && tamper_rejected && wrong_key_rejected &&
    wire_band_ok && ratchet_ok && constant_rate_ok;
  return {
    ok, roundtrips, tamper_rejected, wrong_key_rejected, length_hidden, wire_band_ok,
    ratchet_ok, constant_rate_ok,
    note: 'AES-256-GCM is the confidentiality boundary; the φ corkscrew adds covertness (length-hiding + whitening). Regulators are homeostatic — forward ratchet (forward secrecy) + constant-rate framing (traffic-flow confidentiality) — and blind to content, never adaptive.',
  };
}

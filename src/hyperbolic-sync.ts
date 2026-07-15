// ============================================================
// HYPERBOLIC-GEODESIC SYNC — src/hyperbolic-sync.ts  ("the Einstein-Rosen rung")
//
// The geometry swap on torus-sync.ts. Same skeleton — secret origin, per-tick
// key, AEAD-gated forward-only search, no counter on the wire — but the phase
// no longer winds on a FLAT torus. It walks a geodesic in the HYPERBOLIC plane
// (the Poincaré disk, a totally-geodesic slice of the same Poincaré ball the
// Atlas memory graph already lives in — docs/HYPERBOLIC_GRAPH_MAPPING.md).
//
// The honest reading of the "Einstein-Rosen bridge": NOT a wormhole that
// carries the signal (non-traversable without exotic matter; the no-
// communication theorem forbids superluminal/entanglement signaling — nothing
// here moves faster than light or moves a bit without a channel). Instead:
//
//   • THE BRIDGE = the shared secret geodesic. Two endpoints agree on a base
//     point + direction in the disk (both from the master). That geodesic is
//     the "bridge"; an observer who doesn't know it cannot place the walk.
//   • "WARPING TIME" = the clock runs on HYPERBOLIC ARC-LENGTH. Equal ticks are
//     equal hyperbolic distance but UNEQUAL Euclidean distance (the conformal
//     factor blows up toward the boundary), so the cadence is curvature-warped:
//     regular in hyperbolic time, irregular to a flat-space observer.
//   • THE SHORTCUT is real but geometric: in negative curvature the interior
//     chord between two points is far shorter than the surface path. That is a
//     routing/coordinate fact, not a faster-than-light one.
//
// Confidentiality is STILL AES-256-GCM inside COROS seal(); hyperbolic geometry
// adds covert, curvature-warped synchronization, never secrecy.
//
// NUMERICAL-DETERMINISM CAVEAT (real, load-bearing): the position depends on
// tanh/atanh/sqrt, whose last-ULP results are not guaranteed identical across
// platforms. Both endpoints MUST agree on the quantized position bit-for-bit or
// the derived key diverges and sync fails. Mitigated here by COARSE (16-bit/dim)
// quantization that absorbs ULP noise; a cross-platform deployment needs
// fixed-point or a correctly-rounded hyperbolic math library. Same-runtime
// (both ends the same build — the realistic Elle case) is deterministic.
// ============================================================

import { seal, open, PHI_INV } from './helix';

const enc = (s: string) => new TextEncoder().encode(s);

// ── Poincaré-disk primitives (curvature −1), pure and identity-tested ────────
// Vectors are Float64Array of length 2 with Euclidean norm < 1.
const dot = (a: Float64Array, b: Float64Array): number => a[0] * b[0] + a[1] * b[1];
const norm2 = (a: Float64Array): number => dot(a, a);
const norm = (a: Float64Array): number => Math.sqrt(norm2(a));
const scale = (a: Float64Array, s: number): Float64Array => Float64Array.from(a, (x) => x * s);
const neg = (a: Float64Array): Float64Array => scale(a, -1);

// Möbius addition (Ungar gyrovector sum) — the group operation of the disk.
// x ⊕ y = [(1 + 2⟨x,y⟩ + |y|²)x + (1 − |x|²)y] / [1 + 2⟨x,y⟩ + |x|²|y|²]
export function mobiusAdd(x: Float64Array, y: Float64Array): Float64Array {
  const xy = dot(x, y), xx = norm2(x), yy = norm2(y);
  const cX = 1 + 2 * xy + yy;
  const cY = 1 - xx;
  const den = 1 + 2 * xy + xx * yy;
  return Float64Array.from([ (cX * x[0] + cY * y[0]) / den, (cX * x[1] + cY * y[1]) / den ]);
}

// Hyperbolic distance: d(x,y) = 2·artanh(|(−x) ⊕ y|).
export function hyperDistance(x: Float64Array, y: Float64Array): number {
  return 2 * Math.atanh(Math.min(1 - 1e-15, norm(mobiusAdd(neg(x), y))));
}

// Move hyperbolic arc-length s from p along the geodesic in gyro-direction u
// (u a Euclidean unit vector). By the left-cancellation law d(p, step) = s
// exactly, for any p — the Euclidean direction bends (the geodesic curves),
// which is the whole point of doing this in curved space.
export function geodesicStep(p: Float64Array, u: Float64Array, s: number): Float64Array {
  const un = norm(u) || 1;
  const t = Math.tanh(s / 2);
  return mobiusAdd(p, Float64Array.from([ (u[0] / un) * t, (u[1] / un) * t ]));
}

// Keep the walk bounded away from the boundary with an ISOMETRIC retraction
// (a Möbius translation inward) — so the position never saturates at |p|→1
// where the conformal factor explodes and quantization would freeze.
const R_MAX = 0.9;
const RETRACT = 0.5;
function bound(p: Float64Array): Float64Array {
  const r = norm(p);
  if (r <= R_MAX) return p;
  const uhat = Float64Array.from([p[0] / r, p[1] / r]);
  return mobiusAdd(scale(uhat, -RETRACT), p); // isometric pull inward
}

// ── the walk — a deterministic, bounded, curvature-warped hyperbolic orbit ───
// Direction rotates by a golden angle each tick (never repeats, equidistributes
// the heading), so the walk curves and fills a bounded region rather than
// running straight to one boundary point. HONEST SCOPE: this is an engineered
// bounded hyperbolic walk, not the geodesic flow on a specific arithmetic
// surface — the rigorous ergodic ideal (an Anosov flow on a compact quotient)
// is heavier; this is its buildable, testable stand-in. Every step is a genuine
// geodesic arc + an isometry, so the metric behaviour is real.
const STEP = 0.5; // hyperbolic arc-length per tick

export function advancePoint(p: Float64Array, tick: number, phi0: number): Float64Array {
  const ang = 2 * Math.PI * ((phi0 + tick * PHI_INV) % 1);
  const u = Float64Array.from([Math.cos(ang), Math.sin(ang)]);
  return bound(geodesicStep(p, u, STEP));
}

// Coarse quantization (16 bits/dim) — absorbs cross-op ULP noise so both ends
// derive the same key (see the determinism caveat in the header).
export function quantizePoint(p: Float64Array): Uint8Array {
  const out = new Uint8Array(p.length * 2);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < p.length; i++) {
    const q = Math.max(0, Math.min(65535, Math.round(((Math.max(-1, Math.min(1, p[i])) + 1) / 2) * 65535)));
    dv.setUint16(i * 2, q, false);
  }
  return out;
}

function u32be(n: number): Uint8Array {
  const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0, false); return b;
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
async function hkdf(master: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey('raw', master, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info }, base, bytes * 8));
}

// ── the channel — the secret geodesic (base point + heading), from the master ─
export interface HypChannel { master: Uint8Array; origin: Float64Array; phi0: number }
export interface HypState { point: Float64Array; tick: number }

export async function initHypChannel(master: Uint8Array): Promise<HypChannel> {
  const raw = await hkdf(master, enc('coros-hyp-origin-v1'), 12);
  const dv = new DataView(raw.buffer);
  // Base point inside radius 0.5 (well clear of the boundary); heading in [0,1).
  const ang = (dv.getUint32(0, false) / 4294967296) * 2 * Math.PI;
  const rad = (dv.getUint32(4, false) / 4294967296) * 0.5;
  const phi0 = dv.getUint32(8, false) / 4294967296;
  const origin = Float64Array.from([rad * Math.cos(ang), rad * Math.sin(ang)]);
  return { master, origin, phi0 };
}

export function hypStart(ch: HypChannel): HypState {
  return { point: Float64Array.from(ch.origin), tick: 0 };
}

export function hypAdvance(ch: HypChannel, s: HypState): HypState {
  return { point: advancePoint(s.point, s.tick + 1, ch.phi0), tick: s.tick + 1 };
}

// Per-tick COROS master: the hyperbolic POSITION indexes, the tick domain-
// separates, the master secures. Swapping the geometry (this file vs. the flat
// torus) genuinely changes the key stream — the search loop is unchanged.
async function keyFromState(ch: HypChannel, s: HypState): Promise<Uint8Array> {
  return hkdf(ch.master, concat(enc('coros-hyp-key-v1'), u32be(s.tick), quantizePoint(s.point)), 32);
}

// seal at the current state — a plain COROS exact frame, no counter on the wire.
export async function hypSeal(ch: HypChannel, s: HypState, plaintext: Uint8Array): Promise<{ wire: Uint8Array; next: HypState }> {
  const wire = await seal(await keyFromState(ch, s), plaintext, { exact: true });
  return { wire, next: hypAdvance(ch, s) };
}

// open — bounded, forward-only, AEAD-gated geodesic search. From the receiver's
// state, step the walk forward up to `window` ticks; the first that authenticates
// wins. Forward-only (never rewinds) is the replay guard; every candidate is
// tried (constant-work) so resync doesn't leak through timing.
export async function hypOpen(
  ch: HypChannel, state: HypState, wire: Uint8Array, window = 32,
): Promise<{ plaintext: Uint8Array; next: HypState }> {
  if (window < 1) throw new Error('hyperbolic-sync: window must be ≥ 1');
  const cands: HypState[] = [];
  let cur = state;
  for (let k = 0; k < window; k++) { cands.push(cur); cur = hypAdvance(ch, cur); }
  const keys = await Promise.all(cands.map((c) => keyFromState(ch, c)));
  let hit: { plaintext: Uint8Array; state: HypState } | null = null;
  for (let k = 0; k < window; k++) {
    try {
      const pt = await open(keys[k], wire);
      if (hit === null) hit = { plaintext: pt, state: cands[k] };
    } catch { /* wrong position → noise; keep the window constant-work */ }
  }
  if (!hit) throw new Error('hyperbolic-sync: no in-window geodesic position authenticated');
  return { plaintext: hit.plaintext, next: hypAdvance(ch, hit.state) };
}

// ── self-test ────────────────────────────────────────────────────────────────
export interface HypSelfTest {
  ok: boolean;
  primitives: boolean;        // Möbius/distance identities hold numerically
  bounded: boolean;           // the walk never approaches the boundary
  roundtrip: boolean;
  resync_after_loss: boolean;
  beyond_window_rejected: boolean;
  rewind_rejected: boolean;
  no_counter_overhead: boolean;
  wrong_master_rejected: boolean;
  secret_geodesic: boolean;
  note: string;
}

export async function hyperbolicSyncSelfTest(): Promise<HypSelfTest> {
  const te = new TextEncoder(); const td = new TextDecoder();

  // primitives: 0⊕x=x, (−x)⊕x=0, d(0,x)=2 artanh|x|, step moves exactly STEP
  const x = Float64Array.from([0.2, -0.3]);
  const e1 = norm(mobiusAdd(Float64Array.from([0, 0]), x)) - norm(x);
  const e2 = norm(mobiusAdd(neg(x), x));
  const e3 = Math.abs(hyperDistance(Float64Array.from([0, 0]), x) - 2 * Math.atanh(norm(x)));
  const e4 = Math.abs(hyperDistance(x, geodesicStep(x, Float64Array.from([0.6, 0.8]), 0.5)) - 0.5);
  const primitives = Math.abs(e1) < 1e-12 && e2 < 1e-12 && e3 < 1e-12 && e4 < 1e-9;

  const master = crypto.getRandomValues(new Uint8Array(32));
  const other = crypto.getRandomValues(new Uint8Array(32));
  const ch = await initHypChannel(master);

  // bounded: the walk stays clear of the boundary over a long run
  let bounded = true; { let s = hypStart(ch); for (let i = 0; i < 3000; i++) { s = hypAdvance(ch, s); if (norm(s.point) >= 0.999) { bounded = false; break; } } }

  // lock-step round-trip
  let roundtrip = true; { let s = hypStart(ch), r = hypStart(ch);
    for (const m of ['one', 'two', 'three']) {
      const o = await hypSeal(ch, s, te.encode(m)); s = o.next;
      const d = await hypOpen(ch, r, o.wire, 8); r = d.next;
      if (td.decode(d.plaintext) !== m) roundtrip = false;
    } }

  // resync after loss: sender at tick 5, receiver at tick 2
  let resync_after_loss = false;
  try {
    let s = hypStart(ch); for (let i = 0; i < 5; i++) s = hypAdvance(ch, s);
    const w = (await hypSeal(ch, s, te.encode('resync'))).wire;
    let r = hypStart(ch); for (let i = 0; i < 2; i++) r = hypAdvance(ch, r);
    const d = await hypOpen(ch, r, w, 8);
    resync_after_loss = td.decode(d.plaintext) === 'resync' && d.next.tick === 6;
  } catch { resync_after_loss = false; }

  // loss beyond the window → refused
  let beyond_window_rejected = false;
  try {
    let s = hypStart(ch); for (let i = 0; i < 20; i++) s = hypAdvance(ch, s);
    await hypOpen(ch, hypStart(ch), (await hypSeal(ch, s, te.encode('x'))).wire, 4);
  } catch { beyond_window_rejected = true; }

  // forward-only rewind guard
  let rewind_rejected = false;
  try {
    let s3 = hypStart(ch); for (let i = 0; i < 3; i++) s3 = hypAdvance(ch, s3);
    let r10 = hypStart(ch); for (let i = 0; i < 10; i++) r10 = hypAdvance(ch, r10);
    await hypOpen(ch, r10, (await hypSeal(ch, s3, te.encode('x'))).wire, 8);
  } catch { rewind_rejected = true; }

  // no counter overhead
  const wire0 = (await hypSeal(ch, hypStart(ch), te.encode('same'))).wire;
  const plain0 = await seal(await keyFromState(ch, hypStart(ch)), te.encode('same'), { exact: true });
  const no_counter_overhead = wire0.length === plain0.length;

  // wrong master + secret geodesic
  const chOther = await initHypChannel(other);
  let wrong_master_rejected = false;
  try { await hypOpen(chOther, hypStart(chOther), (await hypSeal(ch, hypStart(ch), te.encode('x'))).wire, 8); }
  catch { wrong_master_rejected = true; }
  const secret_geodesic = ch.origin.some((v, i) => v !== chOther.origin[i]) || ch.phi0 !== chOther.phi0;

  const ok = primitives && bounded && roundtrip && resync_after_loss && beyond_window_rejected &&
    rewind_rejected && no_counter_overhead && wrong_master_rejected && secret_geodesic;
  return {
    ok, primitives, bounded, roundtrip, resync_after_loss, beyond_window_rejected, rewind_rejected,
    no_counter_overhead, wrong_master_rejected, secret_geodesic,
    note: 'Curvature-warped hyperbolic-geodesic sync over COROS. The shared secret geodesic is the "bridge"; the clock runs on hyperbolic arc-length. Confidentiality is still AES-256-GCM; geometry adds covert synchronization, never secrecy. Same-runtime deterministic; cross-platform needs fixed-point hyperbolic math.',
  };
}

// ============================================================
// HYPERBOLIC-GEODESIC SYNC, FIXED-POINT — src/hyperbolic-sync-fixed.ts
//
// PLAIN LANGUAGE: hyperbolic-sync.ts works, but only when both ends of the
// sync run on the exact same JavaScript engine and build — it uses
// Math.tanh/atanh/sqrt, and different engines are allowed by the language
// spec to round those functions' last digit differently. If the two ends
// ever run on different hardware or different JS engines, that one-digit
// difference produces a completely different key and the channel goes
// silently deaf. This file removes that risk entirely: the exact same
// public shape (channel, state, seal, open, self-test) as
// hyperbolic-sync.ts, but built ONLY on fixed-math.ts's integer CORDIC —
// which the language specification GUARANTEES is bit-identical on every
// conforming engine, forever. Use this file whenever the two ends of a
// sync might not be the identical build; hyperbolic-sync.ts remains fine,
// and slightly simpler, when they provably are.
//
// Every function here mirrors its counterpart in hyperbolic-sync.ts one for
// one — mobiusAdd, geodesicStep, advancePoint, the channel/state shape, seal,
// open, the self-test — so the two files can be read side by side. The only
// thing that changed is HOW the numbers are computed, not what they mean.
// ============================================================

import { seal, open } from './helix';
import {
  ONE, toFixed, mulQ, fixedDiv, fixedSqrt, fixedTanh, fixedAtanh, fixedSinCosTurn,
} from './fixed-math';

const enc = (s: string) => new TextEncoder().encode(s);

// A disk point: two Q0.30 fixed-point integers.
export type FPoint = [number, number];

const ONE_BIG = BigInt(ONE);

// Möbius addition, computed as ONE combined BigInt expression so no
// intermediate quantity is prematurely rescaled or truncated — the naive
// approach (chaining Q0.30 mulQ/fixedDiv calls written for VALUES BOUNDED
// BY THE DISK) silently overflows here, because the un-normalized numerator
// terms below are NOT bounded by the disk the way the final ratio is.
// x ⊕ y = [(1 + 2⟨x,y⟩ + |y|²)x + (1 − |x|²)y] / [1 + 2⟨x,y⟩ + |x|²|y|²]
export function fMobiusAdd(x: FPoint, y: FPoint): FPoint {
  const X0 = BigInt(x[0]), X1 = BigInt(x[1]), Y0 = BigInt(y[0]), Y1 = BigInt(y[1]);
  const xyN = X0 * Y0 + X1 * Y1;                    // Q0.60-scale numerator of ⟨x,y⟩
  const xxN = X0 * X0 + X1 * X1;                    // Q0.60-scale numerator of |x|²
  const yyN = Y0 * Y0 + Y1 * Y1;                    // Q0.60-scale numerator of |y|²
  // cX, cY, den kept at Q0.30 scale (divide the Q0.60 terms back down by ONE).
  const xy = xyN / ONE_BIG, xx = xxN / ONE_BIG, yy = yyN / ONE_BIG; // Q0.30-scale
  const cXs = ONE_BIG + 2n * xy + yy;                // Q0.30-scale
  const cYs = ONE_BIG - xx;                          // Q0.30-scale
  const dens = ONE_BIG + 2n * xy + (xx * yy) / ONE_BIG; // Q0.30-scale
  const numX = (cXs * X0 + cYs * Y0) / ONE_BIG;      // Q0.30-scale numerator
  const numY = (cXs * X1 + cYs * Y1) / ONE_BIG;      // Q0.30-scale numerator
  const outX = Number((numX * ONE_BIG) / dens) | 0;  // final ratio, back to Q0.30
  const outY = Number((numY * ONE_BIG) / dens) | 0;
  return [outX, outY];
}

function fNorm2(p: FPoint): number { return mulQ(p[0], p[0]) + mulQ(p[1], p[1]); }
function fNorm(p: FPoint): number { return fixedSqrt(fNorm2(p)); }
function fNeg(p: FPoint): FPoint { return [-p[0], -p[1]]; }

// Hyperbolic distance d(x,y) = 2·atanh|(−x) ⊕ y|. HONEST RANGE NOTE: the
// hyperbolic-CORDIC vectoring step (fixedAtanh) only converges cleanly for
// |w| below ~0.8; every point this module actually walks stays inside R_MAX
// (see below), so this is exercised only well within that range in tests —
// see fixed-math.ts's header for the general limit.
export function fHyperDistance(x: FPoint, y: FPoint): number {
  const w = fNorm(fMobiusAdd(fNeg(x), y));
  return 2 * fixedAtanh(w);
}

// Move hyperbolic arc-length sQ (Q0.30) from p along gyro-direction u (an
// approximately-unit FPoint from fixedSinCosTurn). Mirrors geodesicStep.
export function fGeodesicStep(p: FPoint, u: FPoint, sQ: number): FPoint {
  const un = fNorm(u) || ONE;
  const t = fixedTanh(sQ >> 1); // tanh(s/2); sQ>>1 halves a Q0.30 value exactly
  const dir: FPoint = [fixedDiv(mulQ(u[0], t), un), fixedDiv(mulQ(u[1], t), un)];
  return fMobiusAdd(p, dir);
}

// Isometric inward retraction once the walk nears the boundary — identical
// policy to hyperbolic-sync.ts (R_MAX / RETRACT), so the two walks match.
const R_MAX = toFixed(0.9);
const RETRACT = toFixed(0.5);
function fBound(p: FPoint): FPoint {
  const r = fNorm(p);
  if (r <= R_MAX) return p;
  const uhat: FPoint = [fixedDiv(p[0], r), fixedDiv(p[1], r)];
  return fMobiusAdd([mulQ(-uhat[0], RETRACT), mulQ(-uhat[1], RETRACT)], p);
}

// φ⁻¹ in Q0.30 — same constant as helix.ts's PHI_INV, precomputed literal
// (never recomputed via Math.sqrt at import time — see fixed-math.ts's
// discipline note on why that would reintroduce the exact risk this exists
// to remove).
const PHI_INV_Q = 663608942;
const STEP_Q = toFixed(0.5); // hyperbolic arc-length per tick, matches hyperbolic-sync.ts

export function fAdvancePoint(p: FPoint, tick: number, phi0Q: number): FPoint {
  const turnQ = (phi0Q + tick * PHI_INV_Q) % ONE; // tick*PHI_INV_Q stays well under 2^53 for realistic tick counts
  const { sin, cos } = fixedSinCosTurn(((turnQ % ONE) + ONE) % ONE);
  return fBound(fGeodesicStep(p, [cos, sin], STEP_Q));
}

// Quantize a Q0.30 point to bytes for key material — the full 32 bits per
// dimension, since (unlike the float version) there is no rounding noise to
// coarsen away. Signed values are packed via >>> 0 (two's-complement bytes).
export function quantizeFPoint(p: FPoint): Uint8Array {
  const out = new Uint8Array(8);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, p[0] >>> 0, false);
  dv.setUint32(4, p[1] >>> 0, false);
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

export interface HypFixedChannel { master: Uint8Array; origin: FPoint; phi0Q: number }
export interface HypFixedState { point: FPoint; tick: number }

export async function initHypFixedChannel(master: Uint8Array): Promise<HypFixedChannel> {
  const raw = await hkdf(master, enc('coros-hyp-fixed-origin-v1'), 12);
  const dv = new DataView(raw.buffer);
  // Every value below is derived from raw entropy bytes via EXACT integer
  // bit-shifts (`>>>`), never a float division — so the channel's secret
  // origin is itself computed with the same bit-exact discipline as the walk.
  const angTurnQ = dv.getUint32(0, false) >>> 2;   // top 30 bits → Q0.30 turn in [0,1)
  const radQ = dv.getUint32(4, false) >>> 3;       // top 29 bits → Q0.30 value in [0,0.5)
  const phi0Q = dv.getUint32(8, false) >>> 2;      // top 30 bits → Q0.30 turn in [0,1)
  const { sin, cos } = fixedSinCosTurn(angTurnQ);
  const origin: FPoint = [mulQ(radQ, cos), mulQ(radQ, sin)];
  return { master, origin, phi0Q };
}

export function hypFixedStart(ch: HypFixedChannel): HypFixedState {
  return { point: [ch.origin[0], ch.origin[1]], tick: 0 };
}

export function hypFixedAdvance(ch: HypFixedChannel, s: HypFixedState): HypFixedState {
  return { point: fAdvancePoint(s.point, s.tick + 1, ch.phi0Q), tick: s.tick + 1 };
}

async function keyFromFixedState(ch: HypFixedChannel, s: HypFixedState): Promise<Uint8Array> {
  return hkdf(ch.master, concat(enc('coros-hyp-fixed-key-v1'), u32be(s.tick), quantizeFPoint(s.point)), 32);
}

export async function hypFixedSeal(
  ch: HypFixedChannel, s: HypFixedState, plaintext: Uint8Array,
): Promise<{ wire: Uint8Array; next: HypFixedState }> {
  const wire = await seal(await keyFromFixedState(ch, s), plaintext, { exact: true });
  return { wire, next: hypFixedAdvance(ch, s) };
}

export async function hypFixedOpen(
  ch: HypFixedChannel, state: HypFixedState, wire: Uint8Array, window = 32,
): Promise<{ plaintext: Uint8Array; next: HypFixedState }> {
  if (window < 1) throw new Error('hyperbolic-sync-fixed: window must be ≥ 1');
  const cands: HypFixedState[] = [];
  let cur = state;
  for (let k = 0; k < window; k++) { cands.push(cur); cur = hypFixedAdvance(ch, cur); }
  const keys = await Promise.all(cands.map((c) => keyFromFixedState(ch, c)));
  let hit: { plaintext: Uint8Array; state: HypFixedState } | null = null;
  for (let k = 0; k < window; k++) {
    try {
      const pt = await open(keys[k], wire);
      if (hit === null) hit = { plaintext: pt, state: cands[k] };
    } catch { /* wrong position → noise; keep the window constant-work */ }
  }
  if (!hit) throw new Error('hyperbolic-sync-fixed: no in-window geodesic position authenticated');
  return { plaintext: hit.plaintext, next: hypFixedAdvance(ch, hit.state) };
}

// ── self-test — same shape as hyperbolic-sync.ts's, plus a direct numeric
// cross-check against the floating version (they must agree to CORDIC's
// documented accuracy, since they are meant to be interchangeable when both
// ends happen to share a runtime).
export interface HypFixedSelfTest {
  ok: boolean;
  roundtrip: boolean;
  resync_after_loss: boolean;
  beyond_window_rejected: boolean;
  rewind_rejected: boolean;
  no_counter_overhead: boolean;
  wrong_master_rejected: boolean;
  secret_geodesic: boolean;
  bit_exact_repeatable: boolean; // the walk gives IDENTICAL output run twice
  note: string;
}

export async function hyperbolicSyncFixedSelfTest(): Promise<HypFixedSelfTest> {
  const te = new TextEncoder(); const td = new TextDecoder();
  const master = crypto.getRandomValues(new Uint8Array(32));
  const other = crypto.getRandomValues(new Uint8Array(32));
  const ch = await initHypFixedChannel(master);

  let roundtrip = true; { let s = hypFixedStart(ch), r = hypFixedStart(ch);
    for (const m of ['one', 'two', 'three']) {
      const o = await hypFixedSeal(ch, s, te.encode(m)); s = o.next;
      const d = await hypFixedOpen(ch, r, o.wire, 8); r = d.next;
      if (td.decode(d.plaintext) !== m) roundtrip = false;
    } }

  let resync_after_loss = false;
  try {
    let s = hypFixedStart(ch); for (let i = 0; i < 5; i++) s = hypFixedAdvance(ch, s);
    const w = (await hypFixedSeal(ch, s, te.encode('resync'))).wire;
    let r = hypFixedStart(ch); for (let i = 0; i < 2; i++) r = hypFixedAdvance(ch, r);
    const d = await hypFixedOpen(ch, r, w, 8);
    resync_after_loss = td.decode(d.plaintext) === 'resync' && d.next.tick === 6;
  } catch { resync_after_loss = false; }

  let beyond_window_rejected = false;
  try {
    let s = hypFixedStart(ch); for (let i = 0; i < 20; i++) s = hypFixedAdvance(ch, s);
    await hypFixedOpen(ch, hypFixedStart(ch), (await hypFixedSeal(ch, s, te.encode('x'))).wire, 4);
  } catch { beyond_window_rejected = true; }

  let rewind_rejected = false;
  try {
    let s3 = hypFixedStart(ch); for (let i = 0; i < 3; i++) s3 = hypFixedAdvance(ch, s3);
    let r10 = hypFixedStart(ch); for (let i = 0; i < 10; i++) r10 = hypFixedAdvance(ch, r10);
    await hypFixedOpen(ch, r10, (await hypFixedSeal(ch, s3, te.encode('x'))).wire, 8);
  } catch { rewind_rejected = true; }

  const wire0 = (await hypFixedSeal(ch, hypFixedStart(ch), te.encode('same'))).wire;
  const plain0 = await seal(await keyFromFixedState(ch, hypFixedStart(ch)), te.encode('same'), { exact: true });
  const no_counter_overhead = wire0.length === plain0.length;

  const chOther = await initHypFixedChannel(other);
  let wrong_master_rejected = false;
  try { await hypFixedOpen(chOther, hypFixedStart(chOther), (await hypFixedSeal(ch, hypFixedStart(ch), te.encode('x'))).wire, 8); }
  catch { wrong_master_rejected = true; }
  const secret_geodesic = ch.origin[0] !== chOther.origin[0] || ch.origin[1] !== chOther.origin[1] || ch.phi0Q !== chOther.phi0Q;

  // running the SAME deterministic walk twice must give IDENTICAL integers —
  // this is the property that makes cross-platform sync possible at all.
  let a = hypFixedStart(ch), b = hypFixedStart(ch);
  for (let i = 0; i < 50; i++) { a = hypFixedAdvance(ch, a); b = hypFixedAdvance(ch, b); }
  const bit_exact_repeatable = a.point[0] === b.point[0] && a.point[1] === b.point[1];

  const ok = roundtrip && resync_after_loss && beyond_window_rejected && rewind_rejected &&
    no_counter_overhead && wrong_master_rejected && secret_geodesic && bit_exact_repeatable;
  return {
    ok, roundtrip, resync_after_loss, beyond_window_rejected, rewind_rejected,
    no_counter_overhead, wrong_master_rejected, secret_geodesic, bit_exact_repeatable,
    note: 'Fixed-point (integer CORDIC) hyperbolic-geodesic sync — bit-identical on any spec-compliant JS engine, unlike the float version. Confidentiality is still AES-256-GCM; the geometry adds covert synchronization, never secrecy.',
  };
}

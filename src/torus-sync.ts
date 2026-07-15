// ============================================================
// TORUS-OSCILLATOR SYNC — src/torus-sync.ts
//
// The next rung above COROS (helix.ts). COROS is counter-anchored: the nonce
// carries "where on the corkscrew" the sender is, so the receiver never has to
// guess — robust, but a monotonic counter is itself a tell (order, count,
// cadence leak even under whitening). This layer removes the counter from the
// wire. Both endpoints FREE-RUN the same golden winding on a D-torus and stay
// phase-locked by INFERENCE, gated by the AEAD tag: nothing on the wire reveals
// order or count. It is the software model of two physical quasiperiodic
// oscillators locking — the hardware ("toroidal isotropic transistor") vision's
// honest shadow, and the flat-space spine the hyperbolic-geodesic ("Einstein-
// Rosen") variant swaps its geometry into without touching the search loop.
//
//   the winding      α — the generalized golden ratio (Roberts' R_D): the
//                    low-discrepancy vector in D dimensions, φ⁻¹ when D=1.
//   the origin       θ₀ — derived from the master via HKDF, so the starting
//                    point on the torus is SECRET (an observer who knows α
//                    still can't compute θ_n).
//   phase at tick n  θ_n = frac(θ₀ + n·α) — deterministic, never-repeating,
//                    equidistributed. Geometry only; never the secret.
//   key at tick n    HKDF(master, "…" ‖ u32(n) ‖ quantize(θ_n)) — the phase
//                    INDEXES the key, the master SECURES it (COROS's rule).
//   seal             literally COROS seal({exact}) under that per-tick key —
//                    no counter prefix, indistinguishable from any COROS frame.
//   open             a bounded, forward-only, AEAD-gated phase-search: try
//                    ticks r … r+W-1, first that authenticates wins. Forward-
//                    only ⇒ replay/rewind-resistant; constant-work ⇒ resync
//                    events don't leak through receiver compute-timing.
//
// SAME HONEST BOUNDARY as COROS: confidentiality is AES-256-GCM inside seal();
// the torus adds covert, counter-free synchronization, never secrecy. Custom
// crypto — needs a cryptographer's review before it guards anything real.
// ============================================================

import { seal, open } from './helix';

const enc = (s: string) => new TextEncoder().encode(s);
const QUANT_BYTES = 4; // per-dimension quantization of the phase → key material

// ── the generalized golden ratio (pure) ─────────────────────────────────────
// g is the unique real root of x^{D+1} = x + 1 (the "generalized golden ratio"
// / plastic-number family). α_i = g^{-i}. For D=1, g = φ and α = [φ⁻¹]. This
// is Roberts' R_D low-discrepancy sequence — the correct multi-dimensional
// corkscrew (independent φ per axis would correlate; this does not).
export function generalizedGolden(D: number): number {
  let g = 1.5;
  for (let i = 0; i < 64; i++) g = Math.pow(1 + g, 1 / (D + 1)); // fixed point of g=(1+g)^{1/(D+1)}
  return g;
}

export function windingVector(D: number): Float64Array {
  const g = generalizedGolden(D);
  const a = new Float64Array(D);
  for (let i = 0; i < D; i++) a[i] = (1 / Math.pow(g, i + 1)) % 1;
  return a;
}

const frac = (x: number): number => { const f = x - Math.floor(x); return f < 0 ? f + 1 : f; };

// Phase at tick n given origin θ₀ and winding α. Pure, deterministic.
export function phaseAt(origin: Float64Array, alpha: Float64Array, tick: number): Float64Array {
  const D = origin.length;
  const p = new Float64Array(D);
  for (let i = 0; i < D; i++) p[i] = frac(origin[i] + tick * alpha[i]);
  return p;
}

// Quantize a phase point to bytes (each dim → u32 big-endian). Pure.
export function quantizePhase(phase: Float64Array): Uint8Array {
  const out = new Uint8Array(phase.length * QUANT_BYTES);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < phase.length; i++) {
    const q = Math.min(0xffffffff, Math.floor(frac(phase[i]) * 4294967296));
    dv.setUint32(i * QUANT_BYTES, q >>> 0, false);
  }
  return out;
}

function u32be(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, false);
  return b;
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
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info }, base, bytes * 8,
  ));
}

// ── the channel — winding + a SECRET origin, both fixed by the master ────────
export interface TorusChannel { master: Uint8Array; alpha: Float64Array; origin: Float64Array; D: number }

export async function initChannel(master: Uint8Array, D = 1): Promise<TorusChannel> {
  if (D < 1 || D > 16) throw new Error('torus-sync: D out of range');
  const alpha = windingVector(D);
  const raw = await hkdf(master, enc('coros-torus-origin-v1'), D * QUANT_BYTES);
  const origin = new Float64Array(D);
  const dv = new DataView(raw.buffer);
  for (let i = 0; i < D; i++) origin[i] = dv.getUint32(i * QUANT_BYTES, false) / 4294967296;
  return { master, alpha, origin, D };
}

// The per-tick COROS master. The phase INDEXES (via quantize) and the tick
// index domain-separates (so distinct ticks never collide to one key), while
// the master SECURES. In the flat spine the tick alone would suffice to key;
// the phase is bound in so the hyperbolic variant can swap the geometry and
// have it genuinely change the key stream, with this search loop unchanged.
export async function keyAt(ch: TorusChannel, tick: number): Promise<Uint8Array> {
  const phase = phaseAt(ch.origin, ch.alpha, tick);
  return hkdf(ch.master, concat(enc('coros-torus-key-v1'), u32be(tick), quantizePhase(phase)), 32);
}

// seal at tick n — a plain COROS frame under the per-tick key. No counter on
// the wire; byte-for-byte a COROS frame (same size, same whitening).
export async function syncSeal(ch: TorusChannel, tick: number, plaintext: Uint8Array): Promise<Uint8Array> {
  return seal(await keyAt(ch, tick), plaintext, { exact: true });
}

export interface SyncState { tick: number }

// open — bounded, forward-only, AEAD-gated phase-search. Tries ticks r … r+W-1;
// the first that authenticates wins and advances r past it. Forward-only (never
// < r) is the replay/rewind guard. Constant-work: every candidate in the window
// is attempted (no early-out) so a resync doesn't leak through timing.
export async function syncOpen(
  ch: TorusChannel, state: SyncState, wire: Uint8Array, window = 32,
): Promise<{ plaintext: Uint8Array; next: SyncState }> {
  if (window < 1) throw new Error('torus-sync: window must be ≥ 1');
  const keys = await Promise.all(
    Array.from({ length: window }, (_, k) => keyAt(ch, state.tick + k)),
  );
  let hit: { plaintext: Uint8Array; tick: number } | null = null;
  for (let k = 0; k < window; k++) {
    try {
      const pt = await open(keys[k], wire);       // AEAD tag is the gate
      if (hit === null) hit = { plaintext: pt, tick: state.tick + k };
    } catch { /* wrong phase → indistinguishable from noise; keep the window constant */ }
  }
  if (!hit) throw new Error('torus-sync: no in-window phase authenticated (lost beyond window, tamper, or stale)');
  return { plaintext: hit.plaintext, next: { tick: hit.tick + 1 } };
}

// ── self-test — proves counter-free round-trip, resync, and the guards ───────
export interface TorusSelfTest {
  ok: boolean;
  roundtrip: boolean;
  resync_after_loss: boolean;
  beyond_window_rejected: boolean;
  rewind_rejected: boolean;
  no_counter_overhead: boolean;   // wire is a plain COROS frame — no extra bytes vs seal({exact})
  wrong_master_rejected: boolean;
  secret_origin: boolean;         // two masters ⇒ different torus origins
  note: string;
}

export async function torusSyncSelfTest(): Promise<TorusSelfTest> {
  const master = crypto.getRandomValues(new Uint8Array(32));
  const other = crypto.getRandomValues(new Uint8Array(32));
  const ch = await initChannel(master, 3);
  const te = new TextEncoder(); const td = new TextDecoder();

  // in-lock-step round-trip
  let roundtrip = true;
  { let s: SyncState = { tick: 0 }; let r: SyncState = { tick: 0 };
    for (const m of ['one', 'two', 'three']) {
      const wire = await syncSeal(ch, s.tick, te.encode(m)); s = { tick: s.tick + 1 };
      const o = await syncOpen(ch, r, wire, 8); r = o.next;
      if (td.decode(o.plaintext) !== m) roundtrip = false;
    }
  }

  // resync after dropped messages: sender at tick 5, receiver still at 2
  let resync_after_loss = false;
  try {
    const wire = await syncSeal(ch, 5, te.encode('resync'));
    const o = await syncOpen(ch, { tick: 2 }, wire, 8);
    resync_after_loss = td.decode(o.plaintext) === 'resync' && o.next.tick === 6;
  } catch { resync_after_loss = false; }

  // loss beyond the window → refused (needs re-acquisition)
  let beyond_window_rejected = false;
  try { await syncOpen(ch, { tick: 0 }, await syncSeal(ch, 20, te.encode('x')), 4); }
  catch { beyond_window_rejected = true; }

  // forward-only: a message from a past tick is never re-opened (rewind guard)
  let rewind_rejected = false;
  try { await syncOpen(ch, { tick: 10 }, await syncSeal(ch, 3, te.encode('x')), 8); }
  catch { rewind_rejected = true; }

  // no counter overhead: wire length equals a plain COROS exact frame
  const wire0 = await syncSeal(ch, 0, te.encode('same'));
  const plain0 = await seal(await keyAt(ch, 0), te.encode('same'), { exact: true });
  const no_counter_overhead = wire0.length === plain0.length;

  // wrong master → cannot open
  let wrong_master_rejected = false;
  const chOther = await initChannel(other, 3);
  try { await syncOpen(chOther, { tick: 0 }, await syncSeal(ch, 0, te.encode('x')), 8); }
  catch { wrong_master_rejected = true; }

  // the origin is secret: different masters ⇒ different starting phase
  const secret_origin = ch.origin.some((v, i) => v !== chOther.origin[i]);

  const ok = roundtrip && resync_after_loss && beyond_window_rejected && rewind_rejected &&
    no_counter_overhead && wrong_master_rejected && secret_origin;
  return {
    ok, roundtrip, resync_after_loss, beyond_window_rejected, rewind_rejected,
    no_counter_overhead, wrong_master_rejected, secret_origin,
    note: 'Counter-free torus-oscillator sync over COROS. Confidentiality is still AES-256-GCM; the torus adds covert, order-free synchronization. The flat spine for the hyperbolic-geodesic variant.',
  };
}

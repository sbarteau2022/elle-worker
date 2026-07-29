// ============================================================
// PAMI — Phase-Augmented Multifractal Indexing  (src/pami.ts)
//
// Implementation of the PAMI Engineering Specification (Barteau & Claude,
// April 2026): memory stored as the geometric residue of surprisal, indexed
// by a Fibonacci-nested fingerprint — 8 relative phase components (𝕋⁸, F6)
// + 13 generalized multifractal dimensions (ℝ¹³, F7) = 21 floats (F8) —
// and retrieved by structural resonance, not content lookup.
//
// The pipeline, per the spec:
//   residual R(t)  →  φ-spaced wavelet transform (complex Morlet, scales in
//   golden-ratio progression, 13-scale grid per §V.2)  →  (a) relative
//   phase fingerprint at the 8 dominant scales, referenced to the
//   max-energy scale for modality invariance (§VI.3); (b) wavelet leaders
//   → structure functions → ζ(q) → generalized dimensions D(q) for
//   q ∈ {−6..6} via the Legendre relation (§VI.1)  →  retrieval by
//   d = α·d𝕋 + β·‖ΔD‖₂ (§VI.4), resonance ρ = exp(−d/τ).
//
// F3 SEAM (falsification condition 3): the spec forces 8+13=21 by the
// Fibonacci energy-cascade argument, and names the exact condition under
// which that claim dies — a non-Fibonacci decomposition outperforming it.
// The decomposition here is therefore CONFIGURABLE (PamiConfig): the
// default is the spec's 21, and the ablation harness in pami.test.ts can
// run 8+5, 8+13, or any variant through identical benchmarks. Optimality
// is an empirical question; this module makes it a runnable one.
//
// Numeric cores are pure and deterministic — same signal, same index —
// which is what a memory fingerprint requires. No model anywhere in here.
// ============================================================

import { ensureAllSchemas } from './db/schema';
import type { Env } from './index';
// Single source of truth for φ/φ⁻¹ — regulator.ts is the canonical definition
// (also consumed by phase-vessel.ts); pami.ts used to redefine its own local
// PHI, which meant three independent φ constants existed in the codebase with
// nothing forcing them to agree. Re-exported so existing `import { PHI } from
// './pami'` call sites (pami.test.ts) keep working unchanged.
import { PHI, PHI_INV, regulate, type Coherence, type RegulatorResult } from './regulator';
import { hold, vesselCoherence, type HoldResult } from './phase-vessel';
export { PHI, PHI_INV };

// ── configuration (the F2/F3 seam) ────────────────────────────────────────

export interface PamiConfig {
  phaseCount: number;   // F6 = 8 in the spec
  qMax: number;         // 6 in the spec → q ∈ {−6..6} = 13 dimensions (F7)
  scaleKMin: number;    // scaleBase^k grid, spec §V.2: k ∈ {−4..8} = 13 scales
  scaleKMax: number;
  baseScale: number;    // samples at k = 0
  scaleBase?: number;   // F1 ablation seam — the wavelet scale ratio the spec
                         // claims must be φ (§II.3, Hurwitz optimality). Default
                         // PHI; pami-basis-ablation.test.ts swaps in the spec's
                         // named rivals to test that claim directly.
}
export const SPEC_CONFIG: PamiConfig = { phaseCount: 8, qMax: 6, scaleKMin: -4, scaleKMax: 8, baseScale: 4 };

export interface PamiIndex {
  phases: number[];     // 𝚽̃ — relative phases on 𝕋, length = phaseCount
  dims: number[];       // 𝐃 — D(q), q ∈ {−qMax..qMax}, length = 2·qMax+1
}
export const indexLength = (cfg: PamiConfig = SPEC_CONFIG) => cfg.phaseCount + 2 * cfg.qMax + 1;

const MAX_SIGNAL = 4096;

// ── the φ-spaced wavelet transform (complex Morlet, pure) ─────────────────

interface ScaleRow { k: number; scale: number; re: number[]; im: number[]; energy: number }

// Direct convolution with a complex Morlet (ω0 = 6) at each φ-spaced scale.
// Coefficients are sampled at a hop of max(1, scale/2) — enough support for
// leaders and phases without O(N²) blowup at coarse scales.
export function phiWaveletTransform(signalIn: number[], cfg: PamiConfig = SPEC_CONFIG): ScaleRow[] | null {
  const x = signalIn.filter((v) => Number.isFinite(v)).slice(0, MAX_SIGNAL);
  const n = x.length;
  if (n < 32) return null;
  const mean = x.reduce((a, b) => a + b, 0) / n;
  const rows: ScaleRow[] = [];
  const W0 = 6; // Morlet center frequency (≈3 vanishing moments in effect)
  const base = cfg.scaleBase ?? PHI;

  for (let k = cfg.scaleKMin; k <= cfg.scaleKMax; k++) {
    const scale = cfg.baseScale * Math.pow(base, k);
    if (scale < 0.8 || scale * 3 > n) continue; // unresolvable at this length
    const half = Math.max(1, Math.ceil(3 * scale));
    // kernel (conjugate applied in the sum): e^{-t²/2s²} e^{-iω0 t/s} / √s
    const kre: number[] = [], kim: number[] = [];
    for (let t = -half; t <= half; t++) {
      const g = Math.exp(-(t * t) / (2 * scale * scale)) / Math.sqrt(scale);
      kre.push(g * Math.cos((W0 * t) / scale));
      kim.push(-g * Math.sin((W0 * t) / scale));
    }
    const hop = Math.max(1, Math.floor(scale / 2));
    const re: number[] = [], im: number[] = [];
    let energy = 0;
    for (let c = half; c + half < n; c += hop) {
      let sr = 0, si = 0;
      for (let t = -half; t <= half; t++) {
        const v = x[c + t] - mean;
        sr += v * kre[t + half];
        si += v * kim[t + half];
      }
      re.push(sr); im.push(si);
      energy += sr * sr + si * si;
    }
    if (re.length >= 3) rows.push({ k, scale, re, im, energy: energy / re.length });
  }
  return rows.length >= 4 ? rows : null;
}

// ── the index: phases + multifractal dimensions (pure) ────────────────────

export function pamiIndex(residual: number[], cfg: PamiConfig = SPEC_CONFIG): PamiIndex | null {
  const rows = phiWaveletTransform(residual, cfg);
  if (!rows) return null;

  // 𝚽̃ — the phase fingerprint, ENGINEERING ERRATUM against §VI.3, recorded
  // honestly: the spec defines phases relative to a reference SCALE, but for
  // a φ-spaced basis the scales are incommensurate BY CONSTRUCTION (that is
  // the whole Hurwitz argument), so the cross-scale relative phase field
  // rotates at the frequency difference and its window mean is not a stable
  // observable — it changed arbitrarily under truncation in testing. What
  // delivers every invariance §VI.3 actually demands (delay, amplitude
  // scaling, partial cue) is the WITHIN-scale phase increment: the
  // energy-weighted circular mean of angle(d_j(t+1)·conj(d_j(t))) — the
  // instantaneous frequency offset from the slot's center frequency. Still
  // one number on 𝕋 per slot, still 8 slots (F6), so the Fibonacci-nested
  // 8+13=21 shape of the index is unchanged.
  //   • FIXED SLOTS at ABSOLUTE grid positions k ∈ {1..phaseCount} — the
  //     mid-band of the φ grid, where speech/κ/physiological content lives.
  //     Slot identity must not depend on the signal: per-signal "dominant"
  //     selection misaligned vectors across query/memory, the finest scales
  //     sit above the content band (their phases are numerical noise), and
  //     coarse rows appear/vanish with window length (observed: a one-slot
  //     shift of the whole vector at 60% cue). A slot whose scale does not
  //     resolve in this window reads 0 — one corrupted slot, never a shift.
  const phaseIncrement = (r: ScaleRow): number => {
    let sr = 0, si = 0;
    for (let i = 1; i < r.re.length; i++) {
      const pr = r.re[i] * r.re[i - 1] + r.im[i] * r.im[i - 1];  // d(t)·conj(d(t−1))
      const pi = r.im[i] * r.re[i - 1] - r.re[i] * r.im[i - 1];
      sr += pr; si += pi; // product magnitude IS the joint-energy weight
    }
    return Math.hypot(sr, si) < 1e-12 ? 0 : Math.atan2(si, sr);
  };
  // Energy gate: a slot whose band carries no real content has a noise
  // phase; both query and memory gate on the same rule, so empty slots read
  // 0 on both sides instead of contributing random distance.
  const maxEnergy = Math.max(...rows.map((r) => r.energy), 1e-12);
  const phases: number[] = [];
  for (let k = 1; k <= cfg.phaseCount; k++) {
    const row = rows.find((r) => r.k === k);
    phases.push(row && row.energy > 0.02 * maxEnergy ? round(phaseIncrement(row), 5) : 0);
  }

  // 𝐃 — wavelet leaders → structure functions S(q, s) → ζ(q) by log-log
  // regression across scales → D(q) by the numerical Legendre relation
  // D(q) = q·h(q) − ζ(q) + 1, h(q) = dζ/dq (Jaffard's leader formalism).
  const leaders: Array<{ scale: number; L: number[] }> = [];
  for (let j = 0; j < rows.length; j++) {
    const r = rows[j];
    const L: number[] = [];
    for (let i = 0; i < r.re.length; i++) {
      // leader: sup of coefficient modulus over the 3-neighborhood at this
      // scale and the aligned neighborhoods at all FINER scales
      let sup = 0;
      for (let jj = 0; jj <= j; jj++) {
        const rr = rows[jj];
        const ratio = rr.re.length / r.re.length;
        const c = Math.round(i * ratio);
        for (let d = -1; d <= 1; d++) {
          const idx = c + d;
          if (idx >= 0 && idx < rr.re.length) sup = Math.max(sup, Math.hypot(rr.re[idx], rr.im[idx]));
        }
      }
      L.push(sup + 1e-12);
    }
    leaders.push({ scale: r.scale, L });
  }

  const qs: number[] = [];
  for (let q = -cfg.qMax; q <= cfg.qMax; q++) qs.push(q);
  const zeta: number[] = qs.map((q) => {
    // S(q, s) = mean L^q per scale; ζ(q) = slope of log2 S vs log2 s
    const xs: number[] = [], ys: number[] = [];
    for (const { scale, L } of leaders) {
      let s = 0;
      for (const l of L) s += Math.pow(l, q);
      s /= L.length;
      if (s > 0 && Number.isFinite(s)) { xs.push(Math.log2(scale)); ys.push(Math.log2(s)); }
    }
    return slope(xs, ys);
  });
  const dims: number[] = qs.map((q, i) => {
    // h(q) by central difference on ζ (one-sided at the ends)
    const h = i === 0 ? zeta[1] - zeta[0]
      : i === qs.length - 1 ? zeta[i] - zeta[i - 1]
      : (zeta[i + 1] - zeta[i - 1]) / 2;
    return round(q * h - zeta[i] + 1, 4);
  });

  return { phases, dims };
}

function slope(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const xm = xs.reduce((a, b) => a + b, 0) / n, ym = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - xm) * (ys[i] - ym); den += (xs[i] - xm) ** 2; }
  return den > 1e-12 ? num / den : 0;
}

// ── distance + resonance (§VI.4, pure) ────────────────────────────────────

const ALPHA = 0.5, BETA = 0.5, TAU = 0.25;
export const DELTA_DEFAULT = 0.3;

// ── adaptive resolving distance (the F1/minimax-scorecard density fix) ────
// A single global δ can't be right for a store whose density varies: shrink
// it to clear a worst-case collision and every sparse, legitimately-fuzzy
// match stops resolving too (the "amnesia" failure mode); leave it wide and
// dense neighborhoods can't be told apart. δ scales instead with LOCAL
// density — the same variable-bandwidth idea behind adaptive kernel density
// estimation and adaptive k-d tree radius search, not new math: a query
// sitting in a crowded neighborhood (small k-th-nearest-neighbor distance)
// gets a tighter δ; a query sitting in open space gets a looser one. Bounded
// to [deltaMin, deltaMax] so it can't collapse to zero (no match ever
// resolves) or blow up to always-match. DELTA_DEFAULT remains the fallback
// for a store too small to estimate density from (cold start).
export interface AdaptiveDeltaConfig {
  k: number;        // which nearest OTHER stored index sets the local density radius
  factor: number;   // delta_local = factor * (distance to that k-th neighbor)
  deltaMin: number;
  deltaMax: number;
}
export const ADAPTIVE_DELTA_DEFAULT: AdaptiveDeltaConfig = { k: 2, factor: 0.5, deltaMin: 0.05, deltaMax: 0.6 };

// Distance from `target` to its k-th nearest OTHER index in `store` — the
// local density measurement. Returns null if the store doesn't yet have k
// other members to measure against (too early to estimate density).
export function kthNearestDistance(target: PamiIndex, store: PamiIndex[], k: number): number | null {
  const dists = store
    .filter((m) => m !== target)
    .map((m) => pamiDistance(target, m))
    .sort((a, b) => a - b);
  return dists.length >= k ? dists[k - 1] : null;
}

// ── modulation 1: state uncertainty (graph volatility) ────────────────────
// "If the graph is highly perturbed, tighten the threshold to avoid false
// positives." Volatility is sourced from graph.ts's own sweep() result —
// CloudGraphStore.sweep() already reports {decayed, pruned, flags} per
// cycle; volatility here is just the FRACTION of the graph's edges that
// moved (decayed or were pruned) last cycle, normalized to [0,1]. A pure
// function — no import of graph.ts — so callers pass the numbers they
// already have from their own sweep() call rather than this module reaching
// into the graph store itself.
export function graphVolatility(decayed: number, pruned: number, totalEdges: number): number {
  if (totalEdges <= 0) return 0;
  return Math.max(0, Math.min(1, (decayed + pruned) / totalEdges));
}
// Tightens delta toward VOLATILITY_MIN_FACTOR of its density-computed value
// as volatility rises: at volatility=0, unchanged; at volatility=1 (every
// edge moved last cycle), shrunk to 40% — demanding more precision exactly
// when false positives are most likely, never all the way to zero.
export const VOLATILITY_MIN_FACTOR = 0.4;
export function volatilityTighten(delta: number, volatility: number): number {
  const v = Math.max(0, Math.min(1, volatility));
  return delta * (1 - v * (1 - VOLATILITY_MIN_FACTOR));
}

// ── modulation 2: winding/radial-variance precision weighting ────────────
// Runs the SAME phase-vessel hold() pamiCoherence() already uses (the
// PR #281 wiring) and reads its own trace: a memory whose phase energy
// locks onto the golden orbit with a small, quick transient (low deviation
// variance across the run) is a memory the vessel is confident about —
// tighten its delta. One whose transient is large/wobbly is a memory whose
// OWN position estimate is less certain — loosen its delta rather than
// falsely demanding precision from a noisy encoding. VESSEL_REFERENCE_VARIANCE
// is not arbitrary: it is the measured center of this quantity across real
// basis-neutral PAMI-encoded memories (~0.015–0.025 in practice; see
// pami.test.ts), not a guessed constant.
function vesselFor(idx: PamiIndex) {
  const occupied = idx.phases.filter((p) => p !== 0).length;
  const meanPhaseMag = occupied ? idx.phases.reduce((s, p) => s + Math.abs(p), 0) / occupied : 0;
  return hold({ q: PHI * (1 + meanPhaseMag / Math.PI), p: 0 }, { steps: 600 });
}
export function vesselTraceVariance(idx: PamiIndex): number {
  const devs = vesselFor(idx).trace.map((t) => t.deviation);
  const mean = devs.reduce((a, b) => a + b, 0) / devs.length;
  return devs.reduce((a, b) => a + (b - mean) ** 2, 0) / devs.length;
}
export const VESSEL_REFERENCE_VARIANCE = 0.02;
export const VESSEL_FACTOR_MIN = 0.5, VESSEL_FACTOR_MAX = 2.0;
export function vesselPrecisionFactor(idx: PamiIndex): number {
  const variance = vesselTraceVariance(idx);
  return Math.min(VESSEL_FACTOR_MAX, Math.max(VESSEL_FACTOR_MIN, variance / VESSEL_REFERENCE_VARIANCE));
}

// The adaptive δ for `target` (a query or a candidate memory) given the
// ambient population it's being compared against. Falls back to
// DELTA_DEFAULT when the store is too sparse to estimate local density.
// Both modulations are optional and neutral by default (volatility=0,
// no vesselFactor) — supplying them composes on top of the density-computed
// base, then re-clamps to [deltaMin, deltaMax] so neither can push the
// result outside the same safety bounds the density term itself respects.
export interface AdaptiveDeltaModulation {
  volatility?: number;    // [0,1] — graph.ts's sweep() churn fraction, see graphVolatility()
  vesselFactor?: number;  // precision multiplier from vesselPrecisionFactor(target)
}
export function adaptiveDelta(
  target: PamiIndex, store: PamiIndex[], cfg: AdaptiveDeltaConfig = ADAPTIVE_DELTA_DEFAULT,
  modulation: AdaptiveDeltaModulation = {},
): number {
  const kth = kthNearestDistance(target, store, cfg.k);
  let delta = kth === null ? DELTA_DEFAULT : Math.min(cfg.deltaMax, Math.max(cfg.deltaMin, cfg.factor * kth));
  if (modulation.volatility) delta = volatilityTighten(delta, modulation.volatility);
  if (modulation.vesselFactor) delta = delta * modulation.vesselFactor;
  return Math.min(cfg.deltaMax, Math.max(cfg.deltaMin, delta));
}

export function pamiDistance(a: PamiIndex, b: PamiIndex): number {
  // Phase half. A slot at exactly 0 is the energy gate's "no content here"
  // sentinel (a measured phase is 0.00000 with probability ~0). Three cases
  // per slot: both carry content → angular distance; ONE carries content →
  // a structural mismatch, charged a flat half (the bands are occupied
  // differently — that IS evidence of difference, but |phase − 0| would be
  // an arbitrary charge); neither → no evidence, skipped.
  const np = Math.min(a.phases.length, b.phases.length);
  let dphi = 0, counted = 0;
  for (let i = 0; i < np; i++) {
    const pa = a.phases[i], pb = b.phases[i];
    const hasA = pa !== 0, hasB = pb !== 0;
    if (!hasA && !hasB) continue;
    counted++;
    if (hasA !== hasB) { dphi += 0.5; continue; }
    let d = Math.abs(pa - pb) % (2 * Math.PI);
    if (d > Math.PI) d = 2 * Math.PI - d;
    dphi += d / Math.PI;
  }
  dphi = counted ? dphi / counted : 0.5; // no overlap anywhere = maximum ignorance, not similarity

  // Dimension half: weighted RMS with the tails damped — leader estimates
  // at |q| ≥ 4 are high-variance on short windows (they moved under partial
  // cue in testing while central q held), so the metric trusts the center
  // more. The stored index keeps all 13 (the spec's shape); only the
  // metric weights them.
  const nd = Math.min(a.dims.length, b.dims.length);
  const qMax = (nd - 1) / 2;
  let dd = 0, wsum = 0;
  for (let i = 0; i < nd; i++) {
    const q = i - qMax;
    const w = 1 / (1 + 0.1 * q * q);
    dd += w * (a.dims[i] - b.dims[i]) ** 2;
    wsum += w;
  }
  dd = Math.sqrt(wsum > 0 ? dd / wsum : 0);
  return ALPHA * dphi + BETA * Math.min(1, dd);
}

export const resonance = (a: PamiIndex, b: PamiIndex): number => round(Math.exp(-pamiDistance(a, b) / TAU), 4);

// κ(T,t) as cross-modal PAMI distance (§VII): two simultaneous residual
// windows → two indices → resonance ∈ [0,1].
export function kappaCrossModal(narrative: number[], physiological: number[], cfg: PamiConfig = SPEC_CONFIG): number | null {
  const a = pamiIndex(narrative, cfg), b = pamiIndex(physiological, cfg);
  if (!a || !b) return null;
  return resonance(a, b);
}

// ── wiring seam: PAMI → phase-vessel → regulator ───────────────────────────
// The three φ-implementations in this codebase (this file's wavelet index,
// regulator.ts's free-energy descent, phase-vessel.ts's symplectic hold) were
// each built with a seam for exactly this: regulator.ts exports Coherence for
// phase-vessel.vesselCoherence() to fill in; phase-vessel.ts's docstring calls
// itself "the multiplicative twin of the regulator's additive ledger." Until
// now nothing called across the seam — pami.ts had its own local PHI and
// neither regulator.ts nor phase-vessel.ts was reachable from a memory index.
// This is that connection, derived entirely from the index's own numbers (no
// new free parameters):
//   structural ← fraction of the 8 phase slots the energy gate actually
//                filled (an index that's mostly gated-to-zero has little
//                structure to hold)
//   relational ← fraction of adjacent D(q) pairs that keep the non-increasing
//                shape a genuine multifractal cascade must have (the same
//                check pami.test.ts already runs on cascade() signals)
//   harmonic   ← feed the index's own mean phase magnitude into the vessel as
//                an off-orbit start and read back whether it locks — a
//                well-formed φ-structured residual should fall into the
//                golden rhythm; a noisy one shouldn't
// The resulting Coherence is then run through the SAME regulate() the build's
// scaffold/coherence-layer invariants use, so a PAMI memory's "quality" is
// measured on the identical φ-weighted free-energy scale as everything else
// the regulator already governs.
export interface PamiCoherenceResult {
  coherence: Coherence;
  regulated: RegulatorResult;
  vessel: HoldResult;
}

export function pamiCoherence(idx: PamiIndex): PamiCoherenceResult {
  const occupied = idx.phases.filter((p) => p !== 0).length;
  const structural = idx.phases.length ? occupied / idx.phases.length : 0;

  let monotoneOk = 0;
  for (let i = 1; i < idx.dims.length; i++) if (idx.dims[i] <= idx.dims[i - 1] + 0.15) monotoneOk++;
  const relational = idx.dims.length > 1 ? monotoneOk / (idx.dims.length - 1) : 1;

  const vessel = vesselFor(idx);
  const harmonic = vesselCoherence(vessel).harmonic;

  const coherence: Coherence = { structural, relational, harmonic };
  const regulated = regulate(coherence, { perturb: 0 });
  return { coherence, regulated, vessel };
}

// ── the five operations (§VIII.1) over D1 ─────────────────────────────────
// v1 store: the 21 floats as JSON, linear resonance scan over a bounded
// recent window. The spec's k-d/LSH structure is the scale-up seam; at
// M ≤ a few thousand a scan is exact and fast enough for the tick.

let schemaReady = false;
async function ensureSchema(env: Env): Promise<void> {
  if (schemaReady) return;
  await ensureAllSchemas(env.DB);
  await ensureDeltaColumn(env);
  schemaReady = true;
}

// pami_memories predates per-memory delta; same late-ALTER pattern as
// memory.ts's vectorize_id column. A pre-existing row reads delta=NULL,
// which every consumer below treats as "not yet assigned" and falls back
// to DELTA_DEFAULT for, never as zero/collision.
let deltaColumnReady = false;
async function ensureDeltaColumn(env: Env): Promise<void> {
  if (deltaColumnReady) return;
  await env.DB.prepare('ALTER TABLE pami_memories ADD COLUMN delta REAL').run().catch(() => {});
  deltaColumnReady = true;
}

const genId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);

// ── insertion-time precision (the O(1)-at-query-time fix) ─────────────────
// Computing a query's local density at RETRIEVAL time means scanning the
// whole store on every single lookup — fine in a test, a real cost on
// edge-deployed compute. Move the density calculation to WRITE time instead:
// each memory gets its own permanent delta_i, computed once from its
// nearest neighbor AT THE MOMENT IT'S WRITTEN, so retrieval becomes a flat
// per-candidate comparison (distance < candidate.delta), no scan required.
//
//   delta_i = min(DELTA_MAX, gamma * d(m_i, nearest_other))
//
// gamma=0.5 is not just a "safety margin" — it is PROVABLY sufficient to
// guarantee two memories' basins never overlap: for any pair (A, B),
// nearestDist(A) ≤ d(A,B) by definition (B is one of the candidates the min
// is taken over), so delta_A ≤ 0.5·d(A,B); symmetrically delta_B ≤
// 0.5·d(A,B); therefore delta_A + delta_B ≤ d(A,B), always. Proven inline
// in pami.test.ts across every pair of a real memory set, not just the
// closest one.
//
// THE CAVEAT the "or when the graph undergoes structural changes" phrase in
// this feature's own design brief is pointing at: that guarantee only holds
// for memories that existed WHEN EACH OTHER's delta was computed. If A is
// inserted alone (capped at DELTA_MAX, having no close neighbor yet) and B
// is inserted later very close to A, A's delta is now STALE — it doesn't
// know B exists, and A_delta + B_delta could exceed d(A,B), a real basin
// overlap. pamiStore() below closes this: on every insert, existing
// memories whose stored delta the NEW memory would invalidate get shrunk in
// the same batch, not left to rot until a maintenance pass. pamiRecomputeDeltas()
// is the bulk equivalent for "the graph undergoes structural changes" more
// broadly (a bulk backfill/consolidation-triggered refresh), exported
// standalone rather than wired into any cron path here — that wiring is a
// deliberate choice for whoever owns consolidate.ts's schedule, not a
// silent side effect of this change.
export const GAMMA_DEFAULT = 0.5;
export function computeInsertionDelta(
  newIdx: PamiIndex, existing: PamiIndex[], deltaMax = DELTA_DEFAULT, gamma = GAMMA_DEFAULT,
): number {
  let nearest = Infinity;
  for (const other of existing) {
    const d = pamiDistance(newIdx, other);
    if (d < nearest) nearest = d;
  }
  return Number.isFinite(nearest) ? Math.min(deltaMax, gamma * nearest) : deltaMax;
}

export async function pamiStore(env: Env, index: PamiIndex, content?: string): Promise<string> {
  await ensureSchema(env);
  const id = genId();

  const rows = await env.DB.prepare('SELECT id, index_json, delta FROM pami_memories ORDER BY created_at DESC LIMIT 4000')
    .all().then((r) => r.results as Array<{ id: string; index_json: string; delta: number | null }>).catch(() => []);
  const existing = rows.flatMap((r) => {
    try { return [{ r, idx: JSON.parse(r.index_json) as PamiIndex }]; } catch { return []; }
  });

  const newDelta = computeInsertionDelta(index, existing.map((e) => e.idx));

  // Shrink-on-insert: any existing memory whose stored delta the new one
  // now invalidates gets tightened in the SAME batch, so the no-overlap
  // guarantee never goes stale between writes.
  const shrinks = existing.flatMap(({ r, idx }) => {
    const d = pamiDistance(index, idx);
    const candidate = GAMMA_DEFAULT * d;
    const current = r.delta ?? DELTA_DEFAULT;
    return candidate < current ? [{ id: r.id, delta: Math.max(0, candidate) }] : [];
  });

  const stmts = [
    env.DB.prepare('INSERT INTO pami_memories (id, index_json, content, created_at, delta) VALUES (?,?,?,?,?)')
      .bind(id, JSON.stringify(index), (content || '').slice(0, 4000) || null, Date.now(), newDelta),
    ...shrinks.map((s) => env.DB.prepare('UPDATE pami_memories SET delta = ? WHERE id = ?').bind(s.delta, s.id)),
  ];
  await env.DB.batch(stmts);
  return id;
}

// Bulk maintenance recompute — "when the graph undergoes structural
// changes." Recomputes EVERY stored memory's delta from scratch against the
// full current population. Not on any cron path; call this from wherever
// graph-hygiene maintenance is triggered, on purpose, not by default.
export async function pamiRecomputeDeltas(env: Env, deltaMax = DELTA_DEFAULT, gamma = GAMMA_DEFAULT): Promise<{ updated: number }> {
  await ensureSchema(env);
  const rows = await env.DB.prepare('SELECT id, index_json FROM pami_memories ORDER BY created_at DESC LIMIT 4000')
    .all().then((r) => r.results as Array<{ id: string; index_json: string }>).catch(() => []);
  const parsed = rows.flatMap((r) => {
    try { return [{ id: r.id, idx: JSON.parse(r.index_json) as PamiIndex }]; } catch { return []; }
  });
  const stmts = parsed.map(({ id, idx }) => {
    const others = parsed.filter((p) => p.id !== id).map((p) => p.idx);
    const delta = computeInsertionDelta(idx, others, deltaMax, gamma);
    return env.DB.prepare('UPDATE pami_memories SET delta = ? WHERE id = ?').bind(delta, id);
  });
  if (stmts.length) await env.DB.batch(stmts);
  return { updated: stmts.length };
}

export async function pamiRetrieve(
  env: Env, query: PamiIndex, k = 5,
): Promise<Array<{ id: string; distance: number; resonance: number; content: string | null; delta: number; resolved: boolean }>> {
  await ensureSchema(env);
  const rows = await env.DB.prepare('SELECT id, index_json, content, delta FROM pami_memories ORDER BY created_at DESC LIMIT 4000')
    .all().then((r) => r.results as Array<{ id: string; index_json: string; content: string | null; delta: number | null }>).catch(() => []);
  // O(1) per candidate: each row already carries its own pre-computed
  // basin of attraction from pamiStore()/pamiRecomputeDeltas() — no
  // nearest-neighbor scan happens here, at query time, at all.
  const scored = rows.flatMap((r) => {
    let idx: PamiIndex;
    try { idx = JSON.parse(r.index_json) as PamiIndex; } catch { return []; }
    const d = pamiDistance(query, idx);
    const delta = r.delta ?? DELTA_DEFAULT;
    return [{
      id: r.id, distance: round(d, 4), resonance: round(Math.exp(-d / TAU), 4), content: r.content,
      delta: round(delta, 4), resolved: d < delta,
    }];
  });
  return scored.sort((a, b) => a.distance - b.distance).slice(0, Math.max(1, Math.min(k, 50)));
}

// ── the pami tool (her interface to all five operations) ──────────────────

export interface PamiToolInput {
  op?: 'encode' | 'store' | 'retrieve' | 'resonate' | 'kappa' | 'coherence';
  signal?: number[];       // the residual window (caller subtracts its prediction; identity-𝒫 = raw signal, dream-pass semantics)
  signal_b?: number[];     // second window for kappa
  index?: PamiIndex;       // for store/resonate when already encoded
  index_b?: PamiIndex;
  content?: string;        // payload for store
  k?: number;
}

export async function pamiTool(env: Env, a: PamiToolInput): Promise<string> {
  const op = a.op || (a.signal_b ? 'kappa' : a.signal ? 'encode' : undefined);
  try {
    if (op === 'encode') {
      const idx = pamiIndex(a.signal ?? []);
      return idx ? JSON.stringify({ op, index: idx, floats: idx.phases.length + idx.dims.length })
        : JSON.stringify({ op, error: 'pami encode: need signal[] of ≥32 finite samples' });
    }
    if (op === 'store') {
      const idx = a.index ?? (a.signal ? pamiIndex(a.signal) : null);
      if (!idx) return JSON.stringify({ op, error: 'pami store: provide index or signal[]' });
      const id = await pamiStore(env, idx, a.content);
      return JSON.stringify({ op, memory_id: id });
    }
    if (op === 'retrieve') {
      const idx = a.index ?? (a.signal ? pamiIndex(a.signal) : null);
      if (!idx) return JSON.stringify({ op, error: 'pami retrieve: provide index or signal[]' });
      // Each match carries its OWN pre-computed delta/resolved, assigned at
      // insertion time (computeInsertionDelta in pamiStore) — no
      // nearest-neighbor scan happens here at query time. static_threshold
      // is kept only as a reference baseline, not the actual gate.
      return JSON.stringify({ op, matches: await pamiRetrieve(env, idx, a.k ?? 5), static_threshold: DELTA_DEFAULT });
    }
    if (op === 'resonate') {
      const x = a.index ?? (a.signal ? pamiIndex(a.signal) : null);
      const y = a.index_b ?? (a.signal_b ? pamiIndex(a.signal_b) : null);
      if (!x || !y) return JSON.stringify({ op, error: 'pami resonate: need two indices (or two signals)' });
      return JSON.stringify({ op, resonance: resonance(x, y), distance: round(pamiDistance(x, y), 4) });
    }
    if (op === 'kappa') {
      const kap = kappaCrossModal(a.signal ?? [], a.signal_b ?? []);
      return kap === null ? JSON.stringify({ op, error: 'pami kappa: need two signals of ≥32 samples' })
        : JSON.stringify({ op, kappa: kap });
    }
    if (op === 'coherence') {
      const idx = a.index ?? (a.signal ? pamiIndex(a.signal) : null);
      if (!idx) return JSON.stringify({ op, error: 'pami coherence: provide index or signal[]' });
      const r = pamiCoherence(idx);
      return JSON.stringify({
        op, coherence: r.coherence, free_energy: r.regulated.final.F,
        balanced_superposition: r.regulated.balanced_superposition,
        vessel_locked: r.vessel.locked,
      });
    }
  } catch (e) {
    return JSON.stringify({ op, error: `pami failed: ${(e as Error).message}` });
  }
  return JSON.stringify({ error: 'pami: op must be encode|store|retrieve|resonate|kappa|coherence (or pass signal/signal_b for auto)' });
}

function round(x: number, p: number): number {
  const f = 10 ** p;
  return Math.round(x * f) / f;
}

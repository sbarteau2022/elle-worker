// ============================================================
// SEAM WIRE — two candidate producers for the regulator's ż, built side by
// side on the SAME windows of the SAME live series, gated by the SAME
// pre-registered kill-tests (kappa-memory/validate.ts). Numbers decide.
//
//   Readout A — seam sense (b), the product-manifold disagreement.
//       window → pamiIndex → (pamiBridgeVector ∈ 𝔹²⁹, phases ∈ 𝕋⁸)
//              → ProductPredictor.step → (zHyper, zTorus)
//       d_t  = |unit(zHyper) − unit(zTorus)|          disagreement ∈ [0,1]
//       ż_A  = d_t − d_{t−1}
//       Stays inside kappa-memory's own geometry. Paper §6 sense (b);
//       the per-factor thresholds it names (0.20 ball / 0.70 torus) are
//       counted as "seam events", not used as the score.
//
//   Readout B — seam sense (c), the cross-scale coupling detector.
//       A faithful port of research/seam-rip/rip.py: κ_c = |corr(slow-band
//       signal, fast-band amplitude envelope)| with a circular-shift null.
//       ż_B  = κ_t − κ_{t−1},  precision = 1 − p_t
//       Brought in from the sandbox; the paper calls this κ "unrelated" to
//       kappa-memory's κ. This file is where that claim gets tested.
//
// Per-trajectory scores handed to the gate (TraceRow):
//   reserve       = Σ_t score_t (·precision_t for B)   → RESERVE_CONSOLIDATION
//   velocity_peak = max_t |ż_t|                        → VELOCITY_BOUNDARY
//
// Pre-registered (fixed before the fixture existed — see the test file):
//   WINDOW 64 tokens, STRIDE 4, fs = 1 sample/token,
//   slow band [1/64, 4/64) cycles/token, fast band [8/64, 32/64),
//   N_NULL 200, label settled_open = truncated (a generation that never closed).
// Nothing here writes to seam.ts. Nothing here is wired to production.
// ============================================================
import { pamiIndex, type PamiIndex } from './pami';
import { pamiBridgeVector, PAMI_BRIDGE_DIM, PAMI_PHASE_COUNT } from './pami-bridge';
import { ProductPredictor, surpriseToUnit } from './predict';
import { runValidateKappa, type TraceRow, type ValidateKappaReport } from './kappa-memory/validate';

export const WIRE = {
  WINDOW: 64,
  STRIDE: 4,
  SLOW_BAND: [1 / 64, 4 / 64] as const,   // cycles per token, [lo, hi)
  FAST_BAND: [8 / 64, 32 / 64] as const,
  N_NULL: 200,
  SEAM_B_BALL: 0.20,    // paper §9 per-factor disagreement thresholds
  SEAM_B_TORUS: 0.70,
} as const;

// ── tiny deterministic RNG (xorshift32) so the null is replayable ─────────────
export function makeRng(seed: number): () => number {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// ── FFT (radix-2, in place, N must be a power of two) ─────────────────────────
function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (2 * Math.PI / len) * (inverse ? 1 : -1);
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = i + k + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

const isPow2 = (n: number) => n > 0 && (n & (n - 1)) === 0;

// rip.py: bandpass(x, lo, hi, fs) — brick-wall on rfft bins with lo ≤ f < hi.
export function bandpass(x: number[], lo: number, hi: number, fs = 1): number[] {
  const n = x.length;
  if (!isPow2(n)) throw new Error(`bandpass: n=${n} must be a power of two`);
  const re = Float64Array.from(x), im = new Float64Array(n);
  fft(re, im);
  for (let k = 0; k < n; k++) {
    // rfftfreq semantics: bins 0..n/2 carry f = k·fs/n; mirror the mask to the
    // negative side so the inverse stays real (this is what irfft does).
    const kk = k <= n / 2 ? k : n - k;
    const f = (kk * fs) / n;
    if (!(f >= lo && f < hi)) { re[k] = 0; im[k] = 0; }
  }
  fft(re, im, true);
  return Array.from(re);
}

// rip.py: analytic(x) — Hilbert via the one-sided spectrum; returns |analytic|.
export function envelope(x: number[]): number[] {
  const n = x.length;
  if (!isPow2(n)) throw new Error(`envelope: n=${n} must be a power of two`);
  const re = Float64Array.from(x), im = new Float64Array(n);
  fft(re, im);
  const h = new Float64Array(n);
  h[0] = 1; h[n / 2] = 1;
  for (let k = 1; k < n / 2; k++) h[k] = 2;
  for (let k = 0; k < n; k++) { re[k] *= h[k]; im[k] *= h[k]; }
  fft(re, im, true);
  const out = new Array<number>(n);
  for (let k = 0; k < n; k++) out[k] = Math.hypot(re[k], im[k]);
  return out;
}

function demean(x: number[]): number[] {
  const m = x.reduce((s, v) => s + v, 0) / x.length;
  return x.map((v) => v - m);
}
function corrNorm(a: number[], b: number[]): number {
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  const d = Math.sqrt(aa * bb);
  return d > 0 ? ab / d : 0;
}

export interface CouplingResult {
  kappa: number;      // |corr| — the seam-rip κ_c
  p: number;          // circular-shift permutation p-value
  nullMean: number;
}

// rip.py: rip(s, fs, n_null, seed) — κ with its circular-shift null.
export function coupling(
  s: number[],
  opts: { fs?: number; slow?: readonly [number, number]; fast?: readonly [number, number]; nNull?: number; seed?: number } = {},
): CouplingResult {
  const fs = opts.fs ?? 1;
  const slow = opts.slow ?? WIRE.SLOW_BAND;
  const fast = opts.fast ?? WIRE.FAST_BAND;
  const nNull = opts.nNull ?? WIRE.N_NULL;
  const a = demean(bandpass(s, slow[0], slow[1], fs));
  const b = demean(envelope(bandpass(s, fast[0], fast[1], fs)));
  const real = Math.abs(corrNorm(a, b));
  const rng = makeRng(opts.seed ?? 0);
  const n = b.length;
  const lo = Math.max(1, Math.round(fs));
  const span = Math.max(1, n - 2 * lo);
  let ge = 0, sum = 0;
  const bs = new Array<number>(n);
  for (let i = 0; i < nNull; i++) {
    const shift = lo + Math.floor(rng() * span);
    for (let k = 0; k < n; k++) bs[(k + shift) % n] = b[k]; // np.roll
    const r = Math.abs(corrNorm(a, bs));
    sum += r;
    if (r >= real) ge++;
  }
  return { kappa: real, p: (ge + 1) / (nNull + 1), nullMean: sum / nNull };
}

// ── windows ───────────────────────────────────────────────────────────────────
export function windows(series: number[], window = WIRE.WINDOW, stride = WIRE.STRIDE): number[][] {
  const out: number[][] = [];
  for (let s = 0; s + window <= series.length; s += stride) out.push(series.slice(s, s + window));
  return out;
}

// ── Readout B: seam sense (c) ─────────────────────────────────────────────────
export interface ReadoutTrace {
  score: number[];       // per-window score (d_t for A, κ_t for B)
  precision: number[];   // 1 for A; 1 − p_t for B
  zdot: number[];        // ż_t = score_t − score_{t−1}
  nWindows: number;
  nRejected: number;     // windows the readout could not score
  seamEvents: number;    // A only: windows past either per-factor threshold
}

export function readoutB(series: number[], seed = 0): ReadoutTrace {
  const ws = windows(series);
  const score: number[] = [], precision: number[] = [];
  ws.forEach((w, i) => {
    const r = coupling(w, { seed: seed * 7919 + i });
    score.push(r.kappa);
    precision.push(1 - r.p);
  });
  return finish(score, precision, ws.length, 0, 0);
}

// ── Readout A: seam sense (b) ─────────────────────────────────────────────────
export function readoutA(series: number[]): ReadoutTrace {
  const ws = windows(series);
  const pp = new ProductPredictor(PAMI_BRIDGE_DIM, PAMI_PHASE_COUNT);
  const score: number[] = [], precision: number[] = [];
  let rejected = 0, seamEvents = 0;
  // One entry per window, NaN where the readout could not score — keeps the
  // trace aligned to the windows so causality is testable index-for-index.
  for (const w of ws) {
    const idx: PamiIndex | null = pamiIndex(w);
    if (!idx) { rejected++; score.push(Number.NaN); precision.push(Number.NaN); continue; }
    const st = pp.step(pamiBridgeVector(idx), idx.phases);
    const zh = st.zHyper, zt = st.zTorus;
    if (zh === null || zt === null || Number.isNaN(zh) || Number.isNaN(zt)) {
      rejected++; score.push(Number.NaN); precision.push(Number.NaN); continue;
    }
    if ((st.residualHyper ?? 0) > WIRE.SEAM_B_BALL || (st.residualTorus ?? 0) > WIRE.SEAM_B_TORUS) seamEvents++;
    score.push(Math.abs(surpriseToUnit(zh) - surpriseToUnit(zt)));
    precision.push(1);
  }
  return finish(score, precision, ws.length, rejected, seamEvents);
}

function finish(score: number[], precision: number[], nWindows: number, nRejected: number, seamEvents: number): ReadoutTrace {
  // ż over consecutive SCORED windows (NaN gaps are skipped, never zero-filled).
  const zdot: number[] = [];
  let prev: number | null = null;
  for (const v of score) {
    if (Number.isNaN(v)) continue;
    if (prev !== null) zdot.push(v - prev);
    prev = v;
  }
  return { score, precision, zdot, nWindows, nRejected, seamEvents };
}

// ── trace → gate row ──────────────────────────────────────────────────────────
export function toTraceRow(t: ReadoutTrace, settledOpen: 0 | 1): TraceRow {
  const scored = t.score.map((v, i) => [v, t.precision[i]] as const).filter(([v]) => !Number.isNaN(v));
  if (scored.length < 2) return { settled_open: settledOpen, reserve: null, velocity_peak: null };
  let reserve = 0;
  for (const [v, p] of scored) reserve += v * p;
  const velocity_peak = t.zdot.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  return { settled_open: settledOpen, reserve, velocity_peak };
}

export interface FixtureRow {
  idx: number;
  correct: boolean;
  truncated: boolean;          // at the generating eval's own token budget
  open_at_512?: boolean;       // full completion ≥ 512 tokens (val's `truncated` ≡ this)
  n_completion_full?: number;
  n_completion: number;
  short: boolean;
  streams: Record<string, number[]>;
}

export interface ArmReport {
  readout: 'A' | 'B';
  stream: string;
  n: number;
  nNullRows: number;          // rows with no scorable pair of windows
  meanRejected: number;
  meanSeamEvents: number;
  report: ValidateKappaReport;
}

export function runArm(
  readout: 'A' | 'B',
  stream: string,
  rows: FixtureRow[],
  label: (r: FixtureRow) => 0 | 1,
  seed = 0,
): ArmReport {
  const traces: TraceRow[] = [];
  let rej = 0, seam = 0, nullRows = 0;
  rows.forEach((r, i) => {
    const s = r.streams[stream];
    const t = readout === 'A' ? readoutA(s) : readoutB(s, seed * 100003 + i);
    rej += t.nRejected; seam += t.seamEvents;
    const row = toTraceRow(t, label(r));
    if (row.reserve === null) nullRows++;
    traces.push(row);
  });
  return {
    readout, stream, n: rows.length, nNullRows: nullRows,
    meanRejected: rej / Math.max(1, rows.length),
    meanSeamEvents: seam / Math.max(1, rows.length),
    report: runValidateKappa(traces, 0),
  };
}

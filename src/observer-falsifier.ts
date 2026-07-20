// ============================================================
// THE OBSERVER FALSIFIER — src/observer-falsifier.ts  —  the NULL-able gate
//
// The rung the whole ladder was climbing toward, and the one held to the
// strictest discipline: it must be able to come back NULL, or it is a
// kaleidoscope (seam-rip's rule). Built and self-test-validated on SYNTHETIC
// data here; the real verdict runs over the closed-case docket (observer-
// docket.ts) once cases are drained and labeled.
//
// THE PRE-REGISTERED CLAIM (written before the evidence): a run whose reasoning
// trajectory is more coherent — higher κ — produces a Prediction that better
// matches what the historical record shows actually happened. Coherence should
// predict accuracy. The test is a Spearman rank correlation between the per-run
// trajectory κ and the prediction↔outcome match, against a PERMUTATION NULL
// that shuffles the pairing. One-sided (coherence predicts BETTER match).
//
// Decision rule, pre-registered:
//   PASS         — p < alpha AND rho > 0  (coherence predicts accuracy)
//   NULL         — otherwise               (the honest empty result)
//   UNDERPOWERED — fewer than POWER_FLOOR pairs (no verdict; never dress
//                  sampling noise as signal — the docket is only 10 cases)
//
// It RANKS AND GATES NOTHING. It is a verdict readout. Whether κ ever earns the
// right to inform, let alone steer, reasoning stays gated behind this returning
// signal on real data — and it has not yet.
//
// PURE: no I/O, no wall clock, no Math.random (a seeded PRNG so the permutation
// null is reproducible and resume-safe). observer.ts owns the D1 reads/writes.
// ============================================================

export const POWER_FLOOR = 8; // fewer real (κ, match) pairs → no verdict
export const ALPHA = 0.01; // pre-registered significance

export type Verdict = 'PASS' | 'NULL' | 'UNDERPOWERED';

export interface FalsifyResult {
  verdict: Verdict;
  rho: number | null; // Spearman(κ, match), null when underpowered
  p: number | null; // permutation-null p-value, null when underpowered
  n: number;
  alpha: number;
}

// Deterministic PRNG (mulberry32). No Math.random — the worker core forbids it
// (resume-safety), and a seeded null is reproducible, which the discipline wants.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Spearman rank correlation. Ties broken by first-seen order — coarse, but the
// inputs are continuous scores where exact ties are near-zero-measure, and the
// permutation null uses the same ranking on both sides so any bias cancels.
export function spearman(a: number[], b: number[]): number {
  const rank = (xs: number[]) => {
    const order = xs.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(xs.length);
    order.forEach(([, i], k) => { r[i] = k; });
    return r;
  };
  const ra = rank(a), rb = rank(b), n = a.length;
  const mean = (n - 1) / 2;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = ra[i] - mean, y = rb[i] - mean;
    num += x * y; da += x * x; db += y * y;
  }
  const den = Math.sqrt(da * db);
  return den > 0 ? num / den : 0;
}

// A DETERMINISTIC first proxy for prediction↔outcome match: content-word
// Jaccard overlap ∈ [0,1]. Honest scope: this is a lexical stand-in for a real
// judge (LLM or human) of whether the Prediction described what happened. It is
// swappable — the falsifier core takes numeric match, not this function — but a
// deterministic proxy keeps the whole gate reproducible and self-testable.
const STOP = new Set('the a an and or but of to in on at for with as is are was were be been being it its this that these those by from into than then so not no nor only over under about after before within without across against toward'.split(' '));
function contentTokens(s: string): Set<string> {
  return new Set(
    String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3 && !STOP.has(w))
  );
}
export function overlapMatch(prediction: string, realized: string): number {
  const a = contentTokens(prediction), b = contentTokens(realized);
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter); // Jaccard
}

// The gate. pairs: {coherence: κ_run, match: prediction↔outcome score}.
export function falsify(
  pairs: Array<{ coherence: number; match: number }>,
  opts: { nNull?: number; seed?: number; alpha?: number } = {},
): FalsifyResult {
  const n = pairs.length;
  const alpha = opts.alpha ?? ALPHA;
  if (n < POWER_FLOOR) return { verdict: 'UNDERPOWERED', rho: null, p: null, n, alpha };

  const coh = pairs.map(p => p.coherence);
  const mat = pairs.map(p => p.match);
  const real = spearman(coh, mat);

  const nNull = opts.nNull ?? 2000;
  const rng = mulberry32((opts.seed ?? 0) >>> 0);
  const shuffled = mat.slice();
  let ge = 0;
  for (let k = 0; k < nNull; k++) {
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = t;
    }
    if (spearman(coh, shuffled) >= real) ge++;
  }
  const p = (ge + 1) / (nNull + 1); // one-sided, with the +1 floor
  const verdict: Verdict = p < alpha && real > 0 ? 'PASS' : 'NULL';
  return { verdict, rho: real, p, n, alpha };
}

// Synthetic (coherence, match) pairs for the self-test — the proof that the
// gate can come back NULL:
//   'coupled'  — match ≈ coherence + noise (coherence predicts accuracy) → PASS
//   'noise'    — coherence and match independent                        → NULL
//   'shuffled' — coupled, then the pairing is permuted away             → NULL
export function syntheticPairs(
  mode: 'coupled' | 'noise' | 'shuffled',
  n: number,
  seed: number,
): Array<{ coherence: number; match: number }> {
  const rng = mulberry32(seed >>> 0);
  const coh: number[] = [], mat: number[] = [];
  for (let i = 0; i < n; i++) {
    const c = rng();
    coh.push(c);
    mat.push(mode === 'noise' ? rng() : Math.max(0, Math.min(1, 0.7 * c + 0.3 * rng())));
  }
  if (mode === 'shuffled') {
    for (let i = mat.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = mat[i]; mat[i] = mat[j]; mat[j] = t;
    }
  }
  return coh.map((c, i) => ({ coherence: c, match: mat[i] }));
}

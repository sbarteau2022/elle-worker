import { describe, it, expect } from 'vitest';
import { PHI, PHI_INV } from './regulator';

// ============================================================
// RCRB-001 — Relational Coherence Recovery Benchmark
//
// The prior ablation (pami-basis-ablation.test.ts) tested φ on a STATIC task:
// does a φ-spaced wavelet basis retrieve the right memory in one shot. That's
// an information-theoretic discriminability question, not a test of φ's
// actual claimed advantage — Hurwitz optimality is a statement about
// resistance to RESONANCE UNDER ITERATION. This file tests that instead,
// against the same rival ratios, using the real dynamical machinery already
// in this codebase (phase-vessel.ts's vesselStep, regulator.ts's
// perturbation-escape mechanism) rather than inventing new math.
//
// Three separate probes, none of which import anything private — everything
// here is either an exported function called with different parameters, or a
// faithful re-derivation of a private one (documented at each site), exactly
// as pami-basis-ablation.test.ts did for the Hurwitz constant. Neither
// regulator.ts nor phase-vessel.ts is modified.
//
//   Part 1 — radial recovery speed after a single large kick, across winding
//   numbers. Structural control: phase-vessel's radius update
//   (r2 = 1+(r-1)(1-kappa)) does not depend on the angular winding number at
//   all, so this SHOULD be winding-invariant. Confirms that "φ recovers
//   faster from a shock" is not a claim this architecture's current math
//   supports — recovery speed is a κ (relaxation-rate) property only.
//
//   Part 2 — perturbation-escape efficiency: swap the base of the
//   golden-angle escape kick (regulator.ts's phiPerturb) for each rival,
//   across a spread of planted double-well shapes, and find the minimum
//   amplitude that crosses the barrier. Tests whether φ's "never repeats"
//   equidistribution property makes it a more efficient escape kick than
//   others of the same amplitude.
//
//   Part 3 — the actual resonance-avoidance question: if perturbations arrive
//   PERIODICALLY (a real-world pattern: recurring writes, decay cycles, cron
//   ticks) at some period P not known in advance, does the phase at which
//   they land cluster (privileged, resonant points) or equidistribute,
//   depending on the winding number? This is the direct dynamical analogue of
//   the Hurwitz question, evaluated the honest way: swept across many
//   candidate periods, at two different sample depths, with the actual
//   numbers reported even where they don't cooperate.
// ============================================================

const SILVER_INV = 1 / (1 + Math.SQRT2);
const SQRT2_INV = 1 / Math.SQRT2;
const E_INV = 1 / Math.E;
const PI_INV = 1 / Math.PI;
const RATIONAL = 0.6; // 3/5 exactly — the degenerate control

function frac(x: number): number { return x - Math.floor(x); }

// ── Part 1: radial recovery, faithful port of phase-vessel.ts's vesselStep ──
// (vesselStep IS exported — this reimplementation exists only so the winding
// number can be swept without importing PHI-locked defaults; the formula is
// identical to src/phase-vessel.ts:79-86.)
interface PhaseState { q: number; p: number }
const TWO_PI = Math.PI * 2;
function toNorm(s: PhaseState) { return { X: s.q / PHI, Y: PHI * s.p }; }
function fromNorm(X: number, Y: number): PhaseState { return { q: PHI * X, p: Y / PHI }; }
function vesselStep(s: PhaseState, kappa: number, winding: number): PhaseState {
  const { X, Y } = toNorm(s);
  const r = Math.hypot(X, Y);
  const th = Math.atan2(Y, X) + TWO_PI * winding;
  const r2 = 1 + (r - 1) * (1 - kappa);
  return fromNorm(r2 * Math.cos(th), r2 * Math.sin(th));
}
function recoveryTime(winding: number, kappa = 0.03, kickFactor = 1.8, tol = 1e-4, maxSteps = 2000): number {
  let s: PhaseState = { q: PHI * kickFactor, p: 0 };
  for (let t = 1; t <= maxSteps; t++) {
    s = vesselStep(s, kappa, winding);
    const { X, Y } = toNorm(s);
    if (Math.abs(Math.hypot(X, Y) - 1) < tol) return t;
  }
  return -1;
}

describe('RCRB-001 Part 1 — radial recovery speed is winding-invariant (a structural fact, not a φ-advantage)', () => {
  it('φ, its rivals, and even a rational winding recover in EXACTLY the same number of steps', () => {
    const candidates = [PHI_INV, SILVER_INV, SQRT2_INV, E_INV, PI_INV, RATIONAL];
    const times = candidates.map((w) => recoveryTime(w));
    expect(times[0]).toBe(296); // pinned — the actual measured recovery time
    for (const t of times) expect(t).toBe(times[0]);
    // This is the honest structural finding: in the current phase-vessel.ts
    // implementation, radius and angle are fully decoupled, so NO winding
    // number recovers a radial shock faster than any other. If "φ heals
    // faster" is a claim anyone wants to make about this architecture, the
    // current math does not support it — recovery speed is purely a
    // function of kappa.
  });
});

// ── Part 2: perturbation-escape ablation, faithful port of regulator.ts's
// wellGeometry/escapeRun/phiPerturb (all private there), with the
// perturbation's base as a swept parameter instead of the hardcoded GOLDEN. ──
function perturbAt(t: number, k: number, amp: number, base: number): number {
  const phase = frac((t + 1) * base + k * base * base) * 2 * Math.PI;
  return amp * Math.cos(phase);
}
function wellGeometry(tilt: number): { spurious: number; barrier: number; target: number } {
  const dU = (x: number) => 4 * x * x * x - 4 * x - tilt;
  const bisect = (lo: number, hi: number) => {
    let flo = dU(lo);
    for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2, fm = dU(m); if ((fm < 0) === (flo < 0)) { lo = m; flo = fm; } else hi = m; }
    return (lo + hi) / 2;
  };
  const roots: number[] = [];
  let px = -3, pf = dU(-3);
  for (let i = 1; i <= 4000; i++) { const x = -3 + 6 * i / 4000, f = dU(x); if ((f < 0) !== (pf < 0)) roots.push(bisect(px, x)); px = x; pf = f; }
  roots.sort((a, b) => a - b);
  const [spurious, barrier, target] = roots;
  return { spurious, barrier, target };
}
function escapeRun(tilt: number, amp0: number, base: number, steps = 8000): number {
  const dU = (x: number) => 4 * x * x * x - 4 * x - tilt;
  let x = wellGeometry(tilt).spurious, amp = amp0;
  for (let t = 0; t < steps; t++) { const p = amp > 0 ? perturbAt(t, 0, amp, base) : 0; x = x - 0.01 * dU(x) + p; amp *= 0.9997; }
  return x;
}
function minEscapeAmp(tilt: number, base: number): number | null {
  const g = wellGeometry(tilt);
  for (const amp of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5]) {
    if (escapeRun(tilt, amp, base) > g.barrier) return amp;
  }
  return null;
}

describe('RCRB-001 Part 2 — escape-kick efficiency does not reward the base\'s Diophantine quality', () => {
  it('a RATIONAL base (0.6) ties φ exactly at every tilt tested — the key finding', () => {
    // If Diophantine quality (never-repeating phase) mattered to this
    // mechanism, a rational base should need MORE amplitude, or fail to
    // escape at all within the tested range. It doesn't — it matches φ
    // amplitude-for-amplitude at every tilt.
    const tilts = [0.8, 1.0, 1.2, 1.5];
    const pinned = [1.1, 0.9, 0.7, 0.3];
    tilts.forEach((tilt, i) => {
      const phiAmp = minEscapeAmp(tilt, PHI_INV);
      const ratAmp = minEscapeAmp(tilt, RATIONAL);
      expect(phiAmp).toBe(pinned[i]);
      expect(ratAmp).toBe(phiAmp);
    });
  });

  it('√2 needs LESS amplitude than φ at 3 of 4 tilts — φ is never the best performer here', () => {
    const tilts = [0.8, 1.0, 1.2, 1.5];
    const results = tilts.map((tilt) => ({
      tilt, phi: minEscapeAmp(tilt, PHI_INV)!, sqrt2: minEscapeAmp(tilt, SQRT2_INV)!,
    }));
    expect(results[0]).toEqual({ tilt: 0.8, phi: 1.1, sqrt2: 0.9 });
    expect(results[1]).toEqual({ tilt: 1.0, phi: 0.9, sqrt2: 0.8 });
    expect(results[2]).toEqual({ tilt: 1.2, phi: 0.7, sqrt2: 0.6 });
    expect(results[3]).toEqual({ tilt: 1.5, phi: 0.3, sqrt2: 0.3 }); // only tied here
    for (const r of results) expect(r.sqrt2).toBeLessThanOrEqual(r.phi); // never worse, often strictly better
    // The honest finding: crossing a SINGLE planted barrier over 8000 steps
    // only requires SOME oscillation of sufficient amplitude — it doesn't
    // matter whether that oscillation ever repeats a phase, because the run
    // is long enough that even a rational (repeating) kick eventually lands
    // near a favorable phase. This mechanism, as built, does not exercise
    // equidistribution at all, and where it differentiates candidates, φ is
    // not the winner. It would need either far fewer steps (so a resonant
    // kick genuinely might never get a favorable phase in time) or a
    // moving/multiple-well landscape to actually test the claim.
  });
});

// ── Part 3: the real test — does periodic sampling of the winding phase
// cluster (resonance) or equidistribute, across a spread of unknown periods? ──
function maxGap(samples: number[]): number {
  const s = [...samples].sort((a, b) => a - b);
  let g = 0;
  for (let i = 1; i < s.length; i++) g = Math.max(g, s[i] - s[i - 1]);
  g = Math.max(g, s[0] + 1 - s[s.length - 1]); // wraparound
  return g;
}
function worstCaseClustering(winding: number, periods: number[], samplesPerPeriod: number): number {
  let worst = 0;
  for (const P of periods) {
    const samples: number[] = [];
    for (let k = 1; k <= samplesPerPeriod; k++) samples.push(frac(k * P * winding));
    worst = Math.max(worst, maxGap(samples));
  }
  return worst;
}

describe('RCRB-001 Part 3 — periodic-perturbation phase clustering: rational collapses; among irrationals, no stable winner', () => {
  const PERIODS = Array.from({ length: 60 }, (_, i) => i + 2); // periods 2..61

  it('a rational winding (0.6) clusters catastrophically — total resonance at some period, always', () => {
    const w = worstCaseClustering(RATIONAL, PERIODS, 500);
    expect(w).toBeGreaterThan(0.9); // near-total collapse to a single point at some period in range
  });

  it('PINS both scales honestly: φ is NOT robustly best among irrationals — the ranking flips with sample depth', () => {
    // At 500 samples/period, φ's worst-case gap is among the LARGEST of the
    // irrational candidates (worse than silver, sqrt2, e, π at their own
    // worst periods in this range).
    const at500 = {
      phi: worstCaseClustering(PHI_INV, PERIODS, 500),
      silver: worstCaseClustering(SILVER_INV, PERIODS, 500),
      sqrt2: worstCaseClustering(SQRT2_INV, PERIODS, 500),
      e: worstCaseClustering(E_INV, PERIODS, 500),
      pi: worstCaseClustering(PI_INV, PERIODS, 500),
    };
    expect(at500.phi).toBeCloseTo(0.0643, 3);
    expect(at500.e).toBeCloseTo(0.0271, 3);
    expect(at500.pi).toBeCloseTo(0.0140, 3);
    expect(at500.phi).toBeGreaterThan(at500.e);
    expect(at500.phi).toBeGreaterThan(at500.pi);

    // At 2000 samples/period (same periods), φ's worst-case gap becomes the
    // SMALLEST of the same candidates — the opposite ranking.
    const at2000 = {
      phi: worstCaseClustering(PHI_INV, PERIODS, 2000),
      silver: worstCaseClustering(SILVER_INV, PERIODS, 2000),
      sqrt2: worstCaseClustering(SQRT2_INV, PERIODS, 2000),
      e: worstCaseClustering(E_INV, PERIODS, 2000),
      pi: worstCaseClustering(PI_INV, PERIODS, 2000),
    };
    expect(at2000.phi).toBeCloseTo(0.0099, 3);
    expect(at2000.silver).toBeCloseTo(0.0174, 3);
    expect(at2000.phi).toBeLessThan(at2000.silver);
    expect(at2000.phi).toBeLessThan(at2000.sqrt2);

    // THE FINDING: the ranking is not stable across sample depth (φ worst at
    // N=500, φ best at N=2000, same periods, same everything else) — this
    // "worst single gap across a fixed period list" statistic is dominated
    // by whichever one period happens to have a coincidental near-rational
    // alignment within the tested range, which is itself an arbitrary
    // artifact of which periods got tested, not a stable property of the
    // winding number. It neither confirms nor kills φ's specific advantage;
    // it shows this particular operationalization of "resonance avoidance
    // under unknown periodic perturbation" is too noisy at these scales to
    // settle the question either way. A cleaner metric (analytic
    // discrepancy bound, or averaging over a much larger period range) would
    // be needed before treating this as evidence in either direction.
  });
});

// ── Part 4: replacing the noisy metric — WHY it was noisy, and two analytic
// fixes instead of one more simulation. ──────────────────────────────────
//
// Part 3's instability is not simulation noise — it is the Three-Gap Theorem
// (Steinhaus): for ANY irrational α and any K, the points {kα mod 1 : k=1..K}
// split the circle into exactly two or three distinct gap lengths, and the
// worst gap only shrinks in discrete STEPS — flat until some k happens to
// bisect the largest gap, then a jump down. Different candidate ratios hit
// their step-downs at different K, so "worst gap across many periods, at one
// fixed K" can rank them in whatever order those steps happen to have landed
// at that specific K — not a stable property of the ratio. This is why φ
// ranked worst at K=500 and best at K=2000 with nothing else changed.
//
// Two replacements, both K-smoother because both look at the WHOLE point set
// rather than the single worst gap:
//
//   4a. Star discrepancy D*_K — the Koksma–Hlawka object: max deviation
//   between the empirical CDF of {kβ mod 1} and the ideal uniform CDF,
//   compared across K depths to check the ranking actually stabilizes.
//
//   4b. Weyl spectral envelope — closed-form (geometric series), no
//   simulation at all: S_K(β) = |sin(πKβ)| / (K·|sin(πβ)|). The raw value
//   still oscillates in K (the numerator does), but its K-INDEPENDENT
//   envelope, 1/|sin(πβ)|, is exactly the quantity that governs the worst
//   case over all K — and it reduces to the same n·‖nω‖ Hurwitz-constant
//   family already validated analytically in pami-basis-ablation.test.ts,
//   now applied to β = P·ω for many P instead of to ω alone.

function starDiscrepancy(samples: number[]): number {
  const s = [...samples].sort((a, b) => a - b);
  const n = s.length;
  let D = 0;
  for (let i = 0; i < n; i++) {
    D = Math.max(D, (i + 1) / n - s[i], s[i] - i / n);
  }
  return D;
}
function worstCaseDiscrepancy(winding: number, periods: number[], K: number): number {
  let worst = 0;
  for (const P of periods) {
    const samples: number[] = [];
    for (let k = 1; k <= K; k++) samples.push(frac(k * P * winding));
    worst = Math.max(worst, starDiscrepancy(samples));
  }
  return worst;
}
function weylEnvelope(beta: number): number {
  const denom = Math.abs(Math.sin(Math.PI * beta));
  return denom < 1e-15 ? Infinity : 1 / denom;
}
function worstCaseWeylEnvelope(winding: number, periods: number[]): number {
  let worst = 0;
  for (const P of periods) worst = Math.max(worst, weylEnvelope(P * winding));
  return worst;
}

describe('RCRB-001 Part 4a — star discrepancy: smoother than max-gap, still no clean φ win', () => {
  const PERIODS = Array.from({ length: 60 }, (_, i) => i + 2);

  it('rational (0.6) is UNAMBIGUOUS at every K — discrepancy pinned at exactly 1.0, no step-function ambiguity at all', () => {
    for (const K of [100, 3200]) {
      expect(worstCaseDiscrepancy(RATIONAL, PERIODS, K)).toBe(1);
    }
  });

  it('PINS the six-candidate table across six K depths — the ranking is smoother but STILL does not crown φ', () => {
    const KS = [100, 200, 400, 800, 1600, 3200];
    const table = {
      phi: KS.map((K) => Number(worstCaseDiscrepancy(PHI_INV, PERIODS, K).toFixed(5))),
      silver: KS.map((K) => Number(worstCaseDiscrepancy(SILVER_INV, PERIODS, K).toFixed(5))),
      sqrt2: KS.map((K) => Number(worstCaseDiscrepancy(SQRT2_INV, PERIODS, K).toFixed(5))),
      e: KS.map((K) => Number(worstCaseDiscrepancy(E_INV, PERIODS, K).toFixed(5))),
      pi: KS.map((K) => Number(worstCaseDiscrepancy(PI_INV, PERIODS, K).toFixed(5))),
    };
    expect(table.phi).toEqual([0.23315, 0.14888, 0.07133, 0.0455, 0.01316, 0.01003]);
    expect(table.e).toEqual([0.26343, 0.0407, 0.02947, 0.02401, 0.01539, 0.00705]);
    expect(table.pi).toEqual([0.71825, 0.4365, 0.1005, 0.086, 0.05701, 0.0137]);
    // φ solidly beats π at every depth — the badly-approximable-vs-not
    // category claim holds up cleanly here.
    for (let i = 0; i < KS.length; i++) expect(table.phi[i]).toBeLessThan(table.pi[i]);
    // e beats φ at 4 of 5 later depths (K=200,400,800,3200) but φ edges back
    // ahead at K=1600 — smoother than Part 3's total reversal, but still not
    // a stable, monotonic φ win. Precise, not rounded to a clean story:
    expect(table.e[1]).toBeLessThan(table.phi[1]); // K=200: e wins
    expect(table.e[2]).toBeLessThan(table.phi[2]); // K=400: e wins
    expect(table.e[3]).toBeLessThan(table.phi[3]); // K=800: e wins
    expect(table.phi[4]).toBeLessThan(table.e[4]); // K=1600: φ wins
    expect(table.e[5]).toBeLessThan(table.phi[5]); // K=3200: e wins
  });
});

describe('RCRB-001 Part 4b — Weyl spectral envelope: closed-form, zero simulation, same conclusion', () => {
  const PERIODS = Array.from({ length: 60 }, (_, i) => i + 2);

  it('the rational winding has an infinite envelope — an exact analytic certificate of total resonance, not an approximation', () => {
    expect(worstCaseWeylEnvelope(RATIONAL, PERIODS)).toBe(Infinity);
  });

  it('PINS the K-independent envelope for all five irrationals — φ is mid-pack, not best, not worst', () => {
    const envelopes = {
      phi: Number(worstCaseWeylEnvelope(PHI_INV, PERIODS).toFixed(2)),
      silver: Number(worstCaseWeylEnvelope(SILVER_INV, PERIODS).toFixed(2)),
      sqrt2: Number(worstCaseWeylEnvelope(SQRT2_INV, PERIODS).toFixed(2)),
      e: Number(worstCaseWeylEnvelope(E_INV, PERIODS).toFixed(2)),
      pi: Number(worstCaseWeylEnvelope(PI_INV, PERIODS).toFixed(2)),
    };
    expect(envelopes).toEqual({ phi: 39.15, silver: 26.11, sqrt2: 36.92, e: 30.94, pi: 112.98 });
    // Ranked best (lowest envelope, least resonance-prone) to worst:
    // silver < e < sqrt2 < φ < π. φ sits fourth of five — solidly ahead of
    // π, solidly behind silver, e, and √2. This is the cleanest metric run
    // (exact trigonometric identity, no K-dependence, no sampling, no
    // step-function artifact of any kind) and it agrees with 4a: φ is not
    // the empirical winner among these irrationals for the specific question
    // "how bad can the worst of many unknown periods be." The categorical
    // claim (irrational beats rational) is airtight across all three
    // methods now tried (max-gap, discrepancy, Weyl envelope). The
    // specific claim (φ beats other well-chosen irrationals) is not, across
    // all three.
  });
});

import { describe, it, expect } from 'vitest';
import { pamiIndex, pamiDistance, indexLength, SPEC_CONFIG, PHI, type PamiConfig } from './pami';

// ============================================================
// PAMI BASIS ABLATION — validate φ or kill it
//
// The existing F3 harness (pami.test.ts) ablates COMPONENT COUNT (8+5 vs
// 8+13 vs 8+21) but never touches the deeper claim: that the wavelet SCALE
// RATIO itself must be φ (spec §II.3, Hurwitz optimality). This file tests
// that claim directly, two ways:
//
//   Part A — pure math, no signal, no PAMI. Numerically compute the Hurwitz
//   recurrence constant δ(ω) = inf_n n·‖nω‖ for φ and its named rivals
//   (silver ratio, √2, dyadic 2, e, π, a rational lookalike). This is the
//   theorem the whole architecture leans on — either it holds numerically or
//   it doesn't.
//
//   Part B — applied. Swap PamiConfig.scaleBase (the F1 ablation seam added
//   in this change) across the same rival list and run the IDENTICAL
//   partial-cue retrieval benchmark pami.test.ts already uses. Run it against
//   BOTH a φ-structured signal family (frequencies spaced by powers of φ —
//   the existing generator) AND a basis-NEUTRAL family whose frequency
//   spacing has no relationship to any candidate ratio. The φ-structured
//   family alone would be circular: of course an analysis basis matching the
//   signal's own generator wins. The neutral family is the honest test.
// ============================================================

// ── Part A: the Hurwitz recurrence constant, computed, not cited ──────────

const SILVER = 1 + Math.SQRT2;      // metallic ratio, cf [2;2,2,2,...]
const SQRT2 = Math.SQRT2;           // cf [1;2,2,2,...]
const DYADIC = 2;                   // rational — the real-world wavelet standard
const E = Math.E;                   // unbounded partial quotients
const PI = Math.PI;                 // has a famously good early approximant (355/113)
const RATIONAL_PHI_LOOKALIKE = 1.618; // = 809/500 exactly — looks like φ to 3dp, is rational

// δ(ω) = liminf_{n→∞} n·‖nω‖ is NOT the min over an arbitrary range of n — it
// is governed by the CONTINUED-FRACTION CONVERGENTS p_k/q_k, the only points
// where n·‖nω‖ can set a genuine "record low." (An earlier version of this
// test took the min over a flat window of consecutive n and got nonsense —
// 4.9 instead of ≈0.447 — because generic n far from any convergent
// denominator gives large, uninformative values; convergents are sparse,
// spaced exponentially apart, so a flat window almost always misses them.)
// This is the textbook-correct way to compute it.
function convergents(omega: number, depth: number): Array<{ a: number; p: number; q: number; val: number }> {
  let x = omega;
  let p2 = 0, p1 = 1, q2 = 1, q1 = 0;
  const out: Array<{ a: number; p: number; q: number; val: number }> = [];
  for (let k = 0; k < depth; k++) {
    const a = Math.floor(x);
    const p = a * p1 + p2, q = a * q1 + q2;
    out.push({ a, p, q, val: q * Math.abs(q * omega - p) });
    const frac = x - a;
    if (frac < 1e-13) break; // exact rational (or double-precision floor) reached
    x = 1 / frac;
    p2 = p1; p1 = p; q2 = q1; q1 = q;
  }
  return out;
}

describe('Part A — Hurwitz recurrence constant: φ vs its named rivals (pure math, via convergents)', () => {
  const HURWITZ_BOUND = 1 / Math.sqrt(5); // ≈ 0.44721 — Hurwitz's theorem: no irrational exceeds this
  const MARKOV_SECOND = 1 / Math.sqrt(8); // ≈ 0.35355 — the next Lagrange/Markov number (√2-equivalent class)

  it("φ's convergent values converge to EXACTLY 1/√5 — the theorem's claim, computed not cited", () => {
    const cs = convergents(PHI, 20);
    const tail = cs.slice(-5).map((c) => c.val); // last 5 convergents, well past the transient
    for (const v of tail) expect(v).toBeCloseTo(HURWITZ_BOUND, 5);
  });

  it('silver ratio and √2 (an equivalence class under the modular group) converge to the SAME second-place constant 1/√8, strictly below φ', () => {
    // depth 12, not 18: float precision on the recurrence starts drifting
    // past ~depth 15 (q grows past 10^6); stay well inside the reliable zone.
    const silverTail = convergents(SILVER, 12).slice(-4).map((c) => c.val);
    const sqrt2Tail = convergents(SQRT2, 12).slice(-4).map((c) => c.val);
    for (const v of silverTail) expect(v).toBeCloseTo(MARKOV_SECOND, 4);
    for (const v of sqrt2Tail) expect(v).toBeCloseTo(MARKOV_SECOND, 4);
    expect(MARKOV_SECOND).toBeLessThan(HURWITZ_BOUND); // confirms the spectrum ordering, not assumed
  });

  it('e is NOT badly-approximable: the convergent right before each big partial quotient crashes progressively lower, unlike φ\'s', () => {
    // e's continued fraction [2;1,2,1,1,4,1,1,6,1,1,8,...] has UNBOUNDED
    // partial quotients by construction. The near-miss convergent p_k/q_k is
    // good precisely when the NEXT quotient a_{k+1} is large (|e−p_k/q_k| ≈
    // 1/(q_k² a_{k+1})) — so the crash sits at the convergent BEFORE each big
    // quotient, not at the big-quotient convergent itself.
    const cs = convergents(E, 18);
    const crashVals = cs.filter((c) => c.val < 0.25).map((c) => c.val);
    expect(crashVals.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < crashVals.length; i++) {
      expect(crashVals[i]).toBeLessThan(crashVals[i - 1]); // strictly deepening — trending to 0
    }
    expect(crashVals[crashVals.length - 1]).toBeLessThan(HURWITZ_BOUND / 3);
  });

  it('π shows a dramatic, famous dip at 355/113 — one of the best low-denominator approximations of any irrational', () => {
    const cs = convergents(PI, 4); // stop well before float precision runs out (~depth 14 for Math.PI)
    const hit = cs.find((c) => c.p === 355 && c.q === 113);
    expect(hit).toBeDefined();
    expect(hit!.val).toBeLessThan(0.01); // vs φ's steady-state ≈0.447 — a near-total collapse
  });

  it('reports the "small-n vulnerability" honestly: even φ has one, at n=1 — a different question than the asymptotic theorem', () => {
    // The k=1 convergent (2/1) is the nearest-integer approximation, distance
    // 1/φ² ≈ 0.382 — legitimately below 1/√5, simply not yet in the
    // converging tail. Recorded because PAMI's finite windows (≤4096 samples,
    // ≤~13 scales) only ever reach small n, where this transient matters.
    const cs = convergents(PHI, 3);
    expect(cs[1].val).toBeCloseTo(1 / (PHI * PHI), 6);
    expect(cs[1].val).toBeLessThan(HURWITZ_BOUND);
  });

  it('a rational lookalike (1.618, NOT φ) collapses to (near) zero at its intended denominator — total resonance', () => {
    // 1.618 is intended as 809/500, but IEEE-754 double precision can't
    // represent 1.618 exactly, so its continued fraction doesn't literally
    // terminate at q=500 — it mimics an irrational until float precision
    // itself runs out (an artifact of the representation, not the math).
    // The direct, representation-independent check: n·‖nω‖ AT n=500 collapses.
    const n = 500;
    const dist = Math.abs(n * RATIONAL_PHI_LOOKALIKE - Math.round(n * RATIONAL_PHI_LOOKALIKE));
    expect(n * dist).toBeLessThan(1e-8); // near-exact rational ⇒ near-total collapse
  });

  it('dyadic (2, rational) collapses immediately: it has no continued-fraction tail at all', () => {
    const cs = convergents(DYADIC, 5);
    expect(cs).toHaveLength(1); // [2] — terminates instantly, the degenerate case
    expect(cs[0].val).toBeLessThan(1e-9);
  });
});

// ── Part B: applied — does φ-spacing actually win the memory task? ────────

function seeded(seed: number) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff - 0.5; };
}

// φ-structured family — IDENTICAL to pami.test.ts's memorySignal(): frequencies
// spaced by powers of φ. Kept for continuity with the existing harness, but
// flagged: this family is not a neutral test bed for scaleBase ablation,
// because the signal generator itself is φ-shaped.
function memorySignalPhi(n: number, seed: number): number[] {
  const rand = seeded(seed);
  const f0 = 0.006 * (1 + ((seed * 0.618) % 1) * 4);
  const am = 0.002 + 0.012 * ((seed * 0.382) % 1);
  const phases = [rand() * 6, rand() * 6, rand() * 6];
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (let c = 0; c < 3; c++) v += Math.sin((2 * Math.PI * f0 * Math.pow(PHI, c) * i) + phases[c]) / (c + 1);
    out.push(v * (1 + 0.5 * Math.sin(2 * Math.PI * am * i)));
  }
  return out;
}

// Basis-neutral family — component frequencies spaced LINEARLY (arithmetic
// progression, not any geometric ratio), so no candidate scaleBase has a
// home-field advantage baked into the signal itself. This is the honest test
// of PAMI's actual claim: that φ-spaced ANALYSIS is the best lens on residual
// signals in general, not just on signals that happen to already be φ-shaped.
function memorySignalNeutral(n: number, seed: number): number[] {
  const rand = seeded(seed);
  const f0 = 0.004 * (1 + ((seed * 0.37) % 1) * 4);
  const step = 0.003 + 0.004 * ((seed * 0.71) % 1);
  const am = 0.002 + 0.01 * ((seed * 0.53) % 1);
  const phases = [rand() * 6, rand() * 6, rand() * 6, rand() * 6];
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (let c = 0; c < 4; c++) v += Math.sin((2 * Math.PI * (f0 + step * c) * i) + phases[c]) / (c + 1);
    out.push(v * (1 + 0.5 * Math.sin(2 * Math.PI * am * i)));
  }
  return out;
}

const N = 1024;

// Give each candidate base its OWN natural k-range so every basis gets a fair
// shot at as many resolvable octaves as its growth rate allows within the
// same window — clamping a fast-growing base (π, e, dyadic) to the spec's
// integer k-range would starve it of scales for no reason but numeral
// convenience, biasing the comparison toward φ before a single sample runs.
function configFor(scaleBase: number, baseScale = 4): PamiConfig {
  const kMin = Math.ceil(Math.log(0.8 / baseScale) / Math.log(scaleBase));
  const kMaxNatural = Math.floor(Math.log((N / 3) / baseScale) / Math.log(scaleBase));
  const kMax = Math.max(kMin + 3, Math.min(kMaxNatural, kMin + 24)); // guard against pathological ranges
  return { phaseCount: 8, qMax: 6, scaleKMin: kMin, scaleKMax: kMax, baseScale, scaleBase };
}

function benchmark(cfg: PamiConfig, gen: (n: number, seed: number) => number[]): number | null {
  const mems = [1, 2, 3, 4, 5, 6].map((s) => pamiIndex(gen(N, s), cfg));
  if (mems.some((m) => m === null)) return null; // this basis couldn't even resolve the signal
  let correct = 0;
  for (let s = 1; s <= 6; s++) {
    const q = pamiIndex(gen(N, s).slice(0, Math.floor(N * 0.6)), cfg);
    if (!q) continue;
    const dists = mems.map((m) => pamiDistance(q, m!));
    if (dists.indexOf(Math.min(...dists)) === s - 1) correct++;
  }
  return correct / 6;
}

describe('Part B — applied: scaleBase ablation on the retrieval task', () => {
  const CANDIDATES: Array<[string, number]> = [
    ['φ (spec)', PHI],
    ['silver ratio 1+√2', SILVER],
    ['√2', SQRT2],
    ['dyadic 2', DYADIC],
    ['e', E],
    ['π', PI],
  ];

  it('reports retrieval accuracy per basis on φ-STRUCTURED memories (expected φ home-field advantage)', () => {
    const results = CANDIDATES.map(([name, base]) => ({
      name, accuracy: benchmark(configFor(base), memorySignalPhi),
    }));
    const phiRow = results[0];
    expect(phiRow.accuracy).not.toBeNull();
    // On its own generator family, φ should be at or near the top — this is
    // the expected, non-surprising half of the test.
    const best = Math.max(...results.map((r) => r.accuracy ?? -1));
    expect(phiRow.accuracy).toBeGreaterThanOrEqual(best - 1e-9);
  });

  it('PINS the honest result on BASIS-NEUTRAL memories — this IS an F1 falsification finding, not hidden', () => {
    const results = CANDIDATES.map(([name, base]) => ({
      name, accuracy: benchmark(configFor(base), memorySignalNeutral),
    }));
    const byName = Object.fromEntries(results.map((r) => [r.name, r.accuracy]));

    // THE PINNED F1 OBSERVATION (60% cue, 6 structurally-distinct BASIS-
    // NEUTRAL memories — frequencies spaced linearly, with no relationship to
    // any candidate ratio — N=1024, each basis given its own natural k-range
    // so no basis is starved of resolvable scales):
    //
    //   e            0.833   ← best
    //   dyadic (2)   0.500
    //   φ (spec)     0.333   ← the spec's own ratio, mid-pack
    //   silver ratio 0.333
    //   √2           0.333
    //   π            0.167   ← worst
    //
    // On signals NOT generated to favor any particular basis, φ does NOT win
    // — e and even plain dyadic spacing outperform it here. This is a REAL
    // F1 falsification signal on this synthetic benchmark: the pure-math
    // Hurwitz-optimality proof in Part A is correct and unaffected (it's a
    // theorem), but it does not straightforwardly translate into a retrieval
    // advantage for PAMI's specific wavelet-leader pipeline on
    // non-φ-structured residuals. This joins the existing F3 pinned result in
    // pami.test.ts (conventional 8+5 beating spec 8+13 on its own benchmark)
    // as the second piece of evidence against PAMI's APPLIED claims, distinct
    // from its proven mathematical foundation. Small N (6 memories, one seed
    // family, synthetic signals) — suggestive, not dispositive; the spec's
    // own F1/F3 falsification conditions call for real corpus residuals to
    // settle it. If a future implementation change moves these numbers, this
    // assertion will fail and the pin must be re-measured and re-written —
    // never loosened just to pass.
    expect(byName).toEqual({
      'φ (spec)': 1 / 3,
      'silver ratio 1+√2': 1 / 3,
      '√2': 1 / 3,
      'dyadic 2': 1 / 2,
      e: 5 / 6,
      π: 1 / 6,
    });
  });
});

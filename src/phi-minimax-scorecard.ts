// ============================================================
// φ MINIMAX SCORECARD — src/phi-minimax-scorecard.ts
//
// Not a claim that φ (or any rival) is "the answer." A worst-case-risk
// instrument: for each candidate constant, compute its risk in three
// domains this codebase actually has live mechanisms for (static retrieval
// collision, dynamic resonance under periodic perturbation, recovery
// horizon), normalize each to [0,1] against a stated fatal threshold, and
// score the candidate by its WORST domain — not its best, not its average.
// The winner is whoever's floor is safest, which is a different question
// than "who wins any single benchmark."
//
// Every threshold below is either the codebase's own pre-existing constant
// (DELTA_DEFAULT for retrieval, regulate()'s default step budget for
// recovery) or explicitly stated as an external choice (the 0.85 resonance
// ceiling). None are invented ad hoc to make a preferred candidate win —
// see docs/PHI_MINIMAX_SCORECARD.md for the full provenance and, just as
// important, the one modeling choice (ε_min vs. retrieval accuracy) this
// result is NOT robust to.
// ============================================================

import {
  pamiIndex, pamiDistance, pamiCoherence, adaptiveDelta,
  PHI, DELTA_DEFAULT, ADAPTIVE_DELTA_DEFAULT, type PamiConfig,
} from './pami';

export interface Candidate { name: string; base: number }
export const CANDIDATES: Candidate[] = [
  { name: 'phi', base: PHI },
  { name: 'e', base: Math.E },
  { name: 'sqrt2', base: Math.SQRT2 },
  { name: 'pi', base: Math.PI },
];

const N = 1024;

// ── shared signal generator — IDENTICAL to pami-basis-ablation.test.ts's
// memorySignalNeutral: frequencies spaced linearly, no relationship to any
// candidate ratio, so no basis gets a home-field advantage in the signal
// itself. ───────────────────────────────────────────────────────────────
function seeded(seed: number) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff - 0.5; };
}
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
function configFor(scaleBase: number, baseScale = 4): PamiConfig {
  const kMin = Math.ceil(Math.log(0.8 / baseScale) / Math.log(scaleBase));
  const kMaxNatural = Math.floor(Math.log((N / 3) / baseScale) / Math.log(scaleBase));
  const kMax = Math.max(kMin + 3, Math.min(kMaxNatural, kMin + 24));
  return { phaseCount: 8, qMax: 6, scaleKMin: kMin, scaleKMax: kMax, baseScale, scaleBase };
}

// ── Domain 1: static retrieval collision risk ─────────────────────────────
// eps_min: the minimum pairwise pamiDistance among 6 basis-neutral memories.
// Fatal threshold: pami.ts's OWN DELTA_DEFAULT (0.3) — the distance below
// which the engine's own retrieval rule can no longer tell two memories
// apart. Not invented for this scorecard; it is the spec's §VI.4 threshold.
export function epsMin(base: number): number {
  const cfg = configFor(base);
  const idxs = [1, 2, 3, 4, 5, 6].map((s) => pamiIndex(memorySignalNeutral(N, s), cfg));
  if (idxs.some((x) => x === null)) return 0; // could not even resolve — treat as total collision
  let min = Infinity;
  for (let i = 0; i < idxs.length; i++) {
    for (let j = i + 1; j < idxs.length; j++) {
      const d = pamiDistance(idxs[i]!, idxs[j]!);
      if (d < min) min = d;
    }
  }
  return min;
}
export function retrievalRisk(base: number): number {
  const eps = epsMin(base);
  return Math.max(0, Math.min(1, 1 - eps / DELTA_DEFAULT));
}

// ── Domain 1b: the SAME collision, re-scored against a density-adaptive δ
// instead of the flat DELTA_DEFAULT (pami.ts's adaptiveDelta, added directly
// in response to this scorecard's own finding that a static δ can't be
// shrunk without crippling fuzzy recall everywhere else). For the two
// closest memories in the store, compute member A's local δ from the OTHER
// five (density around A, not self-referential to the pair being tested),
// and re-score risk against THAT instead of the global constant.
export function epsMinAdaptive(base: number): { epsMin: number; localDelta: number } {
  const cfg = configFor(base);
  const idxs = [1, 2, 3, 4, 5, 6].map((s) => pamiIndex(memorySignalNeutral(N, s), cfg));
  if (idxs.some((x) => x === null)) return { epsMin: 0, localDelta: DELTA_DEFAULT };
  let min = Infinity, ai = -1;
  for (let i = 0; i < idxs.length; i++) {
    for (let j = i + 1; j < idxs.length; j++) {
      const d = pamiDistance(idxs[i]!, idxs[j]!);
      if (d < min) { min = d; ai = i; }
    }
  }
  const others = idxs.filter((_, i) => i !== ai).map((x) => x!);
  const localDelta = adaptiveDelta(idxs[ai]!, others, ADAPTIVE_DELTA_DEFAULT);
  return { epsMin: min, localDelta };
}
export function retrievalRiskAdaptive(base: number): number {
  const { epsMin: eps, localDelta } = epsMinAdaptive(base);
  return Math.max(0, Math.min(1, 1 - eps / localDelta));
}

// ── Domain 2: dynamic resonance risk ──────────────────────────────────────
// Peak star discrepancy across a sweep of unknown perturbation periods, at
// the sample depth where transient behavior is worst (K=100 — see
// rcrb-001.test.ts's own finding that discrepancy decreases with K, so the
// smallest tested K is the honest worst case, not an arbitrary pick).
// Fatal threshold: 0.85 (stated, external — the "pseudo-rational trap"
// ceiling), per this scorecard's brief.
function frac(x: number): number { return x - Math.floor(x); }
function starDiscrepancy(samples: number[]): number {
  const s = [...samples].sort((a, b) => a - b);
  const n = s.length;
  let D = 0;
  for (let i = 0; i < n; i++) D = Math.max(D, (i + 1) / n - s[i], s[i] - i / n);
  return D;
}
const RESONANCE_PERIODS = Array.from({ length: 60 }, (_, i) => i + 2); // 2..61
const RESONANCE_K = 100; // the worst-case (smallest, most transient) depth tested in rcrb-001.test.ts
const RESONANCE_FATAL = 0.85;
export function peakDiscrepancy(winding: number): number {
  let worst = 0;
  for (const P of RESONANCE_PERIODS) {
    const samples: number[] = [];
    for (let k = 1; k <= RESONANCE_K; k++) samples.push(frac(k * P * winding));
    worst = Math.max(worst, starDiscrepancy(samples));
  }
  return worst;
}
export function resonanceRisk(base: number): number {
  return Math.max(0, Math.min(1, peakDiscrepancy(1 / base) / RESONANCE_FATAL));
  // NOTE: resonanceRisk takes the CANDIDATE VALUE (e.g. e, π, √2, φ) and
  // evaluates it as a WINDING NUMBER via its reciprocal, matching
  // rcrb-001.test.ts's convention (GOLDEN_WINDING = PHI_INV, not PHI).
}

// ── Domain 3: recovery horizon ────────────────────────────────────────────
// rcrb-001.test.ts Part 1 already established that RAW radial recovery time
// (phase-vessel.ts's vesselStep) is EXACTLY winding-invariant (296 steps,
// every candidate, to the step) — a structural fact, not a metric to
// re-measure here. That means the literal "cycles to recover from an
// escape-kick" reading cannot differentiate candidates in the current
// architecture. This scorecard uses the one part of the wired pipeline
// (PAMI → phase-vessel → regulator, from PR #281) that DOES vary by base:
// pamiCoherence()'s regulate() convergence steps, against regulator.ts's
// OWN default step budget (400) as the operational compute window.
const RECOVERY_FATAL_STEPS = 400; // regulator.ts's own `steps ?? 400` default
export function recoveryHorizon(base: number): number {
  const cfg = configFor(base);
  let maxSteps = 0;
  for (const s of [1, 2, 3, 4, 5, 6]) {
    const idx = pamiIndex(memorySignalNeutral(N, s), cfg);
    if (!idx) continue;
    const r = pamiCoherence(idx);
    maxSteps = Math.max(maxSteps, r.regulated.trace.length);
  }
  return maxSteps;
}
export function recoveryRisk(base: number): number {
  return Math.max(0, Math.min(1, recoveryHorizon(base) / RECOVERY_FATAL_STEPS));
}

// ── The scorecard ──────────────────────────────────────────────────────────
// S_ret/P_final use the STATIC DELTA_DEFAULT (unchanged from the original
// scorecard, so prior pinned numbers stay valid). S_ret_adaptive/P_final_adaptive
// are additive — the same Domain 1 collision, re-scored against a
// density-adaptive δ instead. Both are reported side by side, deliberately:
// which one is "correct" depends on which δ the engine actually uses at
// retrieval time, and that is now a real, tested choice (adaptiveDelta in
// pami.ts), not a hypothetical.
export interface ScorecardRow {
  name: string;
  eps_min: number; S_ret: number;
  local_delta: number; S_ret_adaptive: number;
  peak_discrepancy: number; S_res: number;
  recovery_steps: number; S_rcrb: number;
  P_final: number;
  P_final_adaptive: number;
}
export function scorecard(candidates: Candidate[] = CANDIDATES): ScorecardRow[] {
  return candidates.map(({ name, base }) => {
    const eps_min = epsMin(base), S_ret = retrievalRisk(base);
    const { localDelta } = epsMinAdaptive(base);
    const S_ret_adaptive = retrievalRiskAdaptive(base);
    const peak_discrepancy = peakDiscrepancy(1 / base), S_res = resonanceRisk(base);
    const recovery_steps = recoveryHorizon(base), S_rcrb = recoveryRisk(base);
    return {
      name, eps_min, S_ret, local_delta: localDelta, S_ret_adaptive,
      peak_discrepancy, S_res, recovery_steps, S_rcrb,
      P_final: Math.max(S_ret, S_res, S_rcrb),
      P_final_adaptive: Math.max(S_ret_adaptive, S_res, S_rcrb),
    };
  });
}
export function minimaxWinner(candidates: Candidate[] = CANDIDATES): ScorecardRow {
  return scorecard(candidates).reduce((best, row) => (row.P_final < best.P_final ? row : best));
}
export function minimaxWinnerAdaptive(candidates: Candidate[] = CANDIDATES): ScorecardRow {
  return scorecard(candidates).reduce((best, row) => (row.P_final_adaptive < best.P_final_adaptive ? row : best));
}

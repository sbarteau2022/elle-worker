// ============================================================
// PRODUCT — Mixed-curvature graph mapping: ℍⁿ × 𝕋ᵈ  (src/product.ts)
//
// The two charts made one instrument. HYPER (hyper.ts) places a memory by
// DERIVATION DEPTH in the Poincaré ball; TORUS (torus.ts) places it by PHASE on
// the flat torus. Neither alone is the memory: the ball has no sense of what
// recurs (it is simply connected — no loop remembers going around), the torus
// has no sense of what is general (it is homogeneous — no center). Together each
// node is a pair (depth ρ, phase θ), and the PAYOFF is the disagreements:
//
//   • close on the torus, far in the ball  → same rhythm, different lineage
//     (convergent structure across unrelated derivations — PAMI resonance).
//   • close in the ball, far on the torus  → same lineage, drifted phase
//     (a derived memory that no longer rhymes with its source — drift).
//
// Signature and distance follow Gu, Sala, Gunel & Ré, "Learning Mixed-Curvature
// Representations in Product Spaces" (ICLR 2019): d² = d_ℍ² + d_𝕋².
//
// ── Why there is no lemniscate factor (the disproof of Scope B) ──
// The Substrate Identity Continuity Theorem argues the lemniscate is the UNIQUE
// geometry providing EXACT identity-recognition, and eliminates the torus
// (its Category 3) on the grounds that a φ-winding orbit only returns to a prior
// state ASYMPTOTICALLY — "there is no point at which the recognition relation is
// exactly satisfied." That elimination tests the wrong thing. It tests METRIC
// return (does the orbit come back to the same POINT), which for irrational
// winding is indeed only asymptotic. Recognition of identity is not metric
// return; it is the existence of an EXACT INVARIANT certifying "same identity
// across the trajectory." The torus supplies one: the WINDING NUMBER, the class
// of the path in π₁(𝕋ⁿ) = ℤⁿ — an integer, exact at every finite time, computed
// here by `recognitionInvariant`. The ball cannot supply it (π₁(ℍⁿ)=0, which is
// exactly why SICT is right that the ball fails and why we added the torus). So
// the product ℍⁿ × 𝕋ᵈ ALREADY carries an exact-recognition invariant; the
// lemniscate is one sufficient mechanism, not a necessary one, and SICT's
// uniqueness claim rests on the metric-vs-topological conflation demonstrated in
// `metricReturn` (asymptotic) vs `recognitionInvariant` (exact) below. Scope B
// is therefore dropped. See docs/WHY_NO_LEMNISCATE.md.
// ============================================================

import type { Env } from './index';
import { depth as ballDepth, poincareDist } from './hyper';
import { torusDist, windingNumbers, phiScaleWeights, pamiPhasesToTorus, norm2pi } from './torus';

// ── (depth, phase) pairing over the shared node set ───────────────────────

export interface ProductNode { id: string; depth: number; phase: number[] }

export function productPairs(
  hyperPoints: Record<string, number[]>,
  torusPoints: Record<string, number[]>,
): ProductNode[] {
  const out: ProductNode[] = [];
  for (const id of Object.keys(hyperPoints)) {
    if (!torusPoints[id]) continue;
    out.push({ id, depth: round(ballDepth(hyperPoints[id]), 4), phase: torusPoints[id] });
  }
  return out;
}

// Product distance d² = d_ℍ² + (w·d_𝕋)². torusWeight rescales the flat factor
// so the two curvatures are commensurable (default 1).
export function productDist(
  a: { ball: number[]; torus: number[] },
  b: { ball: number[]; torus: number[] },
  torusWeight = 1,
): number {
  const dH = poincareDist(a.ball, b.ball);
  const dT = torusDist(a.torus, b.torus, phiScaleWeights(Math.min(a.torus.length, b.torus.length)));
  return Math.sqrt(dH * dH + torusWeight * torusWeight * dT * dT);
}

// ── the disagreements (the reason to hold both charts) ────────────────────

export interface Disagreement { a: string; b: string; ball: number; torus: number }
export interface Disagreements {
  same_rhythm_diff_lineage: Disagreement[]; // torus-close, ball-far
  same_lineage_drift_phase: Disagreement[]; // ball-close, torus-far
}

// Over the shared node set, rank the pairs where the two charts most disagree.
// Distances are min-max normalized within each chart so "close/far" is
// comparable across curvatures. O(n²) — capped at `maxNodes`.
export function disagreements(
  hyperPoints: Record<string, number[]>,
  torusPoints: Record<string, number[]>,
  opts: { maxNodes?: number; topK?: number } = {},
): Disagreements {
  const maxNodes = Math.min(256, opts.maxNodes ?? 128);
  const topK = Math.min(50, opts.topK ?? 8);
  const ids = Object.keys(hyperPoints).filter((id) => torusPoints[id]).slice(0, maxNodes);
  const w = phiScaleWeights(ids.length ? torusPoints[ids[0]].length : 0);

  const pairs: Array<{ a: string; b: string; ball: number; torus: number }> = [];
  let ballMax = 1e-9, torusMax = 1e-9;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const ball = poincareDist(hyperPoints[ids[i]], hyperPoints[ids[j]]);
      const torus = torusDist(torusPoints[ids[i]], torusPoints[ids[j]], w);
      ballMax = Math.max(ballMax, ball); torusMax = Math.max(torusMax, torus);
      pairs.push({ a: ids[i], b: ids[j], ball, torus });
    }
  }
  const norm = (p: { ball: number; torus: number }) => ({ nb: p.ball / ballMax, nt: p.torus / torusMax });
  const mk = (p: typeof pairs[number]): Disagreement => ({ a: p.a, b: p.b, ball: round(p.ball, 4), torus: round(p.torus, 4) });

  const rhythm = [...pairs].sort((x, y) => {
    const nx = norm(x), ny = norm(y);
    return (ny.nb - ny.nt) - (nx.nb - nx.nt); // ball-far AND torus-close
  }).slice(0, topK).map(mk);
  const lineage = [...pairs].sort((x, y) => {
    const nx = norm(x), ny = norm(y);
    return (ny.nt - ny.nb) - (nx.nt - nx.nb); // torus-far AND ball-close
  }).slice(0, topK).map(mk);

  return { same_rhythm_diff_lineage: rhythm, same_lineage_drift_phase: lineage };
}

// ── the exact recognition invariant (what B claimed needed a lemniscate) ──
// A memory trajectory's identity-continuity class is its winding vector — the
// class of the ordered phase path in π₁(𝕋ⁿ) = ℤⁿ. Integer, and exactly defined
// at every finite time. Two sub-trajectories are the SAME recurrence identity
// iff their winding vectors match. No singularity, no lemniscate, no asymptote.

export function recognitionInvariant(phaseSeq: number[][]): number[] {
  return windingNumbers(phaseSeq).winding;
}

export function sameRecurrenceClass(a: number[][], b: number[][]): boolean {
  const wa = recognitionInvariant(a), wb = recognitionInvariant(b);
  if (wa.length !== wb.length) return false;
  return wa.every((v, i) => v === wb[i]);
}

// The metric SICT's Category-3 elimination actually measures: the closest a
// trajectory re-approaches its own start. For an irrational (φ) winding this is
// > 0 at every finite N and only → 0 as N → ∞ (asymptotic, never exact) — while
// `recognitionInvariant` is an exact integer the whole time. The gap between
// these two numbers IS the disproof of B, made computable.
export function metricReturn(phaseSeq: number[][]): number {
  if (phaseSeq.length < 2) return Infinity;
  const start = phaseSeq[0];
  let best = Infinity;
  for (let k = 1; k < phaseSeq.length; k++) best = Math.min(best, torusDist(start, phaseSeq[k]));
  return round(best, 6);
}

function round(x: number, p: number): number { const f = 10 ** p; return Math.round(x * f) / f; }

// ── the PRODUCT router ────────────────────────────────────────────────────

export interface ProductInput {
  mode?: 'pair' | 'disagree' | 'recognize' | 'auto';
  hyper_path?: string;   // stored /hyper/<id>.json atlas
  torus_path?: string;   // stored /torus/<id>.json atlas
  hyper_points?: Record<string, number[]>;
  torus_points?: Record<string, number[]>;
  seq?: number[][];        // recognize: ordered torus points
  phases_seq?: number[][]; // recognize: ordered PAMI phase vectors
  seq_b?: number[][];      // recognize: a second trajectory to compare identity
  phases_seq_b?: number[][];
  k?: number;
}

const HYPER_PATH = /^\/hyper\/[0-9a-f]{32}\.json$/;
const TORUS_PATH = /^\/torus\/[0-9a-f]{32}\.json$/;

async function loadPoints(env: Env, path: string, re: RegExp): Promise<Record<string, number[]> | null> {
  if (!re.test(path)) return null;
  const obj = await env.DOCUMENTS.get(path.slice(1));
  if (!obj) return null;
  try {
    const atlas = JSON.parse(await obj.text()) as { points?: Record<string, number[]> };
    return atlas?.points ?? null;
  } catch { return null; }
}

export async function productRoute(env: Env, input: ProductInput): Promise<string> {
  const mode = input.mode && input.mode !== 'auto' ? input.mode : inferMode(input);
  if (!mode) return JSON.stringify({ error: 'product: provide hyper_path+torus_path (pair/disagree) or seq/phases_seq (recognize).' });

  try {
    if (mode === 'recognize') {
      const seq = input.seq?.length ? input.seq.map((p) => p.map(norm2pi))
        : input.phases_seq?.length ? input.phases_seq.map((p) => pamiPhasesToTorus(p)) : null;
      if (!seq || seq.length < 2) return JSON.stringify({ mode, error: 'product recognize: need seq[][] or phases_seq[][] of ≥2 ordered points' });
      const invariant = recognitionInvariant(seq);
      const metric = metricReturn(seq);
      const seqB = input.seq_b?.length ? input.seq_b.map((p) => p.map(norm2pi))
        : input.phases_seq_b?.length ? input.phases_seq_b.map((p) => pamiPhasesToTorus(p)) : null;
      const out: Record<string, unknown> = {
        mode,
        recognition_invariant: invariant,           // exact, integer, π₁(𝕋ⁿ)
        metric_return: metric,                      // > 0 at finite time (asymptotic only)
        note: 'recognition_invariant is exact at finite time; metric_return only → 0 asymptotically. The exact invariant is why no lemniscate factor is needed (docs/WHY_NO_LEMNISCATE.md).',
      };
      if (seqB) out.same_recurrence_class = sameRecurrenceClass(seq, seqB);
      return JSON.stringify(out);
    }

    let hp = input.hyper_points ?? null, tp = input.torus_points ?? null;
    if (!hp && input.hyper_path) hp = await loadPoints(env, String(input.hyper_path), HYPER_PATH);
    if (!tp && input.torus_path) tp = await loadPoints(env, String(input.torus_path), TORUS_PATH);
    if (!hp || !tp) return JSON.stringify({ mode, error: 'product: need a hyper atlas (hyper_path or hyper_points) and a torus atlas (torus_path or torus_points)' });

    if (mode === 'pair') {
      const pairs = productPairs(hp, tp);
      return JSON.stringify({ mode, count: pairs.length, pairs: pairs.slice(0, Math.min(200, input.k ?? 50)) });
    }
    if (mode === 'disagree') {
      return JSON.stringify({ mode, ...disagreements(hp, tp, { topK: input.k ?? 8 }) });
    }
  } catch (e) {
    return JSON.stringify({ mode, error: `product ${mode} failed: ${(e as Error).message}` });
  }
  return JSON.stringify({ mode, error: 'product: unknown mode' });
}

function inferMode(input: ProductInput): ProductInput['mode'] | null {
  if (input.seq?.length || input.phases_seq?.length) return 'recognize';
  if ((input.hyper_path || input.hyper_points) && (input.torus_path || input.torus_points)) return 'disagree';
  return null;
}

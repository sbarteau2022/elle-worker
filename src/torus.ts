// ============================================================
// TORUS — Toroidal Graph Mapping  (src/torus.ts)
//
// HYPER's twin. The hyperbolic chart (hyper.ts) answers "what DERIVES from
// what" — depth in the Poincaré ball is depth in the derivation. It cannot
// answer "what RECURS": the ball is simply connected, so a trajectory through
// it has no memory of having gone around anything, and anything cyclic (a
// phase, an orientation, a regime) has to be cut open to embed, putting 1° and
// 359° maximally far apart at the seam.
//
// The flat torus 𝕋ⁿ = ℝⁿ/2πℤⁿ is the opposite instrument, and it is the natural
// home of the rippers' circular quantities. Its coordinates are PAMI's phase
// fingerprint (pami.ts): 8 relative phases at φ-spaced wavelet scales — already
// circular, already φ-spaced, already deterministic (𝕋⁸, F6). No feature
// hashing: each axis is a NAMED phase at a known scale, so the coordinates are
// interpretable by construction.
//
// Three things the torus gives that the ball cannot:
//   • closure   — cyclic quantities live on it natively, no seam.
//   • winding   — a trajectory carries an integer winding number per circle, a
//                 topological invariant. Recurrence vs. drift becomes exact.
//   • no center — homogeneous, so it cannot be fooled into inventing a root for
//                 flat data the way the ball's optimizer will.
//
// SCOPE (design decision A, see docs/TOROIDAL_GRAPH_MAPPING.md): this factor
// carries PERIODIC STRUCTURE only — winding, phase kinship, discrepancy. It
// claims nothing about identity/recognition; per the Substrate Identity
// Continuity Theorem a plain torus gives only asymptotic identity-return, so
// the exact-recognition (lemniscate) layer is deliberately NOT built here.
//
// Everything below the router is PURE and deterministic — same graph, same
// atlas — and validated against docs/tit/ (the φ-orbit discrepancy numbers).
// Only the one optional reading touches a model.
// ============================================================

import type { Env } from './index';
import { callLLM } from './llm';
import { PHI, type PamiIndex } from './pami';

export const TORUS_DIM = 8;                 // F6 — the PAMI phase block, 𝕋⁸
const TWO_PI = 2 * Math.PI;
// The golden angle: a full turn scaled by the most-irrational fraction 2 − φ.
export const GOLDEN_ANGLE = TWO_PI * (2 - PHI);   // ≈ 2.39996 rad ≈ 137.507°

// ── angle primitives ──────────────────────────────────────────────────────

// Any real → [0, 2π).
export function norm2pi(a: number): number {
  const x = a % TWO_PI;
  return x < 0 ? x + TWO_PI : x;
}

// Signed angular difference in (−π, π].
export function wrap(delta: number): number {
  let d = delta % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  else if (d <= -Math.PI) d += TWO_PI;
  return d;
}

// ── distance on the torus (per-axis wrapped L2, optional weights) ──────────

export function torusDist(a: number[], b: number[], weights?: number[]): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const d = wrap(a[i] - b[i]);
    const w = weights ? weights[i] : 1;
    s += w * w * d * d;
  }
  return Math.sqrt(s);
}

// φ-scale weights: axis i (a finer wavelet scale) carries φ^(−i) of the squared
// weight — the per-scale form of the framework's φ^(−n) retention law.
export function phiScaleWeights(dim = TORUS_DIM): number[] {
  return Array.from({ length: dim }, (_, i) => Math.pow(PHI, -i / 2));
}

// ── the golden low-discrepancy sequence (bare-node placement) ─────────────
// Roberts' R_d sequence: the generalized golden ratio g solves g^(d+1) = g + 1
// (g = φ for d = 1), and axis j advances by g^(−(j+1)). Deterministic, and the
// most uniform additive-recurrence cover of 𝕋ᵈ — the discrepancy-optimal way to
// seat nodes that carry no phase of their own.

function generalizedGolden(d: number): number {
  let g = 2;
  for (let k = 0; k < 64; k++) g = Math.pow(1 + g, 1 / (d + 1));
  return g;
}

export function goldenSequence(n: number, dim = TORUS_DIM, seed = 0.5): number[][] {
  const g = generalizedGolden(dim);
  const alpha = Array.from({ length: dim }, (_, j) => Math.pow(g, -(j + 1)));
  const out: number[][] = [];
  for (let k = 1; k <= n; k++) {
    out.push(alpha.map((a) => norm2pi(TWO_PI * ((seed + k * a) % 1))));
  }
  return out;
}

// ── winding number (recurrence vs. drift — the invariant the ball lacks) ──
// Unwrap a sequence of torus points and count net turns per axis. A sequence
// that cycles once through a phase regime and returns has winding 1; one that
// jittered in place has winding 0. This readout does not exist on the ball.

export function windingNumbers(seq: number[][]): { winding: number[]; turns: number[] } {
  if (seq.length < 2) {
    const dim = seq[0]?.length ?? 0;
    return { winding: new Array(dim).fill(0), turns: new Array(dim).fill(0) };
  }
  const dim = seq[0].length;
  const acc = new Array(dim).fill(0);
  for (let k = 1; k < seq.length; k++) {
    for (let j = 0; j < dim; j++) acc[j] += wrap(seq[k][j] - seq[k - 1][j]);
  }
  return {
    winding: acc.map((a) => Math.round(a / TWO_PI)),
    turns: acc.map((a) => round(a / TWO_PI, 4)),
  };
}

// ── translation alignment ("the same note at different scales") ───────────
// Two memories whose phase signatures differ by a single global shift are the
// same structural note at a different scale/origin. Find the best shift τ (the
// circular mean of the per-axis differences) and score the fit in [−1, 1];
// score ≈ 1 means scale-transposed kin, score ≈ 0 means unrelated.

export function translationAlign(a: number[], b: number[]): { shift: number; score: number } {
  const n = Math.min(a.length, b.length);
  if (!n) return { shift: 0, score: 0 };
  let sinS = 0, cosS = 0;
  for (let i = 0; i < n; i++) { const d = wrap(a[i] - b[i]); sinS += Math.sin(d); cosS += Math.cos(d); }
  const shift = Math.atan2(sinS, cosS);
  let score = 0;
  for (let i = 0; i < n; i++) score += Math.cos(wrap(a[i] - b[i] - shift));
  return { shift: round(shift, 5), score: round(score / n, 5) };
}

// ── star discrepancy per axis (coverage / uniformity — the torus metric) ──
// One-sided star discrepancy of one axis's values on the circle. The multi-axis
// atlas reports the per-axis mean and max; lower = more uniform. (True d-dim
// star discrepancy is intractable; per-axis 1-D is the honest, computable
// proxy for a product-of-circles design — see docs/tit/.)

export function axisDiscrepancy(anglesOneAxis: number[]): number {
  const N = anglesOneAxis.length;
  if (N < 1) return 1;
  const pts = anglesOneAxis.map((a) => norm2pi(a) / TWO_PI).sort((x, y) => x - y);
  let D = 0;
  for (let i = 0; i < N; i++) D = Math.max(D, Math.abs((i + 1) / N - pts[i]), Math.abs(i / N - pts[i]));
  return D;
}

export function atlasDiscrepancy(points: number[][], dim: number): { mean: number; max: number; per_axis: number[] } {
  if (!points.length) return { mean: 0, max: 0, per_axis: [] };
  const perAxis: number[] = [];
  for (let j = 0; j < dim; j++) perAxis.push(axisDiscrepancy(points.map((p) => p[j] ?? 0)));
  return {
    mean: round(perAxis.reduce((a, b) => a + b, 0) / dim, 5),
    max: round(Math.max(...perAxis), 5),
    per_axis: perAxis.map((d) => round(d, 5)),
  };
}

// ── nobility: is a winding ratio φ-like (noble) or rational (resonant)? ────
// δ_inf(ω) = inf_{n=1..N} n·‖nω‖. Maximal (φ^(−2) ≈ 0.382) for φ and its noble
// equivalents; near 0 for rationals and near-rationals. This is the φ-vs-
// rational instrument the Substrate Identity Continuity Theorem (F3) calls for:
// it tells genuine φ-structured coherence from performative rational-frequency
// entrainment. Verified against docs/tit/ (P1).

export function nobility(omega: number, nMax = 300): number {
  let w = omega % 1; if (w < 0) w += 1;
  let best = Infinity;
  for (let n = 1; n <= nMax; n++) {
    const nw = n * w;
    const val = n * Math.abs(nw - Math.round(nw));
    if (val < best) best = val;
    if (best < 1e-12) break;
  }
  return round(best, 5);
}

// ── the encoder: PAMI phases → a torus point (no hashing) ─────────────────
// PAMI phases are atan2 outputs in (−π, π]; 0 is the energy gate's "no content"
// sentinel. We seat them directly on 𝕋⁸ (norm to [0, 2π)). The sentinel caveat
// is recorded honestly: an empty slot reads as phase 0, indistinguishable from
// a measured 0 (probability ~0), which the φ-scale weights already down-weight
// at finer scales.

export function pamiPhasesToTorus(index: PamiIndex | number[], dim = TORUS_DIM): number[] {
  const phases = Array.isArray(index) ? index : index.phases;
  const out: number[] = [];
  for (let i = 0; i < dim; i++) out.push(norm2pi(Number.isFinite(phases[i]) ? phases[i] : 0));
  return out;
}

function round(x: number, p: number): number { const f = 10 ** p; return Math.round(x * f) / f; }

// ── the mapping: place nodes, report the shape ────────────────────────────
// Option A is PLACEMENT, not a re-fit: a node with a phase signature is seated
// where PAMI puts it; a bare node gets a golden-sequence seat. The torus is
// where the rippers already point — we read the shape (coverage, kinship), we
// don't drag points around with an optimizer the way the hierarchy chart does.

const MAX_NODES = 1024;

export interface TorusNode { id: string; phases?: number[]; pami?: { phases: number[] } }

export interface TorusAtlas {
  dim: number;
  points: Record<string, number[]>;
  stats: { nodes: number; placed: number; bare: number; discrepancy: { mean: number; max: number; per_axis: number[] } };
}

export function torusMap(nodesIn: TorusNode[], opts: { dim?: number } = {}): TorusAtlas {
  const dim = Math.max(1, Math.min(TORUS_DIM, Math.round(opts.dim ?? TORUS_DIM)));
  const points: Record<string, number[]> = {};
  const bare: string[] = [];
  let placed = 0;
  for (const n of nodesIn) {
    if (!n || !n.id || points[n.id] || Object.keys(points).length + bare.length >= MAX_NODES) continue;
    const phases = n.phases ?? n.pami?.phases;
    if (phases && phases.some((v) => Number.isFinite(v) && v !== 0)) {
      points[n.id] = pamiPhasesToTorus(phases, dim);
      placed++;
    } else {
      bare.push(n.id);
    }
  }
  if (bare.length) {
    const seq = goldenSequence(bare.length, dim);
    bare.forEach((id, i) => { points[id] = seq[i]; });
  }
  const pts = Object.values(points);
  return {
    dim, points,
    stats: {
      nodes: pts.length, placed, bare: bare.length,
      discrepancy: atlasDiscrepancy(pts, dim),
    },
  };
}

export function torusNeighbors(atlas: TorusAtlas, query: string | number[], k = 5, weighted = true):
  Array<{ id: string; dist: number; align: number }> {
  const q = typeof query === 'string' ? atlas.points[query] : query;
  if (!q) return [];
  const w = weighted ? phiScaleWeights(atlas.dim) : undefined;
  const skip = typeof query === 'string' ? query : null;
  return Object.entries(atlas.points)
    .filter(([id]) => id !== skip)
    .map(([id, p]) => ({ id, dist: round(torusDist(q, p, w), 5), align: translationAlign(q, p).score }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, Math.max(1, Math.min(50, k)));
}

// ── the TORUS router ──────────────────────────────────────────────────────

export interface TorusInput {
  mode?: 'map' | 'neighbors' | 'dist' | 'align' | 'winding' | 'nobility' | 'auto';
  nodes?: Array<{ id: string; phases?: number[]; pami?: { phases: number[] } }>;
  map_path?: string;
  id?: string;
  a?: number[] | string; b?: number[] | string;
  seq?: number[][];              // winding: an ordered list of torus points
  phases_seq?: number[][];       // winding: an ordered list of PAMI phase vectors
  omega?: number;                // nobility: a winding ratio to score
  k?: number; dim?: number; store?: boolean; interpret?: boolean; context?: string;
}

const SYNTH_SYSTEM =
`You are TORUS's synthesis head. You are handed the statistics of a flat-torus (𝕋⁸, PAMI-phase) embedding of a memory graph: how many nodes were seated by their own phase signature vs. placed on the golden low-discrepancy lattice, and the per-axis star discrepancy (lower = more uniform coverage of the phase circles). In 2-4 sentences say what the SHAPE means: is the phase space well covered or clumped on a few axes, which axes carry the structure, and what periodic/rhythmic kinship to look at next. Ground every claim in the numbers; you have phase geometry, not content.`;

const ATLAS_PATH = /^\/torus\/[0-9a-f]{32}\.json$/;

async function loadAtlas(env: Env, path: string): Promise<TorusAtlas | null> {
  if (!ATLAS_PATH.test(path)) return null;
  const obj = await env.DOCUMENTS.get(path.slice(1));
  if (!obj) return null;
  try {
    const atlas = JSON.parse(await obj.text()) as TorusAtlas;
    return atlas && atlas.points && Number.isFinite(atlas.dim) ? atlas : null;
  } catch { return null; }
}

const asPoint = (v: unknown): number[] | null =>
  Array.isArray(v) && v.length && v.every((x) => Number.isFinite(x)) ? (v as number[]).map(norm2pi) : null;

export async function torusRoute(env: Env, input: TorusInput): Promise<string> {
  const mode = input.mode && input.mode !== 'auto' ? input.mode : inferMode(input);
  if (!mode) {
    return JSON.stringify({ error: 'torus: nothing to do. Provide nodes[] (map), map_path+id (neighbors), a+b (dist/align), seq/phases_seq (winding), or omega (nobility).' });
  }

  try {
    if (mode === 'map') {
      const nodes = (input.nodes ?? []).map((n) => ({ id: String(n.id || ''), phases: n.phases, pami: n.pami })).filter((n) => n.id);
      if (!nodes.length) return JSON.stringify({ mode, error: 'torus map: need nodes[] (each id, optional phases[]/pami)' });
      const atlas = torusMap(nodes, { dim: input.dim });
      const report: Record<string, unknown> = { mode, stats: atlas.stats };
      if (input.store !== false) {
        const id = crypto.randomUUID().replace(/-/g, '');
        const key = `torus/${id}.json`;
        await env.DOCUMENTS.put(key, JSON.stringify(atlas), { httpMetadata: { contentType: 'application/json' } });
        report.stored = `/${key}`;
      } else {
        report.points = atlas.points;
      }
      if (input.interpret !== false) {
        try {
          const ctx = input.context ? `\nCaller context: ${String(input.context).slice(0, 400)}` : '';
          const r = await callLLM('reasoning', SYNTH_SYSTEM, [{ role: 'user', content: `Atlas stats:\n${JSON.stringify(atlas.stats)}${ctx}` }], 300, env);
          report.reading = String(r.content).trim();
        } catch { /* the geometry stands on its own */ }
      }
      return JSON.stringify(report);
    }

    if (mode === 'neighbors') {
      const atlas = await loadAtlas(env, String(input.map_path || ''));
      if (!atlas) return JSON.stringify({ mode, error: 'torus neighbors: map_path must be a stored /torus/<id>.json atlas' });
      const id = String(input.id || '');
      if (!atlas.points[id]) return JSON.stringify({ mode, error: `torus neighbors: no atlas point "${id}"` });
      return JSON.stringify({ mode, id, neighbors: torusNeighbors(atlas, id, input.k ?? 5) });
    }

    if (mode === 'dist' || mode === 'align') {
      let pa = asPoint(input.a), pb = asPoint(input.b);
      if ((!pa || !pb) && input.map_path) {
        const atlas = await loadAtlas(env, String(input.map_path));
        if (!atlas) return JSON.stringify({ mode, error: 'torus: map_path must be a stored /torus/<id>.json atlas' });
        if (!pa && typeof input.a === 'string') pa = atlas.points[input.a] ?? null;
        if (!pb && typeof input.b === 'string') pb = atlas.points[input.b] ?? null;
      }
      if (!pa || !pb) return JSON.stringify({ mode, error: 'torus: need two points a,b (arrays, or atlas ids with map_path)' });
      const align = translationAlign(pa, pb);
      if (mode === 'align') return JSON.stringify({ mode, ...align, note: 'shift = best global phase offset; score≈1 means the same structure at a different scale/origin' });
      return JSON.stringify({ mode, dist: round(torusDist(pa, pb), 5), dist_phi_weighted: round(torusDist(pa, pb, phiScaleWeights(Math.min(pa.length, pb.length))), 5), align: align.score });
    }

    if (mode === 'winding') {
      const seq = input.seq?.length ? input.seq.map((p) => p.map(norm2pi))
        : input.phases_seq?.length ? input.phases_seq.map((p) => pamiPhasesToTorus(p))
        : null;
      if (!seq || seq.length < 2) return JSON.stringify({ mode, error: 'torus winding: need seq[][] or phases_seq[][] of ≥2 ordered points' });
      return JSON.stringify({ mode, ...windingNumbers(seq), note: 'integer winding per axis: net turns through each phase circle — recurrence (≠0) vs drift (0)' });
    }

    if (mode === 'nobility') {
      const omega = Number(input.omega);
      if (!Number.isFinite(omega)) return JSON.stringify({ mode, error: 'torus nobility: need a numeric omega (a winding ratio)' });
      const nob = nobility(omega);
      return JSON.stringify({ mode, omega, nobility: nob, phi_max: round(Math.pow(PHI, -2), 5), reading: nob > 0.34 ? 'φ-like (noble): genuinely quasi-periodic, resists resonance' : nob < 0.1 ? 'rational-resonant: locks to a periodic band (performative coherence)' : 'intermediate' });
    }
  } catch (e) {
    return JSON.stringify({ mode, error: `torus ${mode} failed: ${(e as Error).message}` });
  }

  return JSON.stringify({ mode, error: 'torus: unknown mode' });
}

function inferMode(input: TorusInput): TorusInput['mode'] | null {
  if (input.nodes?.length) return 'map';
  if (input.map_path && input.id) return 'neighbors';
  if (input.seq?.length || input.phases_seq?.length) return 'winding';
  if (input.omega !== undefined) return 'nobility';
  if (input.a !== undefined && input.b !== undefined) return 'dist';
  return null;
}

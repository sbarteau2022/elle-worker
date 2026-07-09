// ============================================================
// HYPER — Hyperbolic Neural Graph Mapping  (src/hyper.ts)
//
// The stage AFTER the rippers. PFAR and vFAR rip the structure out of their
// inputs — a stream becomes a spectral fingerprint, an image becomes field
// stats + rhythm + texture + palette — and the graph kernel (graph.ts) holds
// typed, weighted edges between memories. What none of them provide is a
// GEOMETRY: a single space where "how far apart are these two structures"
// and "which one is more general" are the same kind of question.
//
// This module maps ripped fingerprints and graph nodes into the Poincaré
// ball. Hyperbolic space is the natural home for hierarchy: volume grows
// exponentially with radius, so a tree embeds with low distortion — general
// things sit near the origin, specific things near the boundary, and
// tree-distance becomes geodesic distance. (Nickel & Kiela 2017 is the
// doctrine being ported; see docs/HYPERBOLIC_GRAPH_MAPPING.md for the
// formalization.)
//
// Three layers, same discipline as PFAR/vFAR:
//   • geometry  : Möbius addition, geodesic distance, exp/log maps at the
//                 origin, the analytic distance gradient. Pure, unit-tested.
//   • encoder   : ripVector — ANY ripper report (pfar/vfar/pami JSON) →
//                 a fixed-length feature vector by deterministic feature
//                 hashing; ψ = exp₀ of its scaled image places it in the
//                 ball. Same structure in, same point out, always.
//   • mapping   : hyperMap — Riemannian SGD over the ball. Edges attract to
//                 a conductance-weighted target distance, sampled non-edges
//                 repel, and directed provenance kinds (causal/derived/
//                 refines/supersedes) push the consequent RADIALLY outward
//                 from its antecedent, so depth-in-the-ball reads as
//                 depth-in-the-derivation. Deterministic (seeded PRNG),
//                 bounded, no model anywhere.
//
// hyperRoute is the tool router, same shape as pfarRoute: run the numeric
// core, store the atlas in R2 (hyper/…), optionally lay one LLM reading over
// the numbers. The geometry never touches a model.
// ============================================================

import type { Env } from './index';
import { callLLM } from './llm';
import { CONDUCTANCE, type EdgeKind, type MemEdge } from './graph';

// ── the geometry (pure): the Poincaré ball, curvature −1 ─────────────────
// B = { x ∈ ℝⁿ : ‖x‖ < 1 }. All points live strictly inside; project() is
// the only door back in when an update lands on or past the boundary.

const BOUNDARY_EPS = 1e-5;   // points live at norm ≤ 1 − BOUNDARY_EPS
const EPS = 1e-12;

export function dot(u: number[], v: number[]): number {
  let s = 0;
  for (let i = 0; i < u.length; i++) s += u[i] * v[i];
  return s;
}
export function norm(u: number[]): number { return Math.sqrt(dot(u, u)); }

// Pull a point that drifted onto/over the boundary back inside the ball.
export function project(x: number[]): number[] {
  const n = norm(x);
  const max = 1 - BOUNDARY_EPS;
  if (n <= max) return x;
  const s = max / n;
  return x.map((v) => v * s);
}

// Möbius addition — the ball's group operation:
//   u ⊕ v = ((1 + 2⟨u,v⟩ + ‖v‖²)·u + (1 − ‖u‖²)·v) / (1 + 2⟨u,v⟩ + ‖u‖²‖v‖²)
export function mobiusAdd(u: number[], v: number[]): number[] {
  const uv = dot(u, v), uu = dot(u, u), vv = dot(v, v);
  const den = 1 + 2 * uv + uu * vv;
  const a = (1 + 2 * uv + vv) / (den || EPS);
  const b = (1 - uu) / (den || EPS);
  return project(u.map((ui, i) => a * ui + b * v[i]));
}

// Geodesic distance: d(u,v) = arcosh(1 + 2‖u−v‖² / ((1−‖u‖²)(1−‖v‖²))).
// From the origin this reduces to d(0,x) = 2·atanh(‖x‖) — the radial DEPTH.
export function poincareDist(u: number[], v: number[]): number {
  const alpha = Math.max(EPS, 1 - dot(u, u));
  const beta = Math.max(EPS, 1 - dot(v, v));
  let duv = 0;
  for (let i = 0; i < u.length; i++) duv += (u[i] - v[i]) ** 2;
  const gamma = 1 + (2 * duv) / (alpha * beta);
  return Math.acosh(Math.max(1, gamma));
}

export function depth(x: number[]): number { return 2 * Math.atanh(Math.min(1 - BOUNDARY_EPS, norm(x))); }

// exp/log maps at the origin — the door between the flat tangent space
// (where the encoder works) and the ball (where distance means something):
//   exp₀(t) = tanh(‖t‖) · t/‖t‖        log₀(y) = atanh(‖y‖) · y/‖y‖
export function expMap0(t: number[]): number[] {
  const n = norm(t);
  if (n < EPS) return t.map(() => 0);
  const s = Math.tanh(n) / n;
  return project(t.map((v) => v * s));
}
export function logMap0(y: number[]): number[] {
  const n = norm(y);
  if (n < EPS) return y.map(() => 0);
  const s = Math.atanh(Math.min(1 - BOUNDARY_EPS, n)) / n;
  return y.map((v) => v * s);
}

// Euclidean gradient of d(u,v) with respect to u (Nickel & Kiela, eq. 4):
//   ∂d/∂u = 4 / (β·√(γ²−1)) · ( (‖v‖² − 2⟨u,v⟩ + 1)/α² · u − v/α )
// with α = 1−‖u‖², β = 1−‖v‖². Symmetric in the obvious way for ∂d/∂v.
export function distGrad(u: number[], v: number[]): number[] {
  const alpha = Math.max(EPS, 1 - dot(u, u));
  const beta = Math.max(EPS, 1 - dot(v, v));
  let duv = 0;
  for (let i = 0; i < u.length; i++) duv += (u[i] - v[i]) ** 2;
  const gamma = 1 + (2 * duv) / (alpha * beta);
  const denom = beta * Math.sqrt(Math.max(EPS, gamma * gamma - 1));
  const a = (dot(v, v) - 2 * dot(u, v) + 1) / (alpha * alpha);
  return u.map((ui, i) => (4 / denom) * (a * ui - v[i] / alpha));
}

// ── deterministic PRNG (mulberry32) + string hash (fnv1a) ─────────────────
// No Math.random anywhere: the same graph must always map to the same atlas,
// or the map is an oracle instead of an instrument.

export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A deterministic unit vector in ℝᵈ from a string (Box–Muller over mulberry32).
function hashDirection(key: string, dim: number): number[] {
  const rand = mulberry32(fnv1a(key));
  const v: number[] = new Array(dim);
  for (let i = 0; i < dim; i++) {
    const u1 = Math.max(EPS, rand()), u2 = rand();
    v[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
  const n = norm(v) || 1;
  return v.map((x) => x / n);
}

// ── the encoder (pure): any ripper report → a point's tangent vector ─────
// Feature hashing over the NUMERIC LEAVES of whatever JSON a ripper returned:
// each (path, value) leaf contributes symlog-squashed value along the fixed
// pseudo-random direction its path hashes to. Scale-robust, order-stable,
// and totally agnostic about which instrument did the ripping — a PFAR
// spectrum, a vFAR field report, and a PAMI index all become commensurable
// vectors in the same tangent space.

export const RIP_DIM = 16;      // encoder output dimensionality
const MAX_LEAVES = 512;         // a rip report is small; a bad caller is not
const TANGENT_SCALE = 0.9;      // ψ(f) = exp₀(0.9·f̂): pure-feature points sit at depth ≤ 2·atanh(tanh 0.9)

export function numericLeaves(x: unknown, prefix = '', out: Array<[string, number]> = []): Array<[string, number]> {
  if (out.length >= MAX_LEAVES) return out;
  if (typeof x === 'number') {
    if (Number.isFinite(x)) out.push([prefix, x]);
    return out;
  }
  if (Array.isArray(x)) {
    for (let i = 0; i < x.length && out.length < MAX_LEAVES; i++) numericLeaves(x[i], `${prefix}[${i}]`, out);
    return out;
  }
  if (x && typeof x === 'object') {
    for (const k of Object.keys(x as Record<string, unknown>).sort()) {
      if (out.length >= MAX_LEAVES) break;
      numericLeaves((x as Record<string, unknown>)[k], prefix ? `${prefix}.${k}` : k, out);
    }
  }
  return out;
}

const symlog = (v: number) => Math.sign(v) * Math.log1p(Math.abs(v));

export function ripVector(rip: unknown, dim = RIP_DIM): number[] {
  const f = new Array(dim).fill(0);
  const leaves = numericLeaves(rip);
  for (const [path, value] of leaves) {
    const dir = hashDirection(path, dim);
    const s = Math.tanh(symlog(value));
    for (let i = 0; i < dim; i++) f[i] += s * dir[i];
  }
  const n = norm(f);
  if (n > 1) for (let i = 0; i < dim; i++) f[i] /= n;
  return f;
}

// ψ: features → the ball. The "neural" layer in its honest form — a fixed
// deterministic encoder, not a trained one (training is the loss below).
export function placeFeatures(features: number[], dim: number): number[] {
  const f = features.slice(0, dim);
  while (f.length < dim) f.push(0);
  const n = norm(f);
  const t = n > 1 ? f.map((v) => (v / n) * TANGENT_SCALE) : f.map((v) => v * TANGENT_SCALE);
  return expMap0(t);
}

// ── the mapping (pure): Riemannian SGD over the ball ──────────────────────
//
// Loss over the atlas X = {xᵢ}:
//   L = Σ_edges  ŵ·(d(xᵤ,xᵥ) − δ(ŵ))²                    (attraction to target)
//     + Σ_negs   max(0, μ − d(xᵤ,xᵥ))²                    (margin repulsion)
//     + λ_h Σ_hier max(0, m + r(src) − r(dst))²           (provenance depth)
// with ŵ = min(1, weight·conductance(kind)/2), target δ interpolating
// [δ_near, δ_far] by ŵ, r(x) = ‖x‖ (Euclidean radius as the depth proxy in
// the hinge — monotone in true depth, cheap to differentiate).
//
// Update: x ← proj( x − lr · ((1−‖x‖²)²/4) · ∇ₑL )  — the inverse metric
// scaling + retraction of Nickel & Kiela.

const HIERARCHY: ReadonlySet<EdgeKind> = new Set<EdgeKind>(['causal', 'derived', 'refines', 'supersedes']);
const MAX_NODES = 256;
const MAX_EDGES = 2048;
const MAX_EPOCHS = 1000;
const DELTA_NEAR = 0.3, DELTA_FAR = 1.6;  // edge target-distance range
const NEG_MARGIN = 2.4;                    // non-edges pushed at least this far
const HIER_MARGIN = 0.08;                  // consequent at least this much farther out (Euclidean radius)
const HIER_WEIGHT = 1.0;
const INIT_RADIUS = 0.1;                   // id-hash init: near the origin, let the loss sort depth

export interface HyperNode { id: string; features?: number[] }

export interface HyperMapOpts {
  dim?: number;        // 2..16, default 2
  epochs?: number;     // default 300
  lr?: number;         // default 0.05
  seed?: number;       // default 42
  negatives?: number;  // negative samples per edge per epoch, default 2
}

export interface HyperAtlas {
  dim: number;
  points: Record<string, number[]>;
  stats: {
    nodes: number; edges: number; epochs: number; loss: number;
    mean_edge_dist: number;
    depth: { min: number; max: number; mean: number };
  };
}

export function hyperMap(nodesIn: HyperNode[], edgesIn: MemEdge[], opts: HyperMapOpts = {}): HyperAtlas {
  const dim = Math.max(2, Math.min(16, Math.round(opts.dim ?? 2)));
  const epochs = Math.max(1, Math.min(MAX_EPOCHS, Math.round(opts.epochs ?? 300)));
  const lr = Math.max(1e-4, Math.min(0.5, opts.lr ?? 0.05));
  const seed = (opts.seed ?? 42) >>> 0;
  const negPerEdge = Math.max(0, Math.min(8, Math.round(opts.negatives ?? 2)));

  // Nodes: explicit list first, then any edge endpoint not already named.
  const byId = new Map<string, HyperNode>();
  for (const n of nodesIn) {
    if (n && n.id && !byId.has(n.id) && byId.size < MAX_NODES) byId.set(n.id, n);
  }
  const edges = edgesIn
    .filter((e) => e && e.src && e.dst && e.src !== e.dst)
    .slice(0, MAX_EDGES);
  for (const e of edges) {
    for (const id of [e.src, e.dst]) {
      if (!byId.has(id) && byId.size < MAX_NODES) byId.set(id, { id });
    }
  }
  const ids = [...byId.keys()];
  const usable = edges.filter((e) => byId.has(e.src) && byId.has(e.dst));

  // Init: features place a node (the encoder's ψ), an id-hash point otherwise;
  // either way a tiny id-hash jitter breaks exact ties deterministically.
  const X = new Map<string, number[]>();
  for (const id of ids) {
    const node = byId.get(id)!;
    const jitter = hashDirection(`jitter:${id}`, dim).map((v) => v * 0.01);
    if (node.features && node.features.some((v) => Number.isFinite(v) && v !== 0)) {
      const p = placeFeatures(node.features.filter(Number.isFinite), dim);
      X.set(id, project(p.map((v, i) => v + jitter[i])));
    } else {
      const d0 = hashDirection(`init:${id}`, dim);
      X.set(id, project(d0.map((v, i) => v * INIT_RADIUS + jitter[i])));
    }
  }

  const rand = mulberry32(seed);
  const adj = new Set<string>();
  for (const e of usable) { adj.add(`${e.src} ${e.dst}`); adj.add(`${e.dst} ${e.src}`); }

  // One Riemannian step on point `id` from a Euclidean gradient contribution.
  const step = (id: string, gradE: number[], eta: number) => {
    const x = X.get(id)!;
    const scale = ((1 - dot(x, x)) ** 2) / 4;
    X.set(id, project(x.map((v, i) => v - eta * scale * gradE[i])));
  };

  let loss = 0;
  for (let epoch = 0; epoch < epochs; epoch++) {
    loss = 0;
    const eta = lr * (1 - (0.9 * epoch) / epochs); // gentle anneal, never to zero
    for (const e of usable) {
      const u = X.get(e.src)!, v = X.get(e.dst)!;
      const w = Math.min(1, (Math.max(0, e.weight) * (CONDUCTANCE[e.kind] ?? 0.5)) / 2);
      const target = DELTA_FAR - (DELTA_FAR - DELTA_NEAR) * w;
      const d = poincareDist(u, v);
      const diff = d - target;
      loss += Math.max(w, 0.1) * diff * diff;
      const coef = 2 * Math.max(w, 0.1) * diff;
      const gu = distGrad(u, v), gv = distGrad(v, u);
      step(e.src, gu.map((g) => coef * g), eta);
      step(e.dst, gv.map((g) => coef * g), eta);

      // Provenance depth: the consequent (dst) sits farther out than its
      // antecedent (src). Hinge on Euclidean radius.
      if (HIERARCHY.has(e.kind)) {
        const xu = X.get(e.src)!, xv = X.get(e.dst)!;
        const ru = norm(xu), rv = norm(xv);
        const viol = HIER_MARGIN + ru - rv;
        if (viol > 0) {
          loss += HIER_WEIGHT * viol * viol;
          const c = 2 * HIER_WEIGHT * viol;
          if (ru > EPS) step(e.src, xu.map((x) => (c * x) / ru), eta);
          if (rv > EPS) step(e.dst, xv.map((x) => (-c * x) / rv), eta);
        }
      }

      // Negative sampling: push sampled NON-neighbors of src out past the margin.
      for (let k = 0; k < negPerEdge && ids.length > 2; k++) {
        const other = ids[Math.floor(rand() * ids.length)];
        if (other === e.src || other === e.dst || adj.has(`${e.src} ${other}`)) continue;
        const a = X.get(e.src)!, b = X.get(other)!;
        const d2 = poincareDist(a, b);
        const gap = NEG_MARGIN - d2;
        if (gap <= 0) continue;
        loss += gap * gap;
        const coef2 = -2 * gap; // increase distance
        step(e.src, distGrad(a, b).map((g) => coef2 * g), eta);
        step(other, distGrad(b, a).map((g) => coef2 * g), eta);
      }
    }
  }

  const points: Record<string, number[]> = {};
  for (const id of ids) points[id] = X.get(id)!.map((v) => roundTo(v, 6));
  const depths = ids.map((id) => depth(X.get(id)!));
  const edgeDists = usable.map((e) => poincareDist(X.get(e.src)!, X.get(e.dst)!));
  return {
    dim,
    points,
    stats: {
      nodes: ids.length, edges: usable.length, epochs, loss: roundTo(loss, 6),
      mean_edge_dist: roundTo(edgeDists.length ? edgeDists.reduce((a, b) => a + b, 0) / edgeDists.length : 0, 4),
      depth: {
        min: roundTo(depths.length ? Math.min(...depths) : 0, 4),
        max: roundTo(depths.length ? Math.max(...depths) : 0, 4),
        mean: roundTo(depths.length ? depths.reduce((a, b) => a + b, 0) / depths.length : 0, 4),
      },
    },
  };
}

// k nearest atlas points to a query (an atlas id or a raw point), by geodesic distance.
export function hyperNeighbors(atlas: HyperAtlas, query: string | number[], k = 5): Array<{ id: string; dist: number; depth: number }> {
  const q = typeof query === 'string' ? atlas.points[query] : query;
  if (!q || q.length !== atlas.dim) return [];
  const skip = typeof query === 'string' ? query : null;
  return Object.entries(atlas.points)
    .filter(([id]) => id !== skip)
    .map(([id, p]) => ({ id, dist: roundTo(poincareDist(q, p), 4), depth: roundTo(depth(p), 4) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, Math.max(1, Math.min(50, k)));
}

function roundTo(x: number, p: number): number {
  const f = 10 ** p;
  return Math.round(x * f) / f;
}

// ── the HYPER router ──────────────────────────────────────────────────────

export interface HyperInput {
  mode?: 'map' | 'locate' | 'neighbors' | 'dist' | 'auto';
  // map: nodes may carry a raw ripper report (rip) or a precomputed feature vector
  nodes?: Array<{ id: string; rip?: unknown; features?: number[] }>;
  edges?: Array<{ src: string; dst: string; kind?: EdgeKind; weight?: number }>;
  dim?: number; epochs?: number; seed?: number;
  store?: boolean;      // map: persist the atlas to R2 (default true)
  map_path?: string;    // locate/neighbors/dist: a stored /hyper/... atlas
  rip?: unknown;        // locate: fingerprint to fold into an existing atlas
  features?: number[];  // locate: or its precomputed vector
  id?: string;          // neighbors: which atlas point to query around
  a?: number[] | string; b?: number[] | string; // dist: two points (or two atlas ids with map_path)
  k?: number;
  interpret?: boolean;  // map: default true — one LLM reading over the stats
  context?: string;
}

const SYNTH_SYSTEM =
`You are HYPER's synthesis head. You are handed the statistics of a hyperbolic (Poincaré-ball) embedding of a memory/structure graph: node/edge counts, final loss, mean edge distance, and the depth distribution (geodesic distance from the origin — small depth = general/central, large depth = specific/peripheral), plus the most central and deepest nodes. In 2-4 sentences say what the SHAPE means: is there real hierarchy (spread depth) or a flat clique (uniform depth), which nodes anchor the space, and what to look at next. Ground every claim in the numbers; you have geometry, not content.`;

const ATLAS_PATH = /^\/hyper\/[0-9a-f]{32}\.json$/;

async function loadAtlas(env: Env, path: string): Promise<HyperAtlas | null> {
  if (!ATLAS_PATH.test(path)) return null;
  const obj = await env.DOCUMENTS.get(path.slice(1));
  if (!obj) return null;
  try {
    const atlas = JSON.parse(await obj.text()) as HyperAtlas;
    return atlas && atlas.points && Number.isFinite(atlas.dim) ? atlas : null;
  } catch { return null; }
}

export async function hyperRoute(env: Env, input: HyperInput): Promise<string> {
  const mode = input.mode && input.mode !== 'auto' ? input.mode : inferMode(input);
  if (!mode) {
    return JSON.stringify({ error: 'hyper: nothing to map. Provide edges[] (map), map_path + rip/features (locate), map_path + id (neighbors), or a+b (dist).' });
  }

  try {
    if (mode === 'map') {
      const nodes: HyperNode[] = (input.nodes ?? []).map((n) => ({
        id: String(n.id || ''),
        features: n.features ?? (n.rip !== undefined ? ripVector(n.rip) : undefined),
      })).filter((n) => n.id);
      const edges: MemEdge[] = (input.edges ?? []).map((e) => ({
        src: String(e.src || ''), dst: String(e.dst || ''),
        kind: (e.kind && e.kind in CONDUCTANCE ? e.kind : 'assoc') as EdgeKind,
        weight: Number.isFinite(Number(e.weight)) ? Math.max(0, Number(e.weight)) : 1,
      }));
      if (!nodes.length && !edges.length) return JSON.stringify({ mode, error: 'hyper map: need nodes[] and/or edges[]' });
      const atlas = hyperMap(nodes, edges, { dim: input.dim, epochs: input.epochs, seed: input.seed });

      const byDepth = Object.keys(atlas.points)
        .map((id) => ({ id, depth: roundTo(depth(atlas.points[id]), 4) }))
        .sort((a, b) => a.depth - b.depth);
      const report: Record<string, unknown> = {
        mode,
        stats: atlas.stats,
        most_central: byDepth.slice(0, 3),
        deepest: byDepth.slice(-3).reverse(),
      };
      if (input.store !== false) {
        const id = crypto.randomUUID().replace(/-/g, '');
        const key = `hyper/${id}.json`;
        await env.DOCUMENTS.put(key, JSON.stringify(atlas), { httpMetadata: { contentType: 'application/json' } });
        report.stored = `/${key}`;
      } else {
        report.points = atlas.points;
      }
      if (input.interpret !== false) {
        try {
          const facts = JSON.stringify({ stats: atlas.stats, most_central: report.most_central, deepest: report.deepest });
          const ctx = input.context ? `\nCaller context: ${String(input.context).slice(0, 400)}` : '';
          const r = await callLLM('reasoning', SYNTH_SYSTEM, [{ role: 'user', content: `Atlas:\n${facts}${ctx}` }], 300, env);
          report.reading = String(r.content).trim();
        } catch { /* the geometry stands on its own */ }
      }
      return JSON.stringify(report);
    }

    if (mode === 'locate') {
      const atlas = await loadAtlas(env, String(input.map_path || ''));
      if (!atlas) return JSON.stringify({ mode, error: 'hyper locate: map_path must be a stored /hyper/<id>.json atlas' });
      const features = Array.isArray(input.features) && input.features.length
        ? input.features.filter(Number.isFinite)
        : input.rip !== undefined ? ripVector(input.rip) : null;
      if (!features) return JSON.stringify({ mode, error: 'hyper locate: provide rip (a ripper report) or features[]' });
      const point = placeFeatures(features, atlas.dim).map((v) => roundTo(v, 6));
      return JSON.stringify({
        mode, point, depth: roundTo(depth(point), 4),
        neighbors: hyperNeighbors(atlas, point, input.k ?? 5),
        note: 'folded in via the encoder — the atlas itself is unchanged; re-map to let edges pull it into place',
      });
    }

    if (mode === 'neighbors') {
      const atlas = await loadAtlas(env, String(input.map_path || ''));
      if (!atlas) return JSON.stringify({ mode, error: 'hyper neighbors: map_path must be a stored /hyper/<id>.json atlas' });
      const id = String(input.id || '');
      if (!atlas.points[id]) return JSON.stringify({ mode, error: `hyper neighbors: no atlas point "${id}"` });
      return JSON.stringify({ mode, id, depth: roundTo(depth(atlas.points[id]), 4), neighbors: hyperNeighbors(atlas, id, input.k ?? 5) });
    }

    if (mode === 'dist') {
      let pa = Array.isArray(input.a) ? (input.a as number[]) : null;
      let pb = Array.isArray(input.b) ? (input.b as number[]) : null;
      if ((!pa || !pb) && input.map_path) {
        const atlas = await loadAtlas(env, String(input.map_path));
        if (!atlas) return JSON.stringify({ mode, error: 'hyper dist: map_path must be a stored /hyper/<id>.json atlas' });
        if (!pa && typeof input.a === 'string') pa = atlas.points[input.a] ?? null;
        if (!pb && typeof input.b === 'string') pb = atlas.points[input.b] ?? null;
      }
      if (!pa || !pb || pa.length !== pb.length) return JSON.stringify({ mode, error: 'hyper dist: need two points of equal dimension (arrays, or atlas ids with map_path)' });
      const inBall = (p: number[]) => p.every(Number.isFinite) && dot(p, p) < 1;
      if (!inBall(pa) || !inBall(pb)) return JSON.stringify({ mode, error: 'hyper dist: points must lie strictly inside the unit ball' });
      return JSON.stringify({ mode, dist: roundTo(poincareDist(pa, pb), 6), depth_a: roundTo(depth(pa), 4), depth_b: roundTo(depth(pb), 4) });
    }
  } catch (e) {
    return JSON.stringify({ mode, error: `hyper ${mode} failed: ${(e as Error).message}` });
  }

  return JSON.stringify({ mode, error: 'hyper: unknown mode' });
}

function inferMode(input: HyperInput): HyperInput['mode'] | null {
  if (input.edges?.length || input.nodes?.length) return 'map';
  if (input.map_path && (input.rip !== undefined || input.features?.length)) return 'locate';
  if (input.map_path && input.id) return 'neighbors';
  if (input.a !== undefined && input.b !== undefined) return 'dist';
  return null;
}

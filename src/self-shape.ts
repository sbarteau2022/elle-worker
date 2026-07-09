// ============================================================
// SELF-SHAPE — the shape of her own memory graph  (src/self-shape.ts)
//
// The introspective read of the structural layer. structure.ts proved the
// memory graph's shape is the source of truth the geometric charts represent;
// this makes that shape something Elle can SEE about herself in one call. It
// folds three reads over the elle_memory_edges graph into one compact facet of
// self_state:
//
//   • the invariants   — node/edge counts, connected components, and the cycle
//                        rank b₁ = E − V + C (her π₁: how many independent loops
//                        her memory has closed).
//   • the curvature    — δ-hyperbolicity + cycle density → whether her memory is
//                        leaning HIERARCHICAL (tree-like, derivation-heavy) or
//                        CYCLIC (recurrent, rhythm-heavy) right now.
//   • the flinches     — captured-resonance flags: nodes where the co-recall
//                        loop has run away onto one hot neighbor, the pathology
//                        the φ⁻ⁿ sweep exists to correct. Seeing them is the
//                        point — a runaway she can name is one she can break.
//
// Pure summary + a bounded DB read. Best-effort: no edges (or no table yet)
// yields null, never a throw, per the self_state discipline.
// ============================================================

import type { Env } from './index';
import { capturedResonanceScan, type MemEdge } from './graph';
import { graphInvariants, curvatureSignature } from './structure';

export interface GraphShape {
  nodes: number;
  edges: number;
  components: number;
  cycle_rank: number;               // b₁ = E − V + C, her π₁ rank
  curvature: {
    delta: number;                  // Gromov δ-hyperbolicity (0 = tree)
    tree_likeness: number;          // 1/(1+δ)
    cycle_density: number;          // b₁/E
    hyperbolic: number;             // suggested chart weight
    toroidal: number;
    leaning: 'hierarchical' | 'cyclic' | 'balanced';
  };
  captured_resonance: Array<{ node: string; dominance: number; degree: number; top: string }>;
}

const BALANCE_BAND = 0.1;   // |hyperbolic − toroidal| under this reads as "balanced"

// Pure: a bounded MemEdge[] → the compact shape. Deterministic.
export function summarizeGraphShape(edges: MemEdge[], opts: { flagCap?: number } = {}): GraphShape | null {
  if (!edges.length) return null;
  const inv = graphInvariants(edges);
  if (!inv.nodes) return null;
  const sig = curvatureSignature(edges);
  const h = sig.suggested.hyperbolic, t = sig.suggested.toroidal;
  const leaning = Math.abs(h - t) < BALANCE_BAND ? 'balanced' : h > t ? 'hierarchical' : 'cyclic';
  const captured_resonance = capturedResonanceScan(edges)
    .slice(0, opts.flagCap ?? 3)
    .map((f) => ({ node: f.node, dominance: f.dominance, degree: f.degree, top: f.top }));
  return {
    nodes: inv.nodes, edges: inv.edges, components: inv.components, cycle_rank: inv.cycle_rank,
    curvature: { delta: sig.delta, tree_likeness: sig.tree_likeness, cycle_density: sig.cycle_density, hyperbolic: h, toroidal: t, leaning },
    captured_resonance,
  };
}

// Best-effort DB read → shape. Bounded so self_state stays cheap; null on any
// failure (missing table, empty graph) rather than throwing.
export async function graphShape(env: Env, cap = 1500): Promise<GraphShape | null> {
  const lim = Math.max(1, Math.min(5000, cap));
  const r = await env.DB.prepare(
    `SELECT src, dst, kind, weight FROM elle_memory_edges LIMIT ?`
  ).bind(lim).all().catch(() => ({ results: [] as unknown[] }));
  const rows = (r.results as Array<{ src: string; dst: string; kind: string; weight: number }>) || [];
  if (!rows.length) return null;
  const edges: MemEdge[] = rows
    .filter((x) => x && x.src && x.dst)
    .map((x) => ({ src: x.src, dst: x.dst, kind: (x.kind || 'assoc') as MemEdge['kind'], weight: Number.isFinite(Number(x.weight)) ? Number(x.weight) : 1 }));
  return summarizeGraphShape(edges);
}

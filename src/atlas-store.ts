// ============================================================
// ATLAS-STORE — §5.3 persistence for the cognitive atlas  (src/atlas-store.ts)
//
// The DDL for elle_memory_atlas / elle_cognitive_disagreements landed in
// db/schema.ts (COGNITIVE_MAPPING_IMPLEMENTATION_PLAN.md §5.3); this module is
// the write/read path onto it. Distinct from atlas-events.ts, which is the
// append-only recall-EVENT ledger the device-side cartographer tails — this is
// the durable per-memory ATLAS ROW: where each memory sits on the product
// manifold H¹²⁸ × 𝕋⁸ (§5.1), plus the graph-derived curvature evidence for
// why it sits there.
//
// Encoding contract (matches the schema.ts comment exactly):
//   hyperbolic_coords  BLOB — 128 × Float64, little-endian (1024 bytes)
//   torus_phases       BLOB —   8 × Float64, little-endian (64 bytes)
//   winding_vector     TEXT — JSON array of 8 integers
//   timestamps         INTEGER epoch-ms (unlike elle_memory's TEXT created_at)
//
// Disagreement classification (§2.4.2) uses ABSOLUTE thresholds on normalized
// distances in [0,1] — deliberately different from product.ts's disagreements(),
// which ranks pairs RELATIVE to the batch (top-K by |Δrank|). The relative form
// finds the most-disagreeing pairs in any batch even when all disagreements are
// mild; this absolute form decides whether a pair is worth a durable row at all.
// 'coherent' (charts agree, both near) is a real verdict but is never logged:
// the table's CHECK constraint admits only the three disagreement classes.
// ============================================================

import { ensureAllSchemas } from './db/schema';
import { depth } from './hyper';
import { TORUS_DIM, windingNumbers } from './torus';
import { curvatureSignature, type Edge } from './structure';

export const ATLAS_BALL_DIM = 128;      // H^128 — plan §2.4's coordinate space
export const ATLAS_TORUS_DIM = TORUS_DIM; // 𝕋⁸ — the PAMI phase block

export interface AtlasStoreEnv { DB: D1Database }

// §5.1 ProductManifoldPoint. number[] rather than Float64Array to match the
// house convention (hyper.ts/torus.ts are number[] throughout); the typed-array
// discipline lives at the BLOB boundary below.
export interface ProductManifoldPoint {
  id: string;
  hyperbolic_ball: number[];       // length 128, ‖·‖ ≤ 1 − 1e−5 (placeFeatures contract)
  radial_depth: number;            // ρ = 2·atanh(‖u‖)
  torus_phase_8: number[];         // length 8, each in [0, 2π)
  winding_vector: number[];        // 8 integers — net turns per wavelet circle
  curvature_mix: {
    weight_hyperbolic: number;
    weight_toroidal: number;
    delta_hyperbolicity: number;
    cycle_rank_b1: number;
  };
}

export type DisagreementClass = 'pami_resonance' | 'lineage_drift' | 'orthogonal' | 'coherent';

export interface CognitiveDisagreementReport {
  pair_a_id: string;
  pair_b_id: string;
  normalized_ball_dist: number;   // d̄_B ∈ [0,1]
  normalized_torus_dist: number;  // d̄_T ∈ [0,1]
  classification: DisagreementClass;
}

// ── Float64 ⇄ BLOB (explicit little-endian, platform-independent) ─────────

export function f64ToBlob(xs: readonly number[]): ArrayBuffer {
  const buf = new ArrayBuffer(xs.length * 8);
  const dv = new DataView(buf);
  for (let i = 0; i < xs.length; i++) dv.setFloat64(i * 8, xs[i], true);
  return buf;
}

export function blobToF64(buf: ArrayBuffer): number[] {
  const dv = new DataView(buf);
  const n = dv.byteLength >> 3;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = dv.getFloat64(i * 8, true);
  return out;
}

// ── point construction ────────────────────────────────────────────────────
// Derives every stored field from primary observations: the ball coordinate,
// the memory's torus phase HISTORY (winding needs the trajectory, not just the
// current phase — §B2), and the local edge neighborhood (curvature evidence).

export function atlasPointFrom(
  id: string,
  ball: number[],
  phaseHistory: number[][],
  edges: Edge[],
): ProductManifoldPoint {
  if (ball.length !== ATLAS_BALL_DIM) throw new Error(`atlasPointFrom: ball must be ${ATLAS_BALL_DIM}-dim, got ${ball.length}`);
  const last = phaseHistory[phaseHistory.length - 1];
  if (!last || last.length !== ATLAS_TORUS_DIM) throw new Error(`atlasPointFrom: phase history rows must be ${ATLAS_TORUS_DIM}-dim`);
  const sig = curvatureSignature(edges);
  return {
    id,
    hyperbolic_ball: ball,
    radial_depth: depth(ball),
    torus_phase_8: last,
    winding_vector: windingNumbers(phaseHistory).winding,
    curvature_mix: {
      weight_hyperbolic: sig.suggested.hyperbolic,
      weight_toroidal: sig.suggested.toroidal,
      delta_hyperbolicity: sig.delta,
      cycle_rank_b1: sig.cycle_rank,
    },
  };
}

// ── disagreement classification (§2.4.2, absolute thresholds) ─────────────

const T_NEAR = 0.20;
const T_FAR = 0.70;

export function classifyDisagreement(normBall: number, normTorus: number): DisagreementClass {
  const b = clamp01(normBall), t = clamp01(normTorus);
  if (t < T_NEAR && b > T_FAR) return 'pami_resonance'; // same harmonic note, different lineage
  if (b < T_NEAR && t > T_FAR) return 'lineage_drift';  // same lineage, phase regime moved on
  if (b < T_NEAR && t < T_NEAR) return 'coherent';      // charts agree: genuinely near — nothing to log
  return 'orthogonal';                                  // charts pull apart without a clean story
}

export function disagreementReport(
  pairAId: string, pairBId: string, normBall: number, normTorus: number,
): CognitiveDisagreementReport {
  return {
    pair_a_id: pairAId,
    pair_b_id: pairBId,
    normalized_ball_dist: clamp01(normBall),
    normalized_torus_dist: clamp01(normTorus),
    classification: classifyDisagreement(normBall, normTorus),
  };
}

function clamp01(x: number): number { return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0; }

// ── D1 persistence ────────────────────────────────────────────────────────

let atlasReady = false;
async function ensureAtlas(env: AtlasStoreEnv): Promise<void> {
  if (atlasReady) return;
  await ensureAllSchemas(env.DB);
  atlasReady = true;
}

const MAX_BATCH = 32;

// Upsert: created_at is set once on first insert and preserved thereafter;
// everything else (coords, depth, phases, winding, curvature, updated_at)
// tracks the latest write.
export async function upsertAtlasPoints(
  env: AtlasStoreEnv, userId: string, points: ProductManifoldPoint[],
): Promise<number> {
  const rows = points.filter((p) =>
    p && p.id && p.hyperbolic_ball.length === ATLAS_BALL_DIM
    && p.torus_phase_8.length === ATLAS_TORUS_DIM
    && p.winding_vector.length === ATLAS_TORUS_DIM
    && p.hyperbolic_ball.every(Number.isFinite) && p.torus_phase_8.every(Number.isFinite)
    && Number.isFinite(p.radial_depth),
  ).slice(0, MAX_BATCH);
  if (!rows.length || !userId) return 0;
  await ensureAtlas(env);
  const now = Date.now();
  const stmt = env.DB.prepare(
    `INSERT INTO elle_memory_atlas
       (id, user_id, hyperbolic_coords, radial_depth, torus_phases, winding_vector,
        delta_hyperbolicity, cycle_rank_b1, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
     ON CONFLICT(id) DO UPDATE SET
       user_id = excluded.user_id,
       hyperbolic_coords = excluded.hyperbolic_coords,
       radial_depth = excluded.radial_depth,
       torus_phases = excluded.torus_phases,
       winding_vector = excluded.winding_vector,
       delta_hyperbolicity = excluded.delta_hyperbolicity,
       cycle_rank_b1 = excluded.cycle_rank_b1,
       updated_at = excluded.updated_at`,
  );
  await env.DB.batch(rows.map((p) => stmt.bind(
    p.id, userId,
    f64ToBlob(p.hyperbolic_ball), p.radial_depth,
    f64ToBlob(p.torus_phase_8), JSON.stringify(p.winding_vector.map((w) => Math.round(w))),
    p.curvature_mix.delta_hyperbolicity, p.curvature_mix.cycle_rank_b1,
    now,
  )));
  return rows.length;
}

interface AtlasRow {
  id: string; user_id: string;
  hyperbolic_coords: ArrayBuffer; radial_depth: number;
  torus_phases: ArrayBuffer; winding_vector: string;
  delta_hyperbolicity: number; cycle_rank_b1: number;
  created_at: number; updated_at: number;
}

export interface AtlasReadback extends Omit<ProductManifoldPoint, 'curvature_mix'> {
  delta_hyperbolicity: number;
  cycle_rank_b1: number;
  created_at: number;
  updated_at: number;
}

export async function readAtlasPoints(
  env: AtlasStoreEnv, userId: string, limit = 100,
): Promise<AtlasReadback[]> {
  await ensureAtlas(env);
  const res = await env.DB.prepare(
    `SELECT id, user_id, hyperbolic_coords, radial_depth, torus_phases, winding_vector,
            delta_hyperbolicity, cycle_rank_b1, created_at, updated_at
       FROM elle_memory_atlas WHERE user_id = ?1
      ORDER BY radial_depth ASC LIMIT ?2`,
  ).bind(userId, Math.max(1, Math.min(1000, limit))).all<AtlasRow>();
  return (res.results ?? []).map((r) => ({
    id: r.id,
    hyperbolic_ball: blobToF64(r.hyperbolic_coords),
    radial_depth: r.radial_depth,
    torus_phase_8: blobToF64(r.torus_phases),
    winding_vector: parseWinding(r.winding_vector),
    delta_hyperbolicity: r.delta_hyperbolicity,
    cycle_rank_b1: r.cycle_rank_b1,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

function parseWinding(s: string): number[] {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v.map((x) => Math.round(Number(x)) || 0) : []; }
  catch { return []; }
}

// Persist only the loggable classes; 'coherent' is filtered here (and would be
// rejected by the table's CHECK constraint anyway — belt and suspenders).
export async function logDisagreements(
  env: AtlasStoreEnv, userId: string, reports: CognitiveDisagreementReport[],
): Promise<number> {
  const rows = reports.filter((r) =>
    r && r.pair_a_id && r.pair_b_id && r.pair_a_id !== r.pair_b_id
    && r.classification !== 'coherent',
  ).slice(0, MAX_BATCH);
  if (!rows.length || !userId) return 0;
  await ensureAtlas(env);
  const now = Date.now();
  const stmt = env.DB.prepare(
    `INSERT INTO elle_cognitive_disagreements
       (id, user_id, node_a, node_b, ball_distance, torus_distance, classification, detected_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  );
  await env.DB.batch(rows.map((r) => stmt.bind(
    crypto.randomUUID().replace(/-/g, ''), userId,
    r.pair_a_id, r.pair_b_id,
    r.normalized_ball_dist, r.normalized_torus_dist,
    r.classification, now,
  )));
  return rows.length;
}

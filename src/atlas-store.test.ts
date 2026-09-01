// ============================================================
// atlas-store tests — §5.3 persistence (codec, point construction,
// disagreement classification, D1 upsert/readback against a faithful
// in-memory D1 fake in the atlas-events.test.ts style).
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  ATLAS_BALL_DIM,
  ATLAS_TORUS_DIM,
  f64ToBlob,
  blobToF64,
  atlasPointFrom,
  classifyDisagreement,
  disagreementReport,
  upsertAtlasPoints,
  readAtlasPoints,
  logDisagreements,
  type AtlasStoreEnv,
  type ProductManifoldPoint,
  type CognitiveDisagreementReport,
} from './atlas-store';
import { depth, mulberry32 } from './hyper';
import { curvatureSignature, type Edge } from './structure';
import { windingNumbers } from './torus';

// ── in-memory D1 fake ─────────────────────────────────────────────────────
// Extends the atlas-events.test.ts pattern: batch applies only INSERT
// statements (ensureAllSchemas' CREATEs pass through untouched), dispatched
// on the table name in the SQL. elle_memory_atlas rows live in a Map keyed
// by id with upsert semantics that preserve the original created_at;
// elle_cognitive_disagreements is append-only.

interface AtlasStoredRow {
  id: string;
  user_id: string;
  hyperbolic_coords: ArrayBuffer;
  radial_depth: number;
  torus_phases: ArrayBuffer;
  winding_vector: string;
  delta_hyperbolicity: number;
  cycle_rank_b1: number;
  created_at: number;
  updated_at: number;
}

interface DisagreementStoredRow {
  id: string;
  user_id: string;
  node_a: string;
  node_b: string;
  ball_distance: number;
  torus_distance: number;
  classification: string;
  detected_at: number;
}

function fakeEnv() {
  const atlas = new Map<string, AtlasStoredRow>();
  const disagreements: DisagreementStoredRow[] = [];
  const mkStmt = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => mkStmt(sql, a),
    async run() { return { success: true }; },
    async all() {
      // The only SELECT this module issues is the readback query:
      // WHERE user_id = ?1 ORDER BY radial_depth ASC LIMIT ?2.
      const userId = String(args[0]);
      const limit = Number(args[1]) || 100;
      const results = [...atlas.values()]
        .filter((r) => r.user_id === userId)
        .sort((a, b) => a.radial_depth - b.radial_depth)
        .slice(0, limit);
      return { results };
    },
    async first() { return null; },
    _apply(a: unknown[]) {
      if (sql.includes('elle_memory_atlas')) {
        const id = String(a[0]);
        const prev = atlas.get(id);
        const now = Number(a[8]);
        atlas.set(id, {
          id,
          user_id: String(a[1]),
          hyperbolic_coords: a[2] as ArrayBuffer,
          radial_depth: Number(a[3]),
          torus_phases: a[4] as ArrayBuffer,
          winding_vector: String(a[5]),
          delta_hyperbolicity: Number(a[6]),
          cycle_rank_b1: Number(a[7]),
          created_at: prev ? prev.created_at : now,
          updated_at: now,
        });
      } else if (sql.includes('elle_cognitive_disagreements')) {
        disagreements.push({
          id: String(a[0]),
          user_id: String(a[1]),
          node_a: String(a[2]),
          node_b: String(a[3]),
          ball_distance: Number(a[4]),
          torus_distance: Number(a[5]),
          classification: String(a[6]),
          detected_at: Number(a[7]),
        });
      }
    },
    _sql: sql,
    _args: args,
  });
  const db = {
    prepare: (sql: string) => mkStmt(sql),
    async batch(stmts: Array<ReturnType<typeof mkStmt>>) {
      for (const s of stmts) if (s._sql.trimStart().startsWith('INSERT')) s._apply(s._args);
      return stmts.map(() => ({ success: true }));
    },
  } as unknown as D1Database;
  return { env: { DB: db } as AtlasStoreEnv, atlas, disagreements };
}

// ── helpers ───────────────────────────────────────────────────────────────

function mkBall(scale: number, seed = 0): number[] {
  const rng = mulberry32(0xA71A5 + seed);
  const v = Array.from({ length: ATLAS_BALL_DIM }, () => rng() - 0.5);
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => (x / n) * scale);
}

function mkPoint(id: string, ballScale: number, seed = 0): ProductManifoldPoint {
  const ball = mkBall(ballScale, seed);
  const rng = mulberry32(0x9047 + seed);
  return {
    id,
    hyperbolic_ball: ball,
    radial_depth: depth(ball),
    torus_phase_8: Array.from({ length: ATLAS_TORUS_DIM }, () => rng() * 2 * Math.PI),
    winding_vector: Array.from({ length: ATLAS_TORUS_DIM }, (_, j) => (j % 3) - 1),
    curvature_mix: {
      weight_hyperbolic: 0.7,
      weight_toroidal: 0.3,
      delta_hyperbolicity: 0.5,
      cycle_rank_b1: 2,
    },
  };
}

// ── codec ─────────────────────────────────────────────────────────────────

describe('f64ToBlob / blobToF64', () => {
  it('round-trips 128 values bit-exactly at 1024 bytes', () => {
    const rng = mulberry32(0xB10B);
    const xs = Array.from({ length: 128 }, () => (rng() - 0.5) * 1e6);
    const buf = f64ToBlob(xs);
    expect(buf.byteLength).toBe(1024);
    const back = blobToF64(buf);
    expect(back.length).toBe(128);
    let exact = 0;
    for (let i = 0; i < 128; i++) if (Object.is(back[i], xs[i])) exact++;
    expect(exact).toBe(128);
  });

  it('is explicitly little-endian: 1.0 → 00 00 00 00 00 00 F0 3F', () => {
    const bytes = new Uint8Array(f64ToBlob([1.0]));
    expect([...bytes]).toEqual([0, 0, 0, 0, 0, 0, 0xf0, 0x3f]);
  });

  it('an 8-dim phase row is 64 bytes', () => {
    expect(f64ToBlob(new Array(8).fill(0)).byteLength).toBe(64);
  });

  it('preserves NaN, ±Infinity, and −0 through the round trip', () => {
    const back = blobToF64(f64ToBlob([NaN, Infinity, -Infinity, -0, 0]));
    expect(Number.isNaN(back[0])).toBe(true);
    expect(back[1]).toBe(Infinity);
    expect(back[2]).toBe(-Infinity);
    expect(Object.is(back[3], -0)).toBe(true);
    expect(Object.is(back[4], 0)).toBe(true);
  });
});

// ── point construction ────────────────────────────────────────────────────

describe('atlasPointFrom', () => {
  const HALF_PI = Math.PI / 2;
  // Axis-0 traversal of the full circle in quarter turns, closed exactly.
  const loopHistory = [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [HALF_PI, 0, 0, 0, 0, 0, 0, 0],
    [Math.PI, 0, 0, 0, 0, 0, 0, 0],
    [3 * HALF_PI, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
  ];
  const triangle: Edge[] = [
    { src: 'a', dst: 'b' },
    { src: 'b', dst: 'c' },
    { src: 'c', dst: 'a' },
  ];

  it('derives every field from the primary observations', () => {
    const ball = mkBall(0.5);
    const p = atlasPointFrom('mem1', ball, loopHistory, triangle);
    expect(p.id).toBe('mem1');
    expect(p.hyperbolic_ball).toBe(ball);
    expect(p.radial_depth).toBe(depth(ball));
    expect(p.torus_phase_8).toEqual(loopHistory[loopHistory.length - 1]);
    expect(p.winding_vector).toEqual(windingNumbers(loopHistory).winding);
    expect(p.winding_vector[0]).toBe(1); // one net turn on axis 0
    expect(p.winding_vector.slice(1)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    const sig = curvatureSignature(triangle);
    expect(p.curvature_mix.weight_hyperbolic).toBe(sig.suggested.hyperbolic);
    expect(p.curvature_mix.weight_toroidal).toBe(sig.suggested.toroidal);
    expect(p.curvature_mix.delta_hyperbolicity).toBe(sig.delta);
    expect(p.curvature_mix.cycle_rank_b1).toBe(sig.cycle_rank);
    expect(p.curvature_mix.cycle_rank_b1).toBe(1); // a triangle has b1 = 1
  });

  it('a single-row history yields zero winding', () => {
    const p = atlasPointFrom('mem2', mkBall(0.3), [loopHistory[1]], []);
    expect(p.winding_vector).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('rejects malformed inputs', () => {
    expect(() => atlasPointFrom('x', new Array(64).fill(0), loopHistory, [])).toThrow(/128-dim/);
    expect(() => atlasPointFrom('x', mkBall(0.2), [], [])).toThrow(/phase history/);
    expect(() => atlasPointFrom('x', mkBall(0.2), [[0, 0, 0]], [])).toThrow(/phase history/);
  });
});

// ── disagreement classification ───────────────────────────────────────────

describe('classifyDisagreement', () => {
  it('maps the four §2.4.2 regions', () => {
    expect(classifyDisagreement(0.9, 0.1)).toBe('pami_resonance');
    expect(classifyDisagreement(0.1, 0.9)).toBe('lineage_drift');
    expect(classifyDisagreement(0.1, 0.1)).toBe('coherent');
    expect(classifyDisagreement(0.5, 0.5)).toBe('orthogonal');
    expect(classifyDisagreement(0.9, 0.9)).toBe('orthogonal');
  });

  it('thresholds are strict: exact 0.20 / 0.70 fall to orthogonal', () => {
    expect(classifyDisagreement(0.7, 0.1)).toBe('orthogonal');  // b not > 0.70
    expect(classifyDisagreement(0.1, 0.7)).toBe('orthogonal');  // t not > 0.70
    expect(classifyDisagreement(0.2, 0.1)).toBe('orthogonal');  // b not < 0.20
    expect(classifyDisagreement(0.1, 0.2)).toBe('orthogonal');  // t not < 0.20
  });

  it('clamps out-of-range and non-finite inputs before classifying', () => {
    expect(classifyDisagreement(-5, 2)).toBe('lineage_drift');  // → (0, 1)
    expect(classifyDisagreement(2, -5)).toBe('pami_resonance'); // → (1, 0)
    expect(classifyDisagreement(NaN, NaN)).toBe('coherent');    // → (0, 0)
  });
});

describe('disagreementReport', () => {
  it('clamps the stored distances and classifies from the clamped values', () => {
    const r = disagreementReport('a', 'b', 1.7, -0.3);
    expect(r.normalized_ball_dist).toBe(1);
    expect(r.normalized_torus_dist).toBe(0);
    expect(r.classification).toBe('pami_resonance');
    expect(r.pair_a_id).toBe('a');
    expect(r.pair_b_id).toBe('b');
  });
});

// ── D1 upsert / readback ──────────────────────────────────────────────────

describe('upsertAtlasPoints / readAtlasPoints', () => {
  it('writes rows and reads them back decoded, ordered by radial_depth', async () => {
    const { env } = fakeEnv();
    const pts = [mkPoint('deep', 0.9, 1), mkPoint('shallow', 0.2, 2), mkPoint('mid', 0.5, 3)];
    expect(await upsertAtlasPoints(env, 'u1', pts)).toBe(3);

    const back = await readAtlasPoints(env, 'u1');
    expect(back.map((r) => r.id)).toEqual(['shallow', 'mid', 'deep']);
    for (const r of back) {
      const orig = pts.find((p) => p.id === r.id)!;
      let exact = 0;
      for (let i = 0; i < ATLAS_BALL_DIM; i++) if (Object.is(r.hyperbolic_ball[i], orig.hyperbolic_ball[i])) exact++;
      expect(exact).toBe(ATLAS_BALL_DIM);
      expect(r.torus_phase_8).toEqual(orig.torus_phase_8);
      expect(r.winding_vector).toEqual(orig.winding_vector);
      expect(r.radial_depth).toBe(orig.radial_depth);
      expect(r.delta_hyperbolicity).toBe(orig.curvature_mix.delta_hyperbolicity);
      expect(r.cycle_rank_b1).toBe(orig.curvature_mix.cycle_rank_b1);
    }

    expect((await readAtlasPoints(env, 'u1', 2)).map((r) => r.id)).toEqual(['shallow', 'mid']);
    expect(await readAtlasPoints(env, 'someone-else')).toEqual([]);
  });

  it('preserves created_at across re-upserts while content and updated_at move', async () => {
    const { env, atlas } = fakeEnv();
    const p = mkPoint('p1', 0.4, 4);
    await upsertAtlasPoints(env, 'u1', [p]);
    atlas.get('p1')!.created_at = 12345; // sentinel: pretend the first write was long ago

    const before = Date.now();
    const p2 = { ...mkPoint('p1', 0.8, 5), winding_vector: [2, 0, 0, 0, 0, 0, 0, -1] };
    await upsertAtlasPoints(env, 'u1', [p2]);

    const [row] = await readAtlasPoints(env, 'u1');
    expect(row.created_at).toBe(12345);
    expect(row.updated_at).toBeGreaterThanOrEqual(before);
    expect(row.radial_depth).toBe(p2.radial_depth);
    expect(row.winding_vector).toEqual([2, 0, 0, 0, 0, 0, 0, -1]);
    expect(atlas.size).toBe(1);
  });

  it('rounds winding entries at serialization time', async () => {
    const { env, atlas } = fakeEnv();
    const p = { ...mkPoint('w1', 0.3, 6), winding_vector: [1.4, -0.6, 2.5, 0, 0, 0, 0, 0] };
    await upsertAtlasPoints(env, 'u1', [p]);
    expect(JSON.parse(atlas.get('w1')!.winding_vector)).toEqual([1, -1, 3, 0, 0, 0, 0, 0]);
  });

  it('filters malformed points and empty inputs', async () => {
    const { env } = fakeEnv();
    const good = mkPoint('ok', 0.4, 7);
    const badBall = { ...mkPoint('b1', 0.4, 8), hyperbolic_ball: new Array(64).fill(0) };
    const badPhase = { ...mkPoint('b2', 0.4, 9), torus_phase_8: [0, 0, 0] };
    const badWinding = { ...mkPoint('b3', 0.4, 10), winding_vector: [0] };
    const nanBall = mkPoint('b4', 0.4, 11);
    nanBall.hyperbolic_ball = [...nanBall.hyperbolic_ball];
    nanBall.hyperbolic_ball[7] = NaN;
    const nanDepth = { ...mkPoint('b5', 0.4, 12), radial_depth: NaN };
    const noId = { ...mkPoint('', 0.4, 13) };

    expect(await upsertAtlasPoints(env, 'u1', [good, badBall, badPhase, badWinding, nanBall, nanDepth, noId])).toBe(1);
    expect((await readAtlasPoints(env, 'u1')).map((r) => r.id)).toEqual(['ok']);

    expect(await upsertAtlasPoints(env, 'u1', [])).toBe(0);
    expect(await upsertAtlasPoints(env, '', [good])).toBe(0);
  });

  it('caps a write at 32 rows', async () => {
    const { env, atlas } = fakeEnv();
    const pts = Array.from({ length: 40 }, (_, i) => mkPoint(`m${i}`, 0.1 + (i % 9) * 0.09, 100 + i));
    expect(await upsertAtlasPoints(env, 'u1', pts)).toBe(32);
    expect(atlas.size).toBe(32);
  });

  it('readback tolerates malformed stored winding JSON', async () => {
    const { env, atlas } = fakeEnv();
    await upsertAtlasPoints(env, 'u1', [mkPoint('seed-row', 0.4, 14)]);
    const template = atlas.get('seed-row')!;
    atlas.set('bad-json', { ...template, id: 'bad-json', radial_depth: 5, winding_vector: 'not json' });
    atlas.set('loose-json', { ...template, id: 'loose-json', radial_depth: 6, winding_vector: '[1.4,"2",null]' });

    const back = await readAtlasPoints(env, 'u1');
    expect(back.find((r) => r.id === 'bad-json')!.winding_vector).toEqual([]);
    expect(back.find((r) => r.id === 'loose-json')!.winding_vector).toEqual([1, 2, 0]);
  });
});

// ── disagreement logging ──────────────────────────────────────────────────

describe('logDisagreements', () => {
  const mk = (a: string, b: string, ball: number, torus: number): CognitiveDisagreementReport =>
    disagreementReport(a, b, ball, torus);

  it('persists loggable classes and filters coherent, self-pairs, and missing ids', async () => {
    const { env, disagreements } = fakeEnv();
    const reports = [
      mk('a', 'b', 0.9, 0.1),   // pami_resonance — kept
      mk('c', 'd', 0.1, 0.9),   // lineage_drift — kept
      mk('e', 'f', 0.5, 0.5),   // orthogonal — kept
      mk('g', 'h', 0.05, 0.05), // coherent — filtered
      mk('i', 'i', 0.9, 0.1),   // self-pair — filtered
      mk('', 'j', 0.9, 0.1),    // missing id — filtered
    ];
    expect(await logDisagreements(env, 'u1', reports)).toBe(3);
    expect(disagreements.map((r) => r.classification)).toEqual(['pami_resonance', 'lineage_drift', 'orthogonal']);
    for (const r of disagreements) {
      expect(r.id).toMatch(/^[0-9a-f]{32}$/);
      expect(r.user_id).toBe('u1');
      expect(r.detected_at).toBeGreaterThan(0);
    }
    expect(disagreements[0].node_a).toBe('a');
    expect(disagreements[0].node_b).toBe('b');
    expect(disagreements[0].ball_distance).toBe(0.9);
    expect(disagreements[0].torus_distance).toBe(0.1);
  });

  it('caps a write at 32 rows and rejects empty input or userId', async () => {
    const { env, disagreements } = fakeEnv();
    const many = Array.from({ length: 40 }, (_, i) => mk(`a${i}`, `b${i}`, 0.9, 0.1));
    expect(await logDisagreements(env, 'u1', many)).toBe(32);
    expect(disagreements.length).toBe(32);

    expect(await logDisagreements(env, 'u1', [])).toBe(0);
    expect(await logDisagreements(env, '', [mk('x', 'y', 0.9, 0.1)])).toBe(0);
  });
});

// ── constants ─────────────────────────────────────────────────────────────

describe('atlas constants', () => {
  it('pins the product-manifold dimensions', () => {
    expect(ATLAS_BALL_DIM).toBe(128);
    expect(ATLAS_TORUS_DIM).toBe(8);
  });
});

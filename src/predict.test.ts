// ============================================================
// predict tests — the prediction operator 𝒫 (src/predict.ts), mirroring the
// Rust harness suite (harness-dhng/src/predict.rs) plus the TS-only
// disagreement bridge:
//
//   v1 EuclidPredictor  — AR(2) exactness on a ramp, Welford outlier z,
//                         skill-vs-persistence < 1 on learnable structure,
//                         determinism, NaN/dim rejection without poisoning.
//   v2 ProductPredictor — seam-safe phase forecasting (no residual tear at
//                         the 0/2π seam), phase-jump surprise, out-of-ball
//                         and NaN rejection.
//   bridge              — surpriseToUnit σ-calibration against atlas-store's
//                         T_NEAR/T_FAR bands, stepDisagreement null policy,
//                         pami_resonance mapping, end-to-end into
//                         logDisagreements via the in-memory D1 fake.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  PREDICT_MIN_AR_HISTORY,
  SURPRISE_Z_HALF,
  Welford,
  ar1Forecast,
  ar2Forecast,
  EuclidPredictor,
  ProductPredictor,
  surpriseToUnit,
  stepDisagreement,
  type ProductPredictStep,
} from './predict';
import { logDisagreements, type AtlasStoreEnv } from './atlas-store';
import { mulberry32 } from './hyper';

// ── minimal in-memory D1 fake (atlas-store.test.ts pattern, disagreement
// table only — that is the only table the bridge writes) ──────────────────

interface DisagreementStoredRow {
  node_a: string;
  node_b: string;
  ball_distance: number;
  torus_distance: number;
  classification: string;
}

function fakeEnv() {
  const disagreements: DisagreementStoredRow[] = [];
  const mkStmt = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => mkStmt(sql, a),
    async run() { return { success: true }; },
    async all() { return { results: [] }; },
    async first() { return null; },
    _apply(a: unknown[]) {
      if (sql.includes('elle_cognitive_disagreements')) {
        disagreements.push({
          node_a: String(a[2]),
          node_b: String(a[3]),
          ball_distance: Number(a[4]),
          torus_distance: Number(a[5]),
          classification: String(a[6]),
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
  return { env: { DB: db } as AtlasStoreEnv, disagreements };
}

// ── AR forecasts ──────────────────────────────────────────────────────────

describe('ar2Forecast / ar1Forecast', () => {
  it('nails a linear ramp: 1.0 + 0.5·i for i<12 forecasts 7.0', () => {
    const series = Array.from({ length: 12 }, (_, i) => 1.0 + 0.5 * i);
    const f = ar2Forecast(series);
    expect(f).not.toBeNull();
    expect(Math.abs(f! - 7.0)).toBeLessThan(1e-9);
  });

  it('returns null when the series is too short', () => {
    expect(ar2Forecast([1, 2, 3])).toBeNull();
    expect(ar1Forecast([1, 2])).toBeNull();
  });

  it('a constant series is singular: null or the constant, never garbage', () => {
    const f = ar2Forecast(new Array(20).fill(5.0));
    expect(f === null || Math.abs(f - 5.0) < 1e-6).toBe(true);
  });

  it('ar1 fits a ramp exactly (the AR(2)-singular fallback path)', () => {
    const series = Array.from({ length: 10 }, (_, i) => 2.0 + 3.0 * i);
    const f = ar1Forecast(series);
    expect(f).not.toBeNull();
    expect(Math.abs(f! - (2.0 + 3.0 * 10))).toBeLessThan(1e-6);
  });
});

// ── Welford ───────────────────────────────────────────────────────────────

describe('Welford', () => {
  it('flags a gross outlier after a calm history with z > 10', () => {
    const w = new Welford();
    for (let i = 0; i < 20; i++) w.zThenUpdate(1.0 + 0.01 * ((i % 3) - 1));
    expect(w.zThenUpdate(5.0)).toBeGreaterThan(10);
  });

  it('returns z = 0 until it has three samples', () => {
    const w = new Welford();
    expect(w.zThenUpdate(1)).toBe(0);
    expect(w.zThenUpdate(100)).toBe(0);
    expect(w.zThenUpdate(-50)).toBe(0);
    expect(w.zThenUpdate(0)).not.toBe(0);
  });
});

// ── v1: EuclidPredictor ───────────────────────────────────────────────────

describe('EuclidPredictor', () => {
  it('learns a 2-dim ramp: skill < 1 and residual < 1e-6 by step 40', () => {
    const p = new EuclidPredictor(2);
    let last = { residual: null as number | null, skill: null as number | null };
    for (let i = 0; i < 40; i++) {
      const s = p.step([0.1 * i, -0.05 * i]);
      last = { residual: s.residual, skill: s.skillVsPersistence };
    }
    expect(last.residual).not.toBeNull();
    expect(last.residual!).toBeLessThan(1e-6);
    expect(last.skill).not.toBeNull();
    expect(last.skill!).toBeLessThan(1.0);
  });

  it('is deterministic: identical streams produce identical steps', () => {
    const rng = mulberry32(0xD1CE);
    const stream = Array.from({ length: 60 }, () => [rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1]);
    const a = new EuclidPredictor(3);
    const b = new EuclidPredictor(3);
    let identical = 0;
    for (const obs of stream) {
      const sa = a.step([...obs]);
      const sb = b.step([...obs]);
      if (
        Object.is(sa.residual, sb.residual) &&
        sa.method === sb.method &&
        Object.is(sa.z, sb.z) &&
        Object.is(sa.skillVsPersistence, sb.skillVsPersistence)
      ) identical++;
    }
    expect(identical).toBe(stream.length);
  });

  it('rejects NaN and dimension mismatch without poisoning later steps', () => {
    const p = new EuclidPredictor(2);
    for (let i = 0; i < 10; i++) p.step([i * 0.1, i * 0.1]);

    const nanStep = p.step([NaN, 0.5]);
    expect(nanStep.predicted).toBeNull();
    expect(nanStep.method).toBeNull();
    expect(Number.isNaN(nanStep.residual!)).toBe(true);
    expect(Number.isNaN(nanStep.z!)).toBe(true);
    expect(nanStep.skillVsPersistence).toBeNull();

    const dimStep = p.step([1.0]);
    expect(Number.isNaN(dimStep.residual!)).toBe(true);

    const clean = p.step([1.0, 1.0]);
    expect(clean.residual).not.toBeNull();
    expect(Number.isFinite(clean.residual!)).toBe(true);
  });

  it('first step is warm-up: predicted null, residual null (not NaN)', () => {
    const s = new EuclidPredictor(2).step([0.5, 0.5]);
    expect(s.predicted).toBeNull();
    expect(s.residual).toBeNull();
    expect(s.z).toBeNull();
    expect(s.method).toBeNull();
  });
});

// ── v2: ProductPredictor ──────────────────────────────────────────────────

describe('ProductPredictor', () => {
  it('crosses the 0/2π seam without a residual tear: max d_T < 0.1 after step 10', () => {
    const p = new ProductPredictor(2, 1);
    let maxResidual = 0;
    for (let i = 0; i < 200; i++) {
      const s = p.step([0.1, 0.1], [0.05 * i]); // steadily winds through the seam
      if (i > 10 && s.residualTorus !== null) maxResidual = Math.max(maxResidual, s.residualTorus);
    }
    expect(maxResidual).toBeGreaterThan(0); // residuals actually flowed
    expect(maxResidual).toBeLessThan(0.1);
  });

  it('a π/2 phase jump after calm rotation registers as surprise: zTorus > 5', () => {
    const p = new ProductPredictor(2, 1);
    let last: ProductPredictStep | null = null;
    for (let i = 0; i < 60; i++) last = p.step([0.1, 0.1], [0.05 * i]);
    expect(last!.zTorus).not.toBeNull();
    const jump = p.step([0.1, 0.1], [0.05 * 60 + Math.PI / 2]);
    expect(jump.zTorus).not.toBeNull();
    expect(jump.zTorus!).toBeGreaterThan(5);
    expect(jump.surprise).not.toBeNull();
    expect(jump.surprise!).toBeGreaterThan(5);
  });

  it('rejects out-of-ball and non-finite observations with NaN residuals', () => {
    const p = new ProductPredictor(2, 1);
    for (let i = 0; i < 10; i++) p.step([0.1, 0.1], [0.05 * i]);

    const outside = p.step([1.5, 0.0], [0.5]);
    expect(outside.predictedBall).toBeNull();
    expect(Number.isNaN(outside.residualProduct!)).toBe(true);
    expect(Number.isNaN(outside.residualHyper!)).toBe(true);
    expect(Number.isNaN(outside.zHyper!)).toBe(true);

    const nan = p.step([0.1, NaN], [0.5]);
    expect(Number.isNaN(nan.residualProduct!)).toBe(true);
    expect(Number.isNaN(nan.surprise!)).toBe(true);

    const clean = p.step([0.1, 0.1], [0.55]);
    expect(clean.residualHyper).not.toBeNull();
    expect(Number.isFinite(clean.residualHyper!)).toBe(true);
  });

  it('is deterministic across identical streams (residuals, surprise)', () => {
    const rng = mulberry32(0x5EED);
    const stream = Array.from({ length: 80 }, () => ({
      ball: [rng() * 0.4 - 0.2, rng() * 0.4 - 0.2],
      phases: [rng() * 2 * Math.PI],
    }));
    const a = new ProductPredictor(2, 1);
    const b = new ProductPredictor(2, 1);
    let identical = 0;
    for (const { ball, phases } of stream) {
      const sa = a.step([...ball], [...phases]);
      const sb = b.step([...ball], [...phases]);
      if (
        Object.is(sa.residualProduct, sb.residualProduct) &&
        Object.is(sa.surprise, sb.surprise) &&
        Object.is(sa.residualHyper, sb.residualHyper) &&
        Object.is(sa.residualTorus, sb.residualTorus)
      ) identical++;
    }
    expect(identical).toBe(stream.length);
  });

  it('warm-up shape: first step has null residuals, not NaN', () => {
    const s = new ProductPredictor(2, 1).step([0.1, 0.1], [0.5]);
    expect(s.residualHyper).toBeNull();
    expect(s.residualTorus).toBeNull();
    expect(s.residualProduct).toBeNull();
    expect(s.zHyper).toBeNull();
    expect(s.zTorus).toBeNull();
    expect(s.surprise).toBeNull();
  });
});

// ── the disagreement bridge ───────────────────────────────────────────────

describe('surpriseToUnit', () => {
  it('calibrates the classifier bands to sigma levels', () => {
    // T_FAR boundary: z = 3.5 → exactly 0.70; T_NEAR: z = 0.375 → exactly 0.20.
    expect(surpriseToUnit(3.5)).toBeCloseTo(0.7, 12);
    expect(surpriseToUnit(0.375)).toBeCloseTo(0.2, 12);
    expect(surpriseToUnit(4.0)).toBeGreaterThan(0.7);
    expect(surpriseToUnit(0.3)).toBeLessThan(0.2);
  });

  it('clamps negative z to 0 and propagates NaN', () => {
    expect(surpriseToUnit(-2)).toBe(0);
    expect(surpriseToUnit(0)).toBe(0);
    expect(Number.isNaN(surpriseToUnit(NaN))).toBe(true);
  });

  it('is monotone and bounded in [0, 1)', () => {
    let prev = -1;
    let monotone = 0;
    for (let z = 0; z <= 50; z += 0.5) {
      const u = surpriseToUnit(z);
      if (u > prev && u >= 0 && u < 1) monotone++;
      prev = u;
    }
    expect(monotone).toBe(101);
    expect(SURPRISE_Z_HALF).toBe(1.5);
  });
});

describe('stepDisagreement', () => {
  const mkStep = (zHyper: number | null, zTorus: number | null): ProductPredictStep => ({
    predictedBall: null,
    predictedPhases: null,
    residualHyper: null,
    residualTorus: null,
    residualProduct: null,
    zHyper,
    zTorus,
    surprise: null,
    skillHyper: null,
    skillTorus: null,
  });

  it('returns null on warm-up (missing z) and rejection (NaN z)', () => {
    expect(stepDisagreement('a', 'b', mkStep(null, 2.0))).toBeNull();
    expect(stepDisagreement('a', 'b', mkStep(2.0, null))).toBeNull();
    expect(stepDisagreement('a', 'b', mkStep(NaN, 2.0))).toBeNull();
    expect(stepDisagreement('a', 'b', mkStep(2.0, NaN))).toBeNull();
  });

  it('classifies a >3.5σ hierarchy hit with phase calm as pami_resonance', () => {
    const r = stepDisagreement('a', 'b', mkStep(5.0, 0.1));
    expect(r).not.toBeNull();
    expect(r!.classification).toBe('pami_resonance');
    expect(r!.pair_a_id).toBe('a');
    expect(r!.pair_b_id).toBe('b');
  });

  it('classifies the mirror image as lineage_drift and both-calm as coherent', () => {
    expect(stepDisagreement('a', 'b', mkStep(0.1, 5.0))!.classification).toBe('lineage_drift');
    expect(stepDisagreement('a', 'b', mkStep(0.1, 0.1))!.classification).toBe('coherent');
  });

  it('end-to-end: a real phase jump lands in the disagreement sink as lineage_drift', async () => {
    const p = new ProductPredictor(2, 1);
    for (let i = 0; i < 60; i++) p.step([0.1, 0.1], [0.05 * i]);
    const jump = p.step([0.1, 0.1], [0.05 * 60 + Math.PI / 2]);
    const report = stepDisagreement('mem-a', 'mem-b', jump);
    expect(report).not.toBeNull();
    // Phase channel took the >3.5σ hit while the hierarchy channel is calm.
    expect(report!.classification).toBe('lineage_drift');

    const { env, disagreements } = fakeEnv();
    expect(await logDisagreements(env, 'u1', [report!])).toBe(1);
    expect(disagreements.length).toBe(1);
    expect(disagreements[0].classification).toBe('lineage_drift');
    expect(disagreements[0].node_a).toBe('mem-a');
    expect(disagreements[0].node_b).toBe('mem-b');
    expect(disagreements[0].torus_distance).toBeGreaterThan(0.7);
    expect(disagreements[0].ball_distance).toBeLessThan(0.2);
  });

  it('coherent reports from calm steps are filtered by the sink, not the bridge', async () => {
    const p = new ProductPredictor(2, 1);
    let calm: ProductPredictStep | null = null;
    for (let i = 0; i < 60; i++) calm = p.step([0.1, 0.1], [0.05 * i]);
    const report = stepDisagreement('mem-a', 'mem-b', calm!);
    expect(report).not.toBeNull(); // the bridge still classifies it…
    expect(report!.classification).toBe('coherent');

    const { env, disagreements } = fakeEnv();
    expect(await logDisagreements(env, 'u1', [report!])).toBe(0); // …the sink drops it
    expect(disagreements.length).toBe(0);
  });
});

// ── constants ─────────────────────────────────────────────────────────────

describe('predict constants', () => {
  it('pins the shared Rust-parity parameters', () => {
    expect(PREDICT_MIN_AR_HISTORY).toBe(6);
  });
});

// ============================================================
// PREDICT — the prediction operator 𝒫  (src/predict.ts)
//
// Port of the Rust harness prediction operator (harness-dhng/src/predict.rs)
// into the worker, byte-for-byte on semantics. Two versions, per the decision
// on record:
//
//   v1 EuclidPredictor  — classical one-step forecasting over flat feature
//                         vectors, blind to the manifold. Residual = L2.
//                         Kept as the baseline/control.
//   v2 ProductPredictor — LIVE. Forecasts on the product manifold ℍⁿ × 𝕋ᵈ:
//                         the hyperbolic factor in the tangent space at the
//                         origin (log₀ → forecast → exp₀, residual = d_H),
//                         the toroidal factor as per-axis wrapped phase
//                         VELOCITY (seam-safe by construction, residual = d_T
//                         with φ-scale weights).
//
// Both share EuclidCore: persistence / EMA / per-dimension AR(2) with
// intercept, best-of selected by running one-step MAE — the honest
// skill-vs-persistence framing of Hyndman & Koehler 2006 (MASE). Residual
// z-scores come from Welford running moments; "surprise" is the max of the
// per-channel z's — precision-weighted prediction error in the sense of
// Rao & Ballard 1999 / Friston 2005, with the running std as the precision.
// The single global chart at the origin (no parallel transport) follows the
// HTGN construction (KDD 2021); circular quantities are handled per
// Fisher & Lee — wrapped differences, never raw ones.
//
// NaN policy (identical to Rust): a non-finite, mis-dimensioned, or
// out-of-ball observation yields a NaN-residual step and is NOT ingested —
// one corrupted frame neither silences surprise nor poisons the forecasts.
//
// The disagreement bridge at the bottom maps per-channel surprise z's into
// [0,1] and hands them to atlas-store's classifier, so a hierarchy-channel
// surprise with phase-channel calm lands in `elle_cognitive_disagreements`
// as what it is.
// ============================================================

import { expMap0, logMap0, norm, poincareDist } from './hyper';
import { norm2pi, phiScaleWeights, torusDist, wrap } from './torus';
import type { Mix } from './product';
import { disagreementReport, type CognitiveDisagreementReport } from './atlas-store';

export const PREDICT_EMA_ALPHA = 0.3;
export const PREDICT_WINDOW = 64;
export const PREDICT_MIN_AR_HISTORY = 6;
export const PREDICT_MIN_Z_COUNT = 3;
export const PREDICT_Z_STD_FLOOR = 1e-9;

export type ForecastMethod = 'persistence' | 'ema' | 'ar2';

// ── Welford running moments (z-score BEFORE ingesting) ────────────────────

export class Welford {
  count = 0;
  mean = 0;
  private m2 = 0;

  // z-score of x against the moments accumulated so far, then ingest it.
  zThenUpdate(x: number): number {
    const z =
      this.count >= PREDICT_MIN_Z_COUNT
        ? (x - this.mean) / Math.max(Math.sqrt(this.m2 / (this.count - 1)), PREDICT_Z_STD_FLOOR)
        : 0;
    this.count += 1;
    const delta = x - this.mean;
    this.mean += delta / this.count;
    this.m2 += delta * (x - this.mean);
    return z;
  }
}

class RunningMae {
  count = 0;
  sumAbs = 0;

  update(absErr: number): void {
    this.count += 1;
    this.sumAbs += absErr;
  }

  mean(): number | null {
    return this.count === 0 ? null : this.sumAbs / this.count;
  }
}

// ── AR forecasts (OLS with intercept, scale-aware singularity guards) ─────

// AR(1)+intercept: the fallback for AR(2)-singular series (a pure ramp makes
// the AR(2) regressors exactly collinear; AR(1) fits ramps exactly).
export function ar1Forecast(series: number[]): number | null {
  const n = series.length;
  if (n < 3) return null;
  const k = n - 1;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let t = 1; t < n; t++) {
    const x = series[t - 1];
    const y = series[t];
    sx += x; sy += y; sxx += x * x; sxy += x * y;
  }
  const det = k * sxx - sx * sx;
  if (Math.abs(det) < 1e-9 * (1 + Math.abs(k * sxx))) return null;
  const p = (k * sxy - sx * sy) / det;
  const c = (sy - p * sx) / k;
  const forecast = c + p * series[n - 1];
  return Number.isFinite(forecast) ? forecast : null;
}

export function ar2Forecast(series: number[]): number | null {
  const n = series.length;
  if (n < PREDICT_MIN_AR_HISTORY) return null;
  // Regression rows: y_t = c + p1*y_{t-1} + p2*y_{t-2}, t = 2..n-1.
  let s1 = 0, s2 = 0, sy = 0, s11 = 0, s12 = 0, s22 = 0, s1y = 0, s2y = 0;
  const m = n - 2;
  for (let t = 2; t < n; t++) {
    const x1 = series[t - 1];
    const x2 = series[t - 2];
    const y = series[t];
    s1 += x1; s2 += x2; sy += y;
    s11 += x1 * x1; s12 += x1 * x2; s22 += x2 * x2;
    s1y += x1 * y; s2y += x2 * y;
  }
  // Normal equations (3x3, symmetric), solved by Cramer's rule:
  // | m    s1   s2  | | c  |   | sy  |
  // | s1   s11  s12 | | p1 | = | s1y |
  // | s2   s12  s22 | | p2 |   | s2y |
  const det = m * (s11 * s22 - s12 * s12) - s1 * (s1 * s22 - s12 * s2) + s2 * (s1 * s12 - s11 * s2);
  // A constant series is singular for AR(1) too and yields null (persistence
  // covers it); a ramp falls through to AR(1), which nails it.
  if (Math.abs(det) < 1e-9 * (1 + Math.abs(m * s11 * s22))) return ar1Forecast(series);
  const detC = sy * (s11 * s22 - s12 * s12) - s1 * (s1y * s22 - s12 * s2y) + s2 * (s1y * s12 - s11 * s2y);
  const detP1 = m * (s1y * s22 - s12 * s2y) - sy * (s1 * s22 - s12 * s2) + s2 * (s1 * s2y - s1y * s2);
  const detP2 = m * (s11 * s2y - s1y * s12) - s1 * (s1 * s2y - s1y * s2) + sy * (s1 * s12 - s11 * s2);
  const c = detC / det;
  const p1 = detP1 / det;
  const p2 = detP2 / det;
  const forecast = c + p1 * series[n - 1] + p2 * series[n - 2];
  return Number.isFinite(forecast) ? forecast : null;
}

// ── EuclidCore: persistence / EMA / AR(2), best-of by running MAE ─────────

export interface PredictOpts {
  alpha?: number;   // EMA smoothing factor in (0, 1]
  window?: number;  // sliding-window capacity for AR fitting
}

class EuclidCore {
  readonly dim: number;
  private readonly alpha: number;
  private readonly windowCap: number;
  private history: number[][] = [];
  private emaLevel: number[] | null = null;
  private maePersistence = new RunningMae();
  private maeEma = new RunningMae();
  private maeAr2 = new RunningMae();

  constructor(dim: number, alpha: number, windowCap: number) {
    this.dim = dim;
    this.alpha = alpha;
    this.windowCap = Math.max(windowCap, PREDICT_MIN_AR_HISTORY);
  }

  private forecastPersistence(): number[] | null {
    return this.history.length ? [...this.history[this.history.length - 1]] : null;
  }

  private forecastEma(): number[] | null {
    return this.emaLevel ? [...this.emaLevel] : null;
  }

  private forecastAr2(): number[] | null {
    if (this.history.length < PREDICT_MIN_AR_HISTORY) return null;
    const out: number[] = [];
    for (let d = 0; d < this.dim; d++) {
      const f = ar2Forecast(this.history.map((v) => v[d]));
      if (f === null) return null;
      out.push(f);
    }
    return out;
  }

  // Lowest running MAE wins; persistence is the honest cold-start default,
  // and strict < keeps earlier methods on ties.
  private choose(): ForecastMethod {
    let best: ForecastMethod = 'persistence';
    let bestMae = this.maePersistence.mean() ?? Infinity;
    const ema = this.maeEma.mean();
    if (ema !== null && ema < bestMae) {
      best = 'ema';
      bestMae = ema;
    }
    const ar2 = this.maeAr2.mean();
    if (ar2 !== null && ar2 < bestMae) best = 'ar2';
    return best;
  }

  private static l2(a: number[], b: number[]): number {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) * (a[i] - b[i]);
    return Math.sqrt(s);
  }

  // Forecast (using only past data), score against obs, THEN ingest it —
  // the ordering is what keeps every MAE an out-of-sample error.
  step(obs: number[]): {
    forecast: number[] | null;
    method: ForecastMethod | null;
    residual: number | null;
    skill: number | null;
  } {
    const method = this.choose();
    const forecast =
      method === 'persistence' ? this.forecastPersistence()
      : method === 'ema' ? this.forecastEma()
      : this.forecastAr2();
    const residual = forecast ? EuclidCore.l2(forecast, obs) : null;

    // Score every candidate method on this observation for future choice.
    const fp = this.forecastPersistence();
    if (fp) this.maePersistence.update(EuclidCore.l2(fp, obs));
    const fe = this.forecastEma();
    if (fe) this.maeEma.update(EuclidCore.l2(fe, obs));
    const fa = this.forecastAr2();
    if (fa) this.maeAr2.update(EuclidCore.l2(fa, obs));

    const p = this.maePersistence.mean();
    const chosenMae =
      method === 'persistence' ? this.maePersistence.mean()
      : method === 'ema' ? this.maeEma.mean()
      : this.maeAr2.mean();
    const skill = p !== null && p > 0 && chosenMae !== null ? chosenMae / p : null;

    // Ingest.
    if (this.emaLevel) {
      for (let i = 0; i < this.emaLevel.length; i++) {
        this.emaLevel[i] = this.alpha * obs[i] + (1 - this.alpha) * this.emaLevel[i];
      }
    } else {
      this.emaLevel = [...obs];
    }
    this.history.push([...obs]);
    if (this.history.length > this.windowCap) this.history.shift();

    return { forecast, method: forecast ? method : null, residual, skill };
  }
}

// ── v1: Euclidean predictor (no DHNG) — the baseline/control ──────────────

export interface PredictStep {
  predicted: number[] | null;              // null during warm-up/rejection
  method: ForecastMethod | null;
  residual: number | null;                 // NaN on rejection
  z: number | null;                        // NaN on rejection
  skillVsPersistence: number | null;       // chosen-MAE / persistence-MAE
}

const rejectedStep = (): PredictStep => ({
  predicted: null,
  method: null,
  residual: Number.NaN,
  z: Number.NaN,
  skillVsPersistence: null,
});

export class EuclidPredictor {
  private core: EuclidCore;
  private welford = new Welford();

  constructor(dim: number, opts: PredictOpts = {}) {
    this.core = new EuclidCore(dim, opts.alpha ?? PREDICT_EMA_ALPHA, opts.window ?? PREDICT_WINDOW);
  }

  step(obs: number[]): PredictStep {
    if (obs.length !== this.core.dim || obs.some((x) => !Number.isFinite(x))) {
      return rejectedStep();
    }
    const { forecast, method, residual, skill } = this.core.step(obs);
    if (residual === null) {
      return { predicted: forecast, method, residual: null, z: null, skillVsPersistence: null };
    }
    return {
      predicted: forecast,
      method,
      residual,
      z: this.welford.zThenUpdate(residual),
      skillVsPersistence: skill,
    };
  }
}

// ── v2: product-manifold predictor (DHNG-aware) — LIVE ────────────────────

export interface ProductPredictStep {
  predictedBall: number[] | null;    // forecast in the Poincaré ball
  predictedPhases: number[] | null;  // forecast phases in [0, 2π)
  residualHyper: number | null;      // d_H(predicted, observed); NaN on reject
  residualTorus: number | null;      // d_T, φ-weighted; NaN on reject
  residualProduct: number | null;    // sqrt(w_h·d_H² + w_t·d_T²); NaN on reject
  zHyper: number | null;
  zTorus: number | null;
  surprise: number | null;           // max of the component z's (shared scale)
  skillHyper: number | null;
  skillTorus: number | null;
}

const rejectedProductStep = (): ProductPredictStep => ({
  predictedBall: null,
  predictedPhases: null,
  residualHyper: Number.NaN,
  residualTorus: Number.NaN,
  residualProduct: Number.NaN,
  zHyper: Number.NaN,
  zTorus: Number.NaN,
  surprise: Number.NaN,
  skillHyper: null,
  skillTorus: null,
});

export class ProductPredictor {
  private readonly hyperDim: number;
  private readonly torusDim: number;
  private readonly mix: Mix;
  private readonly torusWeights: number[];
  private tangentCore: EuclidCore;   // over tangent-space coordinates at 0
  private velocityCore: EuclidCore;  // over per-axis wrapped phase velocities
  private lastPhases: number[] | null = null;
  private welfordHyper = new Welford();
  private welfordTorus = new Welford();

  constructor(hyperDim: number, torusDim: number, mix?: Mix, opts: PredictOpts = {}) {
    this.hyperDim = hyperDim;
    this.torusDim = torusDim;
    this.mix = mix ?? { hyperbolic: 1, toroidal: 1 };
    this.torusWeights = phiScaleWeights(torusDim);
    const alpha = opts.alpha ?? PREDICT_EMA_ALPHA;
    const window = opts.window ?? PREDICT_WINDOW;
    this.tangentCore = new EuclidCore(hyperDim, alpha, window);
    this.velocityCore = new EuclidCore(torusDim, alpha, window);
  }

  // Feed one observed point (ball coordinates, phases in radians).
  step(ball: number[], phases: number[]): ProductPredictStep {
    const bad =
      ball.length !== this.hyperDim ||
      phases.length !== this.torusDim ||
      ball.some((x) => !Number.isFinite(x)) ||
      phases.some((x) => !Number.isFinite(x)) ||
      norm(ball) >= 1.0;
    if (bad) return rejectedProductStep();

    // Hyperbolic factor: log to the origin tangent space, forecast there,
    // exp back, measure with d_H — a jump that is metrically large near the
    // boundary registers as large even when its coordinate displacement is tiny.
    const tangentObs = logMap0(ball);
    const tangent = this.tangentCore.step(tangentObs);
    const predictedBall = tangent.forecast ? expMap0(tangent.forecast) : null;
    const residualHyper = predictedBall ? poincareDist(predictedBall, ball) : null;
    const skillHyper = tangent.skill;

    // Toroidal factor: forecast wrapped per-axis velocity, advance, rewrap —
    // a trajectory crossing the 0/2π seam produces no spurious residual tear.
    const wrapped = phases.map(norm2pi);
    let predictedPhases: number[] | null = null;
    let skillTorus: number | null = null;
    if (this.lastPhases) {
      const last = this.lastPhases;
      const velocity = wrapped.map((cur, j) => wrap(cur - last[j]));
      const vel = this.velocityCore.step(velocity);
      if (vel.forecast) {
        const vf = vel.forecast;
        predictedPhases = last.map((prev, j) => norm2pi(prev + vf[j]));
      }
      skillTorus = vel.skill;
    }
    const residualTorus = predictedPhases ? torusDist(predictedPhases, wrapped, this.torusWeights) : null;
    this.lastPhases = wrapped;

    const residualProduct =
      residualHyper !== null && residualTorus !== null
        ? Math.sqrt(this.mix.hyperbolic * residualHyper * residualHyper + this.mix.toroidal * residualTorus * residualTorus)
        : null;
    const zHyper = residualHyper !== null ? this.welfordHyper.zThenUpdate(residualHyper) : null;
    const zTorus = residualTorus !== null ? this.welfordTorus.zThenUpdate(residualTorus) : null;
    const surprise =
      zHyper !== null && zTorus !== null ? Math.max(zHyper, zTorus)
      : zHyper !== null ? zHyper
      : zTorus;

    return {
      predictedBall,
      predictedPhases,
      residualHyper,
      residualTorus,
      residualProduct,
      zHyper,
      zTorus,
      surprise,
      skillHyper,
      skillTorus,
    };
  }
}

// ── the disagreement bridge: surprise z's → atlas-store's classifier ──────
//
// classifyDisagreement wants both channels in [0,1] with T_NEAR = 0.20 and
// T_FAR = 0.70. A z-score is unbounded, so we squash it with the rational
// map z / (z + Z_HALF), monotone and bounded, negative z clamped to 0 (a
// better-than-expected step is simply "near"). With Z_HALF = 1.5 the
// classifier's bands land on honest sigma levels:
//
//   unit > 0.70  ⇔  z > 3.5   (a genuine >3.5σ surprise — "far")
//   unit < 0.20  ⇔  z < 0.375 (well inside the noise floor — "near")
//
// So pami_resonance = phase channel calm while the hierarchy channel takes a
// >3.5σ hit, lineage_drift the mirror image, coherent (both calm) is never
// logged, and everything in between is orthogonal. No re-tuning of the
// classifier's thresholds — the squash is chosen so σ-semantics land inside
// the distance-calibrated bands.

export const SURPRISE_Z_HALF = 1.5;

// Map a surprise z-score into [0,1]. NaN stays NaN (rejected steps never
// reach the classifier); negative z clamps to 0.
export function surpriseToUnit(z: number): number {
  if (Number.isNaN(z)) return Number.NaN;
  const zz = Math.max(0, z);
  return zz / (zz + SURPRISE_Z_HALF);
}

// One prediction step → one classified disagreement report, or null when the
// step cannot honestly be classified (warm-up or rejection: either channel's
// z missing or NaN). Feed the result to atlas-store's logDisagreements —
// 'coherent' reports are filtered there, not here, so callers can still see
// the classification if they want it.
export function stepDisagreement(
  pairAId: string,
  pairBId: string,
  step: ProductPredictStep,
): CognitiveDisagreementReport | null {
  const { zHyper, zTorus } = step;
  if (zHyper === null || zTorus === null || Number.isNaN(zHyper) || Number.isNaN(zTorus)) return null;
  return disagreementReport(pairAId, pairBId, surpriseToUnit(zHyper), surpriseToUnit(zTorus));
}

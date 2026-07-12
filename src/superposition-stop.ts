// ============================================================
// SUPERPOSITION STOP — src/superposition-stop.ts  —  SHADOW / NOT VALIDATED
//
// The collapse-half that pairs with the superposition HOLD valve (holding.ts,
// in the workbench repo). Holds a position/thesis in superposition until the
// signal genuinely resolves, then collapses — or hits the hard floor.
//
// HARD RULES (the whole point):
//   RULE 0  The price-space hard stop lives OUTSIDE κ and fires FIRST, always.
//           κ decides direction and size INSIDE the risk envelope; it never
//           widens it. A mis-specified information-space loss can hold a loser
//           while feeling coherent — the dumb outer floor is what saves you.
//   SIGNED  κ here MUST be coherence with the ANCHORED GROUND (substrate-to-
//           constraint-network / thesis-vs-realized-price), rising = toward the
//           thesis. NOT the lexical stub, NOT substrate-to-substrate coherence
//           (which is the CRASH signal, opposite sign).
//   REGIME  Collapse-on-adverse is only valid in a momentum/trending regime.
//           In mean-reversion, adverse movement is signal, not stop.
//
// STATUS: SHADOW. Nothing imports this. It returns a decision object; no caller
// acts on it. It must not size a real order until κ clears the validation gate
// (G1 shuffled-control + G2 ground-truth) and is backtested against ATR /
// Kaminski–Lo baselines net of costs. Until then it logs what it WOULD do.
// ============================================================

import { velocityAt, accelerationAt } from './kappa-dynamics';

export type Posture = 'SUPERPOSITION' | 'LONG' | 'SHORT' | 'FLAT';
export type Regime = 'momentum' | 'meanrev' | 'unknown';

export interface StopConfig {
  kHigh: number;        // thesis-coherent floor to collapse toward a direction (e.g. 0.65)
  kLow: number;         // de-phasing ceiling (e.g. 0.35)
  minTrend: number;     // consecutive same-sign κ-velocity steps required (e.g. 2)
  maxHoldSteps: number; // superposition observation budget before resolving to FLAT (e.g. 8)
  hardStopR: number;    // RULE 0: absolute loss in risk-units, overrides everything (e.g. 1.0)
  thetaBudget: number;  // RULE 0: max fraction of premium bled while holding (e.g. 0.30)
  accelAlarm: number;   // |2nd difference| that flags a regime shift and speeds collapse (e.g. 0.15)
}

export const DEFAULT_STOP_CONFIG: StopConfig = {
  kHigh: 0.65, kLow: 0.35, minTrend: 2, maxHoldSteps: 8,
  hardStopR: 1.0, thetaBudget: 0.30, accelAlarm: 0.15,
};

export interface StopDecision {
  action: 'HOLD' | 'COLLAPSE' | 'HARD_STOP';
  to: Posture;
  reason: string;
  shadow: true; // this decision is advisory only until κ is validated
}

// true if the last `n` first-differences of the series share `sign` (+1/-1).
function sustained(series: number[], sign: 1 | -1, n: number): boolean {
  let count = 0;
  for (let i = series.length - 1; i >= 1 && count < n; i--) {
    const d = series[i] - series[i - 1];
    if (Math.sign(d) === sign) count++; else break;
  }
  return count >= n;
}

// Advisory decision for the current step. Pure; no I/O. `kSeries` is this
// position's κ history oldest→newest (coherence with the anchored ground).
export function superpositionStop(
  posture: Posture,
  kSeries: number[],
  stepsHeld: number,
  unrealizedR: number,
  thetaBledFrac: number,
  regime: Regime = 'unknown',
  cfg: StopConfig = DEFAULT_STOP_CONFIG,
): StopDecision {
  // ── RULE 0 — checked FIRST, outside κ, non-negotiable ──
  if (unrealizedR <= -cfg.hardStopR)
    return { action: 'HARD_STOP', to: 'FLAT', reason: `RULE0: risk-unit floor hit (${unrealizedR.toFixed(2)}R)`, shadow: true };
  if (thetaBledFrac >= cfg.thetaBudget)
    return { action: 'HARD_STOP', to: 'FLAT', reason: `RULE0: theta budget spent (${(thetaBledFrac * 100).toFixed(0)}%)`, shadow: true };

  const i = kSeries.length - 1;
  if (i < 0) return { action: 'HOLD', to: posture, reason: 'no κ yet', shadow: true };
  const k = kSeries[i];
  const a = accelerationAt(kSeries, i);              // 2nd difference; null until ≥3 pts
  const regimeShift = a !== null && Math.abs(a) >= cfg.accelAlarm;
  const upTrend = sustained(kSeries, 1, cfg.minTrend) || (regimeShift && (velocityAt(kSeries, i) ?? 0) > 0);
  const downTrend = sustained(kSeries, -1, cfg.minTrend) || (regimeShift && (velocityAt(kSeries, i) ?? 0) < 0);

  if (posture === 'SUPERPOSITION') {
    if (stepsHeld >= cfg.maxHoldSteps && k > cfg.kLow && k < cfg.kHigh)
      return { action: 'COLLAPSE', to: 'FLAT', reason: 'observation window elapsed, unresolved → cash', shadow: true };
    if (k >= cfg.kHigh && upTrend)
      return { action: 'COLLAPSE', to: 'LONG', reason: `coherence locked long${regimeShift ? ' (accel alarm)' : ''}`, shadow: true };
    // adverse collapse only in a momentum regime; in mean-reversion adverse = signal
    if (k <= cfg.kLow && downTrend && regime !== 'meanrev')
      return { action: 'COLLAPSE', to: 'SHORT', reason: `coherence locked short${regimeShift ? ' (accel alarm)' : ''}`, shadow: true };
    return { action: 'HOLD', to: 'SUPERPOSITION', reason: 'ambiguous — keep both legs', shadow: true };
  }

  // Already directional: κ decaying against the thesis with sustained velocity = de-phasing.
  // Only acts as a trailing stop in a momentum regime (mean-rev: hold/add is the play).
  const against =
    regime !== 'meanrev' &&
    ((posture === 'LONG' && k < cfg.kLow && downTrend) ||
     (posture === 'SHORT' && k > cfg.kHigh && upTrend));
  if (against)
    return { action: 'COLLAPSE', to: 'FLAT', reason: `thesis de-phased — κ trailing stop${regimeShift ? ' (accel alarm)' : ''}`, shadow: true };
  return { action: 'HOLD', to: posture, reason: 'thesis still coherent', shadow: true };
}

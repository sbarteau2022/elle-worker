// ============================================================
// κ DYNAMICS — shared finite-difference module (dt = 1 STEP)
//
// One module, imported by BOTH the chat path (src/kappa-turn.ts → index.ts /
// router.ts) and the journal generation path (src/journal.ts), so the math is
// IDENTICAL in both places. A "step" is one chat turn (chat) or one journal
// entry (journal).
//
// HARD RULE: there is NO wall-clock time anywhere in here. Derivatives were
// previously Δκ/dt with dt in seconds (~86,400), which made velocity and
// acceleration structurally ~0 — a unit bug. Everything below differences a
// plain ordered κ series with dt = 1.
//
//   velocity     = κₙ − κₙ₋₁                       (1st difference, needs ≥2 pts)
//   acceleration = κₙ − 2κₙ₋₁ + κₙ₋₂               (2nd difference, needs ≥3 pts)
//   jerk         = κₙ − 3κₙ₋₁ + 3κₙ₋₂ − κₙ₋₃       (3rd difference, needs ≥4 pts)
//   reserve (∫)  = Σκ                              (per-step sum, dt=1; DISPLAY ONLY)
//
// null ≠ 0. A derivative is `null` when there are not enough prior points to
// form it; it is `0` only when the real difference is zero. The two mean
// different things (insufficient data vs. a genuinely flat series) and callers
// rely on the distinction — never coerce null→0 in this module.
// ============================================================

export interface KappaPoint {
  step_index: number;
  kappa: number;
  velocity: number | null;        // 1st difference
  acceleration: number | null;    // 2nd difference
  jerk: number | null;            // 3rd difference
  reserve: number;                // Σκ (display-only; never fed into a derivative)
  input_perturbation: number | null; // how much the input shifted (see kappa-turn.ts)
}

// 6-dp rounding keeps stored/displayed values stable without affecting the
// null/zero distinction (0.013000000000000012 → 0.013, exact 0 stays 0).
const r6 = (x: number): number => Number(x.toFixed(6));

// ── finite differences, dt = 1 ───────────────────────────────
// Each takes the full ordered series and the index to evaluate at. Returns null
// when index i does not have enough prior points for that order.
export function velocityAt(series: number[], i: number): number | null {
  if (i < 1 || i >= series.length) return null;
  return r6(series[i] - series[i - 1]);
}

export function accelerationAt(series: number[], i: number): number | null {
  if (i < 2 || i >= series.length) return null;
  return r6(series[i] - 2 * series[i - 1] + series[i - 2]);
}

export function jerkAt(series: number[], i: number): number | null {
  if (i < 3 || i >= series.length) return null;
  return r6(series[i] - 3 * series[i - 1] + 3 * series[i - 2] - series[i - 3]);
}

// reserve = running Σκ up to and including index i. dt = 1, so it is a plain
// sum — NOT a wall-clock-weighted trapezoid. Display-only.
export function reserveAt(series: number[], i: number): number {
  let sum = 0;
  for (let k = 0; k <= i && k < series.length; k++) sum += series[k];
  return r6(sum);
}

// One point for the newest step in a series. `inputPerturbation` is supplied by
// the caller (it needs embeddings, which live in the worker, not here).
export function latestPoint(series: number[], inputPerturbation: number | null = null): KappaPoint {
  const i = series.length - 1;
  return {
    step_index: i,
    kappa: r6(series[i]),
    velocity: velocityAt(series, i),
    acceleration: accelerationAt(series, i),
    jerk: jerkAt(series, i),
    reserve: reserveAt(series, i),
    input_perturbation: inputPerturbation,
  };
}

// Every point of a series. Used by the journal backfill and the unit tests.
export function computeSeries(kappas: number[], perturbations?: (number | null)[]): KappaPoint[] {
  return kappas.map((_k, i) => ({
    step_index: i,
    kappa: r6(kappas[i]),
    velocity: velocityAt(kappas, i),
    acceleration: accelerationAt(kappas, i),
    jerk: jerkAt(kappas, i),
    reserve: reserveAt(kappas, i),
    input_perturbation: perturbations?.[i] ?? null,
  }));
}

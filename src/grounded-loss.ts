// ============================================================
// GROUNDED LOSS — src/grounded-loss.ts  —  SHADOW / SCAFFOLD / NOT VALIDATED
//
// The LQR-shaped alignment/exit loss, captured as real code so the design is
// not lost. It is a SCAFFOLD: the one thing that makes it honest — the external
// ANCHOR — does not exist yet, so it is injected as a dependency. Until a real
// anchor is supplied (verified human testimony aggregate / realized outcomes,
// i.e. Factor 3), this integrates whatever you feed it, and if you feed it the
// lexical-κ stub it will faithfully, uselessly regulate toward the stub.
//
// THE WHOLE POINT, in one line: this machinery is an optimally efficient
// regulator toward WHATEVER you point it at. Point `groundDeviation` at an
// outside it cannot recruit → truth-tracker. Point it at internal coherence →
// an efficient cage. The anchor is the only decision the math cannot make.
//
// Three terms (see synthesis: residual + integral + control-effort):
//   residual (innovation)   — the part of state the known modes can't explain;
//                             the ONLY informative part. Supplied per step.
//   standing-by cost (∫)    — leaky integral of SIGNED deviation-from-ground.
//                             Duration lives here, NOT in a higher derivative.
//                             Leak rate = the forgiving(bounded) vs coercive
//                             (unbounded) choice — set it on purpose.
//   control effort (D/LQR)  — cost of correcting fast (∝ acceleration ∝ energy).
// STATUS: SHADOW. Nothing imports this. Do not drive anything on its output.
// ============================================================

export interface GroundedLossConfig {
  rho: number;        // leak on the standing-by integral. small = long memory / bounded (holding.ts uses 0.02)
  wIntegral: number;  // weight on the accumulated signed deviation (the “standing idly by” cost)
  wEffort: number;    // weight on control effort (penalizes thrashing / over-correction)
  bounded: boolean;   // true: expm1 bound (≤ e−1, forgiving) — false: raw integral (unbounded, coercive)
}

export const DEFAULT_LOSS_CONFIG: GroundedLossConfig = {
  rho: 0.02, wIntegral: 1.0, wEffort: 0.5, bounded: true,
};

export interface GroundedLossState {
  step: number;
  driftSigned: number;   // leaky-integrated SIGNED deviation from the anchored ground
  loss: number | null;   // combined loss; null until an effort term can form
}

// `groundDeviation(step)` MUST come from the external anchor: signed distance
// of the substrate from the constraint-network ground at this step
// (positive = away from ground, negative = toward it). This is the injection
// seam. Wiring the lexical-κ stub here is exactly the mistake the header warns
// about — it is left to the caller precisely so the anchor is a visible,
// deliberate choice and never a silent default.
export function createGroundedLoss(
  groundDeviation: (step: number) => number,
  cfg: GroundedLossConfig = DEFAULT_LOSS_CONFIG,
) {
  let step = 0;
  let driftSigned = 0;
  let prevDeviation = 0;

  return {
    observe(): GroundedLossState {
      const dev = groundDeviation(step);            // signed: + away from ground, - toward it
      // Reward motion TOWARD the ground, penalize motion away: signed integral.
      driftSigned = (1 - cfg.rho) * driftSigned + dev;
      // Control effort ≈ |change in deviation| (discrete 1st diff; the LQR effort term).
      const effort = step > 0 ? Math.abs(dev - prevDeviation) : 0;
      prevDeviation = dev;

      // Standing-by cost: only the ABOVE-ground (positive) accumulation is penalized;
      // being toward the ground is not a cost. Bounded (expm1) or raw per config.
      const above = Math.max(0, driftSigned);
      const standingBy = cfg.bounded ? Math.expm1(cfg.rho * above) : cfg.rho * above;

      const loss = step > 0
        ? cfg.wIntegral * standingBy + cfg.wEffort * effort
        : null; // need ≥2 steps for an effort term (null ≠ 0)

      step++;
      return { step: step - 1, driftSigned: Number(driftSigned.toFixed(6)), loss: loss === null ? null : Number(loss.toFixed(6)) };
    },
  };
}

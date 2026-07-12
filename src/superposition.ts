// ============================================================
// SUPERPOSITION — src/superposition.ts  —  SHADOW / NOT VALIDATED
//
// ONE superposition model. Replaces the two that were fighting:
//   - holding.ts (workbench) integrates |velocity| into a bounded loss (HOLD strain).
//   - the earlier grounded-loss.ts / superposition-stop.ts re-integrated the SAME
//     κ stream with DIFFERENT math — two integrators that drift apart.
// This is the single source of truth. Its valve math is IDENTICAL to holding.ts
// (Stewart's λ=ρ bounded-loss valve), so the two agree BY CONSTRUCTION instead of
// competing. It ADDS only what the collapse-half needs — a net-direction integral
// and the RULE-0 decision — DERIVED from the same valve, never a second integrator.
//
// holding.ts (workbench) is left untouched (it feeds KappaHeader). Because the
// formulas here are its formulas, there is no fight. Full de-duplication (holding.ts
// importing a shared module) is a later refactor; identical math holds the line now.
//
// STATUS: SHADOW. Nothing imports this. NOT VALIDATED. Requires anchored κ
// (substrate-to-constraint-network, post-G2), not the lexical stub. `driftSigned`
// is the net direction of κ only — it is NOT an external anchor; the real ground
// (Factor-3 testimony / realized outcome) must still be supplied before any of
// this drives a decision.
// ============================================================

// ── the valve — mirrors holding.ts EXACTLY (Stewart's design) ──
export const RHO_DEFAULT = 0.02;
const QUIESCENT_TENSION = 0.05;
const STRAINED_LOSS = 0.25;
const clamp01 = (x: number) => Math.min(Math.abs(x), 1);
const clampSigned = (x: number) => Math.max(-1, Math.min(1, x));

export type HoldingStatus = 'quiescent' | 'holding' | 'strained';

export interface SuperpositionInput {
  kappa: number;
  velocity: number | null;
  input_perturbation: number | null;
}

export interface SuperpositionState {
  turn: number;
  tension: number;        // T_k = (1−ρ)T + |input_perturbation|  (holding.ts)
  drift: number;          // D_k = (1−ρ)D + |velocity|          (holding.ts, unsigned strain)
  driftSigned: number;    // (1−ρ)· + signed velocity            (NEW; net direction, anchor-free)
  loss: number | null;    // expm1(ρ·D) ∈ [0, e−1)               (holding.ts bounded loss)
  rho: number;
  status: HoldingStatus;
}

export type Posture = 'SUPERPOSITION' | 'LONG' | 'SHORT' | 'FLAT';
export type Regime = 'momentum' | 'meanrev' | 'unknown';

export interface CollapseConfig {
  minTrend: number;      // |driftSigned| proxy for a sustained net trend
  maxHoldSteps: number;  // superposition observation budget → FLAT if unresolved
  hardStopR: number;     // RULE 0: absolute loss in risk-units
  thetaBudget: number;   // RULE 0: max fraction of premium bled while holding
}
export const DEFAULT_COLLAPSE: CollapseConfig = {
  minTrend: 2, maxHoldSteps: 8, hardStopR: 1.0, thetaBudget: 0.30,
};

export interface CollapseDecision {
  action: 'HOLD' | 'COLLAPSE' | 'HARD_STOP';
  to: Posture;
  reason: string;
  shadow: true; // advisory only until κ is validated
}

export function createSuperposition(rho: number = RHO_DEFAULT) {
  let turn = 0, tension = 0, drift = 0, driftSigned = 0, loss: number | null = null;

  const state = (): SuperpositionState => ({
    turn, tension, drift, driftSigned, loss, rho,
    status:
      loss !== null && loss > STRAINED_LOSS ? 'strained'
      : tension < QUIESCENT_TENSION ? 'quiescent'
      : 'holding',
  });

  return {
    // One step lands: feed the valve (identical to holding.ts) + the signed integral.
    observe(inp: SuperpositionInput): SuperpositionState {
      turn++;
      tension = (1 - rho) * tension + clamp01(inp.input_perturbation ?? 0);
      if (inp.velocity !== null && inp.velocity !== undefined && !Number.isNaN(inp.velocity)) {
        drift = (1 - rho) * drift + clamp01(inp.velocity);
        driftSigned = (1 - rho) * driftSigned + clampSigned(inp.velocity);
        loss = Math.expm1(rho * drift);
      }
      return state();
    },
    state,

    // Collapse decision DERIVED from the same valve — no second integrator.
    // RULE 0 (price-space hard floor) is checked first and lives OUTSIDE κ.
    decideCollapse(
      posture: Posture, stepsHeld: number, unrealizedR: number, thetaBledFrac: number,
      regime: Regime = 'unknown', cfg: CollapseConfig = DEFAULT_COLLAPSE,
    ): CollapseDecision {
      if (unrealizedR <= -cfg.hardStopR)
        return { action: 'HARD_STOP', to: 'FLAT', reason: `RULE0: risk floor (${unrealizedR.toFixed(2)}R)`, shadow: true };
      if (thetaBledFrac >= cfg.thetaBudget)
        return { action: 'HARD_STOP', to: 'FLAT', reason: 'RULE0: theta budget spent', shadow: true };

      const s = state();
      const dir = s.driftSigned;                       // net direction of κ motion
      const resolved = s.status === 'strained';        // the valve says the hold is slipping
      const trending = Math.abs(dir) >= cfg.minTrend;   // sustained net drift

      if (posture === 'SUPERPOSITION') {
        if (stepsHeld >= cfg.maxHoldSteps && !resolved)
          return { action: 'COLLAPSE', to: 'FLAT', reason: 'window elapsed, unresolved → cash', shadow: true };
        if (resolved && trending && dir > 0)
          return { action: 'COLLAPSE', to: 'LONG', reason: 'valve strained, net-coherent up', shadow: true };
        if (resolved && trending && dir < 0 && regime !== 'meanrev')
          return { action: 'COLLAPSE', to: 'SHORT', reason: 'valve strained, net-coherent down', shadow: true };
        return { action: 'HOLD', to: 'SUPERPOSITION', reason: 'ambiguous — keep both legs', shadow: true };
      }

      // Directional: valve strained AGAINST the thesis = de-phasing → flat (momentum only).
      const against = regime !== 'meanrev' && resolved &&
        ((posture === 'LONG' && dir < 0) || (posture === 'SHORT' && dir > 0));
      if (against)
        return { action: 'COLLAPSE', to: 'FLAT', reason: 'thesis de-phased — trailing stop', shadow: true };
      return { action: 'HOLD', to: posture, reason: 'thesis still coherent', shadow: true };
    },
  };
}

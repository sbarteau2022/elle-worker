// ============================================================
// RECOVERY REGULATOR — src/recovery.ts  —  SHADOW / NOT VALIDATED
//
// The recursive recovery regulator: the recovery-side companion to
// superposition.ts's collapse logic. Where the holding valve prices STRAIN
// (how hard the hold is slipping), this regulates how fast TRUST REBUILDS
// after strain — with φ, the golden ratio, as the regulator coefficient.
//
// φ is not chosen here; it falls out of the formulation. Define recovery as
// a genuinely recursive process — this step's recovered state built from the
// last TWO recovered states with no free parameters:
//
//   R_k = R_{k-1} + R_{k-2}          (the Fibonacci recurrence)
//
// Its characteristic equation x² = x + 1 has positive root φ = (1+√5)/2 —
// the unique positive number satisfying φ = 1 + 1/φ, a coefficient literally
// defined in terms of its own reciprocal. Raw Fibonacci explodes (that is
// its job: it is a growth law, and a coherence value must live in [0,1]).
// The fix is NOT to drop the two-term structure — collapsing to the
// first-order form κ_k = 1 − φ⁻¹(1−κ_{k-1}) assumes the transient mode is
// already zero (it sets B = 0 in D_k = A·φ^k + B·φ'^k), which forgets
// exactly the one-tick-vs-sustained distinction two-term memory exists to
// keep. Instead, renormalize the recurrence by its own growth: with
// d_k = D_k / φ^k,
//
//   d_k = φ⁻¹·d_{k-1} + φ⁻²·d_{k-2}      and      φ⁻¹ + φ⁻² = 1
//
// — a CONVEX COMBINATION of the last two states. That is the whole trick:
//   · genuinely two-term (a single wild tick is weighted 0.618 against what
//     the state before it still remembers, not allowed to overwrite it),
//   · bounded in [0,1] BY CONSTRUCTION — a convex blend of numbers in [0,1]
//     cannot leave [0,1]; no Math.max/Math.min clamps anywhere in the
//     update path (a formula that needs clamps is usually confessing it
//     isn't naturally self-bounding),
//   · O(1): two stored floats.
//
// The blend is the MEMORY; the direction of the step is the INPUT:
//
//   m_k        = φ⁻¹·κ_{k-1} + φ⁻²·κ_{k-2}          (memory blend, ∈ [0,1])
//   strain:      κ_k = φ⁻¹ · m_k                     (decay the blend toward 0)
//   recovery:    κ_k = 1 − φ⁻¹·(1 − m_k)             (decay the blend's DEFICIT toward 1)
//
// Strain and recovery are the same φ⁻¹ contraction read in opposite
// directions — the same duality already live in graph.ts, where
// RETENTION_BASE = φ and edge weight retains φ⁻ⁿ per idle cycle. One
// constant, one law, two directions. (Deliberately self-contained rather
// than importing graph.ts: SHADOW modules carry no dependencies, per the
// superposition.ts precedent; the test asserts the constants agree.)
//
// What the two-term memory actually buys, made falsifiable in the test:
// after a long strain the FIRST confirming tick still lifts κ (both stored
// states are low, so the blend is low — no formula can distinguish tick 1 of
// a real recovery from tick 1 of a fake one; nothing has happened yet to
// distinguish them). The difference is everything after: a fake-out unwinds
// FASTER (κ_{k-2} still remembers the crash and drags the blend back down)
// and a real recovery climbs SLOWER (each step blends against the lower
// prior state — trust is earned across consecutive confirmations, ~7-8
// ticks to 0.9 from a wipeout vs ~5 for the first-order form).
//
// STATUS: SHADOW. Nothing imports this. NOT VALIDATED. What one "step"
// means (tick / bar / decision cycle) is deliberately NOT fixed here — the
// φ⁻¹ contraction is per-step, so cadence changes the effective half-life
// (~1.44 steps), and that choice must be made consciously at the call site,
// not inherited (the exact unit-bug class kappa-dynamics.ts's header
// documents). Like superposition.ts: advisory shape only until wired
// through RULE-0 and validated against real series.
// ============================================================

// φ and its powers. W2 is defined as 1 − W1 (not φ⁻² independently) so the
// convex weights sum to EXACTLY 1 in floating point — the boundedness
// argument then holds in float arithmetic, not just in ℝ. (In exact math
// they are the same number: φ⁻² = 1 − φ⁻¹.)
export const PHI = (1 + Math.sqrt(5)) / 2;
export const W1 = 1 / PHI;        // φ⁻¹ ≈ 0.618… — weight on κ_{k-1}
export const W2 = 1 - W1;         // φ⁻² ≈ 0.382… — weight on κ_{k-2}

export type RecoveryDirection = 'strain' | 'recover';

export interface RecoveryState {
  step: number;
  kappa: number;      // κ_{k-1} — the current coherence, ∈ [0,1]
  kappaPrev: number;  // κ_{k-2} — one step older, ∈ [0,1]
  blend: number;      // m_k that the NEXT step will contract, ∈ [0,1]
}

// ── pure core ────────────────────────────────────────────────

// The two-term memory blend — the renormalized Fibonacci recurrence.
export function memoryBlend(kappa: number, kappaPrev: number): number {
  return W1 * kappa + W2 * kappaPrev;
}

// One strain step: contract the blend toward 0. Range: [0, φ⁻¹] ⊂ [0,1].
export function strainStep(kappa: number, kappaPrev: number): number {
  return W1 * memoryBlend(kappa, kappaPrev);
}

// One recovery step: contract the blend's deficit toward 1.
// Range: [1−φ⁻¹, 1] = [φ⁻², 1] ⊂ [0,1].
export function recoverStep(kappa: number, kappaPrev: number): number {
  return 1 - W1 * (1 - memoryBlend(kappa, kappaPrev));
}

export function stepKappa(kappa: number, kappaPrev: number, dir: RecoveryDirection): number {
  return dir === 'strain' ? strainStep(kappa, kappaPrev) : recoverStep(kappa, kappaPrev);
}

// ── the regulator (two floats of state, O(1) per step) ───────
// Starts at 0/0 by default: no conviction until earned — the conservative
// initial condition for anything that might one day size a position.
export function createRecoveryRegulator(initialKappa = 0, initialPrev = initialKappa) {
  let step = 0;
  let kappa = Math.min(1, Math.max(0, initialKappa));   // sanitize INPUT once;
  let kappaPrev = Math.min(1, Math.max(0, initialPrev)); // the update path itself never clamps
  const state = (): RecoveryState => ({ step, kappa, kappaPrev, blend: memoryBlend(kappa, kappaPrev) });
  return {
    observe(dir: RecoveryDirection): RecoveryState {
      step++;
      const next = stepKappa(kappa, kappaPrev, dir);
      kappaPrev = kappa;
      kappa = next;
      return state();
    },
    state,
  };
}

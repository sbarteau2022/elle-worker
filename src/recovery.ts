// ============================================================
// RECOVERY REGULATOR — src/recovery.ts
//
// STATUS: PROMOTED. Built in. The asymmetric regulator below is the live
// conviction channel (src/conviction.ts → src/trading.ts): it observes every
// open position on the trading cron and its κ is surfaced to the decision
// loop; order-touching enforcement stays behind ELLE_CONVICTION_ENFORCE.
// Promotion earned by measurement, not narration — the validation trail is
// docs/RECOVERY_VS_ATR_REAL.md → RECOVERY_OVERLAY_REAL.md → WITNESS_GATES.md
// (5yr real OHLC, 591 paired envelopes; measured identity: drawdown-shaper —
// cheapest-to-run left-tail control in the series, NOT an alpha source).
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
// (The two-term κ forms below remain advisory-shape instruments; the
// PROMOTED live channel is the asymmetric log-odds regulator further down.)
//
// THE STEP, now fixed (it was deliberately open in the first cut): one step
// is one observation on the ρ = 0.02 cadence — the leak-rate floor, the 2%
// that sits just below the noise floor (holding.ts: the RLS forgetting
// factor optimal when drift is 2% of noise scale per turn, Muth 1960). What
// makes a step WELL-FORMED is an invariant, not a unit: a single step's
// perturbation — even maximal — must not be able to collapse the function
// across its threshold; thresholds are reached by ACCUMULATION only.
// Proven against the real modules in step-invariant.test.ts, with exact
// minima: 13 consecutive worst-case steps to strain the ρ=0.02 valve from
// rest (one step reaches 8% of threshold), 3 for the ρ=0.10 fast valve
// (worst-case floor under PT-II's measured 5), 4 consecutive strains from
// neutral / 6 from full conviction to cross this regulator's 0.15 floor
// (single-step collapse impossible from any κ ≥ 0.15·φ ≈ 0.243) — and the
// mirror in recovery: one confirming step from a wipeout restores only
// φ⁻² ≈ 0.382, never absolution in one blow. The invariant's knee sits at
// ρ ≈ 0.223 (where one maximal step CAN strain) — the 2% floor carries 11×
// slack, the fast valve better than 2×. Like superposition.ts: advisory
// shape only until wired through RULE-0 and validated against real series.
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

// ── perturbation-weighted step ───────────────────────────────
// The binary step treats a 0.3·ATR red tick and a crash bar identically —
// the magnitude channel (input_perturbation, in the valve's vocabulary) was
// discarded, patched over by an arbitrary dead-band at the call site. This
// puts the perturbation INTO the step: w ∈ [0,1] is how much of the full
// φ⁻¹ contraction this observation earns.
//
//   κ_next = (1−w)·m + w·target(dir)
//
//   w = 1  →  exactly the binary step (the worst case — so every minimum
//             proven in step-invariant.test.ts still holds as the floor:
//             no single perturbation, even maximal, collapses anything);
//   w = 0  →  κ_next = m: no information, no net move — the state just
//             settles internally toward its own blend. The dead-band's
//             arbitrary cutoff dissolves into a continuous weight.
//
// Boundedness survives by the same argument as everything else here: a
// convex combination of m ∈ [0,1] and target ∈ [0,1] cannot leave [0,1].
// No clamps in the update path; the weight itself is sanitized once.
export function stepKappaWeighted(kappa: number, kappaPrev: number, dir: RecoveryDirection, weight: number): number {
  const w = Number.isFinite(weight) ? Math.max(0, Math.min(1, weight)) : 0;
  const m = memoryBlend(kappa, kappaPrev);
  const target = dir === 'strain' ? W1 * m : 1 - W1 * (1 - m);
  return (1 - w) * m + w * target;
}

// ── the asymmetric log-odds regulator ────────────────────────
// Two design constraints, formalized:
//
//   1. "The rate of collapse has to be inversely proportional to the rate
//      of recovery."  S_C · S_R = s², exactly — and φ supplies the
//      canonical pair for free: S_C = φ·s, S_R = φ⁻¹·s, so S_C·S_R = s²
//      (φ·φ⁻¹ = 1). Trust is lost φ² ≈ 2.618× faster than it is earned;
//      the product of the two rates is invariant.
//
//   2. "The threshold must be dynamic and never let the loss function
//      achieve complete failure or complete success."  The state lives in
//      LOG-ODDS space: z = ln(κ/(1−κ)), κ = logistic(z), updated as a
//      leaky integrator on the ρ clock (the same leak-rate floor as
//      everything else):
//
//          z_{k+1} = (1−ρ)·z_k + w·(recover ? +φ⁻¹·s : −φ·s)
//
//      The leak bounds |z| < Z = φ·s/ρ STRICTLY (same proof as the valve:
//      a leaky integrator with bounded input is bounded), so κ is confined
//      to the OPEN interval (logistic(−Z), logistic(+Z)) — complete
//      failure (κ=0) and complete success (κ=1) are structurally
//      unreachable, not clamped away. And every threshold is a FRACTION
//      of Z, not a hardcoded κ: change ρ or s and the thresholds move
//      with the structure — dynamic by construction.
//
// The perturbation weight w carries straight over (w=1 is the worst case,
// so single-step-no-collapse minima are provable here exactly as in
// step-invariant.test.ts). This regulator is the PROMOTED live channel —
// see the file header for the validation trail.
export const ASYM_RHO_DEFAULT = 0.10;  // the fast clock — detection lives here (Pressure Test II); the 0.02 clock is the historian
export const ASYM_Z_MAX = 3;           // κ confined to (logistic(−3), logistic(3)) ≈ (0.047, 0.953)

// The rails themselves are asymmetric — a consequence, not a choice: strain
// pushes with φ·s so sustained maximal strain saturates at −zMax, but
// recovery pushes with only φ⁻¹·s, so sustained maximal confirmation
// saturates at +zMax/φ² ≈ 0.382·zMax. The structure itself makes complete
// success even more unreachable than complete failure. Both rails are open:
// approached asymptotically, attained never.
export interface AsymmetricState {
  step: number;
  z: number;          // log-odds state ∈ (−zMax, +zMax/φ²) strictly
  kappa: number;      // logistic(z), open interval (kappaMin, kappaMax)
  zMax: number;       // the collapse-side structural rail: φ·s/ρ
  kappaMin: number;   // logistic(−zMax) — the worst conviction can get (never 0)
  kappaMax: number;   // logistic(+zMax/φ²) — the best it can get (never 1, and lower than the failure rail is deep)
  status: 'strained' | 'holding' | 'charged';  // thresholds at half of each DIRECTIONAL rail — fractions of the structure, not constants
}

const logistic = (z: number) => 1 / (1 + Math.exp(-z));

// The one-step z update as a PURE function — the same line the regulator
// closure applies, exported so persisted state (a z stored in D1 between
// stateless Worker invocations) steps through EXACTLY the arithmetic the
// closure would have applied. One law, whether the state lives in memory
// or in a row.
export function stepAsymmetricZ(
  z: number, dir: RecoveryDirection, weight = 1,
  rho: number = ASYM_RHO_DEFAULT, zMax: number = ASYM_Z_MAX,
): number {
  const s = (rho * zMax) / PHI;
  const w = Number.isFinite(weight) ? Math.max(0, Math.min(1, weight)) : 0;
  const z0 = Number.isFinite(z) ? z : 0;
  return (1 - rho) * z0 + w * (dir === 'recover' ? s / PHI : -(PHI * s));
}

export const asymmetricKappa = (z: number) => logistic(z);

export function createAsymmetricRegulator(rho: number = ASYM_RHO_DEFAULT, zMax: number = ASYM_Z_MAX) {
  // Solve s from the rail: Z = φ·s/ρ  →  s = ρ·Z/φ. The collapse step is
  // then exactly ρ·Z (reaches the rail only as the infinite-step limit of
  // sustained maximal strain), and the recovery step is ρ·Z/φ².
  const s = (rho * zMax) / PHI;
  const S_COLLAPSE = PHI * s;        // = ρ·zMax
  const S_RECOVER = s / PHI;         // = ρ·zMax/φ²  →  S_COLLAPSE·S_RECOVER = s², S_COLLAPSE/S_RECOVER = φ²
  let step = 0;
  let z = 0;                          // neutral start: κ = 0.5, conviction earned from the middle
  const zMaxRecover = zMax / (PHI * PHI);   // the recovery-side rail: S_RECOVER/ρ
  const state = (): AsymmetricState => ({
    step, z,
    kappa: logistic(z),
    zMax,
    kappaMin: logistic(-zMax),
    kappaMax: logistic(zMaxRecover),
    status: z < -zMax / 2 ? 'strained' : z > zMaxRecover / 2 ? 'charged' : 'holding',
  });
  return {
    observe(dir: RecoveryDirection, weight = 1): AsymmetricState {
      step++;
      z = stepAsymmetricZ(z, dir, weight, rho, zMax);
      return state();
    },
    state,
    constants: { s, S_COLLAPSE, S_RECOVER },
  };
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
    // The perturbation-weighted observation: dir says which way, weight says
    // how much of the full φ⁻¹ contraction this observation earned.
    observeWeighted(dir: RecoveryDirection, weight: number): RecoveryState {
      step++;
      const next = stepKappaWeighted(kappa, kappaPrev, dir, weight);
      kappaPrev = kappa;
      kappa = next;
      return state();
    },
    state,
  };
}

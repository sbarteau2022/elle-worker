// ============================================================
// STEP INVARIANT — one step is the leak-rate floor.
//
// The step-cadence question recovery.ts's header left deliberately open is
// now closed, and not by convention but by an INVARIANT: one step is one
// observation on the ρ = 0.02 cadence — the leak rate that sits just below
// the noise floor (holding.ts's own grounding: ρ = 0.02 is the classical
// RLS forgetting factor, optimal precisely when the environment drifts at
// 2% of the noise scale per turn — steady-state Kalman gain of the
// local-level model, Muth 1960). What makes a step a WELL-FORMED step is
// the property this file proves against the real modules:
//
//   A single step's perturbation — even MAXIMAL (|v| clamped at 1, the
//   largest move a unit-interval κ admits) — must not be able to collapse
//   the function across its threshold. The threshold is reachable only by
//   ACCUMULATION, never by one blow.
//
// Closed form, from the valve's own recursion driven with maximal input
// from rest: D_k = (1−(1−ρ)^k)/ρ, so loss_k = expm1(1−(1−ρ)^k), and
// crossing STRAINED_LOSS = 0.25 requires (1−ρ)^k < 1.25/e^… i.e.
// (1−ρ)^k < 0.77686. The exact minima this forces, pinned below:
//   ρ = 0.02 → k_min = 13 consecutive worst-case steps (one step reaches
//              expm1(0.02) ≈ 0.0202 — 8% of the threshold)
//   ρ = 0.10 → k_min = 3 (the fast valve satisfies the invariant minimally;
//              Pressure Test II measured 5 on realistic magnitudes — the
//              closed-form 3 is the worst-case floor beneath that)
// And for the φ recovery regulator (conviction floor 0.15): a single strain
// step cannot cross the floor from any κ ≥ 0.15·φ ≈ 0.2427; from neutral
// (0.5) the floor takes 4 consecutive strains, from full conviction 6.
// ============================================================
import { describe, it, expect } from 'vitest';
import { createSuperposition } from './superposition';
import { createRecoveryRegulator, PHI, W1 } from './recovery';

const STRAINED_LOSS = 0.25; // superposition.ts / holding.ts threshold (not exported; pinned here — a drift would fail the k_min assertions below anyway)
const MAX_STEP = { kappa: 0.5, velocity: 1, input_perturbation: 1 }; // the largest single perturbation the valve admits

// Drive the real valve with maximal input until strained; return the step count.
function stepsToStrain(rho: number, cap = 100): number {
  const sup = createSuperposition(rho);
  for (let k = 1; k <= cap; k++) {
    const s = sup.observe(MAX_STEP);
    if (s.status === 'strained') return k;
  }
  return Infinity;
}

describe('the valve: no single step collapses it — the threshold demands accumulation', () => {
  it('ρ=0.02: one MAXIMAL step from rest reaches expm1(ρ) ≈ 0.0202 — 8% of the threshold', () => {
    const sup = createSuperposition(0.02);
    const s = sup.observe(MAX_STEP);
    expect(s.loss).toBeCloseTo(Math.expm1(0.02), 10);
    expect(s.loss!).toBeLessThan(STRAINED_LOSS * 0.1);   // an order of magnitude under
    expect(s.status).not.toBe('strained');
  });

  it('ρ=0.02: exactly 13 consecutive worst-case steps to strain from rest — the leak-rate floor made exact', () => {
    expect(stepsToStrain(0.02)).toBe(13);
  });

  it('ρ=0.10: exactly 3 — the fast valve satisfies the invariant minimally (PT-II measured 5 on realistic data; 3 is the worst-case floor beneath it)', () => {
    expect(stepsToStrain(0.10)).toBe(3);
  });

  it('the closed form agrees with the real module at every step (ρ=0.02, maximal drive)', () => {
    // loss_k = expm1(1 − (1−ρ)^k) — derived from D_k = (1−(1−ρ)^k)/ρ with λ=ρ.
    const sup = createSuperposition(0.02);
    for (let k = 1; k <= 20; k++) {
      const s = sup.observe(MAX_STEP);
      expect(s.loss).toBeCloseTo(Math.expm1(1 - Math.pow(0.98, k)), 10);
    }
  });

  it('the invariant has a knee: it fails by ρ ≈ 0.25 (one max step ≥ threshold) — quantifying how much slack ρ=0.02 carries', () => {
    // One max step from rest gives loss = expm1(ρ); expm1(ρ) ≥ 0.25 once
    // ρ ≥ ln(1.25) ≈ 0.223. So single-step collapse becomes possible only at
    // a leak more than 11× the floor — and even the fast valve (0.10) sits
    // at less than half the knee. The 2% floor is not near the edge.
    expect(Math.expm1(0.223)).toBeLessThan(STRAINED_LOSS);
    expect(Math.expm1(0.224)).toBeGreaterThan(STRAINED_LOSS);
    const supAtKnee = createSuperposition(0.25);
    expect(supAtKnee.observe(MAX_STEP).status).toBe('strained'); // one blow — the invariant is genuinely load-bearing, not vacuous
  });
});

describe('the φ regulator on the same cadence: conviction cannot be collapsed in one step either', () => {
  const FLOOR = 0.15; // the benchmark's a-priori conviction floor

  it('single-step safety region: no one strain crosses the floor from any κ ≥ 0.15·φ ≈ 0.2427', () => {
    // strain(κ,κ) = φ⁻¹·κ, so crossing needs κ < FLOOR·φ. Exactly at the
    // boundary, one step lands exactly on the floor, not through it.
    const boundary = FLOOR * PHI;
    expect(boundary).toBeCloseTo(0.2427, 4);
    expect(W1 * boundary).toBeCloseTo(FLOOR, 10);
    expect(W1 * (boundary + 1e-6)).toBeGreaterThan(FLOOR);
  });

  it('from neutral entry (0.5): exactly 4 consecutive strains to cross the floor', () => {
    const reg = createRecoveryRegulator(0.5);
    let k = 0;
    while (reg.state().kappa >= FLOOR && k < 50) { reg.observe('strain'); k++; }
    expect(k).toBe(4);
  });

  it('from full conviction (1.0): exactly 6', () => {
    const reg = createRecoveryRegulator(1.0);
    let k = 0;
    while (reg.state().kappa >= FLOOR && k < 50) { reg.observe('strain'); k++; }
    expect(k).toBe(6);
  });

  it('and the mirror holds for recovery: trust cannot be restored in one step from a wipeout either', () => {
    // recover(0,0) = 1 − φ⁻¹ = φ⁻² ≈ 0.382 — well short of, e.g., a 0.85
    // "restored" bar. Symmetric discipline: neither collapse nor absolution
    // in a single step, in either direction.
    const reg = createRecoveryRegulator(0);
    expect(reg.observe('recover').kappa).toBeCloseTo(1 - W1, 10);
    expect(reg.state().kappa).toBeLessThan(0.5);
  });
});

// ============================================================
// RECOVERY REGULATOR TESTS — the four wall-scenarios, made falsifiable.
//
// The "throw it against the wall" exercise (whipsaw / sideways grind /
// total wipeout / unbounded run) is encoded here as deterministic
// assertions, with the first-order deficit-decay form implemented alongside
// as the comparison baseline — so "two-term memory buys X" is a measured
// claim, not a narrated one.
//   npx vitest run src/recovery.test.ts
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  PHI, W1, W2, memoryBlend, strainStep, recoverStep, stepKappa,
  createRecoveryRegulator, type RecoveryDirection,
} from './recovery';
import { RETENTION_BASE } from './graph';

// The first-order form (the "aha" version that collapsed the recurrence to
// one term) — the baseline the two-term regulator must beat where it claims
// to, and match where it claims to.
const strain1 = (k: number) => W1 * k;
const recover1 = (k: number) => 1 - W1 * (1 - k);

// Deterministic LCG for the random-sequence boundedness sweep.
let seed = 20260714;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

describe('constants — one law, shared with the rest of the codebase', () => {
  it('PHI here IS graph.ts RETENTION_BASE (same constant, not a lookalike)', () => {
    expect(PHI).toBe(RETENTION_BASE);
  });
  it('the convex weights sum to exactly 1 in floats (W2 defined as 1−W1)', () => {
    expect(W1 + W2).toBe(1);
  });
  it('the defining identity: W1 = φ−1 = φ⁻¹, W2 = φ⁻² (to float precision)', () => {
    expect(W1).toBeCloseTo(PHI - 1, 12);
    expect(W2).toBeCloseTo(1 / (PHI * PHI), 12);
  });
});

describe('boundedness by construction — no clamps in the update path', () => {
  it('algebraic ranges: strain lands in [0, φ⁻¹], recovery lands in [φ⁻², 1]', () => {
    expect(strainStep(1, 1)).toBeCloseTo(W1, 12);      // max possible strain output
    expect(strainStep(0, 0)).toBe(0);                   // min
    expect(recoverStep(0, 0)).toBeCloseTo(W2, 12);      // min possible recovery output
    expect(recoverStep(1, 1)).toBeCloseTo(1, 12);       // max
  });
  it('100k random step sequences never leave [0,1] — strictly, no epsilon', () => {
    const reg = createRecoveryRegulator(rnd());
    for (let i = 0; i < 100_000; i++) {
      const s = reg.observe(rnd() < 0.5 ? 'strain' : 'recover');
      expect(s.kappa).toBeGreaterThanOrEqual(0);
      expect(s.kappa).toBeLessThanOrEqual(1);
    }
  });
  it('monotone in the right direction: recovery strictly raises κ below 1, strain strictly lowers it above 0', () => {
    // (with equal stored states, where blend === kappa)
    for (const k of [0.01, 0.25, 0.5, 0.75, 0.99]) {
      expect(recoverStep(k, k)).toBeGreaterThan(k);
      expect(strainStep(k, k)).toBeLessThan(k);
    }
  });
});

describe('wall scenario 1 — the whipsaw (dead-cat bounce)', () => {
  // Long strain (κ pinned near 0), ONE confirming tick, then the market
  // resumes crashing. The honest part first: tick 1 lifts both forms
  // equally — both stored states are low, so the blend is low, and nothing
  // in any formula can distinguish tick 1 of a real recovery from tick 1 of
  // a fake one. The two-term advantage is the UNWIND: κ_{k-2} still
  // remembers the crash and drags the fake-out back down faster.
  it('after the fake-out, two-term unwinds meaningfully below first-order', () => {
    // Two-term: state (0.01, 0.01) → recover → strain
    const afterBounce2 = recoverStep(0.01, 0.01);
    const afterResume2 = strainStep(afterBounce2, 0.01);   // kappaPrev = pre-bounce 0.01
    // First-order: same sequence, one state var
    const afterBounce1 = recover1(0.01);
    const afterResume1 = strain1(afterBounce1);
    expect(afterBounce2).toBeCloseTo(afterBounce1, 12);    // tick 1: identical, honestly
    expect(afterResume2).toBeLessThan(afterResume1 * 0.7); // the unwind: >30% deeper pullback
    // Hand-computed anchors so a regression is loud, not silent:
    expect(afterBounce2).toBeCloseTo(0.3882, 3);
    expect(afterResume2).toBeCloseTo(0.1506, 3);
    expect(afterResume1).toBeCloseTo(0.2399, 3);
  });
});

describe('wall scenario 2 — the sideways grind (alternating strain/recover)', () => {
  it('settles into a stable 2-cycle strictly inside (0,1) — partial conviction, no oscillation to the rails', () => {
    const reg = createRecoveryRegulator(0.5);
    let a = 0, b = 0;
    for (let i = 0; i < 500; i++) {
      const dir: RecoveryDirection = i % 2 === 0 ? 'strain' : 'recover';
      const s = reg.observe(dir);
      if (i >= 498) { if (i % 2 === 0) a = s.kappa; else b = s.kappa; }
    }
    // The cycle is stable (repeating to high precision)…
    const reg2 = createRecoveryRegulator(0.9); // …and independent of where you start
    let a2 = 0, b2 = 0;
    for (let i = 0; i < 500; i++) {
      const dir: RecoveryDirection = i % 2 === 0 ? 'strain' : 'recover';
      const s = reg2.observe(dir);
      if (i >= 498) { if (i % 2 === 0) a2 = s.kappa; else b2 = s.kappa; }
    }
    expect(a).toBeCloseTo(a2, 9);
    expect(b).toBeCloseTo(b2, 9);
    // …and lives in the interior, not at the rails.
    for (const v of [a, b]) { expect(v).toBeGreaterThan(0.05); expect(v).toBeLessThan(0.95); }
    // The exact limit, derived: at the alternating fixed cycle the φ
    // identities W1² = W2 and 1−W1·W2 = 2W2 collapse the fixed-point
    // equations to a = b/2 and 2b = 1+a — so b = 2/3, a = 1/3, EXACTLY.
    // Golden-ratio weights, perfectly rational equilibrium: under sustained
    // indecision, partial conviction is literally one-third / two-thirds.
    expect(a).toBeCloseTo(1 / 3, 6);
    expect(b).toBeCloseTo(2 / 3, 6);
    console.log(`sideways-grind 2-cycle: strain-phase κ=${a.toFixed(4)}, recover-phase κ=${b.toFixed(4)} (exactly 1/3, 2/3)`);
  });
});

describe('wall scenario 3 — the total wipeout (climb from zero)', () => {
  it('exact trajectory from κ=0: 0.382, then slower than first-order at every subsequent step', () => {
    const reg = createRecoveryRegulator(0);
    const twoTerm: number[] = [];
    for (let i = 0; i < 8; i++) twoTerm.push(reg.observe('recover').kappa);
    // First-order comparison from the same start
    const firstOrder: number[] = [];
    let k1 = 0;
    for (let i = 0; i < 8; i++) { k1 = recover1(k1); firstOrder.push(k1); }

    expect(twoTerm[0]).toBeCloseTo(W2, 12);          // tick 1: 1−φ⁻¹ = φ⁻² ≈ 0.382 (identical to first-order)
    expect(twoTerm[1]).toBeCloseTo(0.5279, 3);       // hand-computed anchor
    for (let i = 1; i < 8; i++) expect(twoTerm[i]).toBeLessThan(firstOrder[i]); // strictly more conservative after tick 1
    // Trust is earned across consecutive confirmations: ~7 ticks to 0.9 vs ~5.
    const stepsTo09 = (xs: number[]) => xs.findIndex(x => x > 0.9) + 1;
    expect(stepsTo09(twoTerm)).toBeGreaterThan(stepsTo09(firstOrder));
    expect(stepsTo09(twoTerm)).toBeLessThanOrEqual(8); // but it DOES get there — conservative, not dead
    console.log(`wipeout climb — two-term: ${twoTerm.slice(0, 7).map(x => x.toFixed(3)).join(' ')} · first-order: ${firstOrder.slice(0, 7).map(x => x.toFixed(3)).join(' ')}`);
  });
});

describe('wall scenario 4 — the unbounded run (the raw-Fibonacci fatal flaw, fixed structurally)', () => {
  it('1000 consecutive confirmations approach 1 asymptotically and never exceed it', () => {
    const reg = createRecoveryRegulator(0);
    let s = reg.state();
    for (let i = 0; i < 1000; i++) s = reg.observe('recover');
    expect(s.kappa).toBeLessThanOrEqual(1);
    expect(s.kappa).toBeGreaterThan(0.999999);
  });
  it('1000 consecutive violations approach 0 and never go below', () => {
    const reg = createRecoveryRegulator(1);
    let s = reg.state();
    for (let i = 0; i < 1000; i++) s = reg.observe('strain');
    expect(s.kappa).toBeGreaterThanOrEqual(0);
    expect(s.kappa).toBeLessThan(1e-6);
  });
});

describe('the two-term memory is real, not a relabeled first-order form', () => {
  it('output depends on κ_{k-2}, holding κ_{k-1} fixed — the first-order form structurally cannot do this', () => {
    // Same current κ, different history → different next state.
    expect(recoverStep(0.5, 0.9)).not.toBeCloseTo(recoverStep(0.5, 0.1), 4);
    expect(strainStep(0.5, 0.9)).not.toBeCloseTo(strainStep(0.5, 0.1), 4);
    // And the direction is right: a better past pulls the blend up.
    expect(recoverStep(0.5, 0.9)).toBeGreaterThan(recoverStep(0.5, 0.1));
  });
  it('memoryBlend is the renormalized Fibonacci recurrence: d_k = φ⁻¹d_{k-1} + φ⁻²d_{k-2}', () => {
    expect(memoryBlend(1, 0)).toBeCloseTo(W1, 12);
    expect(memoryBlend(0, 1)).toBeCloseTo(W2, 12);
    expect(memoryBlend(0.7, 0.3)).toBeCloseTo(W1 * 0.7 + W2 * 0.3, 12);
  });
  it('stepKappa dispatches to the right direction', () => {
    expect(stepKappa(0.5, 0.5, 'strain')).toBeCloseTo(strainStep(0.5, 0.5), 12);
    expect(stepKappa(0.5, 0.5, 'recover')).toBeCloseTo(recoverStep(0.5, 0.5), 12);
  });
});

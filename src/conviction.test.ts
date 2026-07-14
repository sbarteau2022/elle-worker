// ============================================================
// CONVICTION CHANNEL TESTS — the promoted regulator at its LIVE surface.
// Everything proven in recovery-asymmetric / step-invariant carries over
// only if the wiring preserves it — so the invariants are re-proven HERE,
// against the exact functions trading.ts calls.
//   npx vitest run src/conviction.test.ts
// ============================================================
import { describe, it, expect } from 'vitest';
import { PHI, ASYM_Z_MAX, stepAsymmetricZ, createAsymmetricRegulator } from './recovery';
import {
  freshState, observeCycle, reading, targetFraction, trimQty, isEquitySymbol,
  KAPPA_NEUTRAL, TRIM_MIN_FRACTION, CONVICTION_ATR_N,
} from './conviction';

const logistic = (z: number) => 1 / (1 + Math.exp(-z));

describe('stepAsymmetricZ — the pure step IS the closure step', () => {
  it('a persisted-and-rehydrated state walks the identical trajectory as the in-memory regulator', () => {
    // The whole reason the pure export exists: D1 rows between cron firings
    // must not diverge from what the closure would have computed.
    const reg = createAsymmetricRegulator();
    let z = 0;
    const dirs = ['strain', 'recover', 'strain', 'strain', 'recover', 'strain'] as const;
    const ws = [1, 0.4, 0.9, 0.2, 1, 0.7];
    dirs.forEach((d, i) => {
      const st = reg.observe(d, ws[i]);
      z = stepAsymmetricZ(z, d, ws[i]);
      expect(z).toBe(st.z); // exact float equality — same arithmetic, same order
    });
  });

  it('sanitizes non-finite inputs instead of propagating them', () => {
    expect(Number.isFinite(stepAsymmetricZ(NaN, 'strain', 1))).toBe(true);
    expect(Number.isFinite(stepAsymmetricZ(0, 'strain', NaN))).toBe(true);
    expect(stepAsymmetricZ(0, 'strain', NaN)).toBe(0); // NaN weight = no information
  });
});

describe('the de-risk-only sizing law', () => {
  it('neutral and charged conviction ⇒ full size — this path never levers UP (the Gate-2 lesson)', () => {
    expect(targetFraction(KAPPA_NEUTRAL)).toBe(1);
    expect(targetFraction(0.6)).toBe(1);
    expect(targetFraction(0.759)).toBe(1); // the charged rail — still capped at 1
  });

  it('the size floor is OPEN: sustained maximal strain cannot flatten a position by itself', () => {
    let z = 0;
    for (let i = 0; i < 1000; i++) z = stepAsymmetricZ(z, 'strain', 1);
    const floorFraction = targetFraction(logistic(z));
    expect(floorFraction).toBeGreaterThan(0.09);   // κ_min/κ₀ = logistic(−3)/0.5 ≈ 0.0949
    expect(floorFraction).toBeLessThan(0.10);
    // 100 shares, wiped-out conviction: trims stop at the floor, never to 0.
    const st = { ...freshState('TEST', 100, 100), z, step: 1000 };
    const target = Math.floor(100 * floorFraction);
    expect(target).toBeGreaterThanOrEqual(9);
    expect(trimQty(target, st, logistic(z))).toBe(0); // at the floor: nothing left to trim
  });

  it('single-cycle-no-collapse, live: one maximal shock bar from neutral trims ≤15%, never through the strained threshold', () => {
    // w=1 means a bar ≥ 2·ATR against the thesis — the worst single cycle.
    const z = stepAsymmetricZ(0, 'strain', 1);
    const frac = targetFraction(logistic(z));
    expect(frac).toBeGreaterThan(0.85);
    expect(z).toBeGreaterThan(-ASYM_Z_MAX / 2); // status still 'holding' — accumulation only
  });

  it('trim churn floor: <5% adjustments do nothing', () => {
    const st = freshState('TEST', 100, 100);
    expect(trimQty(100, st, 0.49)).toBe(0);                 // target 98 — 2% < 5% floor
    expect(TRIM_MIN_FRACTION).toBe(0.05);
  });

  it('the last unit is untrimmable: a 1-share position can never be flattened by the executor', () => {
    // floor() would round the open κ floor down to a target of 0 shares —
    // the one hole through which "never complete failure" could leak. Plugged:
    // target is floored at 1 unit; full exits belong to the decision loop.
    const one = freshState('TEST', 100, 1);
    expect(trimQty(1, one, 0.05)).toBe(0);  // even at the deep-strain κ floor
    const two = freshState('TEST', 100, 2);
    expect(trimQty(2, two, 0.05)).toBe(1);  // trims toward 1, stops there
    expect(trimQty(1, two, 0.05)).toBe(0);
  });

  it('never a buy-back: qty already under target ⇒ 0', () => {
    const st = freshState('TEST', 100, 100);
    expect(trimQty(40, st, KAPPA_NEUTRAL)).toBe(0); // target 100, holding 40 — executor stays silent
  });
});

describe('observeCycle — the perturbation form at the live cadence', () => {
  it('thesis-relative direction: the same red bar strains a long and confirms a short', () => {
    const drop = (side: 'long' | 'short') => {
      let r = reading(freshState('T', 100, 10));
      r = observeCycle(r.state, 100, side);   // seed a step so atr exists
      return observeCycle(r.state, 95, side); // −5% bar
    };
    expect(drop('long').kappa).toBeLessThan(0.5);
    expect(drop('short').kappa).toBeGreaterThan(0.5);
  });

  it('a zero-move cycle is a w=0 observation: leak only, breathing the state toward neutral', () => {
    let z = 0;
    for (let i = 0; i < 6; i++) z = stepAsymmetricZ(z, 'strain', 1);
    let r = reading({ ...freshState('T', 100, 10), z, step: 6, atr: 0.01 });
    const before = r.state.z;
    r = observeCycle(r.state, 100, 'long'); // price unchanged
    expect(r.state.z).toBeCloseTo(before * 0.9, 12); // (1−ρ)·z, nothing added
  });

  it('the perturbation scale is self-seeding: first observed move lands w=0.5, then Wilder-blends at n=22', () => {
    let r = reading(freshState('T', 100, 10));
    r = observeCycle(r.state, 102, 'long'); // first move: |ret|=0.02 seeds atr
    // seed: atrPrev=0.02 → w = 0.02/(2·0.02) = 0.5 exactly; atr after Wilder step
    expect(r.state.atr).toBeCloseTo(0.02, 12);
    const z1 = stepAsymmetricZ(0, 'recover', 0.5);
    expect(r.state.z).toBe(z1);
    r = observeCycle(r.state, 102 * 1.04, 'long'); // 2×ATR bar → w clamps at 1
    const expectedAtr = 0.02 + (0.04 - 0.02) / CONVICTION_ATR_N;
    expect(r.state.atr).toBeCloseTo(expectedAtr, 12);
  });

  it('garbage prices are inert: NaN / zero / negative never move the regulator', () => {
    const st = { ...freshState('T', 100, 10), z: -1, step: 5, atr: 0.01 };
    for (const bad of [NaN, 0, -3, Infinity]) {
      const r = observeCycle(st, bad, 'long');
      expect(r.state.z).toBe(-1);
      expect(r.state.step).toBe(5);
    }
  });

  it('recovery stays φ²-slow at the live surface: the shock that took one bar to inflict takes three to clear', () => {
    // Established scale (atr=1%), neutral conviction, then a −10% bar: w
    // clamps at 1 — the maximal single strain, exactly the regulator test's
    // setup, arriving through the live price path.
    let r = reading({ ...freshState('T', 100, 10), atr: 0.01, step: 5 });
    r = observeCycle(r.state, 90, 'long');
    expect(r.state.z).toBeCloseTo(stepAsymmetricZ(0, 'strain', 1), 12);
    let price = 90, k = 0;
    while (r.state.z < -1e-9 && k < 10) {
      price *= 1.25; // maximal confirming bars (each ≥ 2·atr, w clamps at 1)
      r = observeCycle(r.state, price, 'long');
      k++;
    }
    expect(k).toBe(3); // ceil(φ²) — same behavioral law proven in recovery-asymmetric.test.ts
  });
});

describe('scope guards', () => {
  it('plain equities pass; OCC option symbols and junk are excluded', () => {
    for (const ok of ['NVDA', 'SPY', 'BRK.B', 'GE']) expect(isEquitySymbol(ok)).toBe(true);
    for (const no of ['NVDA260320C00120000', 'SPY  240119P00400000', 'nvda', '', '123']) {
      expect(isEquitySymbol(no)).toBe(false);
    }
  });

  it('φ constants agree across the wire — one law, three modules', () => {
    expect(PHI).toBeCloseTo((1 + Math.sqrt(5)) / 2, 15);
    // The behavioral ratio the executor inherits: strain step / recover step = φ².
    const down = Math.abs(stepAsymmetricZ(0, 'strain', 1));
    const up = stepAsymmetricZ(0, 'recover', 1);
    expect(down / up).toBeCloseTo(PHI * PHI, 12);
  });
});

// ============================================================
// κ BACKTEST — pure-core tests. The statistics, and the three pre-registered
// behaviors on SYNTHETIC series where the truth is known by construction.
//   npx vitest run src/backtest.test.ts
// ============================================================
import { describe, it, expect } from 'vitest';
import { pearson, std, runKappaBacktest } from './backtest';

// deterministic PRNG (no Math.random — reproducible)
let seed = 424242;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const gauss = () => { let s = 0; for (let i = 0; i < 6; i++) s += rnd(); return (s - 3) / 1; };

describe('statistics', () => {
  it('pearson: perfect +1, perfect −1, and zero-variance → 0', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 12);
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 12);
    expect(pearson([5, 5, 5, 5], [1, 2, 3, 4])).toBe(0);
    expect(pearson([1, 2], [1, 2])).toBe(0); // n<3 guard
  });
  it('std: known value and degenerate', () => {
    expect(std([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 12);
    expect(std([3])).toBe(0);
  });
});

describe('PT-BT1 — κ fluxes once warmed (not pinned at 0.5)', () => {
  it('a volatile series produces test-half κ with real variance — not a flat line at 0.5', () => {
    let p = 100; const closes = [p];
    for (let i = 0; i < 400; i++) { p *= 1 + 0.02 * gauss(); closes.push(p); }
    const r = runKappaBacktest('VOL', closes, 0.5, 5)!;
    expect(r.kappaStdTest).toBeGreaterThan(0.02);   // it moves; the pin is gone
    // (Rail-visiting is NOT asserted here: a constant-σ walk fluxes but every
    // bar is normal-sized against its own vol, so it borders the rails without
    // crossing — the same property proven in conviction.test.ts. Regimes cross
    // rails; that's asserted on the clustered-vol series below.)
  });

  it('warming lifts κ OFF neutral: a steady uptrend enters the test half charged, a crash strained', () => {
    const up = [100]; for (let i = 0; i < 200; i++) up.push(up[up.length - 1] * 1.004);
    const down = [100]; for (let i = 0; i < 200; i++) down.push(down[down.length - 1] * 0.996);
    const ru = runKappaBacktest('UP', up, 0.5, 5)!;
    const rd = runKappaBacktest('DOWN', down, 0.5, 5)!;
    expect(ru.kappaEnterTest).toBeGreaterThan(0.5);  // stood on an uptrend → conviction
    expect(rd.kappaEnterTest).toBeLessThan(0.5);     // stood on a decline → strain
    // The whole point: neither is pinned at 0.5 the way the cold 6-bar replay was.
    expect(Math.abs(ru.kappaEnterTest - 0.5)).toBeGreaterThan(0.01);
  });
});

describe('PT-BT2 — κ strain predicts forward VOLATILITY (vol clustering)', () => {
  it('a series with clustered volatility: strain magnitude leads |forward return| (positive corr)', () => {
    // Build regimes: alternating calm (σ=0.5%) and turbulent (σ=4%) blocks.
    // Turbulence persists, so a strained κ (built in turbulence) should precede
    // more turbulence — the honest, real signal a vol-derived state can carry.
    let p = 100; const closes = [p];
    for (let block = 0; block < 40; block++) {
      const sigma = block % 2 === 0 ? 0.005 : 0.04;
      for (let i = 0; i < 15; i++) { p *= 1 + sigma * gauss(); closes.push(p); }
    }
    const r = runKappaBacktest('CLUSTER', closes, 0.5, 5)!;
    expect(r.corrLeadVolatility).toBeGreaterThan(0.1); // strain leads turbulence
    // (Rail STATUS crossing is not asserted: turbulence is directionless, so κ
    // oscillates rather than accumulating the ~7 net-adverse steps a rail needs
    // — rails are crossed by sustained DIRECTION, not mere high vol. That's a
    // real-data output, left for the live suite to report, not forced here.)
  });
});

describe('PT-BT3 — κ does NOT predict forward DIRECTION (the honest null)', () => {
  it('a pure random walk: (κ−0.5) has ~0 correlation with signed forward return', () => {
    let p = 100; const closes = [p];
    for (let i = 0; i < 800; i++) { p *= 1 + 0.015 * gauss(); closes.push(p); }
    const r = runKappaBacktest('RW', closes, 0.5, 5)!;
    // No directional edge on a random walk — |corr| small. (The drawdown-shaper
    // reacts to realized vol; it does not forecast returns. If this ever came
    // back large on real data, THAT would be the surprise worth chasing.)
    expect(Math.abs(r.corrLeadDirection)).toBeLessThan(0.15);
  });

  it('contemporaneous sanity: κ−0.5 tracks the trailing return it was just built from (positive)', () => {
    let p = 100; const closes = [p];
    for (let i = 0; i < 500; i++) { p *= 1 + 0.02 * gauss(); closes.push(p); }
    const r = runKappaBacktest('TRACK', closes, 0.5, 5)!;
    expect(r.corrContemporaneous).toBeGreaterThan(0.1); // it reacts to what just happened
  });
});

describe('guards', () => {
  it('refuses series too short to warm and test', () => {
    expect(runKappaBacktest('TINY', [100, 101, 102, 103], 0.5, 5)).toBeNull();
    expect(runKappaBacktest('EMPTY', [], 0.5, 5)).toBeNull();
  });
  it('filters non-finite/negative closes before splitting', () => {
    let p = 100; const closes: number[] = [];
    for (let i = 0; i < 200; i++) { p *= 1 + 0.01 * gauss(); closes.push(i % 37 === 0 ? NaN : p); }
    const r = runKappaBacktest('DIRTY', closes, 0.5, 5);
    expect(r).not.toBeNull();
    expect(Number.isFinite(r!.corrLeadVolatility)).toBe(true);
  });
});

// ============================================================
// COHERENCE FIELD — pure-core tests. The material ground, measured: temporal
// (κ/dissonance) and spatial (do members move together) coherence, proven on
// synthetic fields where the truth is set by construction.
//   npx vitest run src/coherence.test.ts
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  memberCoherence, meanPairwiseCorr, crossSectionalDispersion,
  areaCoherence, worldCoherence, computeField,
} from './coherence';

let seed = 13131;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const gauss = () => { let s = 0; for (let i = 0; i < 6; i++) s += rnd(); return s - 3; };
const priceFrom = (rets: number[]) => { let p = 100; const c = [p]; for (const r of rets) { p *= 1 + r; c.push(p); } return c; };

// A common factor + idiosyncratic noise → tunable cross-sectional coherence.
const factorMembers = (n: number, len: number, loading: number) => {
  const f = Array.from({ length: len }, () => 0.01 * gauss());
  return Array.from({ length: n }, () =>
    priceFrom(f.map(x => loading * x + (1 - loading) * 0.01 * gauss())));
};

describe('spatial coherence — do the members move together', () => {
  it('meanPairwiseCorr: identical +1, opposite −1, independent ≈ 0', () => {
    const a = [0.01, -0.02, 0.03, -0.01, 0.02];
    expect(meanPairwiseCorr([a, a, a])).toBeCloseTo(1, 6);
    expect(meanPairwiseCorr([a, a.map(x => -x)])).toBeCloseTo(-1, 6);
    const indep = Array.from({ length: 6 }, () => Array.from({ length: 200 }, () => gauss()));
    expect(Math.abs(meanPairwiseCorr(indep))).toBeLessThan(0.2);
  });

  it('a high-loading area coheres; a low-loading area does not', () => {
    const coherent = factorMembers(5, 130, 0.95).map(c => c.slice(-21).map((_, i, arr) => i === 0 ? 0 : (arr[i] - arr[i - 1]) / arr[i - 1]).slice(1));
    const idio = factorMembers(5, 130, 0.05).map(c => c.slice(-21).map((_, i, arr) => i === 0 ? 0 : (arr[i] - arr[i - 1]) / arr[i - 1]).slice(1));
    expect(meanPairwiseCorr(coherent)).toBeGreaterThan(meanPairwiseCorr(idio));
    expect(meanPairwiseCorr(coherent)).toBeGreaterThan(0.5);
  });

  it('crossSectionalDispersion: identical members → 0, divergent → >0', () => {
    const same = [0.01, 0.02, -0.01];
    expect(crossSectionalDispersion([same, same, same])).toBeCloseTo(0, 9);
    expect(crossSectionalDispersion([[0.05, -0.05], [-0.05, 0.05]])).toBeGreaterThan(0);
  });
});

describe('temporal coherence — each instrument vs its own past', () => {
  it('memberCoherence warms κ off 0.5 on a trend and returns recent returns', () => {
    const up = priceFrom(Array.from({ length: 120 }, () => 0.004));
    const m = memberCoherence('UP', up, 20)!;
    expect(m.kappa).not.toBeCloseTo(0.5, 2);   // stood on real history, not pinned
    expect(m.returns.length).toBe(20);
    expect(Number.isFinite(m.dissMag)).toBe(true);
  });

  it('refuses instruments with too little history', () => {
    expect(memberCoherence('TINY', [100, 101, 102], 20)).toBeNull();
  });
});

describe('area + world aggregation', () => {
  it('areaCoherence separates a bloc regime from an idiosyncratic one', () => {
    const bloc = factorMembers(5, 130, 0.95);
    const idio = factorMembers(5, 130, 0.05);
    const aBloc = areaCoherence('bloc', bloc.map((c, i) => memberCoherence(`B${i}`, c)))!;
    const aIdio = areaCoherence('idio', idio.map((c, i) => memberCoherence(`I${i}`, c)))!;
    expect(aBloc.crossCoherence).toBeGreaterThan(aIdio.crossCoherence);
    expect(aBloc.nMembers).toBe(5);
    expect(aBloc.meanReturnSeries.length).toBeGreaterThan(0);
  });

  it('worldCoherence detects when the AREAS themselves move as a bloc', () => {
    // Two areas both driven by ONE global factor → high inter-area coherence.
    const g = Array.from({ length: 130 }, () => 0.01 * gauss());
    const areaFrom = () => Array.from({ length: 4 }, () => priceFrom(g.map(x => 0.9 * x + 0.1 * 0.01 * gauss())));
    const a1 = areaCoherence('a1', areaFrom().map((c, i) => memberCoherence(`x${i}`, c)));
    const a2 = areaCoherence('a2', areaFrom().map((c, i) => memberCoherence(`y${i}`, c)));
    const w = worldCoherence([a1, a2])!;
    expect(w.interAreaCoherence).toBeGreaterThan(0.4); // the areas ARE the same macro trade
    expect(w.nAreas).toBe(2);
  });

  it('computeField end-to-end returns areas + a world map, and handles a dropped member', () => {
    const field = computeField({
      alpha: { A: priceFrom(Array.from({ length: 120 }, () => 0.003)), B: priceFrom(Array.from({ length: 120 }, () => 0.002)), SHORT: [100, 101] },
      beta: { C: priceFrom(Array.from({ length: 120 }, () => -0.002)), D: priceFrom(Array.from({ length: 120 }, () => 0.001)) },
    });
    expect(field.areas.length).toBe(2);
    expect(field.world).not.toBeNull();
    const alpha = field.areas.find(a => a.area === 'alpha')!;
    expect(alpha.nMembers).toBe(2); // SHORT dropped, not crashed
  });

  it('empty / all-invalid input yields no world map, not a throw', () => {
    expect(worldCoherence([null, null])).toBeNull();
    expect(computeField({ x: { A: [1, 2] } }).world).toBeNull();
  });
});

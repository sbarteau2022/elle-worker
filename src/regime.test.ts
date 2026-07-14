// ============================================================
// REGIME ANALYSIS — pure-core tests. SNR + confidence indexing, the
// conditional transition cells, lead-time, and the recovery half-life.
//   npx vitest run src/regime.test.ts
// ============================================================
import { describe, it, expect } from 'vitest';
import { confidenceIndex, halfLife, runRegimeAnalysis, SNR_TOLERANCE } from './regime';

let seed = 71717;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const gauss = () => { let s = 0; for (let i = 0; i < 6; i++) s += rnd(); return s - 3; };
const priceFrom = (rets: number[]) => { let p = 100; const c = [p]; for (const r of rets) { p *= 1 + r; c.push(p); } return c; };

describe('SNR → confidence index (the tolerance-or-index rule)', () => {
  it('SNR at/above tolerance → full confidence 1; below → indexed down toward 0', () => {
    expect(confidenceIndex(SNR_TOLERANCE)).toBe(1);
    expect(confidenceIndex(SNR_TOLERANCE * 2)).toBe(1);
    expect(confidenceIndex(SNR_TOLERANCE / 2)).toBeCloseTo(0.5, 6);
    expect(confidenceIndex(0)).toBe(0);
    expect(confidenceIndex(Infinity)).toBe(1);
  });
});

describe('recovery clock — κ mean-reversion half-life', () => {
  it('a persistent (mean-reverting) series has a finite positive half-life; white noise ~0', () => {
    // AR(1) with phi=0.8 → half-life = ln.5/ln.8 ≈ 3.1 bars.
    const ar: number[] = [0];
    for (let i = 0; i < 500; i++) ar.push(0.8 * ar[ar.length - 1] + 0.2 * gauss());
    const hl = halfLife(ar);
    expect(hl).toBeGreaterThan(1.5);
    expect(hl).toBeLessThan(6);
    // White noise: no lag-1 persistence → half-life collapses to ~0 or Infinity path.
    const wn = Array.from({ length: 500 }, () => gauss());
    const hlwn = halfLife(wn);
    expect(hlwn === Infinity || hlwn < 1).toBe(true);
  });
});

describe('runRegimeAnalysis — structure and behavior', () => {
  const vol = priceFrom(Array.from({ length: 600 }, (_, i) => (i % 60 < 30 ? 0.004 : 0.03) * gauss()));

  it('the four conditional cells partition every test bar', () => {
    const r = runRegimeAnalysis('X', vol)!;
    expect(r.cells).toHaveLength(4);
    expect(r.cells.reduce((s, c) => s + c.n, 0)).toBe(r.testBars);
  });

  it('SNR and confidence are finite and in range; κ SNR is reported', () => {
    const r = runRegimeAnalysis('X', vol)!;
    expect(Number.isFinite(r.snrKappa)).toBe(true);
    expect(r.confKappa).toBeGreaterThanOrEqual(0);
    expect(r.confKappa).toBeLessThanOrEqual(1);
    expect(r.confDissonance).toBeGreaterThanOrEqual(0);
    expect(r.confDissonance).toBeLessThanOrEqual(1);
  });

  it('lead-time distribution covers all horizons and names a peak', () => {
    const r = runRegimeAnalysis('X', vol)!;
    expect(r.leadRatios.map(l => l.h)).toEqual([1, 3, 5, 10, 20]);
    expect([1, 3, 5, 10, 20]).toContain(r.leadPeakH);
    for (const l of r.leadRatios) expect(Number.isFinite(l.ratio)).toBe(true);
  });

  it('on a vol-clustering series, firing precedes above-baseline vol at the peak horizon (ratio > 1)', () => {
    const r = runRegimeAnalysis('X', vol)!;
    const peak = r.leadRatios.find(l => l.h === r.leadPeakH)!;
    expect(peak.ratio).toBeGreaterThan(1); // dissonance fires ahead of turbulence
  });

  it('interactionReal is a boolean comparison of cell B vs cell A forward vol', () => {
    const r = runRegimeAnalysis('X', vol)!;
    const a = r.cells[0].meanFwdVol, b = r.cells[1].meanFwdVol;
    expect(r.interactionReal).toBe(b > a);
  });

  it('refuses series too short', () => {
    expect(runRegimeAnalysis('T', priceFrom(Array.from({ length: 40 }, () => 0.01)))).toBeNull();
  });
});

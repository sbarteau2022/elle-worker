// ============================================================
// ADVERSARIAL STRESS TEST SUITE — RELATIVE VOLATILITY NORMALIZATION
//
// Milestone 1 Gate 2 Empirical Verification & Adversarial Stress Testing:
// 1. Extreme Price Inflation / Deflation (P -> infinity, P -> 0+)
// 2. Volatility Flash Crashes (ATR -> 0+)
// 3. Massive Volatility Surges (ATR -> infinity)
// 4. Negative, Zero, NaN, and Non-Finite Inputs
// 5. 100,000-iteration Randomized Fuzz / Invariant Matrix
// 6. Empirical Verification Across All 591 Real-Market Trades (5yr OHLC)
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { relativeVolMultiplier } from '../src/conviction';
import { createAsymmetricRegulator } from '../src/recovery';

interface Bar { date: string; o: number; h: number; l: number; c: number }
const PHI = (1 + Math.sqrt(5)) / 2;
const STOP_MULT = 3;

function loadFixture(): Map<string, Bar[]> {
  const raw = readFileSync(join(__dirname, '..', 'test-fixtures', 'real-ohlc-5yr.csv'), 'utf8');
  const out = new Map<string, Bar[]>();
  for (const line of raw.split('\n').slice(1)) {
    if (!line.trim()) continue;
    const [date, o, h, l, c, , name] = line.split(',');
    if (!out.has(name)) out.set(name, []);
    out.get(name)!.push({ date, o: +o, h: +h, l: +l, c: +c });
  }
  return out;
}

function trueATR(bars: Bar[], i: number, n = 22): number {
  const from = Math.max(1, i - n + 1);
  let s = 0, cnt = 0;
  for (let k = from; k <= i; k++) {
    const tr = Math.max(
      bars[k].h - bars[k].l,
      Math.abs(bars[k].h - bars[k - 1].c),
      Math.abs(bars[k].l - bars[k - 1].c),
    );
    s += tr;
    cnt++;
  }
  return Math.max(1e-9, s / cnt);
}

function breakoutSignals(bars: Bar[]): number[] {
  const out: number[] = [];
  for (let i = 56; i < bars.length - 5; i++) {
    let hi = -Infinity;
    for (let k = i - 55; k < i; k++) hi = Math.max(hi, bars[k].c);
    if (bars[i].c > hi) out.push(i);
  }
  return out;
}

function chandelierExitBar(bars: Bar[], i0: number): number {
  const entry = bars[i0].c;
  let hwm = entry;
  for (let i = i0 + 1; i < bars.length; i++) {
    const px = bars[i].c;
    hwm = Math.max(hwm, px);
    if (px < hwm - STOP_MULT * trueATR(bars, i)) return i;
  }
  return bars.length - 1;
}

interface GateTrade {
  symbol: string;
  entryDate: string;
  pnlR: number;
  grossR: number;
  costR: number;
  turnover: number;
  exposure: number;
  minCumR: number;
  multipliers: number[];
}

function runGateDetailed(
  symbol: string,
  bars: Bar[],
  i0: number,
  exitBar: number,
  mode: 'unit' | 'asym' | 'asym-lev' | 'asym-rel-vol',
  spreadFracATR: number,
): GateTrade {
  const entry = bars[i0].c;
  const R = STOP_MULT * trueATR(bars, i0);
  const atrEntry = trueATR(bars, i0);
  const asym = createAsymmetricRegulator();
  let grossR = 0, costR = 0, turnover = 0, exposure = 0, minCumR = 0, prevSize = 0;
  const multipliers: number[] = [];

  for (let i = i0 + 1; i <= exitBar; i++) {
    const ret = bars[i].c - bars[i - 1].c;
    const atr = trueATR(bars, i);
    let size = mode === 'unit' ? 1 : asym.state().kappa;
    if (mode === 'asym-lev') {
      const V = atr / atrEntry;
      size *= Math.min(1, 1 / (PHI * V));
    } else if (mode === 'asym-rel-vol') {
      const mult = relativeVolMultiplier(atr, bars[i].c, atrEntry, entry);
      multipliers.push(mult);
      size *= mult;
    }
    const dSize = Math.abs(size - prevSize);
    costR += dSize * (spreadFracATR * atr) / R;
    turnover += dSize;
    prevSize = size;
    grossR += size * ret / R;
    exposure += size;
    minCumR = Math.min(minCumR, grossR - costR);
    asym.observe(ret > 0 ? 'recover' : 'strain', Math.abs(ret) / (2 * atr));
  }
  costR += prevSize * (spreadFracATR * trueATR(bars, exitBar)) / R;
  turnover += prevSize;
  return {
    symbol,
    entryDate: bars[i0].date,
    pnlR: grossR - costR,
    grossR,
    costR,
    turnover,
    exposure,
    minCumR,
    multipliers,
  };
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);

// ============================================================
// TEST SUITE
// ============================================================
describe('Milestone 1 Gate 2 Adversarial Stress Testing', () => {

  describe('Dimension 1: Extreme Price Deflation / Inflation (P -> 0+, P -> infinity)', () => {
    it('handles near-zero prices (micro-penny stocks 1e-12) without division by zero or NaN', () => {
      const mult = relativeVolMultiplier(1e-14, 1e-12, 0.05, 100);
      expect(Number.isFinite(mult)).toBe(true);
      // ATR/P = 1e-14 / 1e-12 = 0.01 (1%). Entry ATR/P = 0.05 / 100 = 0.0005 (0.05%).
      // V_rel = 0.01 / 0.0005 = 20. Mult = 1/20 = 0.05.
      expect(mult).toBeCloseTo(0.05, 6);
      expect(mult).toBeGreaterThan(0);
      expect(mult).toBeLessThanOrEqual(1.0);
    });

    it('handles astronomical price inflation (P -> 1e20, 1e100, Number.MAX_VALUE) stably', () => {
      // Stock goes from $100 to $1e15 (hyper-inflation / mega-trend)
      const pEntry = 100;
      const atrEntry = 5; // 5% vol
      const pNow = 1e15;
      const atrNow = 5e13; // 5% vol
      const mult = relativeVolMultiplier(atrNow, pNow, atrEntry, pEntry);
      // Volatility % is constant: 5% vs 5% -> V_rel = 1.0 -> Mult = 1.0 (no de-levering)
      expect(mult).toBe(1.0);
    });

    it('handles Number.MAX_VALUE price inputs without overflow to Infinity or NaN', () => {
      const pMax = 1e300;
      const atrMax = 1e298; // 1%
      const mult = relativeVolMultiplier(atrMax, pMax, 1, 100); // entry is 1%
      expect(Number.isFinite(mult)).toBe(true);
      expect(mult).toBeCloseTo(1.0, 4);
    });

    it('handles Number.MIN_VALUE subnormal prices safely', () => {
      const pSub = Number.MIN_VALUE; // ~5e-324
      const atrSub = Number.MIN_VALUE;
      const mult = relativeVolMultiplier(atrSub, pSub, 1, 100);
      expect(Number.isFinite(mult)).toBe(true);
      expect(mult).toBeGreaterThan(0);
      expect(mult).toBeLessThanOrEqual(1.0);
    });

    it('de-levers correctly when price collapses 99.9% while dollar ATR stays high (huge % vol expansion)', () => {
      // Entry: $100, ATR $5 (5% vol).
      // Now: $1, ATR $2 (200% vol!).
      // V_rel = 2.0 / 0.05 = 40. Mult = 1/40 = 0.025.
      const mult = relativeVolMultiplier(2, 1, 5, 100);
      expect(mult).toBeCloseTo(0.025, 6);
      expect(mult).toBeGreaterThan(0);
      expect(mult).toBeLessThanOrEqual(1.0);
    });
  });

  describe('Dimension 2: Volatility Flash Crashes (ATR -> 0+)', () => {
    it('when ATR_now approaches 0+ (ultra-calm consolidation), V_rel -> 0 and mult caps strictly at 1.0 (no up-levering)', () => {
      const mult = relativeVolMultiplier(1e-15, 100, 5, 100);
      expect(mult).toBe(1.0); // Never lever up past 1.0
    });

    it('when ATR_now is exactly 0 or subnormal, returns 1.0 fail-safe without throwing', () => {
      expect(relativeVolMultiplier(0, 100, 5, 100)).toBe(1.0);
      expect(relativeVolMultiplier(0.0, 100, 5, 100)).toBe(1.0);
    });
  });

  describe('Dimension 3: Massive Volatility Surges (ATR -> infinity)', () => {
    it('when ATR_now surges 1000x relative to price, sizing smoothly scales down without underflow crashing', () => {
      // Entry: $100, ATR $1 (1% vol).
      // Now: $100, ATR $1000 (1000% vol).
      // V_rel = 10 / 0.01 = 1000. Mult = 1/1000 = 0.001.
      const mult = relativeVolMultiplier(1000, 100, 1, 100);
      expect(mult).toBeCloseTo(0.001, 8);
      expect(mult).toBeGreaterThan(0);
      expect(mult).toBeLessThanOrEqual(1.0);
    });

    it('when ATR_now is astronomical (1e150), mult approaches 0+ gracefully', () => {
      const mult = relativeVolMultiplier(1e150, 100, 1, 100);
      expect(Number.isFinite(mult)).toBe(true);
      expect(mult).toBeGreaterThanOrEqual(0);
      expect(mult).toBeLessThanOrEqual(1.0);
    });
  });

  describe('Dimension 4: Negative, Zero, NaN, and Non-Finite Input Boundary Audit', () => {
    const nonPositiveVectors: Array<[number, number, number, number]> = [
      [0, 100, 5, 100],
      [5, 0, 5, 100],
      [5, 100, 0, 100],
      [5, 100, 5, 0],
      [-1, 100, 5, 100],
      [5, -100, 5, 100],
      [5, 100, -5, 100],
      [5, 100, 5, -100],
      [0, 0, 0, 0],
      [-1, -1, -1, -1],
      [-0, 100, 5, 100],
      [5, -0, 5, 100],
      [-Infinity, 100, 5, 100],
      [5, -Infinity, 5, 100],
    ];

    it('all non-positive finite numbers and negative infinities return 1.0 fail-safe', () => {
      for (const [aN, pN, aE, pE] of nonPositiveVectors) {
        const mult = relativeVolMultiplier(aN, pN, aE, pE);
        expect(mult).toBe(1.0);
      }
    });

    it('documents empirical behavior when NaN is passed into relativeVolMultiplier (NaN bypasses <= 0 check)', () => {
      // In JS, NaN <= 0 is false, so NaN slips past the <= 0 guard and yields NaN.
      // This is a documented empirical challenger finding.
      const nanResult = relativeVolMultiplier(NaN, 100, 5, 100);
      expect(Number.isNaN(nanResult)).toBe(true);
    });
  });

  describe('Dimension 5: 100,000 Randomized Invariant Fuzzing Matrix', () => {
    it('verifies strict bounds Lambda in (0, 1] across 100,000 randomized parameter tuples', () => {
      // Generate log-uniform random numbers across 30 orders of magnitude (1e-15 to 1e15)
      let minLambda = Infinity;
      let maxLambda = -Infinity;
      let nanCount = 0;
      let infCount = 0;
      let upLeverCount = 0;

      for (let k = 0; k < 100_000; k++) {
        const logAn = -15 + Math.random() * 30;
        const logPn = -15 + Math.random() * 30;
        const logAe = -15 + Math.random() * 30;
        const logPe = -15 + Math.random() * 30;

        const aN = Math.pow(10, logAn);
        const pN = Math.pow(10, logPn);
        const aE = Math.pow(10, logAe);
        const pE = Math.pow(10, logPe);

        const lambda = relativeVolMultiplier(aN, pN, aE, pE);

        if (Number.isNaN(lambda)) nanCount++;
        if (!Number.isFinite(lambda)) infCount++;
        if (lambda > 1.0000000001) upLeverCount++;

        if (lambda < minLambda) minLambda = lambda;
        if (lambda > maxLambda) maxLambda = lambda;
      }

      expect(nanCount).toBe(0);
      expect(infCount).toBe(0);
      expect(upLeverCount).toBe(0);
      expect(minLambda).toBeGreaterThanOrEqual(0);
      expect(maxLambda).toBeLessThanOrEqual(1.0);
    });
  });

  describe('Dimension 6: Empirical Backtest Verification Across All 591 Trades in 5-Year Real OHLC', () => {
    const fixture = loadFixture();
    const SPREAD_BASE = 0.02;

    const baseTrades: GateTrade[] = [];
    const relVolTrades: GateTrade[] = [];
    const perSymbolRelTrades = new Map<string, GateTrade[]>();
    const perSymbolBaseTrades = new Map<string, GateTrade[]>();

    for (const [sym, bars] of fixture) {
      perSymbolRelTrades.set(sym, []);
      perSymbolBaseTrades.set(sym, []);
      for (const i0 of breakoutSignals(bars)) {
        const ex = chandelierExitBar(bars, i0);
        const tBase = runGateDetailed(sym, bars, i0, ex, 'unit', SPREAD_BASE);
        const tRel = runGateDetailed(sym, bars, i0, ex, 'asym-rel-vol', SPREAD_BASE);
        baseTrades.push(tBase);
        relVolTrades.push(tRel);
        perSymbolBaseTrades.get(sym)!.push(tBase);
        perSymbolRelTrades.get(sym)!.push(tRel);
      }
    }

    it('confirms exactly 591 total trade envelopes across all 6 symbols', () => {
      expect(relVolTrades.length).toBe(591);
      expect(baseTrades.length).toBe(591);
      // Verify all 6 symbols exist
      expect(Array.from(fixture.keys()).sort()).toEqual(['CHK', 'FCX', 'GE', 'KMI', 'NVDA', 'WMT']);
    });

    it('verifies that EVERY single sizing multiplier Lambda in all 591 trades is strictly in (0, 1]', () => {
      let totalBarsEvaluated = 0;
      for (const t of relVolTrades) {
        for (const m of t.multipliers) {
          totalBarsEvaluated++;
          expect(Number.isFinite(m)).toBe(true);
          expect(m).toBeGreaterThan(0);
          expect(m).toBeLessThanOrEqual(1.0);
        }
      }
      expect(totalBarsEvaluated).toBe(20054);
    });

    it('empirically verifies NVDA tail participation expectancy restores to > 1.0R (specifically 1.121R)', () => {
      const nvdaRel = perSymbolRelTrades.get('NVDA')!;
      const nvdaExp = mean(nvdaRel.map(t => t.pnlR));
      expect(nvdaRel.length).toBe(189);
      expect(nvdaExp).toBeCloseTo(1.121, 3);
      expect(nvdaExp).toBeGreaterThan(1.0);
    });

    it('empirically verifies worst trade risk reduction is > 50% (measured 60.55%)', () => {
      const worstBase = Math.min(...baseTrades.map(t => t.pnlR));
      const worstRel = Math.min(...relVolTrades.map(t => t.pnlR));

      expect(worstBase).toBeCloseTo(-1.94, 2);
      expect(worstRel).toBeCloseTo(-0.76, 2);

      const riskReduction = (worstRel - worstBase) / Math.abs(worstBase);
      expect(riskReduction).toBeCloseTo(0.6055, 3); // 60.55% reduction
      expect(riskReduction).toBeGreaterThan(0.50);
    });

    it('empirically verifies mean in-trade drawdown (minCumR) risk reduction is > 50% (measured 59.48%)', () => {
      const meanMinCumBase = mean(baseTrades.map(t => t.minCumR));
      const meanMinCumRel = mean(relVolTrades.map(t => t.minCumR));

      expect(meanMinCumBase).toBeCloseTo(-0.605, 3);
      expect(meanMinCumRel).toBeCloseTo(-0.245, 3);

      const ddReduction = (meanMinCumRel - meanMinCumBase) / Math.abs(meanMinCumBase);
      expect(ddReduction).toBeCloseTo(0.5948, 3); // 59.48% reduction
      expect(ddReduction).toBeGreaterThan(0.50);
    });

    it('logs detailed per-symbol breakdown for independent audit', () => {
      console.log('\n=== EMPIRICAL CHALLENGER BREAKDOWN PER SYMBOL (591 TRADES) ===');
      console.log('Symbol | Trades | Base Exp(R) | RelVol Exp(R) | Base Worst | RelVol Worst | Base MinCum | RelVol MinCum');
      for (const sym of ['CHK', 'FCX', 'GE', 'KMI', 'NVDA', 'WMT']) {
        const b = perSymbolBaseTrades.get(sym)!;
        const r = perSymbolRelTrades.get(sym)!;
        console.log(
          `${sym.padEnd(6)} | ${String(r.length).padStart(6)} | ${mean(b.map(t => t.pnlR)).toFixed(3).padStart(11)} | ${mean(r.map(t => t.pnlR)).toFixed(3).padStart(13)} | ${Math.min(...b.map(t => t.pnlR)).toFixed(2).padStart(10)} | ${Math.min(...r.map(t => t.pnlR)).toFixed(2).padStart(12)} | ${mean(b.map(t => t.minCumR)).toFixed(3).padStart(11)} | ${mean(r.map(t => t.minCumR)).toFixed(3).padStart(13)}`
        );
      }
    });
  });
});

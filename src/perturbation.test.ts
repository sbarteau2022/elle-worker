// ============================================================
// PERTURBATION — pure-core tests. Dissonance as REGULATOR: it keeps the needle
// off the bottom (crosses where the plain one froze), self-gates to transitions,
// and never breaks the open rails.
//   npx vitest run src/perturbation.test.ts
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  freshPerturbed, stepPerturbed, runPerturbationBacktest, DISS_GAIN,
} from './perturbation';
import { ASYM_Z_MAX } from './recovery';

let seed = 55225;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const gauss = () => { let s = 0; for (let i = 0; i < 6; i++) s += rnd(); return s - 3; };

const drive = (closes: number[], gain = DISS_GAIN) => {
  let s = freshPerturbed(closes[0]);
  let r = stepPerturbed(s, closes[1], 'long', gain);
  let activeReg = 0, activePlain = 0, breach = 0;
  for (let i = 1; i < closes.length; i++) {
    r = stepPerturbed(s, closes[i], 'long', gain); s = r.state;
    if (r.active) activeReg++;
    if (r.activePlain) activePlain++;
    if (r.kappaReg <= 0 || r.kappaReg >= 1) breach++;
  }
  return { activeReg, activePlain, breach, final: r, n: closes.length - 1 };
};

describe('gain=0 control — the perturbation vanishes cleanly', () => {
  it('with no dissonance gain, the regulated needle IS the plain fast clock', () => {
    const closes = [100]; let p = 100;
    for (let i = 0; i < 200; i++) { p *= 1 + 0.015 * gauss(); closes.push(p); }
    let s = freshPerturbed(closes[0]);
    for (let i = 1; i < closes.length; i++) {
      const r = stepPerturbed(s, closes[i], 'long', 0); s = r.state;
      expect(r.kappaReg).toBeCloseTo(r.kappaPlain, 9); // identical when gain=0
    }
  });
});

describe('PT-P1 — the needle stays alive: crosses where the plain one froze', () => {
  it('on a transition-bearing series, the perturbed needle is active at least as often as the plain one, and actually crosses', () => {
    // Calm to set a low vol scale, then a sustained regime — the plain
    // self-normalized clock tends to freeze; the perturbed one should cross.
    const closes = [100];
    for (let i = 0; i < 60; i++) closes.push(closes[closes.length - 1] * (1 + 0.002 * gauss()));
    let p = closes[closes.length - 1];
    for (let i = 0; i < 40; i++) { p *= 0.97; closes.push(p); }        // regime down
    for (let i = 0; i < 40; i++) { p *= 1.03; closes.push(p); }        // regime up
    const off = drive(closes, 0);
    const on = drive(closes, DISS_GAIN);
    expect(on.activeReg).toBeGreaterThanOrEqual(off.activeReg);
    expect(on.activeReg).toBeGreaterThan(0); // it crosses — off the bottom
  });
});

describe('PT-P2 — self-gating: quiet in steady state, alive in transition', () => {
  it('a flat tape barely activates — the perturbation does not manufacture crossings from nothing', () => {
    const flat = Array.from({ length: 200 }, (_, i) => 100 + (i % 2 === 0 ? 0.001 : -0.001));
    const r = drive(flat, DISS_GAIN);
    expect(r.activeReg / r.n).toBeLessThan(0.1); // near silent when nothing is happening
  });

  it('it gates to sustained DIRECTION, not raw volatility: a trend activates, directionless churn stays quiet', () => {
    // Two high-vol regimes of comparable magnitude — one directional, one not.
    // The needle must come alive on the sustained move and stay quiet on churn:
    // crossing needs accumulated direction, and the perturbation respects that.
    const trend = [100]; for (let i = 0; i < 120; i++) trend.push(trend[trend.length - 1] * 0.975); // sustained decline
    const churn = [100]; for (let i = 0; i < 120; i++) churn.push(churn[churn.length - 1] * (1 + 0.025 * gauss())); // directionless
    const rt = drive(trend, DISS_GAIN), rch = drive(churn, DISS_GAIN);
    expect(rt.activeReg).toBeGreaterThan(rch.activeReg);   // regime move wakes it; churn does not
    expect(rt.activeReg).toBeGreaterThan(0);
  });
});

describe('PT-P3 — open rails preserved: off the bottom, never into the extremes', () => {
  it('100k hostile steps never push κ_reg to 0 or 1', () => {
    let s = freshPerturbed(100);
    let p = 100, lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 100_000; i++) {
      p *= 1 + (i % 7 === 0 ? 0.15 : 0.03) * gauss();
      if (p <= 0) p = 1;
      const r = stepPerturbed(s, p, 'long'); s = r.state;
      if (r.kappaReg < lo) lo = r.kappaReg;
      if (r.kappaReg > hi) hi = r.kappaReg;
    }
    expect(lo).toBeGreaterThan(0);   // complete failure unreachable
    expect(hi).toBeLessThan(1);      // complete success unreachable
    expect(Math.abs(Math.log(lo / (1 - lo)))).toBeLessThan(ASYM_Z_MAX); // |z_reg| < Z strictly
  }, 20_000);
});

describe('backtest wiring + guards', () => {
  it('runPerturbationBacktest reports reg vs plain and zero rail breaches', () => {
    const closes = [100]; let p = 100;
    for (let i = 0; i < 300; i++) { p *= 1 + (i % 40 < 20 ? 0.004 : 0.025) * gauss(); closes.push(p); }
    const r = runPerturbationBacktest('X', closes, 0.5, 5)!;
    expect(r.railBreaches).toBe(0);              // the invariant holds on real-shaped data
    expect(r.fracActiveReg).toBeGreaterThanOrEqual(r.fracActivePlain);
    expect(Number.isFinite(r.fwdVolWhenActive)).toBe(true);
  });

  it('refuses series too short', () => {
    expect(runPerturbationBacktest('T', [100, 101, 102], 0.5, 5)).toBeNull();
  });
});

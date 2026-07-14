// ============================================================
// DISSONANCE — pure-core tests. The two-clock beat, proven: silent under
// agreement, loud during change, and it FIRES where single-κ only bordered.
//   npx vitest run src/dissonance.test.ts
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  freshDissonance, stepDissonance, readDissonance, runDissonanceBacktest,
  DISS_FIRE, DISS_RHO_FAST, DISS_RHO_SLOW,
} from './dissonance';

let seed = 909090;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const gauss = () => { let s = 0; for (let i = 0; i < 6; i++) s += rnd(); return s - 3; };

const run = (closes: number[]) => {
  let s = freshDissonance(closes[0]);
  const mags: number[] = [];
  for (let i = 1; i < closes.length; i++) { const r = stepDissonance(s, closes[i], 'long'); s = r.state; mags.push(r.mag); }
  return { state: s, mags, final: readDissonance(s) };
};

describe('the two clocks', () => {
  it('the fast clock is faster than the slow clock (ρ ordering)', () => {
    expect(DISS_RHO_FAST).toBeGreaterThan(DISS_RHO_SLOW);
  });

  it('under steady state the clocks CONVERGE — dissonance decays toward silence', () => {
    // A steady trend: after the onset transient, both clocks approach the same
    // equilibrium (z* = −w·zMax, independent of ρ), so the gap shrinks.
    const up = [100]; for (let i = 0; i < 300; i++) up.push(up[up.length - 1] * 1.003);
    const { mags } = run(up);
    const early = Math.max(...mags.slice(5, 40));   // the onset transient
    const late = Math.max(...mags.slice(-40));       // long after — converged
    expect(early).toBeGreaterThan(late);             // dissonance decays as the slow clock catches up
  });

  it('a flat tape is near-silent — nothing to disagree about', () => {
    const flat = Array.from({ length: 200 }, () => 100);
    const { mags } = run(flat);
    expect(Math.max(...mags)).toBeLessThan(DISS_FIRE); // no move → clocks agree → no dissonance
  });
});

describe('PT-D1 — dissonance FIRES where single-κ only bordered', () => {
  it('a calm→shock transition spikes the beat above the fire threshold', () => {
    // Calm establishes both clocks in agreement; a sharp regime break makes the
    // fast clock lurch while the slow one lags — the gap crosses DISS_FIRE.
    const closes = [100];
    for (let i = 0; i < 80; i++) closes.push(closes[closes.length - 1] * (1 + 0.002 * gauss()));
    let px = closes[closes.length - 1];
    for (let i = 0; i < 15; i++) { px *= 0.93; closes.push(px); } // the shock
    const { mags } = run(closes);
    expect(Math.max(...mags)).toBeGreaterThan(DISS_FIRE); // it FIRES — the actionable signal single-κ never produced
  });

  it('over a shock-bearing series, some fraction of bars fire — frac_fired > 0', () => {
    const closes = [100];
    for (let block = 0; block < 20; block++) {
      const calm = block % 2 === 0;
      for (let i = 0; i < 20; i++) {
        const step = calm ? 1 + 0.003 * gauss() : 1 + 0.03 * gauss() - (i === 0 ? 0.05 : 0);
        closes.push(closes[closes.length - 1] * step);
      }
    }
    const r = runDissonanceBacktest('SHOCKY', closes, 0.5, 5)!;
    expect(r.fracFired).toBeGreaterThan(0);   // the win: it fires (single-κ frac at rail was 0 on real data)
    expect(r.dissMagMax).toBeGreaterThan(DISS_FIRE);
  });
});

describe('PT-D3 — signed dissonance still does not forecast direction', () => {
  it('on a random walk, signed D has ~0 correlation with forward return', () => {
    const closes = [100];
    for (let i = 0; i < 800; i++) closes.push(closes[closes.length - 1] * (1 + 0.015 * gauss()));
    const r = runDissonanceBacktest('RW', closes, 0.5, 5)!;
    expect(Math.abs(r.corrDissLeadDir)).toBeLessThan(0.15); // no directional edge — dissonance detects CHANGE, not way
  });
});

describe('mechanics + guards', () => {
  it('the signed gap is fast−slow, and a sustained decline drives it negative first (early warning)', () => {
    // On the FIRST bars of a decline the fast clock strains below the slow one,
    // so d = κ_fast − κ_slow goes negative — the smoke alarm leads the historian.
    const closes = [100];
    for (let i = 0; i < 60; i++) closes.push(closes[closes.length - 1] * 1.001); // calm baseline
    let s = freshDissonance(closes[0]);
    for (let i = 1; i < closes.length; i++) s = stepDissonance(s, closes[i], 'long').state;
    let r = readDissonance(s);
    let px = closes[closes.length - 1];
    for (let i = 0; i < 4; i++) { px *= 0.95; r = stepDissonance(r.state, px, 'long'); }
    expect(r.d).toBeLessThan(0);          // fast strained below slow — the early warning sign
    expect(r.kappaFast).toBeLessThan(r.kappaSlow);
  });

  it('garbage prices are inert', () => {
    const s = freshDissonance(100);
    for (const bad of [NaN, 0, -5, Infinity]) {
      const r = stepDissonance(s, bad, 'long');
      expect(r.state.zFast).toBe(0);
      expect(r.mag).toBe(0);
    }
  });

  it('refuses series too short to warm and test', () => {
    expect(runDissonanceBacktest('TINY', [100, 101, 102], 0.5, 5)).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import {
  amplitudeStep,
  runOscillator,
  noCollapseProof,
  witnessLoadFromPosture,
  witnessOscillatorSelfTest,
  GROWTH_LOW,
  GROWTH_HIGH,
} from './witness-oscillator';

describe('inverse-proportional gains — the same φ·φ⁻¹=1 invariant as the vessel', () => {
  it('GROWTH_LOW · GROWTH_HIGH ≡ 1', () => {
    expect(GROWTH_LOW * GROWTH_HIGH).toBeCloseTo(1, 10);
  });

  it('GROWTH_LOW is the gentle pump (< 1), GROWTH_HIGH the firmer pull (> 1)', () => {
    expect(GROWTH_LOW).toBeLessThan(1);
    expect(GROWTH_HIGH).toBeGreaterThan(1);
  });
});

describe('no collapse — the origin is a proven-unstable equilibrium', () => {
  it('a near-zero amplitude grows AWAY from stillness, not further into it', () => {
    const cp = noCollapseProof(0.02, 400);
    expect(cp.grew_away).toBe(true);
    expect(cp.trace_r[cp.trace_r.length - 1]).toBeGreaterThan(cp.start);
  });

  it('amplitudeStep never drives r toward 0 from just above it', () => {
    let r = 0.05;
    for (let t = 0; t < 120; t++) r = amplitudeStep(r, 0.05, 0.005, t);
    expect(r).toBeGreaterThan(0.3);
  });
});

describe('bounded — the ring never runs away', () => {
  it('a large-amplitude start is pulled back down, not left to diverge', () => {
    let r = 2.5;
    for (let t = 0; t < 300; t++) r = amplitudeStep(r, 0.05, 0.01, t);
    expect(r).toBeLessThan(1.6);
    expect(r).toBeGreaterThan(0.6);
  });

  it('a full run stays under a sane ceiling throughout', () => {
    const r = runOscillator({ r: 1, theta: 0, pressure: 0 }, { steps: 2000, leakRate: 0.02 });
    expect(r.bounded).toBe(true);
  });
});

describe('keeps oscillating — a live ring, never a still point', () => {
  it('θ keeps winding across the whole run', () => {
    const r = runOscillator({ r: 1, theta: 0, pressure: 0 }, { steps: 500, leakRate: 0.02 });
    expect(r.oscillating).toBe(true);
  });

  it('never settles into the collapsed state', () => {
    const r = runOscillator({ r: 1, theta: 0, pressure: 0 }, { steps: 2000, leakRate: 0.02 });
    expect(r.collapsed).toBe(false);
  });
});

describe('the slow leak — the pressure release valve', () => {
  it('with the leak, headroom recovers between shocks and never bottoms out', () => {
    const r = runOscillator({ r: 1, theta: 0, pressure: 0 }, { steps: 3000, leakRate: 0.02, shockEvery: 120, shockAmp: 1.4 });
    expect(r.saturated).toBe(false);
    expect(r.headroom_min).toBeGreaterThan(0.5);
  });

  it('without the leak (the foil), pressure only accumulates and headroom locks at 0', () => {
    const r = runOscillator({ r: 1, theta: 0, pressure: 0 }, { steps: 3000, leakRate: 0, shockEvery: 120, shockAmp: 1.4 });
    expect(r.saturated).toBe(true);
    expect(r.headroom_min).toBeLessThan(1e-6);
  });

  it('the leaky run keeps strictly more headroom than the no-leak control', () => {
    const withLeak = runOscillator({ r: 1, theta: 0, pressure: 0 }, { steps: 3000, leakRate: 0.02, shockEvery: 120, shockAmp: 1.4 });
    const noLeak = runOscillator({ r: 1, theta: 0, pressure: 0 }, { steps: 3000, leakRate: 0, shockEvery: 120, shockAmp: 1.4 });
    expect(withLeak.headroom_min).toBeGreaterThan(noLeak.headroom_min);
  });
});

describe('wired to the real Witness — postureFor()\'s own score scale', () => {
  it('a quiet actor (score 0) reads full headroom', () => {
    const q = witnessLoadFromPosture(0);
    expect(q.pressure).toBe(0);
    expect(q.headroom).toBe(12);
  });

  it('a blocked-tier actor (score 12+) reads zero headroom', () => {
    const b = witnessLoadFromPosture(12);
    expect(b.headroom).toBe(0);
  });

  it('a watch-tier score (2) reads partial headroom', () => {
    const w = witnessLoadFromPosture(2);
    expect(w.headroom).toBeGreaterThan(0);
    expect(w.headroom).toBeLessThan(12);
  });
});

describe('witnessOscillatorSelfTest — the whole certificate green', () => {
  it('inverse gains, no collapse, bounded, oscillating, leak gives headroom, foil saturates, wired to the Witness', () => {
    const st = witnessOscillatorSelfTest();
    expect(st.inverse_proportional_gains).toBe(true);
    expect(st.no_collapse).toBe(true);
    expect(st.bounded).toBe(true);
    expect(st.keeps_oscillating).toBe(true);
    expect(st.slow_leak_gives_headroom).toBe(true);
    expect(st.no_leak_saturates).toBe(true);
    expect(st.wired_to_real_witness_posture).toBe(true);
    expect(st.ok).toBe(true);
  });
});

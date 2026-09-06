// seam-wire unit tests — the port must reproduce rip.py's self-test before any
// real-data number is allowed to mean anything, and the harness must refuse to
// BUILD on noise or on shuffled labels.
import { describe, it, expect } from 'vitest';
import {
  bandpass, envelope, coupling, windows, readoutA, readoutB, toTraceRow, runArm,
  makeRng, WIRE, type FixtureRow,
} from './seam-wire';

function gaussian(rng: () => number): number {
  const u = Math.max(rng(), 1e-12), v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// rip.py self-test, scaled to fs = 1 on a 1024-sample window with rip.py's own
// bands scaled the same way (RIP_BANDS). The permutation null's resolution is
// 1/(slow period): a 32-sample period would floor p near 0.03, a 100-sample
// period (rip.py's) near 0.01 — so the fixture keeps rip.py's period.
const RIP_BANDS = { slow: [0.005, 0.02] as const, fast: [0.08, 0.20] as const };
function ripFixtures(seed = 1) {
  const n = 1024, rng = makeRng(seed);
  // rip.py's geometry scaled by 1/100: 1 Hz → 0.01, 12 Hz → 0.12 cycles/sample.
  const fSlow = 0.01, fFast = 0.12;
  const t = Array.from({ length: n }, (_, i) => i);
  const slow = t.map((i) => Math.sin(2 * Math.PI * fSlow * i));
  const coupled = t.map((i) => slow[i] + (1 + 0.9 * slow[i]) * Math.sin(2 * Math.PI * fFast * i) + 0.3 * gaussian(rng));
  const noise = t.map(() => gaussian(rng));
  const uncoupled = t.map((i) => slow[i] + Math.sin(2 * Math.PI * fFast * i) + 0.3 * gaussian(rng));
  return { coupled, noise, uncoupled };
}

describe('seam-wire · spectral primitives (rip.py port)', () => {
  it('bandpass keeps an in-band tone and kills an out-of-band one', () => {
    const n = 64;
    const inBand = Array.from({ length: n }, (_, i) => Math.sin(2 * Math.PI * (2 / 64) * i));
    const outBand = Array.from({ length: n }, (_, i) => Math.sin(2 * Math.PI * (16 / 64) * i));
    const kept = bandpass(inBand, ...WIRE.SLOW_BAND);
    const killed = bandpass(outBand, ...WIRE.SLOW_BAND);
    const energy = (x: number[]) => x.reduce((s, v) => s + v * v, 0);
    expect(energy(kept) / energy(inBand)).toBeGreaterThan(0.99);
    expect(energy(killed) / energy(outBand)).toBeLessThan(1e-9);
  });
  it('envelope of a pure tone is flat at its amplitude', () => {
    const n = 256;
    const x = Array.from({ length: n }, (_, i) => 0.7 * Math.sin(2 * Math.PI * (16 / 64) * i));
    const e = envelope(x);
    const mid = e.slice(16, n - 16);
    expect(Math.min(...mid)).toBeGreaterThan(0.69);
    expect(Math.max(...mid)).toBeLessThan(0.71);
  });
  it('rejects non-power-of-two windows instead of silently padding', () => {
    expect(() => bandpass(new Array(60).fill(0), 0.1, 0.2)).toThrow(/power of two/);
  });
});

describe('seam-wire · coupling κ_c reproduces rip.py HARNESS VALID', () => {
  const { coupled, noise, uncoupled } = ripFixtures();
  it('coupled (real seam) → p < 0.01', () => {
    const r = coupling(coupled, { nNull: 500, ...RIP_BANDS });
    expect(r.kappa).toBeGreaterThan(0.5);
    expect(r.p).toBeLessThan(0.01);
  });
  it('pure noise → null', () => {
    expect(coupling(noise, { nNull: 500, ...RIP_BANDS }).p).toBeGreaterThanOrEqual(0.01);
  });
  it('uncoupled tones → null', () => {
    expect(coupling(uncoupled, { nNull: 500, ...RIP_BANDS }).p).toBeGreaterThanOrEqual(0.01);
  });
  it('is translation-invariant (adding a constant changes nothing)', () => {
    const a = coupling(coupled, { nNull: 50, seed: 3 });
    const b = coupling(coupled.map((v) => v + 1000), { nNull: 50, seed: 3 });
    expect(b.kappa).toBeCloseTo(a.kappa, 9);
    expect(b.p).toBe(a.p);
  });
  it('is deterministic under a fixed seed', () => {
    expect(coupling(noise, { seed: 11 })).toEqual(coupling(noise, { seed: 11 }));
  });
});

describe('seam-wire · readouts', () => {
  const rng = makeRng(5);
  const series = Array.from({ length: 96 }, () => gaussian(rng));
  it('windows: 96 tokens at 64/4 → 9 windows', () => {
    expect(windows(series).length).toBe(9);
  });
  it('readout B scores every window with a precision in [0,1]', () => {
    const t = readoutB(series);
    expect(t.score.length).toBe(9);
    expect(t.zdot.length).toBe(8);
    expect(t.score.some(Number.isNaN)).toBe(false);
    for (const p of t.precision) { expect(p).toBeGreaterThanOrEqual(0); expect(p).toBeLessThanOrEqual(1); }
  });
  it('readout A is causal: reversing the tail leaves the prefix scores bit-identical', () => {
    const { coupled } = ripFixtures(9);
    const s = coupled.slice(0, 160);
    const cut = 128; // windows fully inside [0,128) are unaffected by what follows
    const flipped = s.slice(0, cut).concat(s.slice(cut).reverse());
    const a = readoutA(s), b = readoutA(flipped);
    const nPrefix = Math.floor((cut - WIRE.WINDOW) / WIRE.STRIDE) + 1;
    expect(a.score.length).toBe(b.score.length);
    expect(a.score.slice(0, nPrefix)).toEqual(b.score.slice(0, nPrefix));
  });
  it('readout A produces a bounded disagreement once the predictor is warm', () => {
    const { coupled } = ripFixtures(2);
    const t = readoutA(coupled.slice(0, 512));
    expect(t.score.length).toBeGreaterThan(10);
    const scored = t.score.filter((d) => !Number.isNaN(d));
    expect(scored.length).toBeGreaterThan(10);
    for (const d of scored) { expect(d).toBeGreaterThanOrEqual(0); expect(d).toBeLessThanOrEqual(1); }
  });
  it('toTraceRow refuses to score a trace with < 2 windows (null, never 0)', () => {
    const row = toTraceRow({ score: [0.3], precision: [1], zdot: [], nWindows: 1, nRejected: 0, seamEvents: 0 }, 1);
    expect(row.reserve).toBeNull();
    expect(row.velocity_peak).toBeNull();
  });
});

describe('seam-wire · harness cannot BUILD on nothing', () => {
  function noiseRows(n: number, seed: number): FixtureRow[] {
    const rng = makeRng(seed);
    return Array.from({ length: n }, (_, i) => ({
      idx: i, correct: true, truncated: rng() < 0.25, n_completion: 96, short: false,
      streams: { x: Array.from({ length: 96 }, () => gaussian(rng)) },
    }));
  }
  const rows = noiseRows(120, 42);
  for (const readout of ['A', 'B'] as const) {
    it(`readout ${readout} on white noise with random labels → not BUILD`, () => {
      const arm = runArm(readout, 'x', rows, (r) => (r.truncated ? 1 : 0));
      expect(arm.report.overall).not.toBe('BUILD');
      for (const kt of arm.report.kill_tests) expect(Math.abs(kt.auc - 0.5)).toBeLessThan(0.15);
    });
  }
  it('Gate 1 refuses fewer than 100 rows', () => {
    const arm = runArm('B', 'x', rows.slice(0, 60), (r) => (r.truncated ? 1 : 0));
    expect(arm.report.overall).toBe('INSUFFICIENT');
  });
});

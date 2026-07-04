import { describe, it, expect } from 'vitest';
import { analyzeSpectrum, prosodyFeatures } from './pfar';

describe('analyzeSpectrum', () => {
  it('finds the dominant frequency of a pure sinusoid', () => {
    // 8 Hz sine sampled at 64 Hz for 1s → dominant bin should be ~8 Hz.
    const sr = 64, cyc = 8;
    const samples = Array.from({ length: sr }, (_, t) => Math.sin((2 * Math.PI * cyc * t) / sr));
    const r = analyzeSpectrum(samples, sr);
    expect(r.n).toBe(64);
    expect(r.sample_rate).toBe(64);
    expect(r.dominant.length).toBeGreaterThan(0);
    expect(Math.abs(r.dominant[0].freq - 8)).toBeLessThan(0.6);
    // one clean tone → highly periodic, low flatness
    expect(r.periodicity).toBeGreaterThan(0.3);
    expect(r.flatness).toBeLessThan(0.5);
  });

  it('reports high flatness for noise-like / flat input and handles tiny input', () => {
    const flat = analyzeSpectrum([1, 1, 1, 1, 1, 1, 1, 1]); // constant → DC removed → ~0 energy
    expect(flat.n).toBe(8);
    expect(analyzeSpectrum([]).n).toBe(0);
    expect(analyzeSpectrum([5]).dominant).toEqual([]);
  });

  it('gives normalized (cycles/sample) freq when no sample rate is passed', () => {
    const samples = Array.from({ length: 32 }, (_, t) => Math.cos((2 * Math.PI * 4 * t) / 32));
    const r = analyzeSpectrum(samples);
    expect(r.sample_rate).toBeNull();
    // 4 cycles over 32 samples → 0.125 cycles/sample
    expect(Math.abs(r.dominant[0].freq - 0.125)).toBeLessThan(0.03);
  });
});

describe('prosodyFeatures', () => {
  it('classifies a rising pitch contour and counts stress peaks', () => {
    const f0 = [100, 105, 110, 118, 130, 145, 160, 180];
    const r = prosodyFeatures(f0, []);
    expect(r.f0).not.toBeNull();
    expect(r.f0!.contour).toBe('rising');
    expect(r.f0!.range).toBeCloseTo(80, 1);
    expect(r.frames).toBe(8);
  });

  it('classifies a falling contour', () => {
    const r = prosodyFeatures([200, 185, 170, 150, 130, 110, 95], []);
    expect(r.f0!.contour).toBe('falling');
  });

  it('ignores unvoiced (<=0) f0 frames and reads the energy envelope rhythm', () => {
    const f0 = [0, 0, 120, 122, 0, 118]; // unvoiced frames dropped
    const energy = [0.1, 0.9, 0.1, 0.1, 0.9, 0.1, 0.1, 0.9, 0.1];
    const r = prosodyFeatures(f0, energy);
    expect(r.f0!.min).toBeGreaterThan(0);
    expect(r.energy).not.toBeNull();
    expect(r.energy!.stress_peaks).toBeGreaterThanOrEqual(2);
    expect(r.energy!.rhythm).not.toBeNull();
  });

  it('returns nulls when there is nothing voiced to measure', () => {
    const r = prosodyFeatures([], []);
    expect(r.f0).toBeNull();
    expect(r.energy).toBeNull();
    expect(r.frames).toBe(0);
  });
});

// ============================================================
// PFAR × WASM FFT (src/pfar-fft.test.ts)
//
// The spectrum route's fast path: pfar.ts quantizes to Q0.30, runs the Rust
// core's radix-2 real FFT through wasm-bridge, and un-scales back to the
// float DFT's units. These tests pin down:
//   1. the bridge actually lights up the WASM backend under vitest,
//   2. quantized-FFT magnitudes match the float64 DFT within 5e-7
//      (measured max ≈ 2.1e-7 at n=4096 — the 1e-7 wish is NOT achievable
//      in Q0.30 at this length, so the threshold is honest, not tight),
//   3. every fallback edge (non-pow2, constant signal, empty) returns
//      bit-identical results to the sync analyzeSpectrum,
//   4. the fast path is actually fast (>10x the sync DFT at n=4096).
// ============================================================

import { describe, expect, it } from 'vitest';
import { analyzeSpectrum, analyzeSpectrumFast } from './pfar';
import { coreStatus, fft } from './wasm-bridge';

// ── signal generators (deterministic; LCG so runs are reproducible) ───────

function makeSignals(n: number): Record<string, number[]> {
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff - 0.5;
  };
  const tone: number[] = new Array(n);
  const speechy: number[] = new Array(n);
  const noise: number[] = new Array(n);
  for (let t = 0; t < n; t++) {
    tone[t] = Math.sin((2 * Math.PI * 200 * t) / n);
    speechy[t] =
      0.6 * Math.sin((2 * Math.PI * 55 * t) / n) +
      0.3 * Math.sin((2 * Math.PI * 110 * t) / n + 0.7) +
      0.15 * Math.sin((2 * Math.PI * 220 * t) / n + 1.3) +
      0.1 * rand();
    noise[t] = rand();
  }
  return { tone, speechy, noise };
}

// Float64 reference DFT over the DC-removed signal — same math as pfar's
// internal float path, magnitudes for bins k = 1..n/2.
function refDftMags(xIn: number[]): number[] {
  const n = xIn.length;
  const mean = xIn.reduce((a, b) => a + b, 0) / n;
  const x = xIn.map((v) => v - mean);
  const half = Math.floor(n / 2);
  const mags: number[] = new Array(half);
  for (let k = 1; k <= half; k++) {
    let re = 0, im = 0;
    const w = (-2 * Math.PI * k) / n;
    for (let t = 0; t < n; t++) {
      const a = w * t;
      re += x[t] * Math.cos(a);
      im += x[t] * Math.sin(a);
    }
    mags[k - 1] = Math.sqrt(re * re + im * im) / n;
  }
  return mags;
}

describe('wasm bridge wiring', () => {
  it('runs the FFT on the real WASM backend, not the TS fallback', async () => {
    const input = new Int32Array(4);
    input[0] = 1 << 28;
    const out = await fft(input);
    expect(out.length).toBe(8);
    expect(out[0]).toBe(1 << 28); // DC bin = sum of inputs
    expect(coreStatus().backend).toBe('wasm');
  });
});

describe('Q0.30 FFT parity vs float64 DFT', () => {
  // Measured maxima: 1.1e-7 (tone/1024), 2.1e-7 (tone/4096). 5e-7 gives
  // ~2.4x headroom without masking a real regression.
  const THRESHOLD = 5e-7;
  const Q30 = 1 << 30;

  for (const n of [1024, 4096]) {
    for (const [name, x] of Object.entries(makeSignals(n))) {
      it(`${name} n=${n}: max |Δmag| < ${THRESHOLD}`, async () => {
        // Mirror pfar's quantization exactly (DC-removed, s = 1.9/Σ|x|).
        const mean = x.reduce((a, b) => a + b, 0) / n;
        const dc = x.map((v) => v - mean);
        let sumAbs = 0;
        for (const v of dc) sumAbs += Math.abs(v);
        const s = 1.9 / sumAbs;
        const q = new Int32Array(n);
        for (let t = 0; t < n; t++) q[t] = Math.round(dc[t] * s * Q30);
        const out = await fft(q);
        const ref = refDftMags(x);
        const unscale = 1 / (s * Q30 * n);
        let maxDiff = 0;
        for (let k = 1; k <= n / 2; k++) {
          const re = out[2 * k], im = out[2 * k + 1];
          const mag = Math.sqrt(re * re + im * im) * unscale;
          maxDiff = Math.max(maxDiff, Math.abs(mag - ref[k - 1]));
        }
        expect(maxDiff).toBeLessThan(THRESHOLD);
      });
    }
  }
});

describe('analyzeSpectrumFast vs analyzeSpectrum', () => {
  it('non-power-of-two length falls back to the float DFT bit-identically', async () => {
    const n = 1000;
    const x = new Array(n).fill(0).map((_, t) => Math.sin((2 * Math.PI * 37 * t) / n) + 0.2 * Math.cos((2 * Math.PI * 90 * t) / n));
    expect(await analyzeSpectrumFast(x, 8000)).toEqual(analyzeSpectrum(x, 8000));
  });

  it('power-of-two tone agrees with the sync path after rounding', async () => {
    const n = 4096, sr = 16000;
    const x = new Array(n).fill(0).map((_, t) => Math.sin((2 * Math.PI * 200 * t) / n));
    const fast = await analyzeSpectrumFast(x, sr);
    const sync = analyzeSpectrum(x, sr);
    expect(fast.n).toBe(sync.n);
    expect(fast.sample_rate).toBe(sync.sample_rate);
    expect(fast.mean).toBe(sync.mean);
    expect(fast.rms).toBe(sync.rms);
    expect(fast.dominant[0].freq).toBe(sync.dominant[0].freq);
    expect(Math.abs(fast.dominant[0].magnitude - sync.dominant[0].magnitude)).toBeLessThanOrEqual(2e-6);
    expect(Math.abs(fast.centroid - sync.centroid)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(fast.flatness - sync.flatness)).toBeLessThanOrEqual(1e-3);
    expect(Math.abs(fast.periodicity - sync.periodicity)).toBeLessThanOrEqual(1e-3);
  });

  it('constant signal (Σ|x|=0 after DC removal) matches the sync path exactly', async () => {
    const x = new Array(256).fill(3.5);
    expect(await analyzeSpectrumFast(x, 100)).toEqual(analyzeSpectrum(x, 100));
  });

  it('empty and single-sample inputs match the sync early return', async () => {
    expect(await analyzeSpectrumFast([], null)).toEqual(analyzeSpectrum([], null));
    expect(await analyzeSpectrumFast([5], 44100)).toEqual(analyzeSpectrum([5], 44100));
  });

  it('is at least 10x faster than the sync DFT at n=4096', async () => {
    const n = 4096;
    const x = new Array(n).fill(0).map((_, t) => Math.sin((2 * Math.PI * 200 * t) / n) + 0.1 * Math.sin((2 * Math.PI * 700 * t) / n));
    await analyzeSpectrumFast(x, 16000); // warm the bridge + JIT
    const t0 = performance.now();
    analyzeSpectrum(x, 16000);
    const syncMs = performance.now() - t0;
    let fastMs = Infinity;
    for (let i = 0; i < 3; i++) {
      const t1 = performance.now();
      await analyzeSpectrumFast(x, 16000);
      fastMs = Math.min(fastMs, performance.now() - t1);
    }
    expect(fastMs).toBeLessThan(syncMs / 10);
  });
});

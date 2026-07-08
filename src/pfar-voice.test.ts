import { describe, it, expect } from 'vitest';
import { voiceFeatures } from './pfar';

// Synthetic signals with KNOWN ground truth — the voice core is deterministic,
// so a pure tone must read as a pure tone.
const SR = 8000;

function tone(freqHz: number, seconds: number, opts: { am?: number; fm?: number; noise?: number } = {}): number[] {
  const n = Math.floor(SR * seconds);
  const out: number[] = [];
  let phase = 0, seed = 42;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = freqHz * (1 + (opts.fm ?? 0) * Math.sin(2 * Math.PI * 3 * t)); // slow 3 Hz wobble
    phase += (2 * Math.PI * f) / SR;
    const amp = 1 + (opts.am ?? 0) * Math.sin(2 * Math.PI * 4 * t);          // slow 4 Hz tremor
    out.push(amp * Math.sin(phase) + (opts.noise ?? 0) * rand());
  }
  return out;
}

const noise = (seconds: number) => tone(0, seconds, { noise: 1 }).map((v, i) => v - Math.sin(0) * i * 0); // pure PRNG noise

describe('voiceFeatures — the Praat/eGeMAPS-style core', () => {
  it('reads a pure 200 Hz tone as exactly that: right F0, fully voiced, steady, clean', () => {
    const v = voiceFeatures(tone(200, 1.5), SR)!;
    expect(v.voiced_fraction).toBeGreaterThan(0.95);
    expect(v.f0!.mean_hz).toBeGreaterThan(195);
    expect(v.f0!.mean_hz).toBeLessThan(205);
    expect(v.jitter_pct!).toBeLessThan(0.5);       // no period perturbation
    expect(v.shimmer_pct!).toBeLessThan(1);        // no amplitude perturbation
    expect(v.hnr_db!).toBeGreaterThan(15);         // harmonic, barely any noise
    expect(v.pauses.count).toBe(0);
    expect(Math.abs(v.f0!.slope_st_per_s)).toBeLessThan(0.5);
  });

  it('caps input at ~1 s of 16 kHz — a long capture is truncated, not refused', () => {
    const v = voiceFeatures(tone(200, 10), SR)!;
    expect(v.duration_s).toBeLessThanOrEqual(16384 / SR + 0.001);
  });

  it('hears amplitude tremor as shimmer and pitch wobble as jitter — separately', () => {
    const clean = voiceFeatures(tone(200, 1.5), SR)!;
    const tremor = voiceFeatures(tone(200, 1.5, { am: 0.35 }), SR)!;
    const wobble = voiceFeatures(tone(200, 1.5, { fm: 0.04 }), SR)!;
    expect(tremor.shimmer_pct!).toBeGreaterThan(clean.shimmer_pct! * 3);
    expect(wobble.jitter_pct!).toBeGreaterThan(clean.jitter_pct! * 3);
  });

  it('reads noise as unvoiced and a noisy tone as a degraded HNR', () => {
    const n = voiceFeatures(noise(1.5), SR)!;
    expect(n.voiced_fraction).toBeLessThan(0.3);
    const clean = voiceFeatures(tone(200, 1.5), SR)!;
    const dirty = voiceFeatures(tone(200, 1.5, { noise: 0.4 }), SR)!;
    expect(dirty.hnr_db!).toBeLessThan(clean.hnr_db! - 5);
  });

  it('finds the pause: tone, silence, tone → one pause of the right length', () => {
    const sig = [...tone(200, 0.6), ...new Array(Math.floor(SR * 0.5)).fill(0), ...tone(200, 0.6)];
    const v = voiceFeatures(sig, SR)!;
    expect(v.pauses.count).toBe(1);
    expect(v.pauses.longest_s).toBeGreaterThan(0.3);
    expect(v.pauses.longest_s).toBeLessThan(0.7);
  });

  it('reports F0 in eGeMAPS semitones with a real rising slope on a rising glide', () => {
    // linear glide 150 → 300 Hz over 1.5 s ≈ one octave = 12 st → ~8 st/s
    const n = Math.floor(SR * 1.5);
    const sig: number[] = [];
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const f = 150 + (150 * i) / n;
      phase += (2 * Math.PI * f) / SR;
      sig.push(Math.sin(phase));
    }
    const v = voiceFeatures(sig, SR)!;
    expect(v.f0!.slope_st_per_s).toBeGreaterThan(4);
    expect(v.f0!.range_st).toBeGreaterThan(8);
    expect(v.f0!.p80_st).toBeGreaterThan(v.f0!.p20_st);
  });

  it('band features: a 200 Hz tone puts its energy low — alpha ratio and Hammarberg both strongly positive', () => {
    // The eGeMAPS band ratios need 5 kHz of bandwidth → 16 kHz capture.
    const SR16 = 16000, n = SR16; // 1 s
    const sig: number[] = [];
    for (let i = 0; i < n; i++) sig.push(Math.sin((2 * Math.PI * 200 * i) / SR16));
    const v = voiceFeatures(sig, SR16)!;
    expect(v.spectral!.centroid_hz).toBeLessThan(400);
    expect(v.spectral!.alpha_ratio_db!).toBeGreaterThan(10);
    expect(v.spectral!.hammarberg_db!).toBeGreaterThan(10);
    // …and at 8 kHz the ratios are honestly null, never fabricated
    expect(voiceFeatures(tone(200, 1), SR)!.spectral!.alpha_ratio_db).toBeNull();
  });

  it('refuses garbage instead of guessing', () => {
    expect(voiceFeatures([0.1, 0.2], SR)).toBeNull();          // too short
    expect(voiceFeatures(tone(200, 1), 100)).toBeNull();       // absurd sample rate
  });
});

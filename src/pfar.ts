// ============================================================
// PFAR — Prosody · FreeQ · Analytic Ripper  (src/pfar.ts)
//
// One move done three ways: RIP THE STRUCTURE OUT OF A STREAM, THEN INTERPRET IT.
// The stream is the only thing that changes:
//
//   • spectrum : a numeric series (κ history, trade prints, any samples)
//                → dominant frequencies, spectral centroid, how periodic it is.
//   • prosody  : pitch (f0) + energy over time — a voice as a signal
//                → range, contour, stress peaks, speech-rate rhythm. HOW it was
//                  said, not what. Reuses the same spectral core on the energy
//                  envelope to find the syllable rhythm.
//   • rhetoric : text → cadence, register fingerprint, and which persuasion
//                tactics an argument deploys. Pairs with the voice registers and
//                Screwtape's War Room.
//
// pfarRoute is the LLM PFAR ROUTER: it looks at what it was handed, decides
// which ripper(s) apply (or obeys an explicit mode), runs them, and synthesizes
// ONE reading. It nests under the elle router as a sub-router — Elle calls one
// tool, `pfar`, and this picks the instrument.
//
// The numeric cores (spectrum, prosody features) are PURE and unit-tested — no
// model, deterministic. Only interpretation and routing touch an LLM.
// ============================================================

import type { Env } from './index';
import { callLLM } from './llm';

// ── deterministic signal core (shared by spectrum + prosody) ──────────────

export interface SpectralPeak { freq: number; magnitude: number }
export interface SpectrumResult {
  n: number;
  sample_rate: number | null;        // Hz if known; else null (freq is cycles/sample)
  dominant: SpectralPeak[];          // top peaks, strongest first
  centroid: number;                  // spectral centroid (same units as freq)
  flatness: number;                  // 0 (one pure tone) .. 1 (white/flat)
  periodicity: number;               // 0..1: how much energy sits in the top peak
  mean: number;
  rms: number;
}

// Naive DFT magnitude spectrum. O(N²) — fine for the small series this sees
// (κ windows, price windows, energy envelopes). Caps N so a bad caller can't
// wedge the isolate. Returns structure, not a verdict.
export function analyzeSpectrum(samplesIn: number[], sampleRate?: number | null): SpectrumResult {
  const samples = samplesIn.filter((x) => Number.isFinite(x)).slice(0, 4096);
  const n = samples.length;
  const sr = sampleRate && Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : null;
  if (n < 2) {
    return { n, sample_rate: sr, dominant: [], centroid: 0, flatness: 0, periodicity: 0, mean: n ? samples[0] : 0, rms: n ? Math.abs(samples[0]) : 0 };
  }
  const mean = samples.reduce((a, b) => a + b, 0) / n;
  const rms = Math.sqrt(samples.reduce((a, b) => a + b * b, 0) / n);
  // Remove DC so the constant offset doesn't dominate bin 0.
  const x = samples.map((v) => v - mean);

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

  // bin index k (1..half) → frequency. Cycles/sample = k/n; Hz = k/n * sr.
  const freqOf = (k1: number) => (sr ? (k1 / n) * sr : k1 / n);

  const totalMag = mags.reduce((a, b) => a + b, 0) || 1e-12;
  let centroidNum = 0;
  for (let i = 0; i < mags.length; i++) centroidNum += freqOf(i + 1) * mags[i];
  const centroid = centroidNum / totalMag;

  // Spectral flatness = geometric mean / arithmetic mean of the magnitudes.
  let logSum = 0, arith = 0, cnt = 0;
  for (const m of mags) { const v = m + 1e-12; logSum += Math.log(v); arith += v; cnt++; }
  const flatness = cnt ? Math.exp(logSum / cnt) / (arith / cnt) : 0;

  // Rank peaks (local maxima first, then fall back to plain top bins).
  const peaks: SpectralPeak[] = [];
  for (let i = 0; i < mags.length; i++) {
    const l = i > 0 ? mags[i - 1] : -Infinity;
    const r = i < mags.length - 1 ? mags[i + 1] : -Infinity;
    if (mags[i] >= l && mags[i] >= r) peaks.push({ freq: freqOf(i + 1), magnitude: mags[i] });
  }
  const ranked = (peaks.length ? peaks : mags.map((m, i) => ({ freq: freqOf(i + 1), magnitude: m })))
    .sort((a, b) => b.magnitude - a.magnitude)
    .slice(0, 5);

  const periodicity = ranked.length ? ranked[0].magnitude / totalMag : 0;

  return {
    n, sample_rate: sr,
    dominant: ranked.map((p) => ({ freq: round(p.freq, 5), magnitude: round(p.magnitude, 6) })),
    centroid: round(centroid, 5),
    flatness: round(Math.max(0, Math.min(1, flatness)), 4),
    periodicity: round(Math.max(0, Math.min(1, periodicity)), 4),
    mean: round(mean, 6), rms: round(rms, 6),
  };
}

export interface ProsodyResult {
  frames: number;
  f0: { min: number; max: number; mean: number; range: number; std: number; contour: 'rising' | 'falling' | 'flat' | 'varied'; stress_peaks: number } | null;
  energy: { mean: number; std: number; stress_peaks: number; rhythm: SpectrumResult | null } | null;
}

// Pitch + energy tracks over time → the shape of an utterance. Pure. The energy
// envelope is run back through analyzeSpectrum to expose the syllable rhythm.
export function prosodyFeatures(f0In: number[] = [], energyIn: number[] = []): ProsodyResult {
  const f0 = f0In.filter((x) => Number.isFinite(x) && x > 0); // 0/neg = unvoiced
  const energy = energyIn.filter((x) => Number.isFinite(x));
  const frames = Math.max(f0.length, energy.length);

  let f0Block: ProsodyResult['f0'] = null;
  if (f0.length >= 2) {
    const min = Math.min(...f0), max = Math.max(...f0);
    const mean = f0.reduce((a, b) => a + b, 0) / f0.length;
    const std = Math.sqrt(f0.reduce((a, b) => a + (b - mean) ** 2, 0) / f0.length);
    f0Block = {
      min: round(min, 2), max: round(max, 2), mean: round(mean, 2),
      range: round(max - min, 2), std: round(std, 2),
      contour: contourOf(f0, mean, std), stress_peaks: countPeaks(f0),
    };
  }

  let energyBlock: ProsodyResult['energy'] = null;
  if (energy.length >= 2) {
    const mean = energy.reduce((a, b) => a + b, 0) / energy.length;
    const std = Math.sqrt(energy.reduce((a, b) => a + (b - mean) ** 2, 0) / energy.length);
    energyBlock = {
      mean: round(mean, 4), std: round(std, 4), stress_peaks: countPeaks(energy),
      rhythm: energy.length >= 4 ? analyzeSpectrum(energy) : null,
    };
  }

  return { frames, f0: f0Block, energy: energyBlock };
}

function contourOf(v: number[], mean: number, std: number): 'rising' | 'falling' | 'flat' | 'varied' {
  // Least-squares slope over the index; classify against the pitch spread.
  const n = v.length;
  const xm = (n - 1) / 2;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (i - xm) * (v[i] - mean); den += (i - xm) ** 2; }
  const slope = den ? num / den : 0;
  const totalRise = slope * (n - 1);
  if (std > 0 && Math.abs(totalRise) < std) return std < mean * 0.03 ? 'flat' : 'varied';
  return totalRise > 0 ? 'rising' : 'falling';
}

function countPeaks(v: number[]): number {
  if (v.length < 3) return 0;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const std = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length) || 1e-9;
  const thresh = mean + 0.5 * std; // a peak has to actually stand out
  let peaks = 0;
  for (let i = 1; i < v.length - 1; i++) {
    if (v[i] > v[i - 1] && v[i] >= v[i + 1] && v[i] >= thresh) peaks++;
  }
  return peaks;
}

function round(x: number, p: number): number {
  const f = 10 ** p;
  return Math.round(x * f) / f;
}

// ── the voice ripper (pure — raw samples in, the instrument-grade read out) ──
// The upgrade wave: math ported from the specialists instead of reinvented.
// F0 tracking is Praat's autocorrelation method (Boersma 1993, simplified:
// Hann window, normalized autocorrelation, parabolic peak interpolation);
// jitter/shimmer/HNR follow Praat's definitions (frame-granular here, not
// cycle-granular — honest proxies, labeled as such); the parameter SET is
// chosen to track eGeMAPS (openSMILE's Geneva minimal set): F0 in semitones
// with percentiles and slope, jitter, shimmer, HNR, voiced fraction, pauses,
// alpha ratio, Hammarberg index, spectral centroid. Pure and deterministic —
// the same window always rips to the same numbers, which is what a
// longitudinal baseline (the κ-drift work) requires of its instrument.
//
// Send ONE short window (≤ MAX_VOICE_SAMPLES ≈ 1s at 16 kHz); baselines are
// built from many windows over time, not one long capture.

const MAX_VOICE_SAMPLES = 16384;
const F0_MIN = 60, F0_MAX = 500;          // Hz — the human speech band
const VOICING_THRESHOLD = 0.45;           // normalized autocorr peak to call a frame voiced

export interface VoiceFeatures {
  sample_rate: number;
  duration_s: number;
  frames: number;
  voiced_fraction: number;                 // 0..1
  f0: {
    mean_hz: number; median_hz: number;
    mean_st: number; std_st: number; range_st: number;  // semitones re 27.5 Hz
    p20_st: number; p80_st: number;
    slope_st_per_s: number;                // least-squares drift over the window
  } | null;
  jitter_pct: number | null;               // frame-granular period perturbation (Praat 'local' style proxy)
  shimmer_pct: number | null;              // frame-granular amplitude perturbation proxy
  hnr_db: number | null;                   // mean autocorrelation HNR over voiced frames
  pauses: { count: number; longest_s: number };  // unvoiced runs ≥ 200 ms
  spectral: {
    centroid_hz: number;
    alpha_ratio_db: number | null;         // 10·log10( E[50–1000] / E[1000–5000] ) — needs 5 kHz of bandwidth
    hammarberg_db: number | null;          // 10·log10( peak[0–2000] / peak[2000–5000] )
  } | null;
}

export function voiceFeatures(samplesIn: number[], sampleRate: number): VoiceFeatures | null {
  if (!Number.isFinite(sampleRate) || sampleRate < 4000) return null;
  const samples = samplesIn.filter((v) => Number.isFinite(v)).slice(0, MAX_VOICE_SAMPLES);
  const frameLen = sampleRate >= 11025 ? 512 : 256;
  if (samples.length < frameLen * 2) return null;
  const hop = frameLen / 2;

  // Global RMS sets the silence floor; a frame well under it can't be voiced.
  const globalRms = Math.sqrt(samples.reduce((a, b) => a + b * b, 0) / samples.length) || 1e-12;
  const hann = new Array(frameLen);
  for (let i = 0; i < frameLen; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frameLen - 1));

  const lagMin = Math.max(2, Math.floor(sampleRate / F0_MAX));
  const lagMax = Math.min(frameLen - 2, Math.ceil(sampleRate / F0_MIN));

  // Boersma's correction: the Hann taper depresses the raw autocorrelation
  // peak, so divide by the WINDOW's own normalized autocorrelation at each
  // lag — a perfectly periodic frame then reads r ≈ 1 again.
  let hannEnergy = 0;
  for (let i = 0; i < frameLen; i++) hannEnergy += hann[i] * hann[i];
  const rw = new Array(lagMax + 1).fill(1);
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let acc = 0;
    for (let i = 0; i < frameLen - lag; i++) acc += hann[i] * hann[i + lag];
    rw[lag] = Math.max(1e-6, acc / hannEnergy);
  }

  interface Frame { voiced: boolean; f0: number; rms: number; hnr: number }
  const frames: Frame[] = [];

  for (let start = 0; start + frameLen <= samples.length; start += hop) {
    const x = new Array(frameLen);
    let mean = 0;
    for (let i = 0; i < frameLen; i++) mean += samples[start + i];
    mean /= frameLen;
    let energy = 0;
    for (let i = 0; i < frameLen; i++) { x[i] = (samples[start + i] - mean) * hann[i]; energy += x[i] * x[i]; }
    const rms = Math.sqrt(energy / frameLen);
    if (energy < 1e-12 || rms < globalRms * 0.1) { frames.push({ voiced: false, f0: 0, rms, hnr: 0 }); continue; }

    // Window-corrected normalized autocorrelation over the speech lag band;
    // parabolic interpolation refines the winning lag to sub-sample precision.
    const rArr = new Array(lagMax + 1).fill(0);
    for (let lag = lagMin; lag <= lagMax; lag++) {
      let acc = 0;
      for (let i = 0; i < frameLen - lag; i++) acc += x[i] * x[i + lag];
      rArr[lag] = Math.min(0.999999, (acc / energy) / rw[lag]);
    }
    // Candidate selection with Praat's octave cost: a periodic signal has
    // near-equal peaks at every multiple of the true period, so lag choice
    // must PREFER the shorter lag unless the longer one is genuinely
    // stronger — otherwise the track halves in frequency at random.
    const OCTAVE_COST = 0.02; // per octave of lag
    let bestLag = 0, bestScore = -Infinity;
    for (let lag = lagMin; lag <= lagMax; lag++) {
      const score = rArr[lag] - OCTAVE_COST * Math.log2(lag / lagMin);
      if (score > bestScore) { bestScore = score; bestLag = lag; }
    }
    const bestR = bestLag ? rArr[bestLag] : 0;
    if (bestR < VOICING_THRESHOLD || !bestLag) { frames.push({ voiced: false, f0: 0, rms, hnr: 0 }); continue; }
    let lag = bestLag;
    const rPrev = bestLag > lagMin ? rArr[bestLag - 1] : bestR;
    const rNext = bestLag < lagMax ? rArr[bestLag + 1] : bestR;
    const denom = rPrev - 2 * bestR + rNext;
    if (Math.abs(denom) > 1e-12) lag += 0.5 * (rPrev - rNext) / denom;
    const f0 = sampleRate / lag;
    const hnr = 10 * Math.log10(bestR / (1 - bestR)); // Praat's autocorrelation HNR
    frames.push({ voiced: f0 >= F0_MIN && f0 <= F0_MAX, f0, rms, hnr });
  }

  const voiced = frames.filter((f) => f.voiced);
  const voicedFraction = frames.length ? voiced.length / frames.length : 0;

  // F0 statistics in semitones re 27.5 Hz (the eGeMAPS convention).
  let f0Block: VoiceFeatures['f0'] = null;
  if (voiced.length >= 2) {
    const hz = voiced.map((f) => f.f0);
    const st = hz.map((f) => 12 * Math.log2(f / 27.5));
    const meanSt = st.reduce((a, b) => a + b, 0) / st.length;
    const stdSt = Math.sqrt(st.reduce((a, b) => a + (b - meanSt) ** 2, 0) / st.length);
    const sorted = [...st].sort((a, b) => a - b);
    const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    // Slope over real time: voiced frames keep their frame index.
    const secondsPerFrame = hop / sampleRate;
    let num = 0, den = 0, tMean = 0;
    const times: number[] = [];
    frames.forEach((f, i) => { if (f.voiced) times.push(i * secondsPerFrame); });
    tMean = times.reduce((a, b) => a + b, 0) / times.length;
    for (let i = 0; i < st.length; i++) { num += (times[i] - tMean) * (st[i] - meanSt); den += (times[i] - tMean) ** 2; }
    f0Block = {
      mean_hz: round(hz.reduce((a, b) => a + b, 0) / hz.length, 2),
      median_hz: round([...hz].sort((a, b) => a - b)[Math.floor(hz.length / 2)], 2),
      mean_st: round(meanSt, 2), std_st: round(stdSt, 2),
      range_st: round(sorted[sorted.length - 1] - sorted[0], 2),
      p20_st: round(pct(0.2), 2), p80_st: round(pct(0.8), 2),
      slope_st_per_s: round(den > 1e-12 ? num / den : 0, 3),
    };
  }

  // Jitter/shimmer: mean absolute frame-to-frame perturbation over
  // CONSECUTIVE voiced frames, as a percentage of the mean (Praat 'local'
  // definitions at frame granularity — proxies, and labeled so above).
  const perturbation = (vals: number[]): number | null => {
    if (vals.length < 3) return null;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    if (mean < 1e-12) return null;
    let acc = 0, n = 0;
    for (let i = 1; i < vals.length; i++) { acc += Math.abs(vals[i] - vals[i - 1]); n++; }
    return (acc / n / mean) * 100;
  };
  const runsOfVoiced: Frame[][] = [];
  let run: Frame[] = [];
  for (const f of frames) {
    if (f.voiced) run.push(f);
    else { if (run.length > 1) runsOfVoiced.push(run); run = []; }
  }
  if (run.length > 1) runsOfVoiced.push(run);
  const periods: number[] = [], amps: number[] = [];
  for (const r of runsOfVoiced) {
    for (const f of r) { periods.push(1 / f.f0); amps.push(f.rms); }
    periods.push(NaN); amps.push(NaN); // break perturbation across runs
  }
  const contiguous = (vals: number[]) => {
    // perturbation() over each NaN-delimited run, weighted by run length
    let accNum = 0, accDen = 0;
    let seg: number[] = [];
    const flushSeg = () => {
      const p = perturbation(seg);
      if (p !== null) { accNum += p * seg.length; accDen += seg.length; }
      seg = [];
    };
    for (const v of vals) { if (Number.isNaN(v)) flushSeg(); else seg.push(v); }
    flushSeg();
    return accDen ? accNum / accDen : null;
  };
  const jitter = contiguous(periods);
  const shimmer = contiguous(amps);
  const hnrMean = voiced.length ? voiced.reduce((a, f) => a + f.hnr, 0) / voiced.length : null;

  // Pauses: unvoiced runs ≥ 200 ms.
  const secondsPerFrame = hop / sampleRate;
  const minPauseFrames = Math.ceil(0.2 / secondsPerFrame);
  let pauseCount = 0, longest = 0, cur = 0;
  for (const f of frames) {
    if (!f.voiced) { cur++; }
    else { if (cur >= minPauseFrames) { pauseCount++; longest = Math.max(longest, cur); } cur = 0; }
  }
  if (cur >= minPauseFrames) { pauseCount++; longest = Math.max(longest, cur); }

  // Band features off one Hann-windowed spectrum of the center of the window.
  let spectral: VoiceFeatures['spectral'] = null;
  {
    const segLen = Math.min(2048, samples.length);
    const off = Math.floor((samples.length - segLen) / 2);
    const nyquist = sampleRate / 2;
    const bandStats = bandEnergies(samples.slice(off, off + segLen), sampleRate);
    spectral = {
      // POWER-weighted centroid (≤5 kHz band): the leakage floor of a
      // magnitude-weighted centroid drags it upward on clean tones.
      centroid_hz: bandStats ? round(bandStats.centroid, 1) : 0,
      alpha_ratio_db: nyquist >= 5000 && bandStats ? round(10 * Math.log10((bandStats.e50_1000 + 1e-12) / (bandStats.e1000_5000 + 1e-12)), 2) : null,
      hammarberg_db: nyquist >= 5000 && bandStats ? round(10 * Math.log10((bandStats.peak0_2000 + 1e-12) / (bandStats.peak2000_5000 + 1e-12)), 2) : null,
    };
  }

  return {
    sample_rate: sampleRate,
    duration_s: round(samples.length / sampleRate, 3),
    frames: frames.length,
    voiced_fraction: round(voicedFraction, 3),
    f0: f0Block,
    jitter_pct: jitter === null ? null : round(jitter, 3),
    shimmer_pct: shimmer === null ? null : round(shimmer, 3),
    hnr_db: hnrMean === null ? null : round(hnrMean, 2),
    pauses: { count: pauseCount, longest_s: round(longest * secondsPerFrame, 2) },
    spectral,
  };
}

// One coarse DFT pass (≤5 kHz) for the eGeMAPS band ratios + power centroid.
function bandEnergies(x: number[], sr: number): { e50_1000: number; e1000_5000: number; peak0_2000: number; peak2000_5000: number; centroid: number } | null {
  const n = Math.min(x.length, 1024);
  if (n < 64) return null;
  const mean = x.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let e50_1000 = 0, e1000_5000 = 0, peak0_2000 = 0, peak2000_5000 = 0;
  let powSum = 0, centroidNum = 0;
  const half = Math.floor(n / 2);
  for (let k = 1; k <= half; k++) {
    const freq = (k / n) * sr;
    if (freq > 5000) break;
    let re = 0, im = 0;
    const w = (-2 * Math.PI * k) / n;
    for (let t = 0; t < n; t++) { const a = w * t; const v = x[t] - mean; re += v * Math.cos(a); im += v * Math.sin(a); }
    const mag = Math.sqrt(re * re + im * im) / n;
    const pow = mag * mag;
    powSum += pow; centroidNum += freq * pow;
    if (freq >= 50 && freq < 1000) e50_1000 += pow;
    if (freq >= 1000 && freq <= 5000) e1000_5000 += pow;
    if (freq <= 2000) peak0_2000 = Math.max(peak0_2000, mag);
    if (freq > 2000 && freq <= 5000) peak2000_5000 = Math.max(peak2000_5000, mag);
  }
  return { e50_1000, e1000_5000, peak0_2000, peak2000_5000, centroid: powSum > 1e-18 ? centroidNum / powSum : 0 };
}

// ── the rhetoric ripper (LLM analytic over text) ──────────────────────────

const RHETORIC_SYSTEM =
`You are a rhetoric ripper. Given a passage, expose its STRUCTURE, not its truth. Report:
- register: the voice/tone fingerprint (e.g. plain-declarative, academic, homiletic, adversarial, ironic).
- cadence: sentence-length rhythm and any deliberate repetition/parallelism/tricolon.
- devices: the rhetorical/persuasion tactics actually deployed (e.g. appeal to authority, false dilemma, anaphora, concession-then-pivot, loaded framing). Name only what is present.
- move: in one sentence, what the passage is trying to make the reader do or believe.
- tell: the single most revealing structural tell.
Return EXACTLY ONE JSON object: {"register":"","cadence":"","devices":["",""],"move":"","tell":""}. No prose outside it.`;

async function ripRhetoric(env: Env, text: string): Promise<unknown> {
  const t = String(text ?? '').trim();
  if (!t) return { error: 'rhetoric ripper: text required' };
  const r = await callLLM('reasoning', RHETORIC_SYSTEM, [{ role: 'user', content: t.slice(0, 6000) }], 600, env);
  const parsed = firstJson(r.content);
  return parsed ?? { raw: String(r.content).slice(0, 500) };
}

// ── the PFAR router ───────────────────────────────────────────────────────

export interface PfarInput {
  mode?: 'spectrum' | 'prosody' | 'voice' | 'rhetoric' | 'auto';
  text?: string;
  signal?: number[];          // raw numeric series for the spectrum ripper
  sample_rate?: number;       // Hz, if the signal is time-sampled
  f0?: number[];              // pitch track for the prosody ripper
  energy?: number[];          // energy/RMS envelope for the prosody ripper
  samples?: number[];         // raw mono PCM window for the VOICE ripper (≤ ~1 s; needs sample_rate)
  interpret?: boolean;        // default true: add an LLM reading over the numbers
}

const SYNTH_SYSTEM =
`You are PFAR's synthesis head. You are handed the STRUCTURAL output of one or more signal rippers (spectrum / prosody / voice / rhetoric). In 2-4 sentences say what the structure MEANS for the caller — what it reveals, and what to do or watch next. Ground every claim in the numbers you were given; do not invent figures. Be concrete, no hedging. For voice: jitter/shimmer/HNR here are frame-granular proxies — describe what they suggest, never diagnose.`;

// Decide which ripper(s) the input calls for, run them, and synthesize one
// reading. mode='auto' (default) infers from which fields are present.
export async function pfarRoute(env: Env, input: PfarInput): Promise<string> {
  const mode = input.mode && input.mode !== 'auto' ? input.mode : inferMode(input);
  if (!mode) {
    return JSON.stringify({ error: 'pfar: nothing to rip. Provide text (rhetoric), signal[] (spectrum), or f0[]/energy[] (prosody).' });
  }
  const interpret = input.interpret !== false;
  const report: Record<string, unknown> = { mode };

  try {
    if (mode === 'spectrum') {
      report.spectrum = analyzeSpectrum(input.signal ?? [], input.sample_rate ?? null);
    } else if (mode === 'prosody') {
      report.prosody = prosodyFeatures(input.f0 ?? [], input.energy ?? []);
    } else if (mode === 'voice') {
      const vf = voiceFeatures(input.samples ?? [], Number(input.sample_rate));
      if (!vf) return JSON.stringify({ mode, error: 'pfar voice: need samples[] (a short raw mono window, ≥2 frames) and sample_rate ≥ 4000 Hz' });
      report.voice = vf;
    } else if (mode === 'rhetoric') {
      report.rhetoric = await ripRhetoric(env, input.text ?? '');
    }
  } catch (e) {
    return JSON.stringify({ mode, error: `pfar ripper failed: ${(e as Error).message}` });
  }

  // Rhetoric already returns an interpretation; the numeric rippers get an
  // optional LLM reading laid over the deterministic numbers.
  if (interpret && mode !== 'rhetoric') {
    try {
      const facts = JSON.stringify(report[mode]);
      const ctx = input.text ? `\nCaller context: ${String(input.text).slice(0, 400)}` : '';
      const r = await callLLM('reasoning', SYNTH_SYSTEM, [{ role: 'user', content: `Ripper output (${mode}):\n${facts}${ctx}` }], 300, env);
      report.reading = String(r.content).trim();
    } catch { /* the numbers stand on their own if synthesis is unreachable */ }
  }

  return JSON.stringify(report);
}

function inferMode(input: PfarInput): PfarInput['mode'] | null {
  if (input.samples && input.samples.length) return 'voice';
  if ((input.f0 && input.f0.length) || (input.energy && input.energy.length)) return 'prosody';
  if (input.signal && input.signal.length) return 'spectrum';
  if (input.text && input.text.trim()) return 'rhetoric';
  return null;
}

// Balanced first-{...} extractor shared with the rhetoric ripper.
function firstJson(text: unknown): unknown | null {
  const s = String(text ?? '').replace(/```json|```/g, '');
  const start = s.indexOf('{'); const end = s.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

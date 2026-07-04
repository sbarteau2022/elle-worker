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
  mode?: 'spectrum' | 'prosody' | 'rhetoric' | 'auto';
  text?: string;
  signal?: number[];          // raw numeric series for the spectrum ripper
  sample_rate?: number;       // Hz, if the signal is time-sampled
  f0?: number[];              // pitch track for the prosody ripper
  energy?: number[];          // energy/RMS envelope for the prosody ripper
  interpret?: boolean;        // default true: add an LLM reading over the numbers
}

const SYNTH_SYSTEM =
`You are PFAR's synthesis head. You are handed the STRUCTURAL output of one or more signal rippers (spectrum / prosody / rhetoric). In 2-4 sentences say what the structure MEANS for the caller — what it reveals, and what to do or watch next. Ground every claim in the numbers you were given; do not invent figures. Be concrete, no hedging.`;

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

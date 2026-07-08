// ============================================================
// vFAR — Visual · FreeQ · Analytic Ripper  (src/vfar.ts)
//
// PFAR's twin, pointed at IMAGES — and unlike PFAR it runs BOTH directions:
// rip the structure out of an image, and put structure back INTO one.
//
//   • rip      : pixels → the structure. Field statistics (contrast, entropy,
//                edge density, orientation energy, symmetry, luminous
//                balance), SPATIAL RHYTHM — PFAR's own spectral core run
//                along both axes (an image is just two signals at right
//                angles) — and the palette (dominant colors, warmth,
//                saturation, colorfulness). Deterministic, pure, unit-tested.
//   • resynth  : ripped structure → a deterministic image. Gratings at the
//                dominant spatial frequencies, laid over the dominant
//                palette. No model anywhere — this is the fingerprint made
//                visible, the decomposer inverted. Stored in R2.
//   • generate : prompt → image via Workers AI (FLUX schnell), stored in R2.
//                The model-based composer, for when she wants to MAKE a
//                picture rather than resynthesize a fingerprint.
//
// Pixels arrive as ARRAYS (luma, optional interleaved rgb), never as encoded
// files: the eyes — the workbench, the phone — rasterize and downsample
// on-device and send numbers. That is the ladder's rung-2 pattern (on-device
// measurement, numbers-only upload) built into the instrument's signature,
// and it keeps this worker free of image codecs.
//
// vfarRoute is the router, same shape as pfarRoute: pick the instrument from
// what was handed over (or obey an explicit mode), run it, lay one LLM
// reading over the numbers. The numeric cores never touch a model.
// ============================================================

import type { Env } from './index';
import { callLLM } from './llm';
import { analyzeSpectrum, type SpectrumResult } from './pfar';

const MAX_PIXELS = 16384;   // 128×128 — the eyes downsample before sending
const MAX_RESYNTH = 512;    // resynth canvas cap, px per side

// ── the field ripper (pure) ───────────────────────────────────────────────

export interface FieldResult {
  w: number; h: number;
  mean: number;                       // 0..255
  contrast: number;                   // std of luma, 0..~128
  entropy: number;                    // 0..1 (normalized Shannon over 32 bins)
  edge_density: number;               // 0..1 (mean Sobel magnitude, normalized)
  dominant_orientation: 'horizontal' | 'vertical' | 'diagonal-up' | 'diagonal-down' | null;
  anisotropy: number;                 // 0 (edges every which way) .. 1 (one direction)
  symmetry: { horizontal: number; vertical: number }; // mirror correlation, 0..1
  balance: { x: number; y: number };  // luminous center of mass offset, -1..1
}

// Accepts luma in 0..1 or 0..255; normalizes to 0..255 internally.
function normalizeLuma(lumaIn: number[], count: number): number[] | null {
  const luma = lumaIn.filter((v) => Number.isFinite(v)).slice(0, count);
  if (luma.length < count) return null;
  const max = Math.max(...luma);
  return max <= 1.000001 ? luma.map((v) => v * 255) : luma;
}

export function analyzeField(lumaIn: number[], w: number, h: number): FieldResult | null {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 2 || h < 2 || w * h > MAX_PIXELS) return null;
  const luma = normalizeLuma(lumaIn, w * h);
  if (!luma) return null;
  const n = w * h;
  const px = (x: number, y: number) => luma[y * w + x];

  const mean = luma.reduce((a, b) => a + b, 0) / n;
  const contrast = Math.sqrt(luma.reduce((a, b) => a + (b - mean) ** 2, 0) / n);

  // Shannon entropy over a 32-bin histogram, normalized to [0,1].
  const bins = new Array(32).fill(0);
  for (const v of luma) bins[Math.min(31, Math.max(0, Math.floor(v / 8)))]++;
  let entropy = 0;
  for (const c of bins) { if (c > 0) { const p = c / n; entropy -= p * Math.log2(p); } }
  entropy /= 5; // log2(32)

  // Sobel over interior pixels: edge density + orientation energy. The EDGE
  // orientation is perpendicular to the gradient; fold into 4 bins.
  let magSum = 0;
  const orient = [0, 0, 0, 0]; // horizontal, diagonal-up, vertical, diagonal-down
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const gx = (px(x + 1, y - 1) + 2 * px(x + 1, y) + px(x + 1, y + 1))
               - (px(x - 1, y - 1) + 2 * px(x - 1, y) + px(x - 1, y + 1));
      const gy = (px(x - 1, y + 1) + 2 * px(x, y + 1) + px(x + 1, y + 1))
               - (px(x - 1, y - 1) + 2 * px(x, y - 1) + px(x + 1, y - 1));
      const mag = Math.hypot(gx, gy);
      if (mag < 1e-9) continue;
      magSum += mag;
      const edgeAngle = (Math.atan2(gy, gx) + Math.PI / 2 + Math.PI * 2) % Math.PI; // 0..π
      const bin = Math.round(edgeAngle / (Math.PI / 4)) % 4;
      orient[bin] += mag;
    }
  }
  const interior = Math.max(1, (w - 2) * (h - 2));
  const edge_density = Math.min(1, magSum / interior / 1020); // 1020 ≈ max Sobel mag at 8-bit

  const orientTotal = orient.reduce((a, b) => a + b, 0);
  const NAMES: FieldResult['dominant_orientation'][] = ['horizontal', 'diagonal-up', 'vertical', 'diagonal-down'];
  let dominant_orientation: FieldResult['dominant_orientation'] = null;
  let anisotropy = 0;
  if (orientTotal > 1e-9) {
    const top = orient.indexOf(Math.max(...orient));
    dominant_orientation = NAMES[top];
    anisotropy = Math.max(0, (orient[top] / orientTotal) * 4 - 1) / 3; // uniform→0, single-bin→1
  }

  // Mirror symmetry: Pearson correlation between the image and its mirror,
  // mapped to [0,1]. A blank image correlates with nothing — call it 1.
  const corr = (other: (x: number, y: number) => number): number => {
    let num = 0, denA = 0, denB = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const a = px(x, y) - mean, b = other(x, y) - mean;
      num += a * b; denA += a * a; denB += b * b;
    }
    if (denA < 1e-9 || denB < 1e-9) return 1;
    return Math.max(0, Math.min(1, (num / Math.sqrt(denA * denB) + 1) / 2));
  };
  const symmetry = {
    horizontal: round(corr((x, y) => px(w - 1 - x, y)), 4), // left–right mirror
    vertical:   round(corr((x, y) => px(x, h - 1 - y)), 4), // top–bottom mirror
  };

  // Where the light sits: luminous center of mass, as offsets from center.
  let mx = 0, my = 0, msum = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = px(x, y); mx += x * v; my += y * v; msum += v; }
  const balance = msum > 1e-9
    ? { x: round(((mx / msum) - (w - 1) / 2) / ((w - 1) / 2), 4), y: round(((my / msum) - (h - 1) / 2) / ((h - 1) / 2), 4) }
    : { x: 0, y: 0 };

  return {
    w, h,
    mean: round(mean, 2), contrast: round(contrast, 2),
    entropy: round(Math.max(0, Math.min(1, entropy)), 4),
    edge_density: round(edge_density, 4),
    dominant_orientation, anisotropy: round(anisotropy, 4),
    symmetry, balance,
  };
}

// ── the rhythm ripper (pure — PFAR's spectral core, both axes) ────────────

export interface RhythmResult {
  horizontal: SpectrumResult; // spectrum of column means → left↔right rhythm (cycles/image-width)
  vertical: SpectrumResult;   // spectrum of row means → top↕bottom rhythm (cycles/image-height)
}

export function analyzeRhythm(lumaIn: number[], w: number, h: number): RhythmResult | null {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 2 || h < 2 || w * h > MAX_PIXELS) return null;
  const luma = normalizeLuma(lumaIn, w * h);
  if (!luma) return null;
  const colMeans = new Array(w).fill(0);
  const rowMeans = new Array(h).fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = luma[y * w + x];
    colMeans[x] += v / h;
    rowMeans[y] += v / w;
  }
  return { horizontal: analyzeSpectrum(colMeans), vertical: analyzeSpectrum(rowMeans) };
}

// ── the texture rippers (pure — the specialists' math, ported) ────────────
// The upgrade wave: instead of reinventing, these port the doctrine of the
// mature image-analysis stack (scikit-image / classical CV) into
// zero-dependency Worker code:
//   • structure tensor  — the continuous orientation instrument (a single
//     dominant angle + coherence), the mature form of the 4-bin histogram.
//   • Gabor bank        — the classic texture signature: filter energy at
//     2 wavelengths × 4 orientations.
//   • GLCM (Haralick)   — gray-level co-occurrence statistics: contrast,
//     correlation, energy, homogeneity, entropy.

export interface TensorResult {
  orientation_deg: number;  // dominant EDGE orientation, 0..180 (0 = horizontal edges)
  coherence: number;        // 0 (isotropic) .. 1 (one clean direction)
}

export function structureTensor(lumaIn: number[], w: number, h: number): TensorResult | null {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 3 || h < 3 || w * h > MAX_PIXELS) return null;
  const luma = normalizeLuma(lumaIn, w * h);
  if (!luma) return null;
  const px = (x: number, y: number) => luma[y * w + x];
  let jxx = 0, jyy = 0, jxy = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const gx = (px(x + 1, y) - px(x - 1, y)) / 2;
      const gy = (px(x, y + 1) - px(x, y - 1)) / 2;
      jxx += gx * gx; jyy += gy * gy; jxy += gx * gy;
    }
  }
  const trace = jxx + jyy;
  if (trace < 1e-9) return { orientation_deg: 0, coherence: 0 }; // flat field: no orientation
  // Gradient-dominant direction; the EDGE runs perpendicular to it.
  const gradAngle = 0.5 * Math.atan2(2 * jxy, jxx - jyy);
  const edgeDeg = ((gradAngle * 180) / Math.PI + 90 + 180) % 180;
  const coherence = Math.sqrt((jxx - jyy) ** 2 + 4 * jxy * jxy) / trace;
  return { orientation_deg: round(edgeDeg, 1), coherence: round(Math.min(1, coherence), 4) };
}

export interface GaborResult {
  // energy per (wavelength, orientation), normalized by image contrast
  signature: Array<{ wavelength: number; orientation_deg: number; energy: number }>;
  peak: { wavelength: number; orientation_deg: number };
}

const GABOR_WAVELENGTHS = [4, 8];           // px
const GABOR_ORIENTATIONS = [0, 45, 90, 135]; // deg — direction of the wave vector
const GABOR_KERNEL = 9;                      // 9×9 kernels
const GABOR_MAX_SIDE = 64;                   // internally downsample beyond this

export function gaborSignature(lumaIn: number[], w: number, h: number): GaborResult | null {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < GABOR_KERNEL || h < GABOR_KERNEL || w * h > MAX_PIXELS) return null;
  let luma = normalizeLuma(lumaIn, w * h);
  if (!luma) return null;

  // Box-downsample so the convolution cost is bounded regardless of input.
  let dw = w, dh = h;
  while (dw > GABOR_MAX_SIDE || dh > GABOR_MAX_SIDE) {
    const nw = Math.floor(dw / 2), nh = Math.floor(dh / 2);
    const next = new Array(nw * nh);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      next[y * nw + x] = (luma[(2 * y) * dw + 2 * x] + luma[(2 * y) * dw + 2 * x + 1]
        + luma[(2 * y + 1) * dw + 2 * x] + luma[(2 * y + 1) * dw + 2 * x + 1]) / 4;
    }
    luma = next; dw = nw; dh = nh;
  }
  if (dw < GABOR_KERNEL || dh < GABOR_KERNEL) return null;

  const mean = luma.reduce((a, b) => a + b, 0) / luma.length;
  const std = Math.sqrt(luma.reduce((a, b) => a + (b - mean) ** 2, 0) / luma.length);
  if (std < 1e-6) {
    // no texture at all — an honest all-zero signature
    const signature = GABOR_WAVELENGTHS.flatMap((wl) => GABOR_ORIENTATIONS.map((o) => ({ wavelength: wl, orientation_deg: o, energy: 0 })));
    return { signature, peak: { wavelength: GABOR_WAVELENGTHS[0], orientation_deg: 0 } };
  }

  const half = (GABOR_KERNEL - 1) / 2;
  const signature: GaborResult['signature'] = [];
  for (const wavelength of GABOR_WAVELENGTHS) {
    const sigma = 0.56 * wavelength;
    for (const orientationDeg of GABOR_ORIENTATIONS) {
      const th = (orientationDeg * Math.PI) / 180;
      const cos = Math.cos(th), sin = Math.sin(th);
      // build the (even) Gabor kernel
      const kernel = new Array(GABOR_KERNEL * GABOR_KERNEL);
      for (let ky = -half; ky <= half; ky++) for (let kx = -half; kx <= half; kx++) {
        const xr = kx * cos + ky * sin;
        const yr = -kx * sin + ky * cos;
        kernel[(ky + half) * GABOR_KERNEL + (kx + half)] =
          Math.exp(-(xr * xr + 0.25 * yr * yr) / (2 * sigma * sigma)) * Math.cos((2 * Math.PI * xr) / wavelength);
      }
      // convolve interior, accumulate |response|
      let acc = 0, cnt = 0;
      for (let y = half; y < dh - half; y++) for (let x = half; x < dw - half; x++) {
        let r = 0;
        for (let ky = -half; ky <= half; ky++) for (let kx = -half; kx <= half; kx++) {
          r += (luma[(y + ky) * dw + (x + kx)] - mean) * kernel[(ky + half) * GABOR_KERNEL + (kx + half)];
        }
        acc += Math.abs(r); cnt++;
      }
      signature.push({ wavelength, orientation_deg: orientationDeg, energy: round(acc / cnt / std / GABOR_KERNEL, 4) });
    }
  }
  const peak = signature.reduce((a, b) => (b.energy > a.energy ? b : a));
  return { signature, peak: { wavelength: peak.wavelength, orientation_deg: peak.orientation_deg } };
}

export interface GlcmResult {
  contrast: number;     // Haralick contrast (gray-level distance²)
  correlation: number;  // -1..1
  energy: number;       // 0..1 (angular second moment)
  homogeneity: number;  // 0..1
  entropy: number;      // bits
}

const GLCM_LEVELS = 16;

export function glcmFeatures(lumaIn: number[], w: number, h: number): GlcmResult | null {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 2 || h < 2 || w * h > MAX_PIXELS) return null;
  const luma = normalizeLuma(lumaIn, w * h);
  if (!luma) return null;
  const q = luma.map((v) => Math.min(GLCM_LEVELS - 1, Math.floor((v / 256) * GLCM_LEVELS)));
  const glcm = new Array(GLCM_LEVELS * GLCM_LEVELS).fill(0);
  let total = 0;
  // Symmetric co-occurrence at distance 1, all four directions.
  const OFFSETS = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (const [dx, dy] of OFFSETS) {
    for (let y = Math.max(0, -dy); y < h - Math.max(0, dy); y++) {
      for (let x = 0; x < w - dx; x++) {
        const a = q[y * w + x], b = q[(y + dy) * w + (x + dx)];
        glcm[a * GLCM_LEVELS + b]++; glcm[b * GLCM_LEVELS + a]++;
        total += 2;
      }
    }
  }
  if (!total) return null;
  let contrast = 0, energy = 0, homogeneity = 0, entropy = 0;
  let meanI = 0;
  for (let i = 0; i < GLCM_LEVELS; i++) for (let j = 0; j < GLCM_LEVELS; j++) {
    const p = glcm[i * GLCM_LEVELS + j] / total;
    if (p <= 0) continue;
    contrast += p * (i - j) * (i - j);
    energy += p * p;
    homogeneity += p / (1 + Math.abs(i - j));
    entropy -= p * Math.log2(p);
    meanI += i * p;
  }
  let varI = 0;
  for (let i = 0; i < GLCM_LEVELS; i++) for (let j = 0; j < GLCM_LEVELS; j++) {
    const p = glcm[i * GLCM_LEVELS + j] / total;
    varI += p * (i - meanI) * (i - meanI);
  }
  let correlation = 0;
  if (varI > 1e-12) {
    for (let i = 0; i < GLCM_LEVELS; i++) for (let j = 0; j < GLCM_LEVELS; j++) {
      const p = glcm[i * GLCM_LEVELS + j] / total;
      correlation += p * (i - meanI) * (j - meanI);
    }
    correlation /= varI;
  } else {
    correlation = 1; // a flat image co-occurs with itself perfectly
  }
  return {
    contrast: round(contrast, 4), correlation: round(Math.max(-1, Math.min(1, correlation)), 4),
    energy: round(energy, 4), homogeneity: round(homogeneity, 4), entropy: round(entropy, 4),
  };
}

// ── the palette ripper (pure) ─────────────────────────────────────────────

export interface PaletteResult {
  colors: Array<{ hex: string; share: number }>; // dominant first
  warmth: number;        // -1 (cold/blue) .. 1 (warm/red)
  saturation: number;    // 0..1 mean HSV saturation
  colorfulness: number;  // 0..1 (opponent-axis spread, Hasler–Süsstrunk-style)
}

// rgb: interleaved [r,g,b, r,g,b, …], 0..1 or 0..255.
export function analyzePalette(rgbIn: number[], w: number, h: number): PaletteResult | null {
  const n = w * h;
  if (!Number.isInteger(n) || n < 1 || n > MAX_PIXELS) return null;
  const rgb = rgbIn.filter((v) => Number.isFinite(v)).slice(0, n * 3);
  if (rgb.length < n * 3) return null;
  const max = Math.max(...rgb);
  const scale = max <= 1.000001 ? 255 : 1;

  // 4 bits/channel quantization → histogram; each bucket keeps its true mean
  // color so the reported hex is the actual average, not the bucket corner.
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  let warmSum = 0, satSum = 0, rgSum = 0, rg2Sum = 0, ybSum = 0, yb2Sum = 0;
  for (let i = 0; i < n; i++) {
    const r = rgb[i * 3] * scale, g = rgb[i * 3 + 1] * scale, b = rgb[i * 3 + 2] * scale;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bk = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
    bk.count++; bk.r += r; bk.g += g; bk.b += b;
    buckets.set(key, bk);
    warmSum += (r - b) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    satSum += mx > 0 ? (mx - mn) / mx : 0;
    const rgOpp = r - g, ybOpp = 0.5 * (r + g) - b;
    rgSum += rgOpp; rg2Sum += rgOpp * rgOpp; ybSum += ybOpp; yb2Sum += ybOpp * ybOpp;
  }
  const colors = [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((bk) => ({
      hex: '#' + [bk.r, bk.g, bk.b].map((c) => Math.round(c / bk.count).toString(16).padStart(2, '0')).join(''),
      share: round(bk.count / n, 4),
    }));
  const varRg = rg2Sum / n - (rgSum / n) ** 2;
  const varYb = yb2Sum / n - (ybSum / n) ** 2;
  return {
    colors,
    warmth: round(Math.max(-1, Math.min(1, warmSum / n)), 4),
    saturation: round(satSum / n, 4),
    colorfulness: round(Math.min(1, Math.sqrt(Math.max(0, varRg) + Math.max(0, varYb)) / 128), 4),
  };
}

// ── resynth (pure): structure → a deterministic PNG ──────────────────────
// Gratings at the dominant horizontal/vertical frequencies, intensity mapped
// through the dominant palette. The decomposer inverted — no model.

export interface ResynthSpec {
  size?: number;        // px per side (square), default 256, cap MAX_RESYNTH
  hfreq?: number;       // cycles across the width  (from rhythm.horizontal)
  vfreq?: number;       // cycles down the height   (from rhythm.vertical)
  colors?: string[];    // hex ramp, dark→light; default void black → gold
  balance?: number;     // 0..1 mix between the two gratings (default 0.5)
  angle_deg?: number;   // rotate the whole weave (from the structure tensor)
}

export function resynthImage(spec: ResynthSpec = {}): Uint8Array {
  const size = Math.max(16, Math.min(MAX_RESYNTH, Math.round(spec.size || 256)));
  const hfreq = clampNum(spec.hfreq, 0, size / 2, 3);
  const vfreq = clampNum(spec.vfreq, 0, size / 2, 2);
  const mix = clampNum(spec.balance, 0, 1, 0.5);
  const angle = (clampNum(spec.angle_deg, -180, 180, 0) * Math.PI) / 180;
  const cosA = Math.cos(angle), sinA = Math.sin(angle);
  const ramp = (spec.colors && spec.colors.length ? spec.colors : ['#0f0f1a', '#C9A84C'])
    .map(parseHex).filter((c): c is [number, number, number] => !!c);
  if (!ramp.length) ramp.push([15, 15, 26], [201, 168, 76]);
  if (ramp.length === 1) ramp.push(ramp[0]);

  const raw = new Uint8Array(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0; // PNG filter: none
    for (let x = 0; x < size; x++) {
      // rotate coordinates about the center so the tensor's angle carries in
      const cx = x - size / 2, cy = y - size / 2;
      const xr = cx * cosA + cy * sinA + size / 2;
      const yr = -cx * sinA + cy * cosA + size / 2;
      const hWave = 0.5 + 0.5 * Math.sin((2 * Math.PI * hfreq * xr) / size);
      const vWave = 0.5 + 0.5 * Math.sin((2 * Math.PI * vfreq * yr) / size);
      const t = (1 - mix) * hWave + mix * vWave;
      // interpolate along the ramp
      const pos = t * (ramp.length - 1);
      const i0 = Math.min(ramp.length - 2, Math.floor(pos));
      const f = pos - i0;
      const o = row + 1 + x * 3;
      for (let c = 0; c < 3; c++) raw[o + c] = Math.round(ramp[i0][c] * (1 - f) + ramp[i0 + 1][c] * f);
    }
  }
  return encodePng(size, size, raw);
}

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function clampNum(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
}

// Minimal PNG encoder — 8-bit RGB, zlib "stored" blocks (no compression lib
// needed in the Workers runtime). raw = filter-byte-prefixed scanlines.
function encodePng(w: number, h: number, raw: Uint8Array): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h);
  ihdr[8] = 8; ihdr[9] = 2; // bit depth 8, color type 2 (RGB)

  // zlib stream: 2-byte header, stored deflate blocks (≤65535 each), adler32.
  const blocks: Uint8Array[] = [new Uint8Array([0x78, 0x01])];
  for (let off = 0; off < raw.length; off += 65535) {
    const len = Math.min(65535, raw.length - off);
    const head = new Uint8Array(5);
    head[0] = off + len >= raw.length ? 1 : 0; // BFINAL
    head[1] = len & 255; head[2] = len >> 8;
    head[3] = ~len & 255; head[4] = (~len >> 8) & 255;
    blocks.push(head, raw.subarray(off, off + len));
  }
  let a = 1, b = 0;
  for (let i = 0; i < raw.length; i++) { a = (a + raw[i]) % 65521; b = (b + a) % 65521; }
  const adler = new Uint8Array(4);
  new DataView(adler.buffer).setUint32(0, ((b << 16) | a) >>> 0);
  blocks.push(adler);
  const idat = concatBytes(blocks);

  return concatBytes([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', new Uint8Array(0)),
  ]);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

let CRC_TABLE: Int32Array | null = null;
function crc32(buf: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function round(x: number, p: number): number {
  const f = 10 ** p;
  return Math.round(x * f) / f;
}

// ── the vFAR router ───────────────────────────────────────────────────────

export interface VfarInput {
  mode?: 'rip' | 'resynth' | 'generate' | 'describe' | 'auto';
  luma?: number[];      // grayscale pixels, row-major (0..1 or 0..255)
  rgb?: number[];       // interleaved r,g,b — enables the palette ripper
  width?: number;
  height?: number;
  prompt?: string;      // for generate; optional question for describe
  spec?: ResynthSpec;   // for resynth (or omit and it uses the last rip's numbers you pass back)
  image_path?: string;  // for describe: a stored /vfar/... artifact path
  interpret?: boolean;  // default true: LLM reading over the rip numbers
  context?: string;     // what the caller is looking at / for
}

const SYNTH_SYSTEM =
`You are vFAR's synthesis head. You are handed the STRUCTURAL output of a visual ripper — field statistics, spatial rhythm spectra (PFAR's core run along both image axes), and possibly a palette. In 2-4 sentences say what the structure MEANS: what kind of image this is likely to be (texture/scene/document/pattern), what stands out (periodicity, orientation, symmetry, balance, color character), and what to look at or do next. Ground every claim in the numbers; do not invent content you cannot see — you have structure, not pixels.`;

// Store bytes in R2 under vfar/, return the public path (served by index.ts).
async function storeArtifact(env: Env, bytes: Uint8Array, contentType: string, ext: string): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, '');
  const key = `vfar/${id}.${ext}`;
  await env.DOCUMENTS.put(key, bytes, { httpMetadata: { contentType } });
  return `/${key}`;
}

export async function vfarRoute(env: Env, input: VfarInput): Promise<string> {
  const mode = input.mode && input.mode !== 'auto' ? input.mode : inferMode(input);
  if (!mode) {
    return JSON.stringify({ error: 'vfar: nothing to work on. Provide luma[]+width+height (rip), prompt (generate), or spec (resynth).' });
  }
  const report: Record<string, unknown> = { mode };

  try {
    if (mode === 'rip') {
      const w = Number(input.width), h = Number(input.height);
      const field = analyzeField(input.luma ?? [], w, h);
      const rhythm = analyzeRhythm(input.luma ?? [], w, h);
      if (!field || !rhythm) return JSON.stringify({ mode, error: `vfar rip: need luma[] of exactly width*height finite values, 2≤side, ≤${MAX_PIXELS} px. The eyes downsample before sending.` });
      report.field = field;
      report.rhythm = rhythm;
      // The specialists' instruments (see the texture rippers above) ride
      // every rip; each is best-effort on degenerate sizes.
      const tensor = structureTensor(input.luma ?? [], w, h);
      if (tensor) report.tensor = tensor;
      const gabor = gaborSignature(input.luma ?? [], w, h);
      if (gabor) report.gabor = gabor;
      const glcm = glcmFeatures(input.luma ?? [], w, h);
      if (glcm) report.glcm = glcm;
      if (input.rgb?.length) report.palette = analyzePalette(input.rgb, w, h);
      // Hand back the inverse: the spec that resynth would use to make this
      // structure visible again. Rip → resynth is one round trip.
      report.resynth_spec = {
        hfreq: rhythm.horizontal.dominant[0] ? round(rhythm.horizontal.dominant[0].freq * w, 2) : 0,
        vfreq: rhythm.vertical.dominant[0] ? round(rhythm.vertical.dominant[0].freq * h, 2) : 0,
        colors: (report.palette as PaletteResult | undefined)?.colors?.slice(0, 3).map((c) => c.hex),
        // the weave leans the way the tensor says the edges run
        angle_deg: tensor && tensor.coherence > 0.3 ? round(tensor.orientation_deg % 90, 1) : 0,
      } satisfies ResynthSpec;
    } else if (mode === 'describe') {
      // The content layer — llava-hf/llava-1.5-7b-hf (Hugging Face lineage,
      // mirrored on Workers AI). The rip sees structure; this sees THINGS.
      // Only works on artifacts she already holds in R2 (/vfar/…), so the
      // consent boundary stays: no fetching arbitrary outside images.
      const path = String(input.image_path || '').trim();
      if (!/^\/vfar\/[0-9a-f]{32}\.(png|jpg)$/.test(path)) return JSON.stringify({ mode, error: 'vfar describe: image_path must be a stored /vfar/<id>.png|jpg artifact' });
      const obj = await env.DOCUMENTS.get(path.slice(1));
      if (!obj) return JSON.stringify({ mode, error: `vfar describe: no artifact at ${path}` });
      const bytes = new Uint8Array(await obj.arrayBuffer());
      const out = await env.AI.run('@cf/llava-hf/llava-1.5-7b-hf' as Parameters<Env['AI']['run']>[0], {
        image: Array.from(bytes),
        prompt: String(input.prompt || 'Describe this image precisely: what is depicted, its composition, and anything notable.').slice(0, 500),
        max_tokens: 384,
      }) as { description?: string };
      return JSON.stringify({ mode, image: path, description: String(out?.description || '').trim() || '(the vision model returned nothing)' });
    } else if (mode === 'resynth') {
      const png = resynthImage(input.spec ?? {});
      const path = await storeArtifact(env, png, 'image/png', 'png');
      return JSON.stringify({ mode, stored: path, bytes: png.length, note: 'deterministic resynthesis — gratings at the given spatial frequencies over the given palette; no model involved' });
    } else if (mode === 'generate') {
      const prompt = String(input.prompt || '').trim();
      if (!prompt) return JSON.stringify({ mode, error: 'vfar generate: prompt required' });
      const out = await env.AI.run('@cf/black-forest-labs/flux-1-schnell' as Parameters<Env['AI']['run']>[0], { prompt: prompt.slice(0, 2000) }) as { image?: string };
      if (!out?.image) return JSON.stringify({ mode, error: 'vfar generate: the image model returned nothing — it may be unavailable on this account' });
      const bytes = Uint8Array.from(atob(out.image), (c) => c.charCodeAt(0));
      const path = await storeArtifact(env, bytes, 'image/jpeg', 'jpg');
      return JSON.stringify({ mode, stored: path, bytes: bytes.length, prompt: prompt.slice(0, 200) });
    }
  } catch (e) {
    return JSON.stringify({ mode, error: `vfar ${mode} failed: ${(e as Error).message}` });
  }

  // One reading over the numbers — same contract as PFAR: the numeric rip
  // stands on its own if synthesis is unreachable.
  if (mode === 'rip' && input.interpret !== false) {
    try {
      const facts = JSON.stringify({ field: report.field, rhythm: report.rhythm, tensor: report.tensor ?? null, gabor: report.gabor ?? null, glcm: report.glcm ?? null, palette: report.palette ?? null });
      const ctx = input.context ? `\nCaller context: ${String(input.context).slice(0, 400)}` : '';
      const r = await callLLM('reasoning', SYNTH_SYSTEM, [{ role: 'user', content: `Ripper output:\n${facts}${ctx}` }], 300, env);
      report.reading = String(r.content).trim();
    } catch { /* the numbers stand on their own */ }
  }

  return JSON.stringify(report);
}

function inferMode(input: VfarInput): VfarInput['mode'] | null {
  if (input.luma && input.luma.length) return 'rip';
  if (input.image_path) return 'describe';
  if (input.prompt && input.prompt.trim()) return 'generate';
  if (input.spec) return 'resynth';
  return null;
}

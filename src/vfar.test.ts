import { describe, it, expect } from 'vitest';
import { analyzeField, analyzeRhythm, analyzePalette, resynthImage } from './vfar';

// Synthetic images with KNOWN structure — the cores are deterministic, so
// ground truth is checkable exactly.
const W = 32, H = 32;

function image(fn: (x: number, y: number) => number): number[] {
  const luma: number[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) luma.push(fn(x, y));
  return luma;
}

const flat = image(() => 128);
const verticalStripes = image((x) => (Math.floor(x / 2) % 2 ? 255 : 0)); // period 4 px across the width
const leftBright = image((x) => 255 - (x * 255) / (W - 1));

describe('analyzeField', () => {
  it('reads a flat field as structureless: no contrast, no edges, no entropy', () => {
    const f = analyzeField(flat, W, H)!;
    expect(f.contrast).toBe(0);
    expect(f.edge_density).toBe(0);
    expect(f.entropy).toBe(0);
    expect(f.dominant_orientation).toBeNull();
  });

  it('sees vertical stripes as vertical edges with high anisotropy and left–right rhythm symmetry', () => {
    const f = analyzeField(verticalStripes, W, H)!;
    expect(f.dominant_orientation).toBe('vertical');
    expect(f.anisotropy).toBeGreaterThan(0.9);
    expect(f.edge_density).toBeGreaterThan(0.1);
    expect(f.symmetry.vertical).toBeGreaterThan(0.99); // top–bottom mirror is identical
  });

  it('finds the luminous center of mass on the bright side', () => {
    const f = analyzeField(leftBright, W, H)!;
    expect(f.balance.x).toBeLessThan(-0.1); // light sits left of center
    expect(Math.abs(f.balance.y)).toBeLessThan(0.01);
  });

  it('accepts 0..1 luma and refuses malformed input instead of guessing', () => {
    expect(analyzeField(flat.map((v) => v / 255), W, H)!.mean).toBeCloseTo(128, 0);
    expect(analyzeField([1, 2, 3], W, H)).toBeNull();          // too few pixels
    expect(analyzeField(flat, 1000, 1000)).toBeNull();          // over the pixel cap
  });
});

describe('analyzeRhythm — PFAR\'s core along both axes', () => {
  it('hears the stripe period as the dominant horizontal frequency', () => {
    const r = analyzeRhythm(verticalStripes, W, H)!;
    // period 4 px → 0.25 cycles/sample; DFT bin resolution is 1/32
    expect(r.horizontal.dominant[0].freq).toBeCloseTo(0.25, 2);
    expect(r.horizontal.periodicity).toBeGreaterThan(0.5);
    // …and no vertical rhythm at all (row means are constant)
    expect(r.vertical.rms).toBeCloseTo(r.vertical.mean, 1);
    expect(r.vertical.dominant.every((p) => p.magnitude < 1e-6)).toBe(true);
  });
});

describe('analyzePalette', () => {
  it('rips a two-color image into its two colors with honest shares', () => {
    const rgb: number[] = [];
    for (let i = 0; i < W * H; i++) {
      if (i < (W * H) / 2) rgb.push(255, 0, 0); else rgb.push(0, 0, 255);
    }
    const p = analyzePalette(rgb, W, H)!;
    expect(p.colors).toHaveLength(2);
    expect(p.colors.map((c) => c.hex).sort()).toEqual(['#0000ff', '#ff0000']);
    expect(p.colors[0].share).toBeCloseTo(0.5, 2);
    expect(Math.abs(p.warmth)).toBeLessThan(0.01); // half warm, half cold
    expect(p.saturation).toBeCloseTo(1, 2);
    expect(p.colorfulness).toBeGreaterThan(0.5);
  });

  it('reads a gray image as colorless', () => {
    const rgb = Array(W * H).fill(0).flatMap(() => [128, 128, 128]);
    const p = analyzePalette(rgb, W, H)!;
    expect(p.saturation).toBe(0);
    expect(p.colorfulness).toBe(0);
    expect(p.colors[0].hex).toBe('#808080');
  });
});

describe('resynthImage — the decomposer inverted, no model', () => {
  it('emits a structurally valid PNG at the requested size', () => {
    const png = resynthImage({ size: 64, hfreq: 8, vfreq: 3, colors: ['#0f0f1a', '#C9A84C'] });
    // PNG signature
    expect([...png.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // IHDR dimensions
    const dv = new DataView(png.buffer, png.byteOffset);
    expect(dv.getUint32(16)).toBe(64);
    expect(dv.getUint32(20)).toBe(64);
    // IEND closes the file
    expect(String.fromCharCode(...png.slice(-8, -4))).toBe('IEND');
  });

  it('is deterministic and clamps a hostile size', () => {
    const a = resynthImage({ size: 32, hfreq: 4 });
    const b = resynthImage({ size: 32, hfreq: 4 });
    expect(a.length).toBe(b.length);
    expect(a.every((v, i) => v === b[i])).toBe(true);
    const dv = new DataView(resynthImage({ size: 99999 }).buffer);
    expect(dv.getUint32(16)).toBe(512); // MAX_RESYNTH
  });

  it('the rip → resynth round trip: the fingerprint image carries the ripped frequency', () => {
    // Rip the stripes, resynthesize from the returned structure, rip AGAIN —
    // the dominant horizontal rhythm must survive the round trip.
    const rip1 = analyzeRhythm(verticalStripes, W, H)!;
    const hfreqCycles = rip1.horizontal.dominant[0].freq * W; // cycles across the image = 8
    const png = resynthImage({ size: 64, hfreq: hfreqCycles, vfreq: 0 });
    // Decode our own stored-deflate PNG scanlines back to luma (RGB, filter 0).
    const raw = storedIdatPayload(png);
    const luma: number[] = [];
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const o = y * (64 * 3 + 1) + 1 + x * 3;
      luma.push(0.299 * raw[o] + 0.587 * raw[o + 1] + 0.114 * raw[o + 2]);
    }
    const rip2 = analyzeRhythm(luma, 64, 64)!;
    expect(rip2.horizontal.dominant[0].freq * 64).toBeCloseTo(hfreqCycles, 0);
    expect(rip2.horizontal.periodicity).toBeGreaterThan(0.5);
  });
});

// Test-side reader for the encoder's own output: concatenates IDAT chunks and
// strips the zlib header + stored-block framing (the encoder never compresses).
function storedIdatPayload(png: Uint8Array): Uint8Array {
  const dv = new DataView(png.buffer, png.byteOffset);
  let off = 8;
  const idat: Uint8Array[] = [];
  while (off < png.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(...png.slice(off + 4, off + 8));
    if (type === 'IDAT') idat.push(png.slice(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const z = concat(idat);
  const out: Uint8Array[] = [];
  let p = 2; // skip zlib header
  for (;;) {
    const final = z[p] & 1;
    const len = z[p + 1] | (z[p + 2] << 8);
    out.push(z.subarray(p + 5, p + 5 + len));
    p += 5 + len;
    if (final) break;
  }
  return concat(out);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, c) => a + c.length, 0));
  let o = 0;
  for (const c of parts) { out.set(c, o); o += c.length; }
  return out;
}

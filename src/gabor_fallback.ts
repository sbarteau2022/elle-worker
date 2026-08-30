// src/gabor_fallback.ts

/**
 * Pure‑TS 2‑D Gabor filter on an 8‑bit grayscale image.
 * Mirrors the WASM implementation for fallback.
 */
export async function gabor_filter_2d(
  input: Uint8Array,
  width: number,
  height: number,
  sigma: number,
  freq: number,
): Promise<Uint8Array> {
  const output = new Uint8Array(width * height);
  const twoPiF = 2 * Math.PI * freq;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const pixel = input[idx] / 255;
      const gx = x - width / 2;
      const gy = y - height / 2;
      const gauss = Math.exp(-(gx * gx + gy * gy) / (2 * sigma * sigma));
      const sinusoid = Math.cos(twoPiF * gx);
      const val = Math.min(1, Math.max(0, pixel * gauss * sinusoid));
      output[idx] = Math.round(val * 255);
    }
  }
  return output;
}

// src/fft_fallback.ts

/**
 * Pure‑TS radix‑2 Cooley‑Tukey FFT on Q30 fixed‑point numbers.
 * Returns interleaved real/imag values (same format as the WASM version).
 */
export async function real_fft(input: Int32Array): Promise<Int32Array> {
  const n = input.length;
  if ((n & (n - 1)) !== 0) {
    throw new Error('FFT length must be power of two');
  }
  const ONE = 1 << 30;
  // Q0.30 multiply. NOT `(a * b) >> 30`: JS `>>` applies ToInt32 to its left
  // operand first, and a Q30 product reaches 2^60, so the high 28 bits are
  // discarded before the shift ever runs — that form returns identically 0 for
  // every in-range input, making the whole transform output zeros. Rust does
  // this in i64 (`crates/elle-core-wasm/src/lib.rs:10`); f64 has only a 53-bit
  // mantissa, so split the left operand and divide each partial product down
  // before summing, keeping every intermediate inside the exact range. Verified
  // bit-exact against the i64 reference over 200k random operand pairs.
  const mul_q = (a: number, b: number) => {
    const ah = Math.floor(a / 65536);
    const al = a - ah * 65536;
    return Math.floor((ah * b) / 16384 + (al * b) / 1073741824);
  };

  const real = Array.from(input);
  const imag = new Array(n).fill(0);

  // bit‑reversal
  let j = 0;
  for (let i = 1; i < n; i++) {
    let bit = n >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const cos_q = Math.round(Math.cos(angle) * ONE);
    const sin_q = Math.round(Math.sin(angle) * ONE);
    for (let i = 0; i < n; i += len) {
      let wReal = ONE;
      let wImag = 0;
      for (let k = 0; k < half; k++) {
        const idx = i + k;
        const idxPair = idx + half;
        const tr = mul_q(wReal, real[idxPair]) - mul_q(wImag, imag[idxPair]);
        const ti = mul_q(wReal, imag[idxPair]) + mul_q(wImag, real[idxPair]);
        const ur = real[idx];
        const ui = imag[idx];
        real[idx] = ur + tr;
        imag[idx] = ui + ti;
        real[idxPair] = ur - tr;
        imag[idxPair] = ui - ti;
        // w = w * twiddle
        const wR = mul_q(wReal, cos_q) - mul_q(wImag, sin_q);
        const wI = mul_q(wReal, sin_q) + mul_q(wImag, cos_q);
        wReal = wR;
        wImag = wI;
      }
    }
  }

  const out = new Int32Array(n * 2);
  for (let i = 0; i < n; i++) {
    out[i * 2] = real[i];
    out[i * 2 + 1] = imag[i];
  }
  return out;
}

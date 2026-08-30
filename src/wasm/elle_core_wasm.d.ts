/* tslint:disable */
/* eslint-disable */

export function cordic_sin_cos(theta_q: number): any;

export function cordic_sinh_cosh(s_q: number): any;

export function div_q_wasm(num: number, den: number): number;

/**
 * Simple separable 2‑D Gabor filter on an 8‑bit grayscale image.
 * Returns a new image buffer of the same size.
 */
export function gabor_filter_2d(input: Uint8Array, width: number, height: number, sigma: number, freq: number): Uint8Array;

export function mul_q_wasm(a: number, b: number): number;

/**
 * Poincare-ball geodesic distance in 2-D, f64 in and out.
 *
 * The Q0.30 variant above cannot represent this metric's range: one integer
 * bit tops out below 2.0 nats while ordinary in-ball pairs exceed 5. This is
 * the export new code should use.
 */
export function poincare_distance(px: number, py: number, qx: number, qy: number): number;

export function poincare_distance_q30(px: number, py: number, qx: number, qy: number): number;

/**
 * Compute a radix‑2 Cooley‑Tukey FFT on Q30 fixed‑point data.
 * `input` length must be a power of two. Returns interleaved real/imag Q30 values.
 */
export function real_fft(input: Int32Array): Int32Array;

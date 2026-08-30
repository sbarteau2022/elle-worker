// src/wasm-bridge.ts
//
// Bridge to the compiled `elle-core-wasm` core, with pure-TS fallbacks.
//
// The previous version could never load the core, for three independent
// reasons: it resolved `new URL('../public/wasm/...', import.meta.url)` and
// `import()`ed that string (a computed specifier workerd cannot resolve, and a
// path with no artifact behind it); it then destructured `instance.exports`,
// but wasm-bindgen's init returns the export object itself, so that read was
// `undefined` and threw; and nothing imported this module in the first place.
// Because every failure was swallowed by the catch, the fallback path was the
// only one that ever ran, silently.
//
// The glue in `src/wasm/` is generated with `--target bundler`, whose entry
// does a STATIC `import * as wasm from './elle_core_wasm_bg.wasm'`. Wrangler
// compiles that to a WebAssembly.Module at bundle time, so the core is ready
// synchronously with no init call and no dynamic specifier. Regenerate with:
//
//   cd crates/elle-core-wasm && cargo build --target wasm32-unknown-unknown --release
//   wasm-bindgen --target bundler --out-dir src/wasm --out-name elle_core_wasm \
//     crates/elle-core-wasm/target/wasm32-unknown-unknown/release/elle_core_wasm.wasm

import * as core from './wasm/elle_core_wasm';
import { real_fft as fftFallbackImpl } from './fft_fallback';
import { gabor_filter_2d as gaborFallbackImpl } from './gabor_fallback';

export type CoreBackend = 'wasm' | 'fallback';

/** Which implementation actually served the last call. */
let backend: CoreBackend = 'wasm';
let degradeReason: string | undefined;

/**
 * Observability, not decoration: a silent fallback is a 10-100x regression that
 * looks exactly like success. Callers and health checks read this to tell
 * "the core is running" apart from "the core has been dead since deploy".
 */
export function coreStatus(): { backend: CoreBackend; reason?: string } {
  return { backend, reason: degradeReason };
}

function degrade(op: string, e: unknown): void {
  backend = 'fallback';
  degradeReason = `${op}: ${e instanceof Error ? e.message : String(e)}`;
  console.error('[WASM-BRIDGE] core unavailable, serving pure-TS fallback:', degradeReason);
}

/**
 * Radix-2 FFT over Q0.30 fixed-point input. Length must be a power of two.
 *
 * The Rust export asserts this, and a failed Rust assert traps the whole
 * invocation rather than returning an error, so the length is checked here
 * first — a caller passing 1000 samples gets a TypeError it can handle, not a
 * dead isolate.
 */
export async function fft(input: Int32Array): Promise<Int32Array> {
  const n = input.length;
  if (n === 0 || (n & (n - 1)) !== 0) {
    throw new TypeError(`FFT length must be a power of two, got ${n}`);
  }
  try {
    return core.real_fft(input);
  } catch (e) {
    degrade('real_fft', e);
    return fftFallbackImpl(input);
  }
}

/** Separable 2-D Gabor filter over an 8-bit grayscale plane. */
export async function gabor(
  input: Uint8Array,
  width: number,
  height: number,
  sigma: number,
  freq: number,
): Promise<Uint8Array> {
  if (width <= 0 || height <= 0 || input.length < width * height) {
    throw new TypeError(`gabor: buffer of ${input.length} too small for ${width}x${height}`);
  }
  try {
    return core.gabor_filter_2d(input, width, height, sigma, freq);
  } catch (e) {
    degrade('gabor_filter_2d', e);
    return gaborFallbackImpl(input, width, height, sigma, freq);
  }
}

/** Q0.30 fixed-point multiply, as the core computes it (i64 intermediate). */
export function mulQ(a: number, b: number): number {
  return core.mul_q_wasm(a, b);
}

/** Poincare-ball geodesic distance in Q0.30, 2-D. */
export function poincareDistanceQ30(px: number, py: number, qx: number, qy: number): number {
  return core.poincare_distance_q30(px, py, qx, qy);
}

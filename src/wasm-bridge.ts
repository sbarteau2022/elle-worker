// src/wasm-bridge.ts

/**
 * Load the compiled WASM module and expose async wrappers.
 * Falls back to pure‑TS implementations if the WASM module cannot be instantiated.
 */
export interface WasmModule {
  real_fft(input: Int32Array): Promise<Int32Array>;
  gabor_filter_2d(input: Uint8Array, w: number, h: number, sigma: number, freq: number): Promise<Uint8Array>;
}

let wasm: WasmModule | null = null;

/** Initialize the WASM module. */
async function initWasm(): Promise<WasmModule> {
  try {
    const wasmUrl = new URL('../public/wasm/elle_core_wasm.js', import.meta.url).toString();
    const wasmModule = await import(/* @vite-ignore */ wasmUrl);
    // The generated JS glue exports a default async init function returning the instance.
    const instance = await wasmModule.default();
    // exported functions are on instance.exports
    const { real_fft, gabor_filter_2d } = instance.exports as any;
    return {
      real_fft: (input: Int32Array) =>
        Promise.resolve(new Int32Array(real_fft(input))),
      gabor_filter_2d: (input: Uint8Array, w: number, h: number, sigma: number, freq: number) =>
        Promise.resolve(new Uint8Array(gabor_filter_2d(input, w, h, sigma, freq))),
    };
  } catch (e) {
    console.warn('WASM init failed, falling back to JS implementations:', e);
    const fallback = await import('./fft_fallback');
    const gaborFallback = await import('./gabor_fallback');
    return {
      real_fft: fallback.real_fft,
      gabor_filter_2d: gaborFallback.gabor_filter_2d,
    };
  }
}

export async function getWasm(): Promise<WasmModule> {
  if (!wasm) {
    wasm = await initWasm();
  }
  return wasm;
}

/** Convenience wrappers used by the edge runtime */
export async function fft(input: Int32Array): Promise<Int32Array> {
  const mod = await getWasm();
  return mod.real_fft(input);
}

export async function gabor(
  input: Uint8Array,
  width: number,
  height: number,
  sigma: number,
  freq: number,
): Promise<Uint8Array> {
  const mod = await getWasm();
  return mod.gabor_filter_2d(input, width, height, sigma, freq);
}

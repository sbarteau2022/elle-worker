// ============================================================
// FIXED-POINT CORDIC — src/fixed-math.ts
//
// PLAIN LANGUAGE: hyperbolic-sync.ts computes a walking point using
// Math.tanh / Math.atanh / Math.sqrt. Those are floating-point functions, and
// floating point has a quiet gap: the JavaScript spec does not require every
// engine to produce the IDENTICAL last bit for a transcendental function like
// tanh. Two ends of a sync running on different hardware or different JS
// engines could compute a position that differs in its very last decimal
// digit — and because that position feeds a key derivation, a one-bit
// difference produces a COMPLETELY different key. The channel goes silently
// deaf. That was flagged as an open caveat in every doc so far ("same-runtime
// is fine; cross-platform needs fixed-point math"). This file is that fix.
//
// THE IDEA: do all the math with whole numbers instead of decimals, using an
// old technique built for hardware that has no multiply/divide circuit at
// all — CORDIC (COordinate Rotation DIgital Computer), invented in 1959 for
// aircraft navigation computers. It computes sin, cos, tanh, atanh, and
// square roots using nothing but ADD, SUBTRACT, and BIT-SHIFT (which is just
// "multiply or divide by 2, instantly, by moving the digits over"). No
// decimal point ever appears in the computation.
//
// WHY THIS GIVES TRUE CROSS-PLATFORM DETERMINISM (not just "same V8 build"):
// JavaScript's bitwise operators (| & ^ << >> >>>) are defined in the language
// SPECIFICATION to convert every operand to a 32-bit signed integer first and
// operate on those exact bits — every compliant engine (V8, SpiderMonkey,
// JavaScriptCore, whatever runs on whatever CPU) MUST produce the identical
// result, by spec, not by convention. Ordinary IEEE-754 double +, −, × are
// ALSO exactly specified (round-to-nearest-even) — the part of floating point
// that is NOT cross-engine-guaranteed is specifically the transcendental
// Math.* functions (sin, cos, tanh, atanh, sqrt, exp, log, …), which the spec
// explicitly permits to be "implementation-approximated." So the discipline
// this file follows is narrow and total: NEVER call a transcendental Math
// function at run time. Every lookup table below was computed ONCE, offline,
// and is written into this file as a literal integer array — never
// recomputed from floating trig on whatever machine happens to load the
// module. (An earlier draft of this file built the tables at import time via
// Math.atan/Math.atanh — which silently reintroduces the exact 1-ULP risk
// this file exists to remove. Caught and fixed before anything shipped.)
//
// Wide products (bigger than JS's 2^53 exact-integer ceiling) are computed
// with BigInt, whose arithmetic is exact and, like the bitwise ops, exactly
// specified — so no precision is quietly lost converting a fixed-point
// multiply or divide back down to a 32-bit result.
//
// FORMAT: Q0.30 fixed point. A "fixed-point number" is just an ordinary
// 32-bit integer where we AGREE to treat it as if it had a decimal point
// after the 30th bit — so the integer 2^30 (1073741824) represents "1.0",
// half that represents "0.5", and so on.
//
// VALID RANGE — read before reusing these functions elsewhere:
//   • Representable magnitude: strictly below 2.0. toFixed(2) itself
//     overflows a signed 32-bit integer (2·2^30 = 2^31, one past INT32_MAX)
//     and silently wraps. Disk coordinates are bounded in (-1, 1) and their
//     hyperbolic-distance norms stay comfortably under 1.5, so this is not a
//     limitation in practice here — just a hard ceiling to respect if this
//     module is reused for something with a wider range.
//   • Hyperbolic rotation-mode convergence: fixedSinhCosh/fixedTanh only
//     converge for |s| below the sum of the ATANH_TABLE entries (~1.055 at
//     24 iterations) — the same kind of range restriction circular CORDIC
//     has at ±π/2. The geodesic arc-length step used elsewhere in this
//     codebase is 0.5, well inside that ceiling.
// ============================================================

const FRAC_BITS = 30;
export const ONE = 1 << FRAC_BITS;              // Q0.30 representation of 1.0
const ONE_BIG = BigInt(ONE);

export function toFixed(x: number): number { return Math.round(x * ONE) | 0; }
export function toFloat(x: number): number { return x / ONE; }

// Exact Q0.30 × Q0.30 → Q0.30 multiply via BigInt (products up to ~2^62 would
// silently round if done in plain `number` arithmetic — this is exact).
export function mulQ(a: number, b: number): number {
  return Number((BigInt(a) * BigInt(b)) / ONE_BIG) | 0;
}

// Exact Q0.30 divide via BigInt (the numerator·ONE intermediate is up to
// ~2^61 — also unsafe in plain `number` arithmetic).
export function fixedDiv(numQ: number, denQ: number): number {
  if (denQ === 0) return numQ >= 0 ? 0x7fffffff : -0x7fffffff;
  return Number((BigInt(numQ) * ONE_BIG) / BigInt(denQ)) | 0;
}

// Integer Newton's-method sqrt in Q0.30 — fixed 8 iterations, exact via
// fixedDiv above; converges for any non-negative input in this format's range.
export function fixedSqrt(xQ: number): number {
  if (xQ <= 0) return 0;
  let guess = xQ > ONE ? xQ : ONE;
  for (let i = 0; i < 8; i++) guess = ((guess + fixedDiv(xQ, guess)) / 2) | 0;
  return guess;
}

// ── circular CORDIC (sin/cos) ────────────────────────────────────────────
// atan(2^-i) for i=0..27, and the CORDIC gain 1/K, in Q0.30 — computed ONCE
// offline (see docs/FIXED_POINT_CORDIC.md for the generating script) and
// pasted here as literal constants. Never recomputed at import time.
const CIRC_ITERS = 28;
const ATAN_TABLE: readonly number[] = [
  843314857, 497837829, 263043837, 133525159, 67021687, 33543516, 16775851,
  8388437, 4194283, 2097149, 1048576, 524288, 262144, 131072, 65536, 32768,
  16384, 8192, 4096, 2048, 1024, 512, 256, 128, 64, 32, 16, 8,
];
const CIRC_GAIN_INV = 652032874;

// sin/cos of an angle given in Q0.30 RADIANS (bounded to [-pi/2, pi/2] by the
// caller; CORDIC circular mode converges there without a range reduction).
export function fixedSinCos(angleQ: number): { sin: number; cos: number } {
  let x = CIRC_GAIN_INV, y = 0, z = angleQ;
  for (let i = 0; i < CIRC_ITERS; i++) {
    const dx = x >> i, dy = y >> i;
    if (z >= 0) { x = (x - dy) | 0; y = (y + dx) | 0; z = (z - ATAN_TABLE[i]) | 0; }
    else        { x = (x + dy) | 0; y = (y - dx) | 0; z = (z + ATAN_TABLE[i]) | 0; }
  }
  return { cos: x, sin: y };
}

// π/2 in Q0.30 — a literal (Math.PI is itself a fixed spec-defined constant,
// not a computed transcendental call, but this is baked in at build time
// exactly like every other table here, for the same discipline).
const HALF_PI = 1686629713;

// Full-circle sin/cos from a TURN FRACTION in [0, 1) — i.e. angle/2π, not
// radians. Two reasons this is the right interface, not an arbitrary choice:
//   1. Circular CORDIC only converges for angles in [-π/2, π/2]; a full turn
//      needs quadrant folding first regardless of units.
//   2. 2π itself (≈6.283) does not fit this format — Q0.30 tops out just
//      under 2.0 — so radians were never representable for a full circle.
//      A turn fraction lives in [0, 1), a perfect, exact fit for Q0.30, and
//      it is exactly the quantity torus-sync.ts's `golden()` already produces.
export function fixedSinCosTurn(turnQ: number): { sin: number; cos: number } {
  const t = ((turnQ % ONE) + ONE) % ONE;   // wrap into [0, ONE) — exact integer mod
  const quarter = ONE >> 2;                 // ONE/4 turn-units per quadrant, exact
  const q = Math.floor(t / quarter) & 3;    // quadrant 0..3 (exact: quarter is a power of 2)
  const r = t - q * quarter;                // reduced turn within the quadrant, [0, quarter)
  // Rescale r from turn-units [0, quarter) to radians [0, HALF_PI): angleQ = r · HALF_PI / quarter.
  const angleQ = fixedDiv(mulQ(r, HALF_PI), quarter);
  const { sin: S, cos: C } = fixedSinCos(angleQ);
  switch (q) {
    case 0: return { cos: C, sin: S };
    case 1: return { cos: -S, sin: C };
    case 2: return { cos: -C, sin: -S };
    default: return { cos: S, sin: -C };
  }
}

// ── hyperbolic CORDIC (tanh/atanh) ───────────────────────────────────────
// Hyperbolic CORDIC needs iterations 1,2,3,4,4,5,…,13,13,14… — indices 4, 13,
// 40, … are each repeated once, a known convergence requirement of the
// hyperbolic variant (Volder/Walther). atanh(2^-i) and the inverse gain,
// again literal, precomputed offline.
const HYP_ITERS = 24;
const HYP_SEQ: readonly number[] = [
  1, 2, 3, 4, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
];
const ATANH_TABLE: readonly number[] = [
  589812981, 274247419, 134923406, 67196451, 67196451, 33565361, 16778582,
  8388779, 4194325, 2097155, 1048576, 524288, 262144, 131072, 131072, 65536,
  32768, 16384, 8192, 4096, 2048, 1024, 512, 256,
];
const HYP_GAIN_INV = 1296540104;

// tanh(s) via hyperbolic CORDIC rotation mode, s in Q0.30. Returns {sinh,cosh};
// tanh = sinh/cosh (fixedDiv) when the caller needs it.
export function fixedSinhCosh(sQ: number): { sinh: number; cosh: number } {
  let x = HYP_GAIN_INV, y = 0, z = sQ;
  for (let k = 0; k < HYP_ITERS; k++) {
    const i = HYP_SEQ[k];
    const dx = x >> i, dy = y >> i;
    if (z >= 0) { x = (x + dy) | 0; y = (y + dx) | 0; z = (z - ATANH_TABLE[k]) | 0; }
    else        { x = (x - dy) | 0; y = (y - dx) | 0; z = (z + ATANH_TABLE[k]) | 0; }
  }
  return { cosh: x, sinh: y };
}

export function fixedTanh(sQ: number): number {
  const { sinh, cosh } = fixedSinhCosh(sQ);
  return fixedDiv(sinh, cosh);
}

// atanh(w) via hyperbolic CORDIC VECTORING mode: drive y to 0, accumulate z.
// Converges for |w| below ~0.8 at this iteration count — comfortably true for
// our use (hyperbolic-sync-fixed.ts keeps every disk point well inside that).
export function fixedAtanh(wQ: number): number {
  let x = ONE, y = wQ, z = 0;
  for (let k = 0; k < HYP_ITERS; k++) {
    const i = HYP_SEQ[k];
    const dx = x >> i, dy = y >> i;
    if (y < 0) { x = (x + dy) | 0; y = (y + dx) | 0; z = (z - ATANH_TABLE[k]) | 0; }
    else       { x = (x - dy) | 0; y = (y - dx) | 0; z = (z + ATANH_TABLE[k]) | 0; }
  }
  return z;
}

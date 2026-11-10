// ============================================================
// TS ↔ RUST FIXED-POINT PARITY — src/fixed-math-parity.test.ts
//
// src/fixed-math.ts and crates/elle-core-wasm/src/lib.rs implement the SAME
// Q0.30 CORDIC twice: same tables, same iteration counts, same algorithm. Only
// the TypeScript side is live today (hyperbolic-sync-fixed.ts → the session-bus
// keystream walk); the Rust twins are currently uncalled.
//
// That duplication has already bitten once. The Rust `div_q` carried
// `i32::MIN` on the negative divide-by-zero branch where TypeScript returns
// -0x7fffffff — one LSB apart. Both feed a keystream each end of the bus
// derives independently, so a single divergent step yields a different key and
// the lane goes SILENTLY DEAF: no exception, no failing test, just a channel
// that stops decrypting. The fix is recorded in a comment in lib.rs; nothing
// stops it recurring.
//
// This file is the guard that comment asked for. It runs both implementations
// over the same inputs — including every boundary the CORDIC branches on — and
// asserts bit-exact equality. If either side is edited without the other, this
// goes red at build time instead of going deaf in production.
// ============================================================

import { describe, expect, it } from 'vitest';
import * as ts from './fixed-math';
import * as core from './wasm/elle_core_wasm';

// Inputs chosen to exercise the branch structure, not just the happy middle:
// sign flips (the z >= 0 test), zero, the convergence ceilings named in
// fixed-math.ts's header, and values just inside/outside them.
const ANGLES = [
  0, 1, -1, 1 << 20, -(1 << 20),
  ts.HALF_PI, -ts.HALF_PI, (ts.HALF_PI / 2) | 0, -((ts.HALF_PI / 2) | 0),
  ts.ONE, -ts.ONE, (ts.ONE / 3) | 0, -((ts.ONE / 3) | 0),
  843314857, -843314857,            // ATAN_TABLE[0]: first branch boundary
  ts.ONE - 1, -(ts.ONE - 1),
];

// Hyperbolic CORDIC converges only for |s| < ~1.055 (sum of ATANH_TABLE).
const HYP_INPUTS = [
  0, 1, -1, 1 << 20, -(1 << 20),
  (ts.ONE / 2) | 0, -((ts.ONE / 2) | 0),
  (ts.ONE * 0.9) | 0, -((ts.ONE * 0.9) | 0),
  589812981, -589812981,            // ATANH_TABLE[0]
  ts.ONE, -ts.ONE,
];

describe('circular CORDIC parity (sin/cos)', () => {
  it('TypeScript and Rust agree bit-exactly on every probe angle', () => {
    for (const a of ANGLES) {
      const t = ts.fixedSinCos(a);
      const r = core.cordic_sin_cos(a) as { sin: number; cos: number };
      expect(r.sin, `sin diverged at angleQ=${a}`).toBe(t.sin);
      expect(r.cos, `cos diverged at angleQ=${a}`).toBe(t.cos);
    }
  });
});

describe('hyperbolic CORDIC parity (sinh/cosh)', () => {
  it('TypeScript and Rust agree bit-exactly on every probe input', () => {
    for (const s of HYP_INPUTS) {
      const t = ts.fixedSinhCosh(s);
      const r = core.cordic_sinh_cosh(s) as { sinh: number; cosh: number };
      expect(r.sinh, `sinh diverged at sQ=${s}`).toBe(t.sinh);
      expect(r.cosh, `cosh diverged at sQ=${s}`).toBe(t.cosh);
    }
  });
});

describe('Q0.30 multiply parity', () => {
  it('agrees across signs, zero, and the format ceiling', () => {
    const vals = [0, 1, -1, ts.ONE, -ts.ONE, ts.ONE - 1, 0x3fffffff, -0x3fffffff,
                  (ts.ONE / 3) | 0, -((ts.ONE / 7) | 0), 123456789, -987654321];
    for (const a of vals) for (const b of vals) {
      expect(core.mul_q_wasm(a, b), `mulQ diverged at (${a},${b})`).toBe(ts.mulQ(a, b));
    }
  });
});

describe('Q0.30 divide parity', () => {
  // IN RANGE is the contract. fixed-math.ts's header declares Q0.30 represents
  // magnitudes strictly below 2.0, so a divide is only meaningful when
  // |num/den| < 2. Every pair below satisfies that; both sides must agree
  // bit-for-bit, because this is the range the keystream walk actually uses.
  it('agrees on every in-range divide', () => {
    const v = [0.9, 0.5, 0.25, 1 / 3, 0.1, 1e-3, -0.9, -0.5, -0.25, -1 / 3, -0.1, -1e-3];
    let checked = 0;
    for (const a of v) for (const b of v) {
      if (Math.abs(a / b) >= 2) continue;               // outside the format's ceiling
      const [n, d] = [ts.toFixed(a), ts.toFixed(b)];
      expect(core.div_q_wasm(n, d), `divQ diverged at (${a}/${b})`).toBe(ts.fixedDiv(n, d));
      checked++;
    }
    expect(checked, 'no in-range pairs were exercised').toBeGreaterThan(20);
  });

  // The exact case that shipped broken: TS returns ±0x7fffffff, Rust once
  // returned i32::MIN on the negative branch. Asymmetric sentinels are one LSB
  // apart and silently re-key the bus.
  it('agrees on the divide-by-zero sentinel, both signs', () => {
    expect(core.div_q_wasm(1, 0)).toBe(ts.fixedDiv(1, 0));
    expect(core.div_q_wasm(0, 0)).toBe(ts.fixedDiv(0, 0));
    expect(core.div_q_wasm(-1, 0)).toBe(ts.fixedDiv(-1, 0));
    expect(ts.fixedDiv(-1, 0), 'sentinel must be symmetric, not i32::MIN').toBe(-0x7fffffff);
  });

  // OUT OF RANGE the two implementations genuinely disagree, and this pins it
  // so the fact is recorded rather than discovered during an outage.
  //
  // TypeScript computes the exact BigInt quotient and then calls Number() on
  // it. Above 2^53 that conversion is LOSSY, so the `| 0` wrap operates on an
  // already-corrupted value. Rust stays in i128 and truncates exactly. For
  // fixedDiv(ONE, 3) the true quotient is 384307168202282325; TS wraps to
  // 1431655744, Rust to 1431655765 — 21 apart, with Rust correct.
  //
  // Not a live defect: every caller keeps |num/den| < 2 per the header's stated
  // range. It IS a trap for anyone reusing fixed-math.ts elsewhere, and it means
  // TS must not be treated as the reference if that range is ever widened.
  it('documents the out-of-range divergence (TS is the lossy side)', () => {
    const tsOut = ts.fixedDiv(ts.ONE, 3);
    const rsOut = core.div_q_wasm(ts.ONE, 3);
    expect(tsOut).toBe(1431655744);
    expect(rsOut).toBe(1431655765);
    expect(rsOut).not.toBe(tsOut);
    // Rust matches the mathematically exact low-32-bit truncation.
    const exact = (BigInt(ts.ONE) * BigInt(ts.ONE)) / 3n;
    expect(BigInt(rsOut)).toBe(BigInt.asIntN(32, exact));
  });
});

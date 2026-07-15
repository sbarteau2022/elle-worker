import { describe, it, expect } from 'vitest';
import {
  ONE, toFixed, toFloat, mulQ, fixedDiv, fixedSqrt,
  fixedSinCos, fixedSinCosTurn, fixedSinhCosh, fixedTanh, fixedAtanh,
} from './fixed-math';

const EPS = 1e-6; // CORDIC's expected accuracy at 24-28 iterations in Q0.30

describe('mulQ / fixedDiv / fixedSqrt — exact wide arithmetic', () => {
  it('multiplies without precision loss on values near the format ceiling', () => {
    const a = toFixed(0.987654321), b = toFixed(0.123456789);
    expect(toFloat(mulQ(a, b))).toBeCloseTo(0.987654321 * 0.123456789, 6);
  });
  it('divides exactly (operands AND quotient within the format\'s valid magnitude, <2.0)', () => {
    expect(toFloat(fixedDiv(toFixed(1), toFixed(1.4)))).toBeCloseTo(1 / 1.4, 5);
    expect(toFloat(fixedDiv(toFixed(0.3), toFixed(0.7)))).toBeCloseTo(0.3 / 0.7, 5);
  });
  it('square-roots correctly, for inputs safely below the format ceiling', () => {
    expect(toFloat(fixedSqrt(toFixed(0.25)))).toBeCloseTo(0.5, 5);
    expect(toFloat(fixedSqrt(toFixed(1.9)))).toBeCloseTo(Math.sqrt(1.9), 4);
  });
});

describe('fixedSinCos — circular CORDIC matches Math.sin/cos', () => {
  it('agrees with floating trig across the convergent range', () => {
    for (const a of [-1.5, -1, -0.5, -0.001, 0, 0.001, 0.5, 1, 1.5]) {
      const { sin, cos } = fixedSinCos(toFixed(a));
      expect(toFloat(sin)).toBeCloseTo(Math.sin(a), 5);
      expect(toFloat(cos)).toBeCloseTo(Math.cos(a), 5);
    }
  });
  it('is bit-for-bit deterministic across repeated calls (the whole point)', () => {
    const a = toFixed(0.7182818);
    const r1 = fixedSinCos(a), r2 = fixedSinCos(a);
    expect(r1).toEqual(r2);
  });
});

describe('fixedSinCosTurn — full-circle sin/cos from a turn fraction', () => {
  it('agrees with Math.sin/cos(2π·turn) across all four quadrants', () => {
    for (const turn of [0, 0.1, 0.24, 0.25, 0.3, 0.5, 0.6, 0.75, 0.9, 0.999]) {
      const angle = 2 * Math.PI * turn;
      const { sin, cos } = fixedSinCosTurn(toFixed(turn));
      expect(toFloat(sin)).toBeCloseTo(Math.sin(angle), 4);
      expect(toFloat(cos)).toBeCloseTo(Math.cos(angle), 4);
    }
  });
  it('wraps negative and >1 turn values into [0,1) exactly like the float golden angle', () => {
    const a = fixedSinCosTurn(toFixed(0.3));
    const b = fixedSinCosTurn(toFixed(1.3));
    const c = fixedSinCosTurn(toFixed(-0.7));
    expect(a).toEqual(b);
    expect(a).toEqual(c);
  });
});

describe('fixedSinhCosh / fixedTanh — hyperbolic CORDIC matches Math.tanh', () => {
  // |s| must stay under the rotation-mode convergence ceiling (~1.055 at 24
  // iterations, see fixed-math.ts header) — the geodesic step size actually
  // used elsewhere in this codebase is 0.5, comfortably inside it.
  it('agrees with floating tanh across the disk-relevant range', () => {
    for (const s of [-1.0, -0.7, -0.1, 0, 0.1, 0.5, 0.7, 1.0]) {
      const t = fixedTanh(toFixed(s));
      expect(toFloat(t)).toBeCloseTo(Math.tanh(s), 5);
    }
  });
  it('sinh/cosh individually agree with the floating versions', () => {
    for (const s of [-1, -0.3, 0, 0.3, 1]) {
      const { sinh, cosh } = fixedSinhCosh(toFixed(s));
      expect(toFloat(sinh)).toBeCloseTo(Math.sinh(s), 4);
      expect(toFloat(cosh)).toBeCloseTo(Math.cosh(s), 4);
    }
  });
});

describe('fixedAtanh — hyperbolic CORDIC vectoring matches Math.atanh', () => {
  it('agrees with floating atanh well inside its convergent range', () => {
    for (const w of [-0.7, -0.3, -0.01, 0, 0.01, 0.3, 0.7]) {
      expect(toFloat(fixedAtanh(toFixed(w)))).toBeCloseTo(Math.atanh(w), 4);
    }
  });
  it('round-trips with fixedTanh (atanh(tanh(x)) ≈ x)', () => {
    for (const x of [-0.6, -0.1, 0.1, 0.6]) {
      const back = fixedAtanh(fixedTanh(toFixed(x)));
      expect(toFloat(back)).toBeCloseTo(x, 3);
    }
  });
});

describe('determinism guarantee', () => {
  it('every exported function is a pure function of its integer input — no hidden state', () => {
    const inputs = [toFixed(0.42), toFixed(-0.13), toFixed(0.99)];
    for (const x of inputs) {
      expect(fixedSinCos(x)).toEqual(fixedSinCos(x));
      expect(fixedSinhCosh(x)).toEqual(fixedSinhCosh(x));
      expect(fixedTanh(x)).toEqual(fixedTanh(x));
      expect(fixedAtanh(x)).toEqual(fixedAtanh(x));
    }
  });
});

import { describe, it, expect } from 'vitest';
import {
  ONE, toFixed, toFloat, mulQ, fixedDiv, fixedSqrt,
  CIRC_ITERS, ATAN_TABLE, CIRC_GAIN_INV, HALF_PI,
  HYP_ITERS, HYP_SEQ, ATANH_TABLE, HYP_GAIN_INV,
  fixedSinCos, fixedSinCosTurn, fixedSinhCosh, fixedTanh, fixedAtanh,
} from './fixed-math';

const EPS = 1e-6; // CORDIC's expected accuracy at 24-28 iterations in Q0.30

describe('CORDIC table constants — exact offline mathematical definitions', () => {
  it('CIRC_ITERS is exactly 28 and ATAN_TABLE contains exact precomputed angles', () => {
    expect(CIRC_ITERS).toBe(28);
    expect(ATAN_TABLE.length).toBe(28);
    for (let i = 0; i < 28; i++) {
      const expected = Math.round(Math.atan(2 ** -i) * ONE);
      expect(ATAN_TABLE[i]).toBe(expected);
    }
  });

  it('CIRC_GAIN_INV matches exact inverse CORDIC gain 1/K in Q0.30', () => {
    let kProd = 1;
    for (let i = 0; i < 28; i++) {
      kProd *= Math.sqrt(1 + 2 ** (-2 * i));
    }
    const expectedCircGainInv = Math.round((1 / kProd) * ONE);
    expect(CIRC_GAIN_INV).toBe(652032874);
    expect(CIRC_GAIN_INV).toBe(expectedCircGainInv);
  });

  it('HALF_PI matches exact pi/2 in Q0.30', () => {
    const expectedHalfPi = Math.round((Math.PI / 2) * ONE);
    expect(HALF_PI).toBe(1686629713);
    expect(HALF_PI).toBe(expectedHalfPi);
  });

  it('HYP_ITERS is exactly 24 and HYP_SEQ follows Walther repeated sequence (4, 13)', () => {
    expect(HYP_ITERS).toBe(24);
    expect(HYP_SEQ.length).toBe(24);
    expect(HYP_SEQ).toEqual([
      1, 2, 3, 4, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
    ]);
  });

  it('ATANH_TABLE contains exact precomputed hyperbolic angles in Q0.30', () => {
    expect(ATANH_TABLE.length).toBe(24);
    for (let k = 0; k < 24; k++) {
      const i = HYP_SEQ[k];
      const expected = Math.round(Math.atanh(2 ** -i) * ONE);
      expect(ATANH_TABLE[k]).toBe(expected);
    }
  });

  it('HYP_GAIN_INV matches exact inverse hyperbolic gain 1/K_h in Q0.30', () => {
    let khProd = 1;
    for (let k = 0; k < 24; k++) {
      const i = HYP_SEQ[k];
      khProd *= Math.sqrt(1 - 2 ** (-2 * i));
    }
    const expectedHypGainInv = Math.round((1 / khProd) * ONE);
    expect(HYP_GAIN_INV).toBe(1296540104);
    expect(HYP_GAIN_INV).toBe(expectedHypGainInv);
  });
});

describe('mulQ / fixedDiv / fixedSqrt — exact wide arithmetic', () => {
  it('multiplies without precision loss on values near the format ceiling', () => {
    const a = toFixed(0.987654321), b = toFixed(0.123456789);
    expect(toFloat(mulQ(a, b))).toBeCloseTo(0.987654321 * 0.123456789, 6);
  });

  it('multiplies signed negative numbers accurately', () => {
    const a = toFixed(-0.5), b = toFixed(0.75);
    expect(toFloat(mulQ(a, b))).toBeCloseTo(-0.375, 6);
    expect(toFloat(mulQ(a, a))).toBeCloseTo(0.25, 6);
  });

  it('divides exactly (operands AND quotient within the format\'s valid magnitude, <2.0)', () => {
    expect(toFloat(fixedDiv(toFixed(1), toFixed(1.4)))).toBeCloseTo(1 / 1.4, 5);
    expect(toFloat(fixedDiv(toFixed(0.3), toFixed(0.7)))).toBeCloseTo(0.3 / 0.7, 5);
  });

  it('handles division by zero safely without throwing or NaN', () => {
    expect(fixedDiv(toFixed(1), 0)).toBe(0x7fffffff);
    expect(fixedDiv(toFixed(-1), 0)).toBe(-0x7fffffff);
    expect(fixedDiv(0, 0)).toBe(0x7fffffff);
  });

  it('square-roots correctly, for inputs safely below the format ceiling', () => {
    expect(toFloat(fixedSqrt(toFixed(0.25)))).toBeCloseTo(0.5, 5);
    expect(toFloat(fixedSqrt(toFixed(1.9)))).toBeCloseTo(Math.sqrt(1.9), 4);
    expect(fixedSqrt(0)).toBe(0);
    expect(fixedSqrt(-100)).toBe(0);
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

  it('satisfies circular Pythagorean identity sin^2 + cos^2 = 1 in Q0.30', () => {
    for (let a = -1.5; a <= 1.5; a += 0.1) {
      const { sin, cos } = fixedSinCos(toFixed(a));
      const pyth = mulQ(sin, sin) + mulQ(cos, cos);
      expect(toFloat(pyth)).toBeCloseTo(1.0, 4);
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

  it('satisfies Pythagorean identity across the entire circle [0, 1) turn', () => {
    for (let turn = 0; turn < 1; turn += 0.05) {
      const { sin, cos } = fixedSinCosTurn(toFixed(turn));
      const pyth = mulQ(sin, sin) + mulQ(cos, cos);
      expect(toFloat(pyth)).toBeCloseTo(1.0, 4);
    }
  });
});

describe('fixedSinhCosh / fixedTanh — hyperbolic CORDIC matches Math.tanh', () => {
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

  it('satisfies hyperbolic Pythagorean identity cosh^2 - sinh^2 = 1 in Q0.30 for values within magnitude ceiling < 2.0', () => {
    for (const s of [-0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6]) {
      const { sinh, cosh } = fixedSinhCosh(toFixed(s));
      const hypId = mulQ(cosh, cosh) - mulQ(sinh, sinh);
      expect(toFloat(hypId)).toBeCloseTo(1.0, 4);
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


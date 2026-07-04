import { describe, it, expect } from 'vitest';
import { clampLimit } from './events';

describe('clampLimit', () => {
  it('returns the default for non-numeric input', () => {
    expect(clampLimit(undefined, 15)).toBe(15);
    expect(clampLimit(null, 20)).toBe(20);
    expect(clampLimit('abc', 10)).toBe(10);
    expect(clampLimit(NaN, 7)).toBe(7);
  });

  it('floors, and clamps into [1,100]', () => {
    expect(clampLimit(0, 15)).toBe(1);
    expect(clampLimit(-5, 15)).toBe(1);
    expect(clampLimit(250, 15)).toBe(100);
    expect(clampLimit(12.9, 15)).toBe(12);
    expect(clampLimit('30', 15)).toBe(30);
  });
});

// Unit tests for the shared κ dynamics module (dt = 1 step, finite differences).
//   npx vitest run src/kappa-dynamics.test.ts
import { describe, it, expect } from 'vitest';
import {
  velocityAt, accelerationAt, jerkAt, reserveAt,
  computeSeries, latestPoint,
} from './kappa-dynamics';

describe('finite differences, dt = 1', () => {
  it('velocity is the 1st difference, null before 2 points', () => {
    const s = [0.4, 0.5, 0.55];
    expect(velocityAt(s, 0)).toBeNull();
    expect(velocityAt(s, 1)).toBe(0.1);
    expect(velocityAt(s, 2)).toBeCloseTo(0.05, 10);
  });
  it('acceleration is the 2nd difference, null before 3 points', () => {
    const s = [0.4, 0.5, 0.55, 0.6];
    expect(accelerationAt(s, 1)).toBeNull();
    expect(accelerationAt(s, 2)).toBeCloseTo(0.55 - 2 * 0.5 + 0.4, 10);  // -0.05
    expect(accelerationAt(s, 3)).toBeCloseTo(0.6 - 2 * 0.55 + 0.5, 10);  // 0.0
  });
  it('jerk is the 3rd difference, null before 4 points', () => {
    const s = [0.4, 0.5, 0.55, 0.6, 0.62];
    expect(jerkAt(s, 2)).toBeNull();
    expect(jerkAt(s, 3)).toBeCloseTo(0.6 - 3 * 0.55 + 3 * 0.5 - 0.4, 10); // 0.05
  });
  it('reserve is the running Σκ (dt=1), not a wall-clock integral', () => {
    const s = [0.4, 0.5, 0.55];
    expect(reserveAt(s, 0)).toBe(0.4);
    expect(reserveAt(s, 1)).toBe(0.9);
    expect(reserveAt(s, 2)).toBeCloseTo(1.45, 10);
  });
});

describe('null ≠ 0 (insufficient data vs. a flat series)', () => {
  // REQUIRED: a constant κ series gives velocity/accel/jerk = 0 where defined.
  it('a constant series gives 0 (not null) once there are enough points', () => {
    const pts = computeSeries([0.5, 0.5, 0.5, 0.5]);
    expect(pts.map(p => p.velocity)).toEqual([null, 0, 0, 0]);
    expect(pts.map(p => p.acceleration)).toEqual([null, null, 0, 0]);
    expect(pts.map(p => p.jerk)).toEqual([null, null, null, 0]);
  });
  it('keeps null distinct from 0 — the early steps are null, not zero', () => {
    const pts = computeSeries([0.5, 0.5]);
    expect(pts[0].velocity).toBeNull();
    expect(pts[1].velocity).toBe(0);
    expect(pts[1].acceleration).toBeNull();   // null, NOT 0
  });
});

describe('historical series 0.487 → 0.500 → 0.500 → 0.500 → 0.500', () => {
  // REQUIRED: per-step velocity must be [null, 0.013, 0, 0, 0] — this is the
  // bug-fix proof: under the old wall-clock dt these were all ~0.
  it('returns per-step velocity [null, 0.013, 0, 0, 0]', () => {
    const series = [0.487, 0.5, 0.5, 0.5, 0.5];
    const v = computeSeries(series).map(p => p.velocity);
    expect(v).toEqual([null, 0.013, 0, 0, 0]);
  });
  it('acceleration and jerk follow the same null-aware finite differences', () => {
    const pts = computeSeries([0.487, 0.5, 0.5, 0.5, 0.5]);
    expect(pts.map(p => p.acceleration)).toEqual([null, null, -0.013, 0, 0]);
    expect(pts.map(p => p.jerk)).toEqual([null, null, null, 0.013, 0]);
  });
});

describe('latestPoint', () => {
  it('describes only the newest step and carries input_perturbation through', () => {
    const p = latestPoint([0.4, 0.5, 0.55, 0.6], 0.31);
    expect(p.step_index).toBe(3);
    expect(p.kappa).toBe(0.6);
    expect(p.velocity).toBeCloseTo(0.05, 10);
    expect(p.acceleration).toBeCloseTo(0, 10);
    expect(p.jerk).toBeCloseTo(0.05, 10);
    expect(p.reserve).toBeCloseTo(2.05, 10);
    expect(p.input_perturbation).toBe(0.31);
  });
  it('input_perturbation defaults to null when not provided', () => {
    expect(latestPoint([0.5]).input_perturbation).toBeNull();
    expect(latestPoint([0.5]).velocity).toBeNull();
  });
});

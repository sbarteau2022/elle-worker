import { describe, it, expect } from 'vitest';
import {
  orient,
  runObliquity,
  obliquitySteers,
  isotropicNull,
  timescaleSeparation,
  detectability,
  cognitiveObliquitySelfTest,
} from './cognitive-obliquity';

describe('R(θ) — the orientation transform', () => {
  it('rotates the input vector and preserves its length (it reorients, not rescales)', () => {
    const u: [number, number] = [1, 0];
    const r = orient(Math.PI / 2, u);
    expect(r[0]).toBeCloseTo(0, 6);
    expect(r[1]).toBeCloseTo(1, 6);
    expect(Math.hypot(...r)).toBeCloseTo(Math.hypot(...u), 6);
  });
});

describe('θ steers which class gets integrated — same F, structured input', () => {
  it('reallocates integration with a cos²(θ) shape: peak aligned, ~0 orthogonal, half at 45°', () => {
    const s = obliquitySteers();
    expect(s.aligned).toBeGreaterThan(s.orthogonal * 3);          // strong reallocation
    expect(s.orthogonal).toBeLessThan(s.aligned * 0.1);           // ~0 when input is rotated orthogonal
    expect(s.halfway).toBeCloseTo(s.aligned * 0.5, 3);            // 45° ≈ half (cos²45° = 0.5)
    expect(s.monotone).toBe(true);                                // falls monotonically 0°→90°
  });
});

describe('the precondition, found by measurement — isotropic null', () => {
  it('with balanced input and a symmetric integrator, θ changes essentially nothing', () => {
    const iso = isotropicNull();
    expect(iso.effectively_flat).toBe(true);
    expect(iso.spread_ratio).toBeLessThan(1.3);   // vs a ~50× swing in the structured case
  });
});

describe('timescale separation — slow θ, fast x', () => {
  it('θ evolves far more slowly than the moment-to-moment state', () => {
    const ts = timescaleSeparation();
    expect(ts.theta_much_slower).toBe(true);
    expect(ts.theta_step_var).toBeLessThan(ts.x_step_var / 5);
  });
});

describe('the falsification shape — detectable where structured, null where novel', () => {
  it('a strong effect where a preferred axis exists AND a null in an isotropic/novel domain', () => {
    const d = detectability();
    expect(d.detectable_where_structure).toBe(true);   // ~all reallocated in a structured domain
    expect(d.null_where_novel).toBe(true);             // ~nothing in an isotropic one
    expect(d.prediction_shape_holds).toBe(true);
    expect(d.structured_effect).toBeGreaterThan(d.novel_effect); // the discriminating gap
  });
});

describe('cognitiveObliquitySelfTest — the whole hypothesis-with-a-test green', () => {
  it('steers, cos² shape, isotropic null, timescale separation, falsification shape', () => {
    const st = cognitiveObliquitySelfTest();
    expect(st.steers_integration).toBe(true);
    expect(st.cos2_shape).toBe(true);
    expect(st.isotropic_null).toBe(true);
    expect(st.timescale_separation).toBe(true);
    expect(st.falsification_shape_holds).toBe(true);
    expect(st.ok).toBe(true);
  });
});

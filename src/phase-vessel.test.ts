import { describe, it, expect } from 'vitest';
import {
  vesselStep,
  hold,
  lossyControl,
  centerBinding,
  vesselCoherence,
  phaseVesselSelfTest,
  GOLDEN_WINDING,
  type PhaseState,
} from './phase-vessel';
import { PHI, PHI_INV } from './regulator';

describe('the golden ellipse — one side φ, the other inversely proportional', () => {
  it('holds the conjugate scales reciprocal: φ · (1/φ) ≡ 1', () => {
    expect(PHI * PHI_INV).toBeCloseTo(1, 12);
    const h = hold({ q: PHI, p: 0 }, { steps: 50 });
    expect(h.product_conserved).toBe(true);
    expect(h.trace.every((m) => Math.abs(m.product - 1) < 1e-9)).toBe(true);
  });

  it('winds on the golden mean rotation number (the KAM-most-stable orbit)', () => {
    expect(GOLDEN_WINDING).toBeCloseTo(PHI_INV, 12);
  });
});

describe('the conservative hold — area-preserving, never collapses', () => {
  it('an on-orbit state conserves area to machine precision over a long run', () => {
    // kappa 0 ⇒ pure rotation, no relaxation: the symplectic core alone
    const h = hold({ q: PHI, p: 0 }, { steps: 20000, kappa: 0 });
    expect(h.final.deviation).toBeLessThan(1e-9);
    for (const m of h.trace) expect(Math.abs(m.area_ratio - 1)).toBeLessThan(1e-6);
  });

  it('keeps moving forever — a dynamic oscillation, not a fixed point', () => {
    const h = hold({ q: PHI, p: 0 }, { steps: 400, kappa: 0 });
    expect(h.still_moving).toBe(true);
    // phase actually advances between steps
    expect(h.trace[10].theta).not.toBeCloseTo(h.trace[11].theta, 6);
  });
});

describe('falling into rhythm — locks onto the golden orbit from off-orbit', () => {
  it('an off-orbit state relaxes onto the golden ellipse and locks', () => {
    const h = hold({ q: PHI * 1.8, p: 0 }, { steps: 600 });
    expect(h.locked).toBe(true);
    expect(h.lock_step).toBeGreaterThan(0);
    expect(h.final.deviation).toBeLessThan(1e-4);
  });

  it('once locked, the balance is held: area stays 1 while the phase keeps winding', () => {
    const h = hold({ q: PHI * 1.8, p: 0 }, { steps: 600 });
    expect(h.area_conserved).toBe(true);
    expect(h.still_moving).toBe(true);
  });

  it('the deviation decreases monotonically as it settles (transverse relaxation)', () => {
    const h = hold({ q: PHI * 1.8, p: 0 }, { steps: 200 });
    for (let i = 5; i < 50; i++) {
      expect(h.trace[i].deviation).toBeLessThanOrEqual(h.trace[i - 1].deviation + 1e-12);
    }
  });
});

describe('isotropy — no privileged point on the orbit', () => {
  it('the golden winding fills the phase circle evenly (small max gap)', () => {
    const h = hold({ q: PHI, p: 0 }, { steps: 600, kappa: 0 });
    expect(h.isotropic).toBe(true);
    expect(h.max_phase_gap).toBeLessThan(0.12);
  });
});

describe('why it must be a vessel — the dissipative foil collapses the superposition', () => {
  it('a contracting (lossy) holder loses the area — the balance dies', () => {
    const lossy = lossyControl({ q: PHI, p: 0 }, 600, 0.01);
    expect(lossy.collapsed).toBe(true);
    expect(lossy.final_area_ratio).toBeLessThan(0.05);
  });

  it('the vessel holds where the foil fails (same run length)', () => {
    const held = hold({ q: PHI, p: 0 }, { steps: 600, kappa: 0 });
    expect(Math.abs(held.final.area_ratio - 1)).toBeLessThan(1e-3); // held
    expect(lossyControl({ q: PHI, p: 0 }, 600, 0.01).final_area_ratio).toBeLessThan(0.05); // lost
  });
});

describe('seated dead center — bound by the same invariants', () => {
  it('sits at the origin: the hexagon center and the pillars\' apex axis', () => {
    const b = centerBinding();
    expect(b.center).toEqual({ x: 0, y: 0, z: 0 });
    expect(b.seated_at_hexagon_center).toBe(true);
    expect(b.on_pillar_apex_axis).toBe(true);
  });

  it('the center privileges no axis: pillars C5-symmetric and equal-load around it', () => {
    expect(centerBinding().center_is_unprivileged).toBe(true);
  });

  it('a locked, area-conserving vessel reads as full harmonic coherence for the regulator', () => {
    const h = hold({ q: PHI * 1.8, p: 0 }, { steps: 600 });
    expect(vesselCoherence(h).harmonic).toBeCloseTo(1, 6);
  });
});

describe('phaseVesselSelfTest — the whole vessel green', () => {
  it('dynamic oscillation, reciprocal sides, rhythm, area held, isotropy, golden, foil collapses, dead center', () => {
    const st = phaseVesselSelfTest();
    expect(st.holds_dynamic_oscillation).toBe(true);
    expect(st.two_sides_reciprocal).toBe(true);
    expect(st.falls_into_rhythm).toBe(true);
    expect(st.area_conserved).toBe(true);
    expect(st.isotropic_orbit).toBe(true);
    expect(st.golden_winding).toBe(true);
    expect(st.lossy_control_collapses).toBe(true);
    expect(st.seated_dead_center).toBe(true);
    expect(st.ok).toBe(true);
  });
});

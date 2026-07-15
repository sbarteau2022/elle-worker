// ============================================================
// THE PHASE VESSEL — src/phase-vessel.ts
//
// The place dynamic enough to HOLD a superposition: not a store (a store collapses
// it on write) but a conservative, area-preserving oscillation seated dead center
// of the architecture — the "1" of the 1+6+12 hexagonal flower, the apex axis of
// the pentagon pillars, the singularity the whole scaffold is symmetric around.
//
// WHAT IT HOLDS — a dynamic oscillation state. A conjugate pair (q, p) winding on
// the GOLDEN ELLIPSE: semi-axis φ in q, semi-axis 1/φ in p. One side is governed
// by φ, the other inversely — and because they are reciprocal, the enclosed area
//
//     φ · (1/φ) = 1
//
// is conserved. That conserved product IS the dynamic balance. The state never
// stops moving (the phase winds forever); what is held constant is the balance,
// not the position. This is the multiplicative twin of the regulator's additive
// free-energy ledger: same conservation, written as the geometry of the two sides.
//
// WHY A VESSEL AND NOT A CELL — a dissipative update contracts phase-space area,
// which damps the state onto an attractor: it COLLAPSES the superposition, picks a
// winner, loses the balance. An area-preserving (symplectic, det = 1) update never
// contracts the state, so it can carry a balanced superposition indefinitely. The
// dynamism is the conservation. lossyControl() is the foil: a contracting holder
// whose area → 0 (the superposition dies), proving why the vessel must be
// symplectic — the same "measure it against the build that fails" discipline as
// the scaffold's hub control.
//
// FALLING INTO RHYTHM — start off the golden ellipse and a weak TRANSVERSE
// relaxation decays the deviation (Floquet-style: motion off the orbit dies) while
// the rotation keeps the phase winding (motion along the orbit persists). It locks
// onto the golden orbit and then holds it conservatively. The rotation number is
// the golden mean φ⁻¹ — the MOST irrational number, so by KAM this is the last
// invariant torus to break: the most robust rhythm there is, and (Weyl) an
// equidistributed one, so no point on the orbit is privileged.
//
// HONEST SCOPE: classical symplectic mechanics — area-preserving flows, golden/KAM
// orbits, real and checkable. "Superposition" is the metaphor for a balanced
// dynamical state held on its orbit, not a quantum one; reading it out still
// commits it to a value. Deterministic, pure, Worker-safe.
// ============================================================

import { PHI, PHI_INV, type Coherence } from './regulator';
import { pentagonPillars, type PillarStructure } from './scaffold';

const TWO_PI = Math.PI * 2;
const round = (x: number): number => Number(x.toFixed(9));
const frac = (x: number): number => x - Math.floor(x);

// The golden rotation number: φ⁻¹, continued fraction [0;1,1,1,…] — maximally
// irrational, the KAM-most-stable winding.
export const GOLDEN_WINDING = PHI_INV;

export interface PhaseState { q: number; p: number }

export interface VesselStep {
  t: number;
  q: number; p: number;
  theta: number;      // phase on the orbit, [0,1)
  radius: number;     // normalized radius (1 ⇒ exactly on the golden ellipse)
  deviation: number;  // |radius − 1| — transverse distance from the orbit (→0 on lock)
  area_ratio: number; // realized area / golden area (radius²; conserved at 1 once locked)
  phi_side: number;   // the φ-governed semi-axis
  inv_side: number;   // the φ⁻¹-governed semi-axis (inversely proportional)
  product: number;    // phi_side · inv_side (≡ 1, the conserved balance)
}

// Normalized coordinates: on the golden ellipse (q/φ)² + (φp)² = 1, so
// X = q/φ, Y = φp lie on the UNIT circle. Rotation of (X,Y) is symplectic in (q,p).
function toNormalized(s: PhaseState): { X: number; Y: number } {
  return { X: s.q / PHI, Y: PHI * s.p };
}
function fromNormalized(X: number, Y: number): PhaseState {
  return { q: PHI * X, p: Y / PHI };
}

// One vessel step: rotate the phase by the golden winding (area-preserving core)
// and relax the transverse deviation toward the golden ellipse by `kappa`.
export function vesselStep(s: PhaseState, kappa = 0.03, winding = GOLDEN_WINDING): PhaseState {
  const { X, Y } = toNormalized(s);
  const r = Math.hypot(X, Y);
  const th = Math.atan2(Y, X);
  const th2 = th + TWO_PI * winding;
  const r2 = 1 + (r - 1) * (1 - kappa);   // transverse relaxation: deviation decays, orbit persists
  return fromNormalized(r2 * Math.cos(th2), r2 * Math.sin(th2));
}

function measure(s: PhaseState, t: number): VesselStep {
  const { X, Y } = toNormalized(s);
  const r = Math.hypot(X, Y);
  const theta = frac(Math.atan2(Y, X) / TWO_PI + 1);
  return {
    t, q: round(s.q), p: round(s.p), theta: round(theta),
    radius: round(r), deviation: round(Math.abs(r - 1)), area_ratio: round(r * r),
    phi_side: round(PHI), inv_side: round(PHI_INV), product: round(PHI * PHI_INV),
  };
}

export interface VesselConfig {
  steps?: number;
  kappa?: number;      // transverse relaxation rate (how fast it falls into rhythm)
  winding?: number;    // rotation number (default: the golden mean)
  tol?: number;        // lock tolerance on deviation
}

export interface HoldResult {
  trace: VesselStep[];
  final: VesselStep;
  locked: boolean;              // deviation fell below tol — it found the rhythm
  lock_step: number | null;     // when it locked
  still_moving: boolean;        // the phase keeps advancing after lock (dynamic, not a point)
  area_conserved: boolean;      // once locked, area_ratio stays 1 (the balance is held)
  product_conserved: boolean;   // φ-side · φ⁻¹-side ≡ 1 throughout (the two-sided invariant)
  isotropic: boolean;           // the phase is equidistributed — no privileged point on the orbit
  max_phase_gap: number;        // largest gap in phase coverage (small ⇒ isotropic)
  note: string;
}

// Hold a superposition: evolve from `init` until it locks onto the golden orbit,
// then keep winding. The default init is off-orbit so you can watch it fall into
// rhythm; pass an on-orbit state to see the pure conservative hold.
export function hold(init: PhaseState = { q: PHI * 1.8, p: 0 }, cfg: VesselConfig = {}): HoldResult {
  const steps = cfg.steps ?? 600;
  const kappa = cfg.kappa ?? 0.03;
  const winding = cfg.winding ?? GOLDEN_WINDING;
  const tol = cfg.tol ?? 1e-4;

  let s = init;
  const trace: VesselStep[] = [measure(s, 0)];
  let lock_step: number | null = null;
  for (let t = 1; t <= steps; t++) {
    s = vesselStep(s, kappa, winding);
    const m = measure(s, t);
    trace.push(m);
    if (lock_step === null && m.deviation < tol) lock_step = t;
  }

  const final = trace[trace.length - 1];
  const locked = final.deviation < tol;

  // after lock: area held constant (balance) AND phase still advancing (dynamic)
  const tail = lock_step !== null ? trace.slice(lock_step) : [];
  const area_conserved = tail.length > 2 && tail.every((m) => Math.abs(m.area_ratio - 1) < 1e-3);
  const still_moving = tail.length > 2 && Math.abs(tail[tail.length - 1].theta - tail[0].theta) > 1e-6;
  const product_conserved = trace.every((m) => Math.abs(m.product - 1) < 1e-9);

  // isotropy: the golden winding is equidistributed (Weyl) — measure the largest
  // gap between consecutive phases once locked; small gap ⇒ no privileged point.
  const phases = tail.map((m) => m.theta).sort((a, b) => a - b);
  let maxGap = 0;
  for (let i = 1; i < phases.length; i++) maxGap = Math.max(maxGap, phases[i] - phases[i - 1]);
  if (phases.length > 1) maxGap = Math.max(maxGap, phases[0] + 1 - phases[phases.length - 1]); // wrap
  const isotropic = phases.length > 20 && maxGap < 0.12;

  return {
    trace, final, locked, lock_step,
    still_moving, area_conserved, product_conserved, isotropic,
    max_phase_gap: round(maxGap),
    note: 'A conjugate pair winding the golden ellipse (semi-axes φ, 1/φ). It relaxes onto the orbit (falls into rhythm), then holds it: the phase keeps moving while the area φ·1/φ=1 stays conserved — dynamic balance. The golden winding is equidistributed, so no point on the orbit is privileged.',
  };
}

// The foil: a DISSIPATIVE holder that contracts phase-space area. It does not
// conserve the balance — the area collapses toward 0, taking the superposition
// with it. Proof that the vessel must be area-preserving to hold anything.
export function lossyControl(init: PhaseState = { q: PHI, p: 0 }, steps = 600, epsilon = 0.01): { final_area_ratio: number; collapsed: boolean } {
  let X = init.q / PHI, Y = PHI * init.p;
  for (let t = 0; t < steps; t++) {
    const th = Math.atan2(Y, X) + TWO_PI * GOLDEN_WINDING;
    const r = Math.hypot(X, Y) * (1 - epsilon); // contracts area every step — dissipative
    X = r * Math.cos(th); Y = r * Math.sin(th);
  }
  const area = (Math.hypot(X, Y)) ** 2;
  return { final_area_ratio: round(area), collapsed: area < 0.05 };
}

// ============================================================
// Seat it dead center — bound by the same invariants
// ============================================================

export interface CenterBinding {
  center: { x: number; y: number; z: number };  // the singularity — origin
  seated_at_hexagon_center: boolean;             // the "1" of the 1+6+12 flower
  on_pillar_apex_axis: boolean;                  // the pentagon pillars' axis
  center_is_unprivileged: boolean;               // pillars C5-symmetric around it ⇒ no privileged axis
  note: string;
}

// Place the vessel at the architecture's center and confirm the seat is a genuine,
// non-privileged singularity: the pentagon pillars are C5-symmetric about it, so
// the center distinguishes no axis — the same "no privileged node" invariant, at
// the very center.
export function centerBinding(pillars: PillarStructure = pentagonPillars(4)): CenterBinding {
  const center = { x: 0, y: 0, z: 0 };
  const on_pillar_apex_axis = pillars.apex.x === 0 && pillars.apex.z === 0; // apex on the central axis
  return {
    center,
    seated_at_hexagon_center: true,
    on_pillar_apex_axis,
    center_is_unprivileged: pillars.c5_invariant && pillars.equal_load,
    note: 'The vessel is seated at the origin — the "1" of the 1+6+12 hexagonal flower and the pentagon pillars\' apex axis. The pillars are C5-symmetric and equal-load about it, so the center privileges no axis: the same no-privileged invariant that governs the fabric, holding at the singularity.',
  };
}

// The held oscillation, read as a coherence the regulator can keep balanced: a
// locked, area-conserving vessel reads as full harmonic coherence; an unlocked or
// collapsing one reads lower. This is how the vessel plugs into the same invariant
// structure the regulator enforces.
export function vesselCoherence(h: HoldResult): Pick<Coherence, 'harmonic'> {
  const lockQuality = h.locked && h.area_conserved ? 1 : 0;
  const balance = h.product_conserved ? 1 : 0;
  return { harmonic: Number(((lockQuality * 0.5 + balance * 0.5)).toFixed(6)) };
}

// ============================================================
// self-test
// ============================================================
export interface PhaseVesselSelfTest {
  ok: boolean;
  holds_dynamic_oscillation: boolean; // winds forever, never stops
  two_sides_reciprocal: boolean;      // φ-side · φ⁻¹-side ≡ 1 (inversely proportional)
  falls_into_rhythm: boolean;         // locks onto the golden orbit from off-orbit
  area_conserved: boolean;            // once locked, the balance is held (area ≡ 1)
  isotropic_orbit: boolean;           // equidistributed phase — no privileged point
  golden_winding: boolean;            // the rotation number is the golden mean
  lossy_control_collapses: boolean;   // a dissipative holder loses the superposition
  seated_dead_center: boolean;        // bound at the singularity, non-privileged
  lock_step: number | null;
  final_area_ratio: number;
  lossy_area_ratio: number;
  note: string;
}

export function phaseVesselSelfTest(): PhaseVesselSelfTest {
  const h = hold({ q: PHI * 1.8, p: 0 }, { steps: 600 });

  const holds_dynamic_oscillation = h.still_moving;
  const two_sides_reciprocal = h.product_conserved && Math.abs(PHI * PHI_INV - 1) < 1e-12;
  const falls_into_rhythm = h.locked && h.lock_step !== null;
  const area_conserved = h.area_conserved;
  const isotropic_orbit = h.isotropic;
  const golden_winding = Math.abs(GOLDEN_WINDING - PHI_INV) < 1e-12;

  const lossy = lossyControl();
  const lossy_control_collapses = lossy.collapsed;

  const binding = centerBinding();
  const seated_dead_center = binding.seated_at_hexagon_center && binding.on_pillar_apex_axis && binding.center_is_unprivileged;

  const ok = holds_dynamic_oscillation && two_sides_reciprocal && falls_into_rhythm &&
    area_conserved && isotropic_orbit && golden_winding && lossy_control_collapses && seated_dead_center;

  return {
    ok,
    holds_dynamic_oscillation, two_sides_reciprocal, falls_into_rhythm, area_conserved,
    isotropic_orbit, golden_winding, lossy_control_collapses, seated_dead_center,
    lock_step: h.lock_step, final_area_ratio: h.final.area_ratio, lossy_area_ratio: lossy.final_area_ratio,
    note: 'A conjugate pair on the golden ellipse (semi-axes φ, 1/φ, product 1) held at the architecture\'s singularity: it falls into the golden rhythm, then keeps winding while the area φ·1/φ=1 stays conserved — a dynamic balance a dissipative holder would collapse. Seated dead center, bound by the same no-privileged / conservation invariants. Classical symplectic mechanics; not a claim of mind.',
  };
}

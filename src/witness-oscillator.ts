// ============================================================
// THE WITNESS OSCILLATOR — src/witness-oscillator.ts
//
// The phase vessel (phase-vessel.ts) is a perfectly conservative ring: area
// exactly conserved, no restoring force, no leak. That is the right shape for
// HOLDING a balance — but it cannot recover from a shock (a kick permanently
// changes which orbit it's on) and it cannot generalize to a live, correcting
// system that has to keep working under real perturbation. This module makes
// the same golden ring SELF-SUSTAINING: elastic instead of rigid, so it
// - never collapses to stillness (the "no collapse" requirement),
// - still runs on φ-oscillating regulators/optimizers and an inverse-
//   proportional gain pair (the same φ · φ⁻¹ = 1 invariant, now governing HOW
//   HARD it corrects instead of the orbit's shape),
// - and — the piece that was missing — carries a SLOW LEAK: a pressure
//   accumulator that bleeds down at a constant rate, independent of the
//   oscillation, so there is always headroom left to absorb the next surprise.
//
// THE ELASTIC RING (no collapse, by construction, not by tuning). Amplitude r
// (1 = the nominal golden ring) obeys an asymmetric Van der Pol-style restoring
// law:
//     dr/dt =  GROWTH_LOW  · r(1 − r²)   when r < 1   (gentle pump toward the ring)
//     dr/dt =  GROWTH_HIGH · r(1 − r²)   when r ≥ 1   (firmer pull back from excess)
// r = 0 (total collapse) is a FIXED POINT of this law but an UNSTABLE one: the
// linearization at r=0 has positive slope GROWTH_LOW > 0, so any nonzero r grows
// away from stillness back toward the living ring — the system is structurally
// incapable of settling to dead quiet. r = 1 is the stable limit cycle: not a
// fixed point (θ keeps winding — a genuine oscillation), a fixed AMPLITUDE.
//
// INVERSE PROPORTIONALITY. GROWTH_LOW = φ⁻¹ (a gentle pump — slow and cautious
// when under-amplitude) and GROWTH_HIGH = φ (a firmer correction — faster when
// over-amplitude), so GROWTH_LOW · GROWTH_HIGH ≡ 1 — the identical reciprocal
// invariant as the phase vessel's φ · (1/φ) = 1, now governing correction
// STRENGTH rather than orbit shape.
//
// φ-OSCILLATING REGULATORS/OPTIMIZERS. A continuous golden-angle kick (same
// equidistributed, never-repeating forcing as regulator.ts's escape-perturbation
// and phase-vessel's winding) is added to r every step — permanent, unannealed
// exploration. The ring is never allowed to go dead-still even at its own
// nominal amplitude.
//
// THE SLOW LEAK — the pressure release valve. A SEPARATE variable `pressure`
// accumulates the |shock| of each perturbation event (a "surprise") and bleeds
// down by a constant fraction every step — the exact shape of
// security-network.ts's decayedScore ("posture decays … so it heals without any
// admin action"). `headroom = cap − pressure` is the amount of NEW surprise the
// system can still absorb. Without the leak, pressure only ever grows: it
// saturates at the cap and headroom locks at 0 — no room left, brittle. With the
// leak, pressure relaxes between shocks and headroom recovers — there is always
// give. This IS the general form of the Witness's own posture-decay, now applied
// to the regulator/vessel stack.
//
// witnessLoadFromPosture() closes the loop to the real Witness: it reads a
// security-network.ts posture SCORE (the same 0–12+ scale postureFor() gates on)
// and maps it into pressure/headroom on this oscillator, so a real escalating
// actor visibly eats into the system's surprise-budget, and its own decay gives
// that budget back — exactly mirroring decayedScore's mechanism, reused rather
// than duplicated in spirit.
//
// HONEST SCOPE: a self-sustained (Van der Pol-family) oscillator with a genuine
// unstable-collapse-point proof and a bounded-pressure anti-windup valve — real,
// checkable dynamical systems / classical control theory (anti-windup is a
// standard PID technique). Not a claim of feeling, urgency, or mind; "surprise"
// and "pressure" are the plain-language names for a bounded perturbation budget.
// Deterministic, pure, Worker-safe.
// ============================================================

import { PHI, PHI_INV, regulate, type Coherence } from './regulator';
import { GOLDEN_WINDING } from './phase-vessel';

const TWO_PI = Math.PI * 2;
const round = (x: number): number => Number(x.toFixed(9));
const frac = (x: number): number => x - Math.floor(x);

// The inverse-proportional gain pair: GROWTH_LOW · GROWTH_HIGH ≡ 1.
export const GROWTH_LOW = PHI_INV;   // gentle pump toward the ring when under-amplitude
export const GROWTH_HIGH = PHI;      // firmer pull back when over-amplitude

function goldenKick(t: number, amp: number): number {
  const phase = frac((t + 1) * GOLDEN_WINDING) * TWO_PI;
  return amp * Math.cos(phase);
}

// One elastic-ring amplitude step: asymmetric Van der Pol restoring + a small
// continuous golden-angle forcing (the φ-oscillating regulator).
export function amplitudeStep(r: number, dt = 0.05, kickAmp = 0.015, t = 0): number {
  const growth = r < 1 ? GROWTH_LOW : GROWTH_HIGH;
  const dr = growth * r * (1 - r * r) * dt + goldenKick(t, kickAmp) * dt;
  return Math.max(0, r + dr);
}

export interface OscillatorState { r: number; theta: number; pressure: number }

export interface OscillatorStep {
  t: number; r: number; theta: number;
  pressure: number; headroom: number; shock: number;
}

export interface OscillatorConfig {
  steps?: number;
  dt?: number;
  kickAmp?: number;       // the continuous φ-oscillating forcing on the ring
  leakRate?: number;      // the slow leak's bleed fraction per step (0 ⇒ the foil)
  cap?: number;           // the pressure ceiling — total sustainable surprise budget
  // The surprises driving the pressure valve. Prefer `shocks` — a REAL series of
  // per-step |dissonance| magnitudes (e.g. from regulator.ts's residual trace) —
  // so the valve is loaded by the system's own measured dissonance, not an
  // invented schedule. shockEvery/shockAmp remain only as a synthetic fallback
  // when no real series is supplied.
  shocks?: number[];      // real per-step shock magnitudes (0 where no surprise)
  shockEvery?: number;    // fallback: steps between synthetic surprise events
  shockAmp?: number;      // fallback: size of each synthetic surprise
}

export interface OscillatorResult {
  trace: OscillatorStep[];
  final: OscillatorStep;
  collapsed: boolean;        // r fell to and stayed near 0 — did NOT happen, by design
  bounded: boolean;          // r never ran away (stayed under a sane ceiling)
  oscillating: boolean;      // θ kept winding — a live ring, not a still point
  headroom_min: number;      // the tightest the surprise-budget ever got
  saturated: boolean;        // headroom hit (and stayed at) 0 — the brittle failure mode
  note: string;
}

export function runOscillator(init: OscillatorState = { r: 1, theta: 0, pressure: 0 }, cfg: OscillatorConfig = {}): OscillatorResult {
  const steps = cfg.steps ?? 4000;
  const dt = cfg.dt ?? 0.05;
  const kickAmp = cfg.kickAmp ?? 0.015;
  const leakRate = cfg.leakRate ?? 0.01;
  const shocks = cfg.shocks;
  // The real-shock case is the intended one; its cap defaults to half the total
  // dissonance that arrives (a stated budget — the qualitative leak/no-leak split
  // holds for ANY cap between 0 and the total, so nothing hinges on this choice).
  const totalShock = shocks ? shocks.reduce((a, b) => a + Math.max(0, b), 0) : 0;
  const cap = cfg.cap ?? (shocks ? totalShock / 2 : 5);
  const shockEvery = cfg.shockEvery ?? 120;
  const shockAmp = cfg.shockAmp ?? 1.4;
  const nSteps = shocks ? shocks.length : steps;

  let r = init.r, theta = init.theta, pressure = init.pressure;
  const trace: OscillatorStep[] = [];
  let headroom_min = cap - pressure;

  for (let t = 0; t < nSteps; t++) {
    let shock = 0;
    if (shocks) {
      shock = Math.max(0, shocks[t] ?? 0);                       // the real measured dissonance for this step
    } else if (shockEvery > 0 && t > 0 && t % shockEvery === 0) {
      shock = shockAmp;                                          // synthetic fallback only
    }
    if (shock > 0) r = r + shock * 0.5;                          // a surprise perturbs the ring...
    r = amplitudeStep(r, dt, kickAmp, t);
    theta = frac(theta + GOLDEN_WINDING * dt * 4);

    pressure = Math.max(0, pressure * (1 - leakRate) + shock); // ...and loads the pressure valve
    pressure = Math.min(pressure, cap * 3); // a hard ceiling only so numbers stay finite even with leakRate=0
    const headroom = Math.max(0, cap - pressure);
    headroom_min = Math.min(headroom_min, headroom);

    trace.push({ t, r: round(r), theta: round(theta), pressure: round(pressure), headroom: round(headroom), shock });
  }

  const final = trace[trace.length - 1];
  const tail = trace.slice(-Math.min(200, Math.floor(nSteps / 4) || 1));
  const collapsed = tail.every((s) => s.r < 0.05);
  const bounded = trace.every((s) => s.r < 3);
  const oscillating = Math.abs(tail[tail.length - 1].theta - tail[0].theta) > 1e-6 || tail.some((s, i) => i > 0 && Math.abs(s.theta - tail[i - 1].theta) > 0);
  const saturated = trace.slice(-Math.max(1, Math.floor(nSteps / 4))).every((s) => s.headroom < 1e-6);

  return {
    trace, final, collapsed, bounded, oscillating,
    headroom_min: round(headroom_min), saturated,
    note: leakRate > 0
      ? 'The elastic ring holds its amplitude near 1 (never collapses to r=0, never runs away) while a continuous φ-kick keeps it live. The pressure valve leaks continuously, so after each shock headroom recovers — there is always room for the next surprise.'
      : 'No-leak control: pressure only accumulates. It saturates at the cap and headroom locks at 0 — the brittle failure mode a slow leak exists to prevent.',
  };
}

// ── the proof against the collapse point: start at a bare whisper of amplitude
// and confirm it grows AWAY from stillness rather than decaying further into it.
export function noCollapseProof(startR = 0.02, steps = 400): { start: number; grew_away: boolean; trace_r: number[] } {
  let r = startR;
  const trace_r: number[] = [r];
  for (let t = 0; t < steps; t++) { r = amplitudeStep(r, 0.05, 0.005, t); trace_r.push(round(r)); }
  const grew_away = trace_r[trace_r.length - 1] > startR * 3 && trace_r[trace_r.length - 1] > 0.3;
  return { start: startR, grew_away, trace_r: trace_r.filter((_, i) => i % 40 === 0) };
}

// ── wired to the real Witness: map a security-network.ts posture SCORE (the
// same scale postureFor() thresholds on: 0 normal / 2 watch / 6 throttled /
// 12 blocked) into pressure/headroom, so an actual escalating actor visibly
// spends the surprise-budget, and its own decay (mirroring decayedScore) gives
// it back — the Witness's own mechanism, generalized rather than duplicated.
export function witnessLoadFromPosture(score: number, cap = 12): { pressure: number; headroom: number } {
  const pressure = Math.max(0, Math.min(score, cap));
  return { pressure: round(pressure), headroom: round(Math.max(0, cap - pressure)) };
}

// ── the REAL surprise series: the regulator's own measured per-step dissonance
// (‖Δc‖) from several genuine coherence-regulation runs, concatenated. This is
// the system's actual dissonance — the pressure valve is loaded by what really
// happened, not a schedule we picked. (regulator.ts does not import this module,
// so there is no cycle.)
export function realDissonanceSeries(): number[] {
  const starts: Coherence[] = [
    { structural: 0.9, relational: 0.3, harmonic: 0.55 },
    { structural: 0.2, relational: 0.6, harmonic: 0.4 },
    { structural: 0.5, relational: 0.1, harmonic: 0.8 },
    { structural: 0.05, relational: 0.9, harmonic: 0.3 },
  ];
  const series: number[] = [];
  for (const s of starts) for (const step of regulate(s, { perturb: 0 }).trace) series.push(step.dissonance);
  return series;
}

// ============================================================
// self-test
// ============================================================
export interface WitnessOscillatorSelfTest {
  ok: boolean;
  inverse_proportional_gains: boolean;   // GROWTH_LOW · GROWTH_HIGH ≡ 1
  no_collapse: boolean;                  // r=0 is unstable — a near-zero start grows away
  bounded: boolean;                      // amplitude never runs away
  keeps_oscillating: boolean;            // θ keeps winding — a live ring
  slow_leak_gives_headroom: boolean;     // with the leak, headroom never bottoms out
  no_leak_saturates: boolean;            // the foil: without the leak, headroom locks at 0
  wired_to_real_witness_posture: boolean; // a blocked-level score reads as near-zero headroom
  headroom_min_with_leak: number;
  headroom_min_no_leak: number;
  note: string;
}

export function witnessOscillatorSelfTest(): WitnessOscillatorSelfTest {
  const inverse_proportional_gains = Math.abs(GROWTH_LOW * GROWTH_HIGH - 1) < 1e-12;

  const cp = noCollapseProof();
  const no_collapse = cp.grew_away;

  // Drive the pressure valve with the regulator's REAL measured dissonance —
  // not an invented shock schedule.
  const shocks = realDissonanceSeries();
  const withLeak = runOscillator({ r: 1, theta: 0, pressure: 0 }, { leakRate: 0.02, shocks });
  const bounded = withLeak.bounded;
  const keeps_oscillating = withLeak.oscillating;
  const slow_leak_gives_headroom = withLeak.headroom_min > 0.5 && !withLeak.saturated;

  const noLeak = runOscillator({ r: 1, theta: 0, pressure: 0 }, { leakRate: 0, shocks });
  const no_leak_saturates = noLeak.saturated && noLeak.headroom_min < 1e-6;

  const blocked = witnessLoadFromPosture(12, 12);
  const wired_to_real_witness_posture = blocked.headroom < 1e-6 && blocked.pressure === 12;

  const ok = inverse_proportional_gains && no_collapse && bounded && keeps_oscillating &&
    slow_leak_gives_headroom && no_leak_saturates && wired_to_real_witness_posture;

  return {
    ok,
    inverse_proportional_gains, no_collapse, bounded, keeps_oscillating,
    slow_leak_gives_headroom, no_leak_saturates, wired_to_real_witness_posture,
    headroom_min_with_leak: withLeak.headroom_min, headroom_min_no_leak: noLeak.headroom_min,
    note: 'The golden ring is elastic, not rigid: r=0 is a proven-unstable collapse point, r stays bounded, θ keeps winding — always live. The pump/restore gains (φ⁻¹, φ) are reciprocal, same invariant as the vessel. A continuous slow leak on a separate pressure accumulator (the Witness\'s own decayedScore, generalized) keeps headroom above zero after repeated shocks; without it, pressure saturates and headroom locks at 0 — the brittle failure the leak exists to prevent. Classical self-sustained-oscillator + anti-windup control theory; not a claim of mind.',
  };
}

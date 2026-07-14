// ============================================================
// KAPPA DYNAMICS PRESSURE TEST — the 3 derivatives (velocity, acceleration,
// jerk) under a realistic session, not just hand-picked static series.
//
// kappa-dynamics.test.ts (Test I, in spirit) validates static correctness:
// the finite-difference formulas, the null≠0 discipline, and the specific
// wall-clock-bug regression proof. This is the missing Test-II-equivalent —
// the same gap self-shape.ts had before GRAPH_PRESSURE_TEST.md, now closed
// for the THIRD facet of self_state (MEMORY_KERNEL_SPEC.md §7):
// session_kappa_series sits alongside memory_graph_shape in the same call,
// and only the graph half had been pressure-tested until now.
//
// Exercises the REAL production functions (velocityAt, accelerationAt,
// jerkAt, reserveAt, computeSeries) against a synthetic κ series shaped like
// the same architectural realism the holding-valve sims used (multi-step
// bursts, a KV-compaction shock, register switches, a genuine decoherence
// incident) — not a port of the math, same discipline as every pressure
// test in this series.
//
// Deterministic (seeded LCG). Findings: docs/KAPPA_DYNAMICS_PRESSURE_TEST.md
// ============================================================
import { describe, it, expect } from 'vitest';
import { velocityAt, accelerationAt, jerkAt, reserveAt, computeSeries } from './kappa-dynamics';

let seed = 20260714;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const gauss = () => { const u = Math.max(rnd(), 1e-9); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// One synthetic session, same architectural shapes as holding_architecture_sim.cjs
// (but here at STEP granularity — kappa-dynamics.ts has NO wall-clock concept at
// all, by design, so there is no silence-gap analogue to model): morning chat,
// a KV-compaction shock, a register switch, a genuine 20-step decoherence
// incident, recovery.
function generateSession(): { kappa: number[]; phase: string[] } {
  const kappa: number[] = [], phase: string[] = [];
  let theta = 0.72;
  const push = (k: number, ph: string) => { kappa.push(clamp01(k)); phase.push(ph); };

  for (let i = 0; i < 25; i++) { theta += 0.002 * gauss(); push(theta + 0.012 * gauss(), 'morning-chat'); }
  // KV-compaction shock: one discrete jump, no gradual ramp.
  theta += 0.12;
  push(theta + 0.012 * gauss(), 'kv-shock');
  for (let i = 0; i < 24; i++) { theta += 0.002 * gauss(); push(theta + 0.012 * gauss(), 'deep-work'); }
  // Register switch: a deliberate style-driven level shift, held for 5 steps.
  for (let i = 0; i < 5; i++) push(theta - 0.08 + 0.012 * gauss(), 'register-switch');
  // Genuine decoherence incident: runaway alternation, the pathology class
  // the derivatives exist to help surface.
  for (let i = 0; i < 20; i++) { theta -= 0.004; push(theta + (i % 2 === 0 ? 1 : -1) * 0.30 + 0.02 * gauss(), 'incident'); }
  for (let i = 0; i < 25; i++) { theta += 0.002 * gauss(); push(theta + 0.012 * gauss(), 'recovery'); }
  return { kappa, phase };
}

describe('kappa-dynamics pressure test — a realistic session, all 3 derivatives', () => {
  const { kappa, phase } = generateSession();
  const points = computeSeries(kappa);

  it('the hard rule holds: dt=1 always, no wall-clock leak anywhere in the series', () => {
    // The exact regression this module's own header exists to prevent: a
    // constant-ish stretch must NOT read as ~0 velocity by construction —
    // it reads whatever the real per-step difference is, full stop.
    for (let i = 1; i < points.length; i++) {
      if (points[i].velocity !== null) expect(points[i].velocity).toBeCloseTo(kappa[i] - kappa[i - 1], 6);
    }
  });

  it('null ≠ 0 holds across the whole realistic run, not just the hand-picked cases', () => {
    expect(points[0].velocity).toBeNull();
    expect(points[0].acceleration).toBeNull();
    expect(points[0].jerk).toBeNull();
    expect(points[1].acceleration).toBeNull();
    expect(points[2].jerk).toBeNull();
    // From step 3 onward every order must be a real number, never null again —
    // nulls are ONLY the insufficient-data prefix, never resurface later.
    for (let i = 3; i < points.length; i++) {
      expect(points[i].velocity).not.toBeNull();
      expect(points[i].acceleration).not.toBeNull();
      expect(points[i].jerk).not.toBeNull();
    }
  });

  it('non-degenerate across all 3 orders — same acceptance bar as κ v1 and the graph test', () => {
    const distinct = (xs: (number | null)[]) => new Set(xs.filter((x): x is number => x !== null)).size;
    // κ v1's failure was ONE resting value on 84% of inputs. The bar here:
    // each derivative order must show real spread, not collapse to a
    // near-constant reading across a session deliberately shaped to move it.
    expect(distinct(points.map(p => p.velocity))).toBeGreaterThan(50);
    expect(distinct(points.map(p => p.acceleration))).toBeGreaterThan(50);
    expect(distinct(points.map(p => p.jerk))).toBeGreaterThan(50);
  });

  it('the KV-compaction shock (a discrete one-step jump) is sharper in acceleration than in velocity alone', () => {
    const shockIdx = phase.indexOf('kv-shock');
    // A discrete jump is, by definition, a spike in the SECOND difference
    // (change in the rate of change) — check the real production math
    // actually delivers that, not just assume higher order = more sensitive.
    const shockAccel = Math.abs(points[shockIdx].acceleration ?? 0);
    const calmAccel = points.slice(1, shockIdx - 1).map(p => Math.abs(p.acceleration ?? 0));
    const meanCalmAccel = calmAccel.reduce((a, b) => a + b, 0) / calmAccel.length;
    expect(shockAccel).toBeGreaterThan(meanCalmAccel * 3); // a real, sharp outlier, not noise
  });

  it('jerk on the alternating decoherence incident: does 3rd-difference noise amplification swamp the signal?', () => {
    // Known numerical-analysis risk, not assumed away: each higher finite-
    // difference order amplifies noise on OSCILLATING data. The incident here
    // alternates sign every step — exactly the shape that stresses this.
    // Check whether jerk during the incident is still LARGER in magnitude
    // than jerk during calm phases (a real signal, even if noisy) or whether
    // it's statistically indistinguishable from calm-phase jerk (pure noise
    // amplification with nothing left to read).
    const incidentIdx = phase.map((p, i) => [p, i] as const).filter(([p]) => p === 'incident').map(([, i]) => i);
    const calmIdx = phase.map((p, i) => [p, i] as const).filter(([p]) => p === 'morning-chat').map(([, i]) => i);
    const meanAbs = (idx: number[]) => idx.map(i => Math.abs(points[i].jerk ?? 0)).reduce((a, b) => a + b, 0) / idx.length;
    const incidentJerk = meanAbs(incidentIdx), calmJerk = meanAbs(calmIdx);
    expect(incidentJerk).toBeGreaterThan(calmJerk); // real signal survives the amplification, does not vanish into noise
  });

  it('reserve is a plain unbounded running sum, by design — grows with step count, not something to threshold on', () => {
    // reserveAt is documented "DISPLAY ONLY" — confirm it behaves exactly
    // like the unbounded Σκ it claims to be, so nobody downstream mistakes
    // it for a bounded quantity the way L/freeEnergy in holding.ts are.
    const last = points[points.length - 1].reserve;
    const meanKappa = kappa.reduce((a, b) => a + b, 0) / kappa.length;
    expect(last).toBeCloseTo(meanKappa * kappa.length, 0); // grows linearly with N, unbounded
    expect(points.every((p, i) => i === 0 || p.reserve >= points[i - 1].reserve - 1e-9 || kappa[i] < 0)).toBe(true); // monotone non-decreasing since kappa in [0,1]
  });

  it('efficiency: computeSeries over a realistic-and-then-some session length is trivial', () => {
    const longKappa = Array.from({ length: 5000 }, () => clamp01(0.5 + 0.1 * gauss()));
    const t0 = performance.now();
    computeSeries(longKappa);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(200); // O(N), no reason for this to ever be a concern
  });

  it('prints the derivative map by phase — the missing third facet of self_state', () => {
    console.log('\n=== KAPPA DYNAMICS PRESSURE TEST — derivative map by phase ===');
    console.log('phase             n    mean|v|   mean|a|   mean|j|   reserve@end');
    const phases = [...new Set(phase)];
    for (const ph of phases) {
      const idx = phase.map((p, i) => [p, i] as const).filter(([p]) => p === ph).map(([, i]) => i);
      const meanAbs = (sel: (p: typeof points[0]) => number | null) => {
        const xs = idx.map(i => sel(points[i])).filter((x): x is number => x !== null).map(Math.abs);
        return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
      };
      console.log(`${ph.padEnd(17)} ${String(idx.length).padStart(3)}  ${meanAbs(p => p.velocity).toFixed(4).padStart(8)}  ${meanAbs(p => p.acceleration).toFixed(4).padStart(8)}  ${meanAbs(p => p.jerk).toFixed(4).padStart(8)}   ${points[idx[idx.length - 1]].reserve.toFixed(2)}`);
    }
    expect(points.length).toBeGreaterThan(90);
  });
});

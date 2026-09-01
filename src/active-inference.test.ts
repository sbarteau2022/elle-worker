// ============================================================
// THE POLICY COMPASS UNDER SIEGE — src/active-inference.test.ts
//
// Gate B4 (COGNITIVE_MAPPING_IMPLEMENTATION_PLAN.md): whenever the
// observation ambiguity ℋ(q(o|s)) exceeds 0.40, the policy posterior must
// put >65% of its mass on the epistemic tools {diagnose, search_corpus,
// pfar, vfar} — for EVERY fixture, 100%, no averaging. The suite sweeps
// the whole gated region (uniform-triad grid + seeded random triads)
// rather than trusting the analytic γ bound in the module header.
//
// Also under test: the information-theory primitives (bits), the G(π)
// decomposition, the low-ambiguity regime (pragmatic tools must dominate
// when the state is resolved — a compass that always says "explore" is
// broken too), the D1 log write, and the cognitive-map snapshot.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  AMBIGUITY_THRESHOLD, EPISTEMIC_MASS_FLOOR, POLICY_PRECISION_GAMMA,
  PREFERRED_PROGRESS, EPISTEMIC_TOOLS, DEFAULT_POLICIES,
  binaryEntropy, bernoulliKL, observationAmbiguity, evaluatePolicy,
  policyPosterior, evaluateActiveInference, logActiveInference,
  toDisk, cognitiveMapSnapshot,
  type ActiveInferenceState,
} from './active-inference';
import { freeEnergy, type Coherence } from './regulator';
import type { AtlasStoreEnv } from './atlas-store';

// ── helpers ───────────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const triad = (s: number, r: number, h: number): Coherence => ({ structural: s, relational: r, harmonic: h });

const EPISTEMIC = new Set<string>(EPISTEMIC_TOOLS);
const pragmaticMass = (st: ActiveInferenceState): number =>
  Object.entries(st.expected_free_energy_G)
    .filter(([name]) => !EPISTEMIC.has(name))
    .reduce((s, [, e]) => s + e.selection_probability, 0);

// Fake D1 covering exactly what this module touches: the
// elle_active_inference_log INSERT (applied on .run()) and the
// elle_memory_atlas readback SELECT. DDL from ensureAllSchemas is a no-op.
interface LogRow {
  turn_id: string; user_id: string;
  structural: number; relational: number; harmonic: number;
  F: number; U: number; S: number;
  selected_tool_policy: string; expected_free_energy_G: number; created_at: number;
}
interface FakeAtlasRow {
  id: string; user_id: string;
  hyperbolic_coords: ArrayBuffer; radial_depth: number;
  torus_phases: ArrayBuffer; winding_vector: string;
  delta_hyperbolicity: number; cycle_rank_b1: number;
  created_at: number; updated_at: number;
}

function fakeEnv(atlasRows: FakeAtlasRow[] = []) {
  const log = new Map<string, LogRow>();
  const mkStmt = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => mkStmt(sql, a),
    async run() {
      if (sql.includes('elle_active_inference_log')) {
        log.set(String(args[0]), {
          turn_id: String(args[0]), user_id: String(args[1]),
          structural: Number(args[2]), relational: Number(args[3]), harmonic: Number(args[4]),
          F: Number(args[5]), U: Number(args[6]), S: Number(args[7]),
          selected_tool_policy: String(args[8]),
          expected_free_energy_G: Number(args[9]), created_at: Number(args[10]),
        });
      }
      return { success: true };
    },
    async all() {
      // readAtlasPoints: WHERE user_id = ?1 ORDER BY radial_depth ASC LIMIT ?2
      const userId = String(args[0]);
      const limit = Number(args[1]) || 100;
      const results = atlasRows
        .filter((r) => r.user_id === userId)
        .sort((a, b) => a.radial_depth - b.radial_depth)
        .slice(0, limit);
      return { results };
    },
    async first() { return null; },
    _sql: sql, _args: args,
  });
  const db = {
    prepare: (sql: string) => mkStmt(sql),
    async batch(stmts: Array<ReturnType<typeof mkStmt>>) { return stmts.map(() => ({ success: true })); },
  } as unknown as D1Database;
  return { env: { DB: db } as AtlasStoreEnv, log };
}

function f64Blob(v: number[]): ArrayBuffer {
  const buf = new ArrayBuffer(v.length * 8);
  const dv = new DataView(buf);
  v.forEach((x, i) => dv.setFloat64(i * 8, x, true));
  return buf;
}

function mkAtlasRow(id: string, userId: string, ball: number[], depthValue: number): FakeAtlasRow {
  return {
    id, user_id: userId,
    hyperbolic_coords: f64Blob(ball), radial_depth: depthValue,
    torus_phases: f64Blob([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]),
    winding_vector: JSON.stringify([1, 0, -1, 0, 2, 0, 0, -1]),
    delta_hyperbolicity: 0.4, cycle_rank_b1: 2,
    created_at: 1000, updated_at: 2000,
  };
}

// ── information-theory primitives ─────────────────────────────────────────

describe('primitives (bits)', () => {
  it('binaryEntropy: 0 at the endpoints, 1 at 1/2, symmetric', () => {
    expect(binaryEntropy(0)).toBe(0);
    expect(binaryEntropy(1)).toBe(0);
    expect(binaryEntropy(0.5)).toBeCloseTo(1, 12);
    // Integer counter: `p += 0.05` accumulates float error and lets p reach
    // ~0.4999999999 < 0.5, where H rounds to 1 and breaks the comparison.
    for (let i = 1; i <= 9; i++) {
      const p = i * 0.05;
      expect(binaryEntropy(p)).toBeCloseTo(binaryEntropy(1 - p), 12);
      expect(binaryEntropy(p)).toBeLessThan(binaryEntropy(p + 0.04));
    }
  });

  it('bernoulliKL: zero iff equal, non-negative, finite against a hard prior', () => {
    let checked = 0;
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const pc = Math.min(1, p);
      // 8dp, not 9: the module clamps q to [1e-9, 1−1e-9], which leaves a
      // residual of ≈1.44e-9 bits at p = 1 by design.
      expect(bernoulliKL(pc, pc)).toBeCloseTo(0, 8);
      for (let q = 0.05; q < 1; q += 0.05) {
        const kl = bernoulliKL(pc, q);
        expect(kl).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(kl)).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(300);
    // Clamped prior: p(o) at exactly 0/1 must not produce Infinity.
    expect(Number.isFinite(bernoulliKL(0.5, 0))).toBe(true);
    expect(Number.isFinite(bernoulliKL(0.5, 1))).toBe(true);
    expect(bernoulliKL(0.25, 0.95)).toBeGreaterThan(0);
  });

  it('policyPosterior: sums to 1, monotone in −G, stable under extreme G', () => {
    const sigma = policyPosterior([0.1, 0.5, 1.0, 2.0]);
    expect(sigma.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 4);
    for (let i = 1; i < sigma.length; i++) expect(sigma[i]).toBeLessThan(sigma[i - 1]);
    expect(policyPosterior([])).toEqual([]);
    const extreme = policyPosterior([1000, 1000.1, 5000]);
    expect(extreme.every(Number.isFinite)).toBe(true);
    expect(extreme.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 4);
    // Equal G → uniform.
    const flat = policyPosterior([3, 3, 3, 3]);
    flat.forEach((x) => expect(x).toBeCloseTo(0.25, 5));
  });
});

// ── observation ambiguity ─────────────────────────────────────────────────

describe('observationAmbiguity ℋ(q(o|s))', () => {
  it('peaks at 1 for the all-0.5 triad, vanishes at both poles', () => {
    expect(observationAmbiguity(triad(0.5, 0.5, 0.5))).toBeCloseTo(1, 5);
    expect(observationAmbiguity(triad(0, 0, 0))).toBe(0);
    expect(observationAmbiguity(triad(1, 1, 1))).toBe(0);
    expect(observationAmbiguity(triad(0.99, 0.98, 0.995))).toBeLessThan(0.2);
  });

  it('uniform triad c ⇒ ℋ = H_b(c) (φ-weights are normalized)', () => {
    for (let c = 0.05; c < 1; c += 0.05) {
      expect(observationAmbiguity(triad(c, c, c))).toBeCloseTo(binaryEntropy(c), 5);
    }
  });

  it('clamps out-of-range channels instead of going NaN', () => {
    const h = observationAmbiguity(triad(-0.2, 1.3, 0.5));
    expect(Number.isFinite(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(1);
  });
});

// ── G(π) decomposition ────────────────────────────────────────────────────

describe('evaluatePolicy G(π) = risk + ambiguity', () => {
  it('decomposition holds and both terms are non-negative across the ℋ range', () => {
    let checked = 0;
    for (const policy of DEFAULT_POLICIES) {
      for (let H = 0; H <= 1.0001; H += 0.05) {
        const e = evaluatePolicy(Math.min(1, H), policy);
        expect(e.pragmatic_risk).toBeGreaterThanOrEqual(0);
        expect(e.epistemic_ambiguity).toBeGreaterThanOrEqual(0);
        expect(e.total_G).toBeCloseTo(e.pragmatic_risk + e.epistemic_ambiguity, 4);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(150);
  });

  it('resolved state (ℋ=0): pragmatic tools beat epistemic; ambiguous state (ℋ=1): reversed', () => {
    const epi = DEFAULT_POLICIES.find((p) => p.kind === 'epistemic')!;
    const prag = DEFAULT_POLICIES.find((p) => p.kind === 'pragmatic')!;
    expect(evaluatePolicy(0, prag).total_G).toBeLessThan(evaluatePolicy(0, epi).total_G);
    expect(evaluatePolicy(1, epi).total_G).toBeLessThan(evaluatePolicy(1, prag).total_G);
    // At ℋ=0 the risk term is the exact Bernoulli KL of g against the prior.
    expect(evaluatePolicy(0, prag).pragmatic_risk)
      .toBeCloseTo(bernoulliKL(prag.resolved_competence, PREFERRED_PROGRESS), 5);
  });
});

// ── evaluateActiveInference: shape + selection ────────────────────────────

describe('evaluateActiveInference', () => {
  it('reuses the regulator free energy verbatim and selects the argmax policy', () => {
    const c = triad(0.62, 0.55, 0.48);
    const st = evaluateActiveInference({ coherence: c });
    const fe = freeEnergy(c, 0.5);
    expect(st.free_energy.F).toBe(fe.F);
    expect(st.free_energy.internal_energy_U).toBe(fe.U);
    expect(st.free_energy.entropy_S).toBe(fe.S);
    expect(st.free_energy.anisotropy_A).toBe(fe.A);
    const entries = Object.entries(st.expected_free_energy_G);
    expect(entries.length).toBe(DEFAULT_POLICIES.length);
    const bestByMass = entries.reduce((a, b) => (b[1].selection_probability > a[1].selection_probability ? b : a));
    expect(st.selected_policy).toBe(bestByMass[0]);
    const total = entries.reduce((s, [, e]) => s + e.selection_probability, 0);
    expect(total).toBeCloseTo(1, 4);
    expect(st.epistemic_mass + pragmaticMass(st)).toBeCloseTo(1, 4);
  });

  it('γ and roster are overridable without touching the defaults', () => {
    const st = evaluateActiveInference({
      coherence: triad(0.5, 0.5, 0.5),
      gamma: 0, // precision zero → uniform posterior regardless of G
    });
    Object.values(st.expected_free_energy_G).forEach((e) =>
      expect(e.selection_probability).toBeCloseTo(1 / DEFAULT_POLICIES.length, 4));
    expect(POLICY_PRECISION_GAMMA).toBe(4);
  });
});

// ── GATE B4: the fixture suite ────────────────────────────────────────────

describe('GATE B4 — ℋ > 0.40 ⇒ epistemic mass > 0.65, 100% of fixtures', () => {
  it('uniform-triad sweep across the entire gated region', () => {
    // H_b(c) = 0.4 at c ≈ 0.0861 and c ≈ 0.9139; sweeping c ∈ (0.09, 0.91)
    // covers every uniform triad the trigger can fire on.
    let gated = 0;
    let passed = 0;
    let ungated = 0;
    for (let c = 0.005; c < 1; c += 0.005) {
      const st = evaluateActiveInference({ coherence: triad(c, c, c) });
      if (st.observation_ambiguity_H > AMBIGUITY_THRESHOLD) {
        gated++;
        expect(st.epistemic_trigger).toBe(true);
        if (st.epistemic_mass > EPISTEMIC_MASS_FLOOR) passed++;
      } else {
        ungated++;
        expect(st.epistemic_trigger).toBe(false);
      }
    }
    expect(gated).toBeGreaterThan(120); // the sweep genuinely covers the region
    expect(ungated).toBeGreaterThan(20); // and its complement
    expect(passed).toBe(gated); // 100% — the gate, not an average
  }, 30000);

  it('500 seeded random triads: every ℋ > 0.40 fixture clears the floor', () => {
    const rng = mulberry32(0xB4B4B4);
    let gated = 0;
    let passed = 0;
    for (let i = 0; i < 500; i++) {
      const st = evaluateActiveInference({ coherence: triad(rng(), rng(), rng()) });
      if (st.observation_ambiguity_H > AMBIGUITY_THRESHOLD) {
        gated++;
        if (st.epistemic_mass > EPISTEMIC_MASS_FLOOR) passed++;
        // The winner above the trigger is one of the four epistemic tools.
        if (!EPISTEMIC.has(st.selected_policy)) passed -= 1;
      }
    }
    expect(gated).toBeGreaterThan(150);
    expect(passed).toBe(gated);
  }, 30000);

  it('epistemic mass rises with ℋ: floor-clearance at the worst gated point, near-total at ℋ→1', () => {
    // Uniform triads pinned just above / far above the threshold.
    const just = evaluateActiveInference({ coherence: triad(0.0875, 0.0875, 0.0875) });
    expect(just.observation_ambiguity_H).toBeGreaterThan(AMBIGUITY_THRESHOLD);
    expect(just.observation_ambiguity_H).toBeLessThan(0.43);
    expect(just.epistemic_mass).toBeGreaterThan(EPISTEMIC_MASS_FLOOR);
    const mid = evaluateActiveInference({ coherence: triad(0.3, 0.3, 0.3) });
    const peak = evaluateActiveInference({ coherence: triad(0.5, 0.5, 0.5) });
    expect(mid.epistemic_mass).toBeGreaterThan(just.epistemic_mass);
    expect(peak.epistemic_mass).toBeGreaterThan(mid.epistemic_mass);
    expect(peak.epistemic_mass).toBeGreaterThan(0.95);
  });

  it('low ambiguity: pragmatic tools dominate (the compass must also say "act")', () => {
    // ℋ ≈ 0.19 here — below the trigger but not near zero, so the pragmatic
    // mass clears the symmetric 0.65 floor (measured ≈ 0.83), not 0.9+.
    const st = evaluateActiveInference({ coherence: triad(0.97, 0.96, 0.98) });
    expect(st.observation_ambiguity_H).toBeLessThan(AMBIGUITY_THRESHOLD);
    expect(st.epistemic_trigger).toBe(false);
    expect(pragmaticMass(st)).toBeGreaterThan(EPISTEMIC_MASS_FLOOR);
    expect(EPISTEMIC.has(st.selected_policy)).toBe(false);
    // Near-resolved state (ℋ ≈ 0.045): pragmatic mass approaches its
    // asymptote — the compass says "act" almost unconditionally.
    const resolved = evaluateActiveInference({ coherence: triad(0.995, 0.996, 0.994) });
    expect(resolved.observation_ambiguity_H).toBeLessThan(0.1);
    expect(pragmaticMass(resolved)).toBeGreaterThan(0.9);
    expect(EPISTEMIC.has(resolved.selected_policy)).toBe(false);
  });
});

// ── D1 log ────────────────────────────────────────────────────────────────

describe('logActiveInference', () => {
  it('writes one elle_active_inference_log row with the selected policy G', async () => {
    const { env, log } = fakeEnv();
    const st = evaluateActiveInference({ coherence: triad(0.5, 0.5, 0.5) });
    await logActiveInference(env, st, 'turn-1', 'user-a', 123456);
    expect(log.size).toBe(1);
    const row = log.get('turn-1')!;
    expect(row.user_id).toBe('user-a');
    expect(row.structural).toBe(st.coherence_triad.structural);
    expect(row.F).toBe(st.free_energy.F);
    expect(row.selected_tool_policy).toBe(st.selected_policy);
    expect(row.expected_free_energy_G)
      .toBe(st.expected_free_energy_G[st.selected_policy].total_G);
    expect(row.created_at).toBe(123456);
  });

  it('INSERT OR REPLACE: rewriting the same turn_id keeps one row', async () => {
    const { env, log } = fakeEnv();
    const st = evaluateActiveInference({ coherence: triad(0.4, 0.6, 0.5) });
    await logActiveInference(env, st, 'turn-x', 'user-a');
    await logActiveInference(env, st, 'turn-x', 'user-a');
    expect(log.size).toBe(1);
  });
});

// ── disk projection + snapshot ────────────────────────────────────────────

describe('toDisk', () => {
  it('preserves the full ball norm, not just the leading pair', () => {
    // 128-dim point whose mass sits mostly OFF the first two coordinates.
    const ball = new Array(128).fill(0);
    ball[0] = 0.01; ball[1] = 0.02;
    for (let i = 2; i < 128; i++) ball[i] = 0.05;
    const fullNorm = Math.sqrt(ball.reduce((s, x) => s + x * x, 0));
    const [x, y] = toDisk(ball);
    expect(Math.hypot(x, y)).toBeCloseTo(Math.min(fullNorm, 1 - 2e-6), 5);
    expect(Math.hypot(x, y)).toBeLessThan(1);
  });

  it('zero leading pair falls back to the positive x-axis; norms clamp inside the disk', () => {
    const ball = new Array(128).fill(0);
    for (let i = 2; i < 128; i++) ball[i] = 0.03;
    const [x, y] = toDisk(ball);
    expect(y).toBe(0);
    expect(x).toBeGreaterThan(0);
    const big = new Array(4).fill(2); // norm 4 → clamped
    const [bx, by] = toDisk(big);
    expect(Math.hypot(bx, by)).toBeLessThan(1);
    expect(toDisk([])).toEqual([0, 0]);
  });
});

describe('cognitiveMapSnapshot', () => {
  it('reads the atlas depth-ordered, projects to the disk, and carries a descending Lyapunov trace', async () => {
    const shallow = new Array(128).fill(0); shallow[0] = 0.2; shallow[1] = 0.1;
    const deep = new Array(128).fill(0); deep[0] = 0.5; deep[1] = 0.6; deep[2] = 0.4;
    const { env } = fakeEnv([
      mkAtlasRow('deep', 'user-a', deep, 0.9),
      mkAtlasRow('shallow', 'user-a', shallow, 0.2),
      mkAtlasRow('other', 'user-b', shallow, 0.1),
    ]);
    const snap = await cognitiveMapSnapshot(env, 'user-a', triad(0.5, 0.5, 0.5), { steps: 40 });
    expect(snap.atlas.map((p) => p.id)).toEqual(['shallow', 'deep']); // user-b filtered, depth ASC
    for (const p of snap.atlas) {
      expect(Math.hypot(p.disk[0], p.disk[1])).toBeLessThan(1);
      expect(p.winding_vector.length).toBe(8);
    }
    expect(snap.lyapunov.length).toBeGreaterThan(0);
    const first = snap.lyapunov[0].F;
    const last = snap.lyapunov[snap.lyapunov.length - 1].F;
    expect(last).toBeLessThanOrEqual(first + 1e-6); // descent, not divergence
    expect(snap.active_inference.epistemic_trigger).toBe(true); // all-0.5 triad ⇒ ℋ = 1
    expect(snap.active_inference.epistemic_mass).toBeGreaterThan(EPISTEMIC_MASS_FLOOR);
  }, 30000);
});

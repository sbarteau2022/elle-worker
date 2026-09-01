// ── B1 acceptance gate (COGNITIVE_MAPPING_IMPLEMENTATION_PLAN.md §5.4) ─────
//
// N = 10,000 random multimodal sensory reports through the full encoder chain
// ψ(R) = placeFeatures(ripVector(R), dim). Pass criteria, verbatim from the
// plan: 100% boundary containment ‖ψ(R)‖₂ ≤ 1.0 − 1e−5; d_B(ψ(Ra), ψ(Rb)) ≥ 0
// and symmetric; zero NaN/Inf anywhere. Plus the step-3 budget: < 2ms/slice.
//
// The report generator is seeded (mulberry32) so every run sees the same
// 10,000 reports — a red run is reproducible, not a lottery ticket. The mix
// deliberately covers all three ripper shapes (pfar spectra, vfar field
// reports, PAMI indices — the bridge path included) plus adversarial
// magnitude extremes, because B1 is a containment guarantee about ANY
// sensory report, not the well-behaved ones.

import { describe, it, expect } from 'vitest';
import {
  norm, poincareDist, depth,
  mulberry32,
  ripVector, placeFeatures, RIP_DIM,
} from './hyper';
import { PAMI_PHASE_COUNT, PAMI_DIM_COUNT } from './pami-bridge';

const N = 10000;
const SEED = 0xB1BA5E;

// ── deterministic multimodal report generator ─────────────────────────────

type Rand = () => number;

// pfar-shaped: spectral fingerprint of an audio/stream slice
function pfarReport(rand: Rand): unknown {
  const bands: number[] = [];
  for (let i = 0; i < 8; i++) bands.push(rand() * 10 ** (rand() * 6 - 3));
  return {
    spectrum: {
      centroid: rand(),
      flatness: rand(),
      periodicity: rand(),
      rolloff: rand() * 20000,
      bandEnergies: bands,
    },
    rms: rand() * 2 - 1,
    zcr: rand(),
  };
}

// vfar-shaped: visual field report
function vfarReport(rand: Rand): unknown {
  return {
    field: {
      mean: rand() * 255,
      contrast: rand() * 128,
      entropy: rand() * 8,
      edge_density: rand(),
      anisotropy: rand(),
      symmetry: { horizontal: rand(), vertical: rand() },
      balance: { x: rand() * 2 - 1, y: rand() * 2 - 1 },
    },
    rhythm: {
      horizontal: { centroid: rand(), flatness: rand(), periodicity: rand(), dominant: [{ freq: rand(), magnitude: rand() * 10 }] },
      vertical: { centroid: rand(), flatness: rand(), periodicity: rand() },
    },
    palette: [
      { h: rand() * 360, s: rand(), l: rand(), share: rand() },
      { h: rand() * 360, s: rand(), l: rand(), share: rand() },
    ],
  };
}

// PAMI-shaped: exactly 8 phases + 13 dims, hits the torus-aware bridge path.
// A random ~sixth of the phase slots carry the energy gate's 0 sentinel.
function pamiReport(rand: Rand): unknown {
  const phases: number[] = [];
  for (let i = 0; i < PAMI_PHASE_COUNT; i++) {
    phases.push(rand() < 1 / 6 ? 0 : rand() * 2 * Math.PI - Math.PI);
  }
  const dims: number[] = [];
  for (let i = 0; i < PAMI_DIM_COUNT; i++) dims.push(rand() * 2 - 1);
  return { phases, dims };
}

// adversarial: magnitude extremes, deep nesting, many leaves, near-empties —
// the reports a containment guarantee actually has to survive.
function adversarialReport(rand: Rand): unknown {
  const pick = Math.floor(rand() * 4);
  if (pick === 0) {
    // huge magnitudes across many leaves
    const o: Record<string, number> = {};
    const k = 1 + Math.floor(rand() * 300);
    for (let i = 0; i < k; i++) o[`x${i}`] = (rand() * 2 - 1) * 10 ** (rand() * 24 - 12);
    return o;
  }
  if (pick === 1) {
    // deep nesting with mixed tiny/large values
    return { a: { b: { c: { d: { e: [rand() * 1e-15, rand() * 1e15, rand()] } } } }, f: rand() };
  }
  if (pick === 2) {
    // nearly-PAMI shapes that must fall through to the hash path
    return { phases: [rand(), rand()], dims: [rand()] };
  }
  // single leaf / near-empty
  return rand() < 0.5 ? { only: (rand() * 2 - 1) * 10 ** (rand() * 12 - 6) } : { z: 0 };
}

function generateReports(): unknown[] {
  const rand = mulberry32(SEED);
  const out: unknown[] = new Array(N);
  for (let i = 0; i < N; i++) {
    const r = rand();
    out[i] = r < 0.3 ? pfarReport(rand)
      : r < 0.6 ? vfarReport(rand)
      : r < 0.85 ? pamiReport(rand)
      : adversarialReport(rand);
  }
  return out;
}

// ── the gate ──────────────────────────────────────────────────────────────

describe('B1 gate: N=10,000 multimodal reports through ψ', () => {
  const reports = generateReports();
  // ψ at both operating dims: 29 (the feature chart) and 128 (the coordinate
  // space hyperMap fits — plan §2.4's H^128).
  const dims = [RIP_DIM, 128] as const;

  for (const dim of dims) {
    describe(`dim = ${dim}`, () => {
      const points: number[][] = [];
      let encodeMs = 0;

      it(`encodes all ${N} reports with 100% boundary containment and zero NaN/Inf`, () => {
        const t0 = performance.now();
        for (const R of reports) points.push(placeFeatures(ripVector(R), dim));
        encodeMs = performance.now() - t0;

        // plain comparisons in the hot loop (an expect() per coordinate is
        // 1.28M assertion objects at dim=128 — it times the test out, not the
        // encoder); aggregate counts asserted exactly below.
        let contained = 0, badShape = 0, nonFinite = 0, badDepth = 0;
        for (const p of points) {
          if (p.length !== dim) badShape++;
          for (const c of p) if (!Number.isFinite(c)) nonFinite++;
          if (norm(p) <= 1 - 1e-5) contained++;
          if (!Number.isFinite(depth(p))) badDepth++;
        }
        expect(badShape).toBe(0);
        expect(nonFinite).toBe(0);
        expect(badDepth).toBe(0);
        expect(contained).toBe(N); // 100%, not 99.99%
        // the <2ms/slice budget itself allows up to 20s of encoding, beyond
        // vitest's 5s default
      }, 30000);

      it('d_B is non-negative, symmetric, and zero at coincidence on sampled pairs', () => {
        const rand = mulberry32(SEED ^ 0x5eed);
        for (let k = 0; k < 2000; k++) {
          const a = points[Math.floor(rand() * N)];
          const b = points[Math.floor(rand() * N)];
          const dab = poincareDist(a, b);
          const dba = poincareDist(b, a);
          expect(Number.isFinite(dab)).toBe(true);
          expect(dab).toBeGreaterThanOrEqual(0);
          // the formula is symmetric term-by-term; hold it to floating-point
          // identity so a future refactor that breaks symmetry fails loudly
          expect(dab).toBe(dba);
        }
        for (let k = 0; k < 50; k++) {
          const a = points[Math.floor(rand() * N)];
          expect(poincareDist(a, a)).toBe(0);
        }
      });

      it('encodes at < 2ms per slice (mean over the 10,000)', () => {
        expect(points.length).toBe(N); // encode ran
        expect(encodeMs / N).toBeLessThan(2);
      });
    });
  }

  it('ψ is deterministic across the whole batch: same reports, same points', () => {
    const rand = mulberry32(SEED ^ 0xd373);
    for (let k = 0; k < 200; k++) {
      const R = reports[Math.floor(rand() * N)];
      expect(placeFeatures(ripVector(R), RIP_DIM)).toEqual(placeFeatures(ripVector(R), RIP_DIM));
    }
  });
});

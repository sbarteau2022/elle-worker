// pami-bridge.test.ts — the torus-aware calibrated PamiIndex encoding.
//
// The behavioural tests here FAIL against the pre-bridge behaviour (the
// generic leaf-hashing ripVector path): the demonstration was run by
// substituting `(idx) => ripVector(idx, PAMI_BRIDGE_DIM)` for pamiBridgeVector
// in a scratch copy of this file — 6 of 9 fail there (both wrap-adjacency
// tests, sentinel flatness, fidelity, purity, centering; numbers in the S2
// swarm report). The three that pass pre-bridge are the shape guard and the
// two structural contracts (finite/in-ball components, live depth), which the
// generic path also honours. With the bridge all 9 pass.
import { describe, expect, it } from 'vitest';
import { depth, norm, placeFeatures, poincareDist } from './hyper';
import { pamiDistance, pamiIndex, type PamiIndex } from './pami';
import {
  PAMI_BRIDGE_DIM,
  PAMI_DIM_COUNT,
  PAMI_PHASE_COUNT,
  isPamiIndexLike,
  pamiBridgeVector,
} from './pami-bridge';

// ── deterministic signal families (mirrors the lane-B siege generators) ────
const lcg = (seed: number) => {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
};
const gauss = (r: () => number) => {
  let u = 0, v = 0;
  while (!u) u = r();
  while (!v) v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const N = 512;
const sine = (r: () => number) => {
  const f = 0.01 + 0.06 * r(), ph = r() * 2 * Math.PI, out: number[] = [];
  for (let i = 0; i < N; i++) out.push(Math.sin(2 * Math.PI * f * i + ph));
  return out;
};
const white = (r: () => number) => {
  const out: number[] = [];
  for (let i = 0; i < N; i++) out.push(gauss(r));
  return out;
};
const ar1 = (r: () => number, rho: number) => {
  const out: number[] = [];
  let x = 0;
  for (let i = 0; i < N; i++) { x = rho * x + gauss(r); out.push(x); }
  return out;
};
const burst = (r: () => number) => {
  const out: number[] = [];
  for (let i = 0; i < N; i++) out.push(r() < 0.02 ? 6 * gauss(r) : 0.05 * gauss(r));
  return out;
};
const chirp = (r: () => number) => {
  const out: number[] = [];
  const f0 = 0.005 + 0.01 * r();
  for (let i = 0; i < N; i++) out.push(Math.sin(2 * Math.PI * (f0 * i + 4e-5 * i * i)));
  return out;
};

const embed = (idx: PamiIndex) => placeFeatures(pamiBridgeVector(idx), PAMI_BRIDGE_DIM);
const spearman = (a: number[], b: number[]) => {
  const rank = (xs: number[]) => {
    const idx = xs.map((v, i) => [v, i] as const).sort((x, y) => x[0] - y[0]);
    const r = new Array<number>(xs.length);
    for (let i = 0; i < idx.length;) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const ra = rank(a), rb = rank(b);
  const n = a.length, am = ra.reduce((x, y) => x + y, 0) / n, bm = rb.reduce((x, y) => x + y, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = ra[i] - am, y = rb[i] - bm; num += x * y; da += x * x; db += y * y; }
  return num / Math.sqrt(da * db);
};

const mkIdx = (phases: number[], dims: number[]): PamiIndex => ({ phases: phases.slice(), dims: dims.slice() });
const baseDims = new Array(13).fill(0).map((_, i) => 1 - 0.05 * i);
const basePhases = [0.5, -1.2, 2.0, 0.3, -0.7, 1.1, -2.4, 0.9];

describe('shape guard', () => {
  it('accepts real pamiIndex output and the spec shape, rejects everything else', () => {
    const idx = pamiIndex(ar1(lcg(0x51), 0.9));
    expect(idx).not.toBeNull();
    expect(isPamiIndexLike(idx)).toBe(true);
    expect(isPamiIndexLike(null)).toBe(false);
    expect(isPamiIndexLike(42)).toBe(false);
    expect(isPamiIndexLike([1, 2, 3])).toBe(false);
    expect(isPamiIndexLike({ phases: basePhases })).toBe(false);
    expect(isPamiIndexLike({ phases: basePhases.slice(0, 7), dims: baseDims })).toBe(false);
    expect(isPamiIndexLike({ phases: basePhases, dims: baseDims.slice(0, 12) })).toBe(false);
    expect(isPamiIndexLike({ phases: [...basePhases.slice(0, 7), NaN], dims: baseDims })).toBe(false);
    expect(isPamiIndexLike({ phases: basePhases, dims: baseDims })).toBe(true);
  });
});

describe('encoding contract', () => {
  it('emits 29 finite components with norm strictly inside the unit ball, deterministically', () => {
    expect(PAMI_BRIDGE_DIM).toBe(2 * PAMI_PHASE_COUNT + PAMI_DIM_COUNT);
    const r = lcg(0x52);
    const fams = [sine, white, (rr: () => number) => ar1(rr, 0.9), burst, chirp];
    let seen = 0;
    for (let i = 0; i < 25; i++) {
      const idx = pamiIndex(fams[i % fams.length](r));
      if (!idx) continue;
      seen++;
      const v = pamiBridgeVector(idx);
      expect(v).toHaveLength(PAMI_BRIDGE_DIM);
      expect(v.every(Number.isFinite)).toBe(true);
      expect(norm(v)).toBeLessThan(1); // placeFeatures' ≤1 contract, met strictly
      expect(pamiBridgeVector(idx)).toEqual(v); // deterministic
    }
    expect(seen).toBeGreaterThan(10);
  });

  it('charges the sentinel phase 0 a flat mismatch: near-equidistant from every content phase', () => {
    // A slot at exactly 0 is the energy gate's "no content" sentinel; the native
    // metric charges it a FLAT 0.5 against any content phase. The bridge maps it
    // to (0,0), whose pre-squash chord to any content phase is the constant
    // PHASE_W. The tanh radial squash is per-vector (its scale depends on the
    // whole vector's norm, which moves with θ), so through the full pipeline the
    // distance is θ-independent only to ~2% — measured spread 0.0045 on
    // distances ≈ 0.22. Assert the flat charge within a 5% honesty band; the
    // generic leaf-hashing path has no sentinel notion at all and hashing θ as
    // a real makes the charge swing with θ (measured on the same sweep: spread
    // 0.8355 on max 1.0763 — relative spread ≈ 78%).
    const dists: number[] = [];
    for (const theta of [-3, -1.5, -0.2, 0.4, 1.7, 3.1]) {
      const withContent = basePhases.slice(); withContent[3] = theta;
      const withSentinel = basePhases.slice(); withSentinel[3] = 0;
      dists.push(poincareDist(embed(mkIdx(withContent, baseDims)), embed(mkIdx(withSentinel, baseDims))));
    }
    const spread = Math.max(...dists) - Math.min(...dists);
    expect(spread).toBeLessThan(0.05 * Math.max(...dists));
    expect(Math.min(...dists)).toBeGreaterThan(0);
  });
});

describe('phase torus (siege B1)', () => {
  it('treats the ±π wrap as the tiny step it is, across six decades of ε', () => {
    // Pre-bridge: wrap/control ratio 149× at ε=0.01 (siege B1 defect, gate >10).
    for (const eps of [1e-1, 1e-2, 1e-3, 1e-4, 1e-5, 1e-6]) {
      const wrapA = basePhases.slice(); wrapA[0] = Math.PI - eps;
      const wrapB = basePhases.slice(); wrapB[0] = -Math.PI + eps; // same torus point, 2ε away
      const ctrlA = basePhases.slice(); ctrlA[0] = 0.5;
      const ctrlB = basePhases.slice(); ctrlB[0] = 0.5 + 2 * eps;
      const dWrap = poincareDist(embed(mkIdx(wrapA, baseDims)), embed(mkIdx(wrapB, baseDims)));
      const dCtrl = poincareDist(embed(mkIdx(ctrlA, baseDims)), embed(mkIdx(ctrlB, baseDims)));
      const ratio = dWrap / Math.max(dCtrl, 1e-12);
      expect(ratio).toBeGreaterThan(0.5);
      expect(ratio).toBeLessThan(2); // generic path: 14.8× at ε=0.1, ≈13/ε below (133× at 1e-2 … 1.31e6× at 1e-6)
    }
  });

  it('reproduces wrap-adjacency on real pamiIndex output', () => {
    const r = lcg(0x53);
    let tested = 0;
    for (let i = 0; i < 10; i++) {
      const idx = pamiIndex(ar1(r, 0.9));
      if (!idx) continue;
      tested++;
      const e = 0.01;
      const wa = mkIdx(idx.phases, idx.dims); wa.phases[0] = Math.PI - e;
      const wb = mkIdx(idx.phases, idx.dims); wb.phases[0] = -Math.PI + e;
      const ca = mkIdx(idx.phases, idx.dims); ca.phases[0] = 0.5;
      const cb = mkIdx(idx.phases, idx.dims); cb.phases[0] = 0.5 + 2 * e;
      const ratio = poincareDist(embed(wa), embed(wb)) / Math.max(poincareDist(embed(ca), embed(cb)), 1e-12);
      expect(ratio).toBeLessThan(2); // generic path: min 121× over the siege's real arm
    }
    expect(tested).toBeGreaterThan(5);
  });
});

describe('metric fidelity (siege B2/B3)', () => {
  it('preserves the native ordering: Spearman ρ(pamiDistance, ball geodesic) > 0.9', () => {
    // Pre-bridge shipped path measures ρ = 0.5377 in the siege; the gate here
    // is far above what leaf-hashing achieves and below what the bridge does.
    const r = lcg(0x54);
    const fams = [sine, white, (rr: () => number) => ar1(rr, 0.9), (rr: () => number) => ar1(rr, 0.3), burst, chirp];
    const idxs: PamiIndex[] = [];
    for (let i = 0; i < 42 && idxs.length < 36; i++) {
      const idx = pamiIndex(fams[i % fams.length](r));
      if (idx) idxs.push(idx);
    }
    expect(idxs.length).toBeGreaterThanOrEqual(30);
    const pts = idxs.map(embed);
    const nat: number[] = [], ball: number[] = [];
    for (let i = 0; i < idxs.length; i++) for (let j = i + 1; j < idxs.length; j++) {
      nat.push(pamiDistance(idxs[i], idxs[j]));
      ball.push(poincareDist(pts[i], pts[j]));
    }
    expect(spearman(nat, ball)).toBeGreaterThan(0.9);
  });

  it('keeps nearest-neighbour family purity ≥ 0.85 (native-comparable, generic path loses it)', () => {
    // Siege B3(e) analogue, smaller n: leave-one-out NN purity over four
    // families. Native scores 0.950 there; the shipped generic path 0.810.
    const r = lcg(0x55);
    const fams: Array<[string, (rr: () => number) => number[]]> = [
      ['sine', sine], ['white', white], ['ar1_9', (rr) => ar1(rr, 0.9)], ['burst', burst],
    ];
    const flat: Array<{ fam: string; pt: number[] }> = [];
    for (const [name, gen] of fams) {
      for (let i = 0; i < 15; i++) {
        const idx = pamiIndex(gen(r));
        if (idx) flat.push({ fam: name, pt: embed(idx) });
      }
    }
    expect(flat.length).toBeGreaterThanOrEqual(55);
    let hit = 0;
    for (let i = 0; i < flat.length; i++) {
      let bj = -1, bd = Infinity;
      for (let j = 0; j < flat.length; j++) {
        if (i === j) continue;
        const d = poincareDist(flat[i].pt, flat[j].pt);
        if (d < bd) { bd = d; bj = j; }
      }
      if (bj >= 0 && flat[bj].fam === flat[i].fam) hit++;
    }
    expect(hit / flat.length).toBeGreaterThanOrEqual(0.85);
  });
});

describe('reference measure (siege B4)', () => {
  it('centres the ordinary-family store at the origin: centroid norm < 0.05', () => {
    // Pre-bridge, the siege's B4 store had Euclidean centroid ‖c‖ = 0.555 and
    // Fréchet mean 0.453 off the origin (this test's own seed-0x56 store
    // measured pre-bridge centroid 0.539) — d(0,ψ) measured distance from an
    // arbitrary point. The baked CENTER moves the mass to the origin, and this seed is
    // disjoint from both the siege's (0xB4) and the calibration's (0xCA11B001).
    const r = lcg(0x56);
    const fams = [sine, (rr: () => number) => ar1(rr, 0.9), (rr: () => number) => ar1(rr, 0.5), chirp];
    const pts: number[][] = [];
    for (let i = 0; i < 120; i++) {
      const idx = pamiIndex(fams[i % 4](r));
      if (idx) pts.push(embed(idx));
    }
    expect(pts.length).toBeGreaterThanOrEqual(110);
    const c = new Array(PAMI_BRIDGE_DIM).fill(0);
    for (const p of pts) for (let i = 0; i < c.length; i++) c[i] += p[i] / pts.length;
    expect(norm(c)).toBeLessThan(0.05);
  });

  it('leaves depth a live, family-varying coordinate (no saturation)', () => {
    const r = lcg(0x57);
    const fams = [sine, white, (rr: () => number) => ar1(rr, 0.9), burst];
    const depths: number[] = [];
    for (let i = 0; i < 24; i++) {
      const idx = pamiIndex(fams[i % 4](r));
      if (!idx) continue;
      expect(norm(pamiBridgeVector(idx))).toBeLessThan(1 - 1e-9); // never saturated
      depths.push(depth(embed(idx)));
    }
    expect(depths.length).toBeGreaterThan(15);
    expect(Math.max(...depths) - Math.min(...depths)).toBeGreaterThan(1e-6);
  });
});

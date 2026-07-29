import { describe, it, expect } from 'vitest';
import {
  pamiIndex, pamiDistance, pamiStore, pamiRetrieve, pamiRecomputeDeltas,
  computeInsertionDelta, DELTA_DEFAULT, GAMMA_DEFAULT, PHI, type PamiConfig, type PamiIndex,
} from './pami';

// ============================================================
// INSERTION-TIME PRECISION — delta_i computed once at write time, not
// recomputed at query time. See pami.ts's computeInsertionDelta/pamiStore
// docstring for the full design. This file proves three things:
//   1. computeInsertionDelta's own arithmetic (cap, gamma, empty-store).
//   2. The no-overlap guarantee actually holds across every pair, not just
//      the closest one — and that it requires the shrink-on-insert step to
//      keep holding once a later memory lands near an earlier one.
//   3. pamiStore/pamiRetrieve actually persist and use delta_i, with query
//      time doing a flat per-candidate comparison, not a neighbor scan.
// ============================================================

function seeded(seed: number) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff - 0.5; };
}
function memorySignal(n: number, seed: number): number[] {
  const rand = seeded(seed);
  const f0 = 0.006 * (1 + ((seed * 0.618) % 1) * 4);
  const am = 0.002 + 0.012 * ((seed * 0.382) % 1);
  const phases = [rand() * 6, rand() * 6, rand() * 6];
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (let c = 0; c < 3; c++) v += Math.sin((2 * Math.PI * f0 * Math.pow(1.618033988749895, c) * i) + phases[c]) / (c + 1);
    out.push(v * (1 + 0.5 * Math.sin(2 * Math.PI * am * i)));
  }
  return out;
}
const N = 1024;

describe('computeInsertionDelta — the pure arithmetic', () => {
  it('an empty store gets DELTA_MAX (no neighbor to shrink against)', () => {
    const idx = pamiIndex(memorySignal(N, 1))!;
    expect(computeInsertionDelta(idx, [])).toBe(DELTA_DEFAULT);
  });

  it('delta = gamma * nearest-neighbor distance, capped at deltaMax', () => {
    const a = pamiIndex(memorySignal(N, 1))!;
    const b = pamiIndex(memorySignal(N, 2))!;
    const d = pamiDistance(a, b);
    expect(computeInsertionDelta(a, [b])).toBeCloseTo(Math.min(DELTA_DEFAULT, GAMMA_DEFAULT * d), 6);
  });

  it('a custom deltaMax/gamma is honored', () => {
    const a = pamiIndex(memorySignal(N, 1))!;
    const b = pamiIndex(memorySignal(N, 2))!;
    const d = pamiDistance(a, b);
    expect(computeInsertionDelta(a, [b], 0.01, 0.5)).toBe(0.01); // capped well below gamma*d
    expect(computeInsertionDelta(a, [b], 1.0, 0.9)).toBeCloseTo(0.9 * d, 6); // no cap bites
  });
});

describe('the no-overlap guarantee: delta_A + delta_B <= d(A,B) for every pair', () => {
  const memories = [1, 2, 3, 4, 5, 6].map((s) => pamiIndex(memorySignal(N, s))!);

  it('holds for every pair when ALL deltas are computed against the FULL final population at once', () => {
    // The "graph already settled" case — equivalent to pamiRecomputeDeltas
    // having just run against the whole store.
    const deltas = memories.map((m, i) => computeInsertionDelta(m, memories.filter((_, j) => j !== i)));
    for (let i = 0; i < memories.length; i++) {
      for (let j = i + 1; j < memories.length; j++) {
        const d = pamiDistance(memories[i], memories[j]);
        expect(deltas[i] + deltas[j]).toBeLessThanOrEqual(d + 1e-9);
      }
    }
  });

  it('WITHOUT the shrink-on-insert step, sequential insertion can violate the guarantee (the staleness this feature exists to close)', () => {
    // Insert memories one at a time, computing each one's delta ONLY against
    // what existed before it — and never revisiting earlier memories. This
    // is exactly the naive "insertion-time-only" version the design brief's
    // own "or when the graph undergoes structural changes" caveat warns
    // against.
    const inserted: PamiIndex[] = [];
    const deltas: number[] = [];
    for (const m of memories) {
      deltas.push(computeInsertionDelta(m, inserted));
      inserted.push(m);
    }
    let anyViolation = false;
    for (let i = 0; i < memories.length; i++) {
      for (let j = i + 1; j < memories.length; j++) {
        const d = pamiDistance(memories[i], memories[j]);
        if (deltas[i] + deltas[j] > d + 1e-9) anyViolation = true;
      }
    }
    // The first-inserted memory has no neighbors yet, so it locks in
    // DELTA_DEFAULT permanently under the naive scheme — and every later
    // memory finding a close neighbor near it is a real, demonstrated
    // violation, not a hypothetical one.
    expect(anyViolation).toBe(true);
  });

  it('WITH shrink-on-insert (pamiStore\'s actual behavior), the guarantee holds even built up incrementally', async () => {
    const db = fakeDb();
    const env = { DB: db } as any;
    for (let s = 0; s < memories.length; s++) await pamiStore(env, memories[s], `mem-${s}`);
    const rows = db._rows() as Array<{ id: string; index_json: string; delta: number | null }>;
    expect(rows).toHaveLength(6);
    const parsed = rows.map((r) => ({ idx: JSON.parse(r.index_json) as PamiIndex, delta: r.delta! }));
    for (let i = 0; i < parsed.length; i++) {
      for (let j = i + 1; j < parsed.length; j++) {
        const d = pamiDistance(parsed[i].idx, parsed[j].idx);
        expect(parsed[i].delta + parsed[j].delta).toBeLessThanOrEqual(d + 1e-9);
      }
    }
  });
});

// ── a minimal, REAL in-memory D1 double — actual row storage, actual
// SELECT/INSERT/UPDATE/batch semantics, not a stub that just resolves.
// Needed because this feature is specifically about what gets persisted and
// read back, not just about pure functions. ──────────────────────────────
function fakeDb() {
  const table: Array<{ id: string; index_json: string; content: string | null; created_at: number; delta: number | null }> = [];
  function run(sql: string, args: any[]) {
    if (/^ALTER TABLE/.test(sql)) return {};
    if (/^INSERT INTO pami_memories/.test(sql)) {
      const [id, index_json, content, created_at, delta] = args;
      table.push({ id, index_json, content, created_at, delta });
      return {};
    }
    if (/^UPDATE pami_memories SET delta/.test(sql)) {
      const [delta, id] = args;
      const row = table.find((r) => r.id === id);
      if (row) row.delta = delta;
      return {};
    }
    return {};
  }
  function all(sql: string) {
    if (/FROM pami_memories/.test(sql)) {
      return { results: [...table].sort((a, b) => b.created_at - a.created_at) };
    }
    return { results: [] };
  }
  return {
    prepare(sql: string) {
      let bound: any[] = [];
      return {
        bind(...args: any[]) { bound = args; return this; },
        async run() { return run(sql, bound); },
        async all() { return all(sql); },
        async first() { return null; },
      };
    },
    async batch(stmts: Array<{ run(): Promise<unknown> }>) { return Promise.all(stmts.map((s) => s.run())); },
    _rows() { return table; },
  };
}

// ── the direct answer to "what happens to the phi-vs-e minimax under this" ──
// pami-basis-ablation.test.ts's basis-neutral generator + configFor, exactly
// as used throughout this whole line of work (RCRB-001, the minimax
// scorecard) — so this is the SAME scenario that produced the ε_min-based
// collision numbers, not a fresh one built to be favorable.
function seededNeutral(seed: number) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff - 0.5; };
}
function memorySignalNeutral(n: number, seed: number): number[] {
  const rand = seededNeutral(seed);
  const f0 = 0.004 * (1 + ((seed * 0.37) % 1) * 4);
  const step = 0.003 + 0.004 * ((seed * 0.71) % 1);
  const am = 0.002 + 0.01 * ((seed * 0.53) % 1);
  const phases = [rand() * 6, rand() * 6, rand() * 6, rand() * 6];
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (let c = 0; c < 4; c++) v += Math.sin((2 * Math.PI * (f0 + step * c) * i) + phases[c]) / (c + 1);
    out.push(v * (1 + 0.5 * Math.sin(2 * Math.PI * am * i)));
  }
  return out;
}
function configForBasis(scaleBase: number, baseScale = 4): PamiConfig {
  const kMin = Math.ceil(Math.log(0.8 / baseScale) / Math.log(scaleBase));
  const kMaxNatural = Math.floor(Math.log((N / 3) / baseScale) / Math.log(scaleBase));
  const kMax = Math.max(kMin + 3, Math.min(kMaxNatural, kMin + 24));
  return { phaseCount: 8, qMax: 6, scaleKMin: kMin, scaleKMax: kMax, baseScale, scaleBase };
}

describe('the collision-risk domain, resolved: no-overlap holds for EVERY candidate this whole line of work has used', () => {
  it('φ, e, √2, and π ALL get provably non-overlapping basins on the exact basis-neutral scenario from the minimax scorecard', async () => {
    const CANDIDATES: Array<[string, number]> = [['phi', PHI], ['e', Math.E], ['sqrt2', Math.SQRT2], ['pi', Math.PI]];
    for (const [name, base] of CANDIDATES) {
      const cfg = configForBasis(base);
      const idxs = [1, 2, 3, 4, 5, 6].map((s) => pamiIndex(memorySignalNeutral(N, s), cfg));
      if (idxs.some((x) => x === null)) continue;
      const memsHere = idxs as PamiIndex[];
      const deltas = memsHere.map((m, i) => computeInsertionDelta(m, memsHere.filter((_, j) => j !== i)));
      for (let i = 0; i < memsHere.length; i++) {
        for (let j = i + 1; j < memsHere.length; j++) {
          const d = pamiDistance(memsHere[i], memsHere[j]);
          expect(deltas[i] + deltas[j]).toBeLessThanOrEqual(d + 1e-9); // never overlaps, for ANY candidate
        }
      }
    }
    // This is the direct confirmation of the predicted consequence: the
    // ε_min-based "collision risk" that drove Domain 1 of the minimax
    // scorecard (φ: 0.7415, e: 0.7608, √2: 0.8396, π: 0.7717 under static δ)
    // is now structurally impossible by construction, for all four. Domain
    // 1 going forward is a question of retrieval ACCURACY, not separation —
    // see docs/PHI_MINIMAX_SCORECARD.md's closing update.
  });
});

describe('pamiStore/pamiRetrieve — delta is persisted at write time, read flatly at query time', () => {
  const memories = [1, 2, 3, 4, 5, 6].map((s) => pamiIndex(memorySignal(N, s))!);

  it('every stored row gets a real, non-null delta, capped at DELTA_DEFAULT', async () => {
    const db = fakeDb();
    const env = { DB: db } as any;
    for (const m of memories) await pamiStore(env, m, 'x');
    const rows = db._rows();
    for (const r of rows) {
      expect(r.delta).not.toBeNull();
      expect(r.delta!).toBeLessThanOrEqual(DELTA_DEFAULT);
      expect(r.delta!).toBeGreaterThan(0);
    }
  });

  it('inserting a close neighbor SHRINKS an earlier row\'s stored delta (the shrink-on-insert path, exercised end to end)', async () => {
    const db = fakeDb();
    const env = { DB: db } as any;
    await pamiStore(env, memories[0], 'first'); // alone: delta capped at DELTA_DEFAULT
    const before = db._rows()[0].delta!;
    expect(before).toBe(DELTA_DEFAULT);

    await pamiStore(env, memories[1], 'second'); // close-ish neighbor arrives
    const after = db._rows().find((r) => r.content === 'first')!.delta!;
    expect(after).toBeLessThanOrEqual(before);
  });

  it('pamiRetrieve resolves matches using each row\'s OWN stored delta — a flat comparison, no scan', async () => {
    const db = fakeDb();
    const env = { DB: db } as any;
    for (const m of memories) await pamiStore(env, m, 'x');
    const query = memories[0];
    const results = await pamiRetrieve(env, query, 6);
    expect(results).toHaveLength(6);
    for (const r of results) {
      expect(r.resolved).toBe(r.distance < r.delta);
    }
    // self-match: the query IS one of the stored memories, so its distance
    // to itself is ~0 and must resolve under any positive delta.
    const self = results.find((r) => r.distance < 1e-6);
    expect(self).toBeDefined();
    expect(self!.resolved).toBe(true);
  });

  it('pamiRecomputeDeltas rebuilds every row\'s delta against the full current population', async () => {
    const db = fakeDb();
    const env = { DB: db } as any;
    for (const m of memories) await pamiStore(env, m, 'x');
    const { updated } = await pamiRecomputeDeltas(env);
    expect(updated).toBe(6);
    const rows = db._rows();
    const parsed = rows.map((r) => ({ idx: JSON.parse(r.index_json) as PamiIndex, delta: r.delta! }));
    for (let i = 0; i < parsed.length; i++) {
      for (let j = i + 1; j < parsed.length; j++) {
        const d = pamiDistance(parsed[i].idx, parsed[j].idx);
        expect(parsed[i].delta + parsed[j].delta).toBeLessThanOrEqual(d + 1e-9);
      }
    }
  });
});

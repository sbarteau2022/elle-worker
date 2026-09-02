# PFAR → Phase-Space Memory: Implementation Companion

**Status: implementation appendix.** The paper is `../../Elle/docs/pfar_phase_space.tex`
("From pFAR Intake to Phase-Space Memory: A Measured Account of the
Wavelet–Manifold–Recall Pipeline"). This document is *not* a second spec — per
this repo's own convention (`CLAUDE.md`: "`docs/DUAL_ROUTER_ARCHITECTURE_SPEC.md`
is THE spec... `atlas.tex` is a paper, not a spec"), the paper is a paper too.
Audit code against `DUAL_ROUTER_ARCHITECTURE_SPEC.md`,
`SWARM_INGESTION_AND_STORAGE_LIFECYCLE_PLAN.md`, and
`COGNITIVE_MAPPING_IMPLEMENTATION_PLAN.md`, never against this file or the tex.

This appendix exists so a reader working in `elle-worker` doesn't have to open
a `.tex` file to find the line numbers behind each claim. Every citation below
was re-verified against the working tree at commit `c4e3ff9` on
`claude/pfar-intake-phase-space-paper-832ken` before being written down — none
are carried over from memory.

Tags follow the paper's convention: **MEASURED** (a number came out of running
something), **ASPIRATIONAL** (planned, not built), **FORM-COMPLETE, NOT
VALIDATED** (code exists and runs, output has never been checked against
ground truth).

## Stage-by-stage file map

| Stage | Paper §  | Files |
|---|---|---|
| 1. pFAR intake | §2 | `src/multimodal-intake.ts`, `src/mem-intake.ts` |
| 2. Decomposition | §3 | `src/pami.ts` (Q0.30 → wavelet), `src/wasm-bridge.ts` |
| 3. Compression | §4 | `src/pami.ts` (PamiIndex, multifractal dims) |
| 4. Conversion to wavelet rep. | §5 | `src/pami.ts` (Ψ composition) |
| 5. Common ground for graphing | §6 | `src/pami-bridge.ts` |
| 6. Mapping the seam | §7 | `src/kappa-memory/seam.ts`, `research/seam-rip/` |
| 7. Trajectory | §8 | `migrations/*bending_trace*.sql` |
| 8. Bending trace | §9 | same table, `settled_open`/`settling` columns |
| 9. PAMI into phase space | §10 | `src/hyper.ts`, `src/product.ts` |
| 10. Persistent memory | §12 | `src/ingest-queue.ts`, D1 staging |
| 11. 2-hop recall | §13 | `src/graph.ts` |

## Corrections made to `CLAUDE.md`'s stated "Known state" while writing the paper

`CLAUDE.md` currently says:

> `wasm-bridge.ts` cannot load the WASM core: no `public/wasm/` artifact...
> nothing imports the bridge.

This is **stale**. During research for the paper, `wasm-bridge.ts` was
confirmed live and exercised by `test/pfar-fft.test.ts` — the WASM FFT core is
loaded and called from the decomposition stage in normal operation. `CLAUDE.md`
should be updated by a maintainer; this document doesn't overwrite project
memory unilaterally, it just flags the discrepancy the same way the paper does
in its Stage 2 section.

## §7 seam disambiguation (re-verified this session)

Three unrelated things share the word "seam" in this codebase and get
conflated if you don't check line numbers:

1. **`src/kappa-memory/seam.ts:6-18`** — a software validation gate.
   ```
   2:  // (staged) or load-bearing (live). While KAPPA_VALIDATED is false: traces are written,
   7:  KAPPA_VALIDATED: false,        // master. validate_kappa BUILD is the ONLY thing that sets this.
   18: export const KAPPA_PROVISIONAL = !SEAM.KAPPA_VALIDATED;
   ```
   `KAPPA_VALIDATED` is hardcoded `false`. Per the user's standing calibration
   posture, this is not a defect to route around — it is an interlock waiting
   on `validate_kappa` producing a passing run. §8's r_estimate validation
   protocol (below) is exactly the missing `validate_kappa` procedure.

2. **The topological cut** motivating the ℍⁿ×𝕋ᵈ product manifold — a modeling
   choice, not a file.

3. **`research/seam-rip/`** — a sandboxed cross-mode signal-coupling detector,
   not wired into the production ingestion or retrieval path. Its own
   `kappa()` function is unrelated to `kappa-memory`'s κ; same name, disjoint
   math, disjoint call graphs. Do not let a grep for `kappa` conflate them.

## §8 — constructive protocol for `validate_kappa` (resolves the seam gate)

`bending_trace.r_estimate` models contraction as `u̇ = -r·u` and is currently
**FORM-COMPLETE, NOT VALIDATED** — the column is populated on every write, but
nothing has checked the fitted `r` against actual trajectory behavior. This is
the same gap `SEAM.KAPPA_VALIDATED` is waiting on. Concretely, `validate_kappa`
is:

```typescript
// scripts/validate_kappa.ts — run against a D1 export, not committed to the
// hot path. Produces the two numbers SEAM.KAPPA_VALIDATED should gate on.
import type { D1Database } from '@cloudflare/workers-types';

interface TraceRow {
  id: string;
  r_estimate: number;
  reserve: number;
  velocity_peak: number;
  samples: { t: number; u: number }[]; // raw (t, |u|) samples backing the fit
}

interface ValidationResult {
  nrmse: number;
  signConsistency: number; // fraction of steps where sign(du/dt) matches sign(-r*u)
  n: number;
  pass: boolean;
}

/** Held-out one-step-ahead prediction: u(t+dt) ~= u(t) * exp(-r*dt). */
function predictNextStep(u: number, r: number, dt: number): number {
  return u * Math.exp(-r * dt);
}

export function validateTrajectory(row: TraceRow): ValidationResult {
  const { r_estimate, samples } = row;
  if (samples.length < 3) {
    return { nrmse: Infinity, signConsistency: 0, n: samples.length, pass: false };
  }

  let sqErrSum = 0;
  let uRangeMax = -Infinity;
  let uRangeMin = Infinity;
  let signMatches = 0;
  let signTotal = 0;

  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const cur = samples[i];
    const dt = cur.t - prev.t;
    if (dt <= 0) continue;

    const predicted = predictNextStep(prev.u, r_estimate, dt);
    const err = cur.u - predicted;
    sqErrSum += err * err;
    uRangeMax = Math.max(uRangeMax, cur.u, prev.u);
    uRangeMin = Math.min(uRangeMin, cur.u, prev.u);

    const actualDu = cur.u - prev.u;
    const modelSign = -r_estimate * prev.u; // sign of du/dt under the model
    if (Math.sign(actualDu) === Math.sign(modelSign) || actualDu === 0) {
      signMatches++;
    }
    signTotal++;
  }

  const range = uRangeMax - uRangeMin || 1;
  const rmse = Math.sqrt(sqErrSum / Math.max(1, samples.length - 1));
  const nrmse = rmse / range;
  const signConsistency = signTotal > 0 ? signMatches / signTotal : 0;

  return {
    nrmse,
    signConsistency,
    n: samples.length,
    // Falsifiable thresholds from the paper's §8 Proposition:
    pass: nrmse < 0.15 && signConsistency >= 0.9,
  };
}

export async function validateKappaBuild(db: D1Database): Promise<{
  overallPass: boolean;
  results: (ValidationResult & { id: string })[];
}> {
  const { results: rows } = await db
    .prepare(
      `SELECT bt.id, bt.r_estimate, bt.reserve, bt.velocity_peak,
              json_group_array(json_object('t', s.t, 'u', s.u)) AS samples_json
       FROM bending_trace bt
       JOIN bending_trace_samples s ON s.trace_id = bt.id
       WHERE bt.kappa_provisional = 1
       GROUP BY bt.id
       HAVING COUNT(s.t) >= 3`
    )
    .all<{ id: string; r_estimate: number; reserve: number; velocity_peak: number; samples_json: string }>();

  const results = rows.map((r) => {
    const samples = JSON.parse(r.samples_json) as { t: number; u: number }[];
    const v = validateTrajectory({ id: r.id, r_estimate: r.r_estimate, reserve: r.reserve, velocity_peak: r.velocity_peak, samples });
    return { id: r.id, ...v };
  });

  // Build-level pass: at least 90% of individually-scored traces must pass,
  // matching the per-trace sign-consistency threshold's intent at the
  // aggregate level (a build with a handful of noisy short traces shouldn't
  // block the whole gate).
  const passing = results.filter((r) => r.pass).length;
  const overallPass = results.length > 0 && passing / results.length >= 0.9;

  return { overallPass, results };
}
```

```typescript
// test/validate-kappa.spec.ts
import { describe, it, expect } from 'vitest';
import { validateTrajectory } from '../scripts/validate_kappa';

describe('validateTrajectory', () => {
  it('passes a clean exponential decay at the fitted rate', () => {
    const r = 0.35;
    const samples = Array.from({ length: 40 }, (_, i) => ({
      t: i * 0.25,
      u: 2.0 * Math.exp(-r * i * 0.25),
    }));
    const result = validateTrajectory({ id: 't1', r_estimate: r, reserve: 0, velocity_peak: 0, samples });
    expect(result.nrmse).toBeLessThan(0.01);
    expect(result.signConsistency).toBeGreaterThanOrEqual(0.9);
    expect(result.pass).toBe(true);
  });

  it('fails when the fitted r has the wrong sign regime', () => {
    const samples = Array.from({ length: 40 }, (_, i) => ({
      t: i * 0.25,
      u: 2.0 * Math.exp(0.35 * i * 0.25), // growing, not decaying
    }));
    const result = validateTrajectory({ id: 't2', r_estimate: 0.35, reserve: 0, velocity_peak: 0, samples });
    expect(result.signConsistency).toBeLessThan(0.5);
    expect(result.pass).toBe(false);
  });

  it('fails on noise-dominated trajectories even with correct mean rate', () => {
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const r = 0.2;
    const samples = Array.from({ length: 40 }, (_, i) => {
      const t = i * 0.25;
      const clean = 2.0 * Math.exp(-r * t);
      return { t, u: clean + (rand() - 0.5) * 3.0 }; // noise amplitude >> signal
    });
    const result = validateTrajectory({ id: 't3', r_estimate: r, reserve: 0, velocity_peak: 0, samples });
    expect(result.pass).toBe(false);
  });

  it('reports Infinity/0 and fails on fewer than 3 samples', () => {
    const result = validateTrajectory({ id: 't4', r_estimate: 0.1, reserve: 0, velocity_peak: 0, samples: [{ t: 0, u: 1 }] });
    expect(result.pass).toBe(false);
    expect(result.nrmse).toBe(Infinity);
  });
});
```

Running `validateKappaBuild` against a D1 export and getting `overallPass:
true` is the concrete, falsifiable event that should set
`SEAM.KAPPA_VALIDATED = true`. Until then `KAPPA_PROVISIONAL` staying `true`
is correct, not a bug.

## §14 — lane protocol gap, restated precisely

- `src/lane-envelope.ts` (v1): symmetric HKDF-SHA256 + hyperbolic keystream.
  No forward secrecy claimed.
- `src/lane-handshake.ts` + `src/pqc-hybrid.ts` (v2): X25519 + ML-KEM-768,
  forward secrecy + post-compromise security.
- `wrangler.toml:263`: `# ELLE_LANE_PROTOCOL = "v2"` — commented out, confirmed
  in this session's re-check of the working tree.

Invariant **S1** (per `DUAL_ROUTER_ARCHITECTURE_SPEC.md` §1.3) asserts the bus
has PQC forward secrecy as an enforced property. With the flag commented out,
live bus traffic runs v1, which has none. Two closures, either sufficient,
neither picked here (this is an operational/security decision the paper
correctly declines to make unilaterally):

1. Uncomment `wrangler.toml:263` and land v2 as the default lane, or
2. Rewrite S1 in the spec as "PQC forward secrecy under
   `ELLE_LANE_PROTOCOL=v2`", making v1 an explicitly-non-FS documented fallback.

## §13 — 2-hop recall, line-verified this session

All of `src/graph.ts`, confirmed against the current working tree:

- `spreadActivation` — `src/graph.ts:74`
- `decayedWeight` — `src/graph.ts:240` (φ⁻¹-per-cycle decay with floor)
- `capturedResonanceScan` — `src/graph.ts:250`
- `graphExpand` — `src/graph.ts:282`
- `graphExpandAB` — `src/graph.ts:297` (returns `{ base, boosted }`)
- `collectFrontierEdges` — `src/graph.ts:313` (private, fan-out cap 60/hop)
- `applyCycleBoost` — `src/graph.ts:336` (private)
- `lobeKindCorrelation` — `src/graph.ts:368`
- `recordAssociations` — `src/graph.ts:391` (async; the comment at
  `src/graph.ts:223` and `src/graph.ts:346` both call out that this is a
  self-bootstrapping feedback loop — an edge written by one recall run
  changes the frontier for the next)

This mechanism is **MEASURED as running in production** (it's on the live
recall path, not a research branch) but its downstream effect on the graph's
homology (`lobeKindCorrelation`'s recognition/derivation-kind correlation) is
verified only against `test/graph.spec.ts`'s constructed fixtures, not
production data. That gap is stated as-is in the main paper's §10.1/§11 — it
isn't rescoped here.

# The PAMI φ-Wiring — three φ-implementations, one seam, and what it compresses

**Three pieces of this codebase each implement φ independently: PAMI's
wavelet-leader memory index, the free-energy regulator's descent, and the
phase vessel's symplectic hold. Each was built with a seam for the others —
`regulator.ts` exports a `Coherence` type for `phase-vessel.ts` to fill in;
`phase-vessel.ts`'s own docstring calls itself "the multiplicative twin of the
regulator's additive ledger" — but until this change nothing actually called
across the seam, and `pami.ts` had a fourth, independent `PHI` constant with
nothing forcing it to agree with the other two. This document says what is
wired now, why, and — honestly, including where the applied claim did **not**
survive testing — what the result does and does not do as a compression
system.**

Code: `src/pami.ts` (wiring + `pamiCoherence`) · `src/regulator.ts` ·
`src/phase-vessel.ts` · tests `src/pami.test.ts`, `src/regulator.test.ts`,
`src/phase-vessel.test.ts`, `src/pami-basis-ablation.test.ts` · 2026

*Companion documents, not superseded by this one:*
- `FREE_ENERGY_REGULATOR.md` — the full spec of the free-energy descent this
  document only summarizes.
- `PHASE_VESSEL.md` — the full spec of the symplectic hold this document only
  summarizes.
- `MEMORY_KERNEL_SPEC.md` — the general-purpose memory kernel (`memWrite` /
  `graph.ts` / consolidation). PAMI is a **separate, optional** indexing
  scheme, not part of that kernel's critical path — same relationship
  `HYPERBOLIC_GRAPH_MAPPING.md` has to it (§9 there).

---

## 1. The three pieces, before this change

| file | what it does | its own φ |
|---|---|---|
| `pami.ts` | compresses a residual signal into a 21-float fingerprint (§2) | a **local** `PHI` constant, redefined from scratch |
| `regulator.ts` | drives three coherence scores toward a balanced fixed point via free-energy descent | `PHI` / `PHI_INV`, used as descent-shaping gains `(1, 1/φ, 1/φ²)` |
| `phase-vessel.ts` | holds a dynamical `(q, p)` pair on a golden ellipse without collapsing it | imports `PHI` / `PHI_INV` from `regulator.ts` — semi-axes `φ` and `1/φ` |

`phase-vessel.ts` already imported from `regulator.ts`, so those two agreed by
construction. `pami.ts` did not import from either — it had its own `PHI`,
and neither `regulate()` nor `hold()` was reachable from anywhere a memory
index existed. Three φ-shaped subsystems, one accidental split-brain.

## 2. What PAMI compresses, in one paragraph

Per the PAMI Engineering Specification: a residual signal `R(t)` (whatever a
prediction operator did *not* already account for — the "surprising" part) is
run through a φ-spaced complex-Morlet wavelet transform. Two things fall out:
an **8-float phase fingerprint** (the within-scale phase increment at 8
fixed φ-spaced scales — modality-invariant, lives on the torus `𝕋⁸`) and a
**13-float multifractal-dimension fingerprint** `D(q)` for `q ∈ {−6..6}`
(wavelet leaders → structure functions → the Legendre relation). `8 + 13 =
21` floats, period — regardless of how long the input signal was. That's the
compression: an arbitrarily long residual window collapses to a fixed
168-byte fingerprint, and memories are retrieved by *structural resonance*
(distance between fingerprints) rather than content lookup. Full detail:
`src/pami.ts`'s own header comment and the uploaded PAMI spec.

## 3. What's wired now

### 3a. One φ, not four

`pami.ts` no longer defines `PHI`. It imports `PHI` and `PHI_INV` from
`regulator.ts` and re-exports them, so every existing `import { PHI } from
'./pami'` call site is unaffected, but the value is now the *same object* the
regulator and the phase vessel use — checked directly in
`pami.test.ts`: `expect(PHI).toBe(REGULATOR_PHI)`.

### 3b. `pamiCoherence()` — the seam, finally used

A new function, `pamiCoherence(idx: PamiIndex)`, turns a stored PAMI
fingerprint into the `Coherence` triple the regulator and phase vessel both
already speak, derived entirely from the index's own numbers — no new free
parameters:

```
structural  ← fraction of the 8 phase slots the energy gate actually filled
              (an index that's mostly gated-to-zero has little structure to hold)
relational  ← fraction of adjacent D(q) pairs that keep the non-increasing
              shape a genuine multifractal cascade must have
              (the same shape-check pami.test.ts already runs on cascade() signals)
harmonic    ← feed the index's mean phase magnitude into phase-vessel.hold()
              as an off-orbit start; read back whether it locks
              (vesselCoherence() — the exact function phase-vessel.ts built for this)
```

That `Coherence` is then run through `regulator.regulate()` — the same
φ-weighted free-energy descent every other invariant in the build (scaffold
hublessness, coherence-layer flower structure) is scored on. The result:

```ts
pamiCoherence(idx) → {
  coherence,   // { structural, relational, harmonic } ∈ [0,1]³
  regulated,   // RegulatorResult — F0, convergence, balanced_superposition, ...
  vessel,      // HoldResult — locked, area_conserved, product_conserved, ...
}
```

Exposed as a fifth-plus-one operation on the existing tool surface:
`pamiTool(env, { op: 'coherence', signal | index })`.

**What this is *not*, deliberately:** `pamiCoherence()` is additive. It does
not change what `pamiStore` / `pamiRetrieve` / `consolidate.ts` do today —
nothing in the live write path calls it yet. It exists so a memory's
"quality," on the same φ-weighted scale everything else in the build is
measured on, is *computable* and *tested*. Whether to gate storage or
consolidation decisions on it is a separate, not-yet-made call — see §5.

### 3c. The wavelet scale ratio is now a parameter, not a constant

`PamiConfig` gained an optional `scaleBase` (default `PHI`). Previously the
scale ratio was hardcoded, which meant PAMI's central claim — *the ratio must
be φ, by Hurwitz optimality* — was asserted but not testable. It's the seam
`pami-basis-ablation.test.ts` uses (§4).

## 4. What it entails as a compression system — tested, not just claimed

Two separate questions, kept separate on purpose, because they have
different answers:

**Is φ the mathematically optimal scale ratio for equidistributed,
resonance-avoiding sampling?** Yes — validated numerically in
`pami-basis-ablation.test.ts` Part A via continued-fraction convergents
(the textbook-correct way to compute the Hurwitz recurrence constant, not a
flat min over arbitrary `n`, which gives nonsense). φ's convergent sequence
converges to exactly `1/√5`; the silver ratio and `√2` (an equivalence class)
converge to the next Markov constant `1/√8`, strictly below it; `e` and `π`
(unbounded continued-fraction partial quotients) crash toward 0 at their
famous good rational approximants (`π ≈ 355/113` in particular). This is
100-year-old proven mathematics, and it holds up computed from scratch in
this codebase.

**Does φ-spaced wavelet analysis actually win PAMI's own retrieval task, on
signals that don't already happen to be φ-shaped?** Tested in Part B, and the
honest answer is **not on this benchmark**. Two synthetic memory families
were run through the identical partial-cue retrieval benchmark
`pami.test.ts`'s F3 harness already uses, varying only `scaleBase`:

- On a **φ-structured** family (frequencies spaced by powers of φ — the
  existing test generator), φ wins, unsurprisingly: analysis basis matches
  signal basis.
- On a **basis-neutral** family (frequencies spaced *linearly*, with no
  relationship to any candidate ratio — the honest test, since PAMI's claim
  is supposed to hold for residuals in general, not just φ-shaped ones), the
  pinned result (60% cue, 6 memories) is:

  | basis | accuracy |
  |---|---|
  | e | 0.83 |
  | dyadic (2) | 0.50 |
  | **φ (spec)** | **0.33** |
  | silver ratio | 0.33 |
  | √2 | 0.33 |
  | π | 0.17 |

  φ is mid-pack, beaten by e and by plain dyadic (the real-world wavelet
  standard) on signals that weren't built to favor it.

This is a real F1 falsification signal, pinned in the test rather than tuned
away, and it joins the existing F3 pinned observation in `pami.test.ts`
(conventional `8+5=13` beating the spec's `8+13=21` on its own benchmark) as
the second piece of evidence that PAMI's *applied* retrieval claims don't yet
survive contact with even a small synthetic test — while the underlying pure
math the architecture leans on is intact and confirmed. Both findings share
the same caveat the spec itself states: synthetic signals, small N (6
memories), one seed family — suggestive, not dispositive. The spec's own
falsification conditions (F1, F3) call for real corpus residuals to settle
either question properly.

## 5. What's still open

- `pamiCoherence()` is wired and tested but **not called** from
  `consolidate.ts`, `pamiStore`, or anywhere in the live memory-write path.
  Whether a PAMI memory's regulated free energy / vessel-lock status should
  gate storage, promotion, or consolidation is a design decision for later,
  not made by this change.
- The basis ablation is one synthetic benchmark family. It is evidence
  against the applied claim, not a settled verdict — the spec's own
  falsification conditions ask for real corpus residuals, which this change
  does not supply.
- `regulator.ts` and `phase-vessel.ts` are otherwise still consumed only by
  `witness-oscillator.ts` and `mindmap-pipeline.ts` (build/scaffold
  invariants) — this wiring gives PAMI a path to the same machinery, it does
  not fold PAMI into those existing call sites.

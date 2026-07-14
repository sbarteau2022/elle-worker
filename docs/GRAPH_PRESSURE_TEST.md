# Graph Pressure Test

**The curvature signature under realistic growth, decay, and captured resonance**

Companion to the holding-valve pressure test series (`HOLDING_UNDER_ARCHITECTURE.md`,
`HOLDING_PRESSURE_TEST_III/IV.md`) · sim: `src/self-shape-pressure-test.test.ts`
(seeded, exercises the real `structure.ts`/`graph.ts` functions end to end against
an in-memory `GraphStore` implementing the real interface) · 2026

---

## What this test is, and is not

`self-shape.test.ts` (Test I, in spirit) already validates static ground truth: a
hand-built tree reads hierarchical, a hand-built dense cyclic graph reads cyclic.
That's the gap the holding valve had before Pressure Test II — real, but never
exercised under anything shaped like actual usage. This is that missing test for
the graph: does `curvatureSignature`/`graphInvariants` hold up under a graph built
the way the real mechanics actually build one — `recordAssociations`' pairwise
reinforcement (the real self-bootstrapping edge formation, cap=5, weight bumped
+0.5 capped at 4.0 on repeat co-recall), the nightly φ⁻¹ `sweep`, and
`capturedResonanceScan`'s own pathology — rather than a topology built by hand.

**Explicitly out of scope**, per `MEMORY_KERNEL_SPEC.md` §4.5/§9: whether the
reported shape means anything cognitively. `structure.ts` is documented as a
"separate, optional, tool-surface-only" layer, not wired into automatic retrieval,
and this test doesn't touch that question. It asks the same question Pressure Test
II asked of the holding loss: **is the structural computation itself a reliable,
non-degenerate instrument** — not whether the shape it reports is "true."

A synthetic 50-plus-day corpus was grown through five phases: a scattered
bootstrap, a real branching tree (hierarchical), a recurring daily-ritual cluster
(cyclic), a decay stretch where the tree goes cold and the ritual stays hot, and a
captured-resonance stress where one pair is hammered daily. Every phase calls the
real `recordAssociations`-equivalent formation logic and the real
`curvatureSignature`/`graphInvariants`/`deltaHyperbolicity`/`capturedResonanceScan`.

## Findings

**1. Coarse classification works.** The signature correctly reads hierarchical
through the tree-building phase (day 19: hyperbolic 0.74 vs. toroidal 0.26),
shifts to cyclic/balanced as the ritual cluster forms (day 21 onward), and moves
further cyclic as the tree decays away (day 41: toroidal 0.73). `capturedResonanceScan`
correctly fires on the hammered pair. At the coarse, phase-level grain this
instrument does what it's supposed to.

**2. A real finding, not a bug: any 3+-node recall organically seeds a cycle.**
`recordAssociations` forms *all* pairwise edges among a recall's touched set — a
recall returning 3 memories forms a triangle, by construction (`graph.ts`'s own
docstring: "the set a recall returned IS, by definition, a set that was relevant
together"). Even the deliberately "sparse, unrelated" bootstrap phase (touching 3
scattered notes per recall) produced `cycle_rank = 1` by day 2. **"Purely
hierarchical" structure can only exist if real recalls stay pairwise** — a narrow
assumption, since production `memRecall` returns top-k≈5 semantic hits, not pairs.
Any realistic corpus will carry baseline cyclic noise from day one, not as a defect
but as a direct consequence of how association actually forms.

**3. The signature is weight-blind — and that has a real, observable consequence.**
`graphInvariants`/`curvatureSignature` depend only on which edges *exist*, never on
their weight. Once a graph's edge set stabilizes, the signature goes **completely
flat** for as long as activity continues without touching new structure — the map
shows **15 straight days** (days 20–34) reading the identical `28 nodes / 36 edges
/ cycle_rank 11 / hyp 0.47 / tor 0.53`, even though the ritual cluster was being
actively, dailyreinforced the entire time (weights climbing toward the 4.0 cap).
The instrument cannot tell "a relationship being used every single day" from "a
relationship nobody has touched in weeks," as long as neither adds a new edge. This
is the graph-structural analogue of Pressure Test II's finding #5 for the holding
valve (tension freezes across silence) — a different mechanism, the same shape of
blind spot: the instrument reacts to *topology change*, not to *usage intensity*.

**4. Captured resonance, combined with ongoing decay, doesn't just bias the
reading — it can collapse the graph.** During the stress phase, only the hammered
pair (`kappa-reading`↔`trading-review`) was refreshed daily; the sweep pruned
everything else in the ritual cluster that went untouched. The graph didn't just
read as more cyclic — it **shrank from 6 nodes to 4** over 5 days, and the final
reading flipped back to `hierarchical` (day 54: hyp 0.60) not because the remaining
structure is meaningfully tree-like, but because a graph that small is barely
structure at all. The distortion-check assertion (does one hot edge swing the
*whole-graph* reading by more than 0.5) passed — the swing was real but bounded —
but that framing understates the fuller dynamic: **captured resonance under active
decay is a starvation mechanism, not just a bias**, and a leaning classification on
a collapsed, near-trivial graph carries much less information than the same
classification on a healthy-sized one. Worth surfacing distinctly if this ever
informs anything downstream: check graph size before trusting the leaning label,
not just the captured-resonance flag.

**5. Non-degenerate, by the same acceptance bar as κ v1.** Across the full run: 5
distinct δ values, 3 distinct leaning classes (hierarchical/cyclic/balanced), zero
turns where `cycle_rank` went negative, and `hyperbolic + toroidal` never exceeded
1 (a real partition, not a broken one). No single dominant resting value on the
overwhelming majority of inputs — the specific failure shape that killed κ v1 does
not reproduce here.

**6. Efficiency is a non-issue.** `deltaHyperbolicity`'s O(sample⁴) 4-point check at
the default `sample=32`, run against a graph built to `self-shape.ts`'s production
cap (~1500 edges), completes in **25ms** including graph construction — comfortably
inside any reasonable ceiling for an admin-gated `self_state`/`/api/elle-self` call,
not a hot loop.

## What this settles, for now

- The structural computation (`graphInvariants`, `curvatureSignature`,
  `deltaHyperbolicity`, `capturedResonanceScan`) is a **reliable, non-degenerate
  instrument** at the coarse, phase-level grain it was tested at — no fixed points,
  no runaway values, correct directional response to real growth/decay/resonance
  dynamics driven through the actual production functions.
- It has a **known, now-documented blind spot**: insensitive to reinforcement
  intensity, only to topology change (finding 3). Anyone consuming `leaning` or
  `delta` as a "how active is this area of memory" signal would be reading
  something the instrument doesn't measure.
- Captured resonance interacting with decay is a **starvation dynamic worth
  watching**, not just a bias to bound (finding 4) — this is new information the
  existing `capturedResonanceScan` flag alone doesn't surface (it flags the hot
  pair; it doesn't flag "and everything around it is dying").
- This does **not** change `MEMORY_KERNEL_SPEC.md` §4.5's determination that this
  layer stays tool-surface-only, out of automatic retrieval. It answers a narrower,
  prerequisite question — is the instrument trustworthy at all — and the answer is
  a qualified yes, with two documented caveats now on record rather than latent.

## What was not tested

Real production `elle_memory_edges` telemetry (still simulated, same caveat as
every test in this series); the fine-grained (single-recall-to-single-recall)
sensitivity of the signature, only the phase-level trend; whether the weight-
blindness (finding 3) or the collapse dynamic (finding 4) should change anything
about `capturedResonanceScan` or the sweep — that's a design decision, not
something this test is positioned to make; interaction with `product.ts`'s mixed-
curvature chart weighting (this test stays at the `structure.ts` layer feeding it).

---

*Run it: `npx vitest run src/self-shape-pressure-test.test.ts --reporter=verbose`
from the repo root (the `--reporter=verbose` flag is needed to see the printed
day-by-day map; the default reporter suppresses console output on passing tests).*

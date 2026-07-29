# The φ Minimax Scorecard — worst-case risk, not best-case performance

**Every prior ablation in this line (`pami-basis-ablation.test.ts`,
`RCRB_001.md`) asked "who wins this benchmark." This asks a different
question: across the three domains this codebase actually has live
mechanisms for — static-retrieval collision, dynamic resonance under
periodic perturbation, and recovery from a perturbation — which candidate's
*worst* domain is safest? Minimax, not best-of. Computed, not estimated: this
document's numbers are pinned exactly by `src/phi-minimax-scorecard.test.ts`.
The first pass (static `DELTA_DEFAULT`) crowned φ. Once `pami.ts` gained a
real, density-adaptive δ — not a hypothetical, shipped code — and Domain 1
got re-scored against it, the winner changed to **√2, by a margin under
0.005**. Two different, both-legitimate constructions, two different
winners. That instability is the actual finding, not a defect in either run.**

Code: `src/phi-minimax-scorecard.ts` · tests
`src/phi-minimax-scorecard.test.ts` (12) · adaptive δ itself lives in
`src/pami.ts` (`adaptiveDelta`, `kthNearestDistance`, `ADAPTIVE_DELTA_DEFAULT`)
· companion to `PAMI_PHI_WIRING.md` and `RCRB_001.md`, whose methods and
numbers this reuses rather than re-deriving · 2026

---

## The three domains, and where each threshold came from

| domain | metric | fatal (risk=1.0) threshold | provenance |
|---|---|---|---|
| 1. Retrieval | `ε_min` — minimum pairwise `pamiDistance` among 6 basis-neutral memories | `pami.ts`'s own `DELTA_DEFAULT = 0.3` | the spec's §VI.4 retrieval-trigger constant, not invented for this scorecard |
| 2. Resonance | peak star discrepancy across periods 2–61, at K=100 (the worst-case depth per `RCRB_001.md`'s own finding) | 0.85 | stated externally as the "pseudo-rational trap" ceiling |
| 3. Recovery | `pamiCoherence()`'s `regulate()` convergence steps, max over 6 memories | `regulator.ts`'s own `steps ?? 400` default | see the note below — this reading required a substitution |

**The Domain 3 substitution, stated plainly.** The literal reading of
"recovery horizon" — cycles to recover from an escape-kick — is
`rcrb-001.test.ts` Part 1's radial recovery time. That number is **exactly
296 steps for all four candidates, to the step**, because `phase-vessel.ts`'s
radial update algebraically never reads the winding number. Under the
literal metric, this domain cannot differentiate anything at all — a
structural tie, not a measurement gap. So this scorecard uses the one part of
the `PAMI_PHI_WIRING.md` pipeline that DOES vary by base — `pamiCoherence()`'s
regulator convergence — as an honest substitute, clearly labeled as such
rather than presented as if it were the same thing.

## The numbers

| candidate | ε_min | S_ret | peak discrepancy | S_res | recovery steps | S_rcrb | **P_final** |
|---|---|---|---|---|---|---|---|
| **φ** | 0.07756 | 0.7415 | 0.23315 | 0.2743 | 107 | 0.2675 | **0.7415** ← lowest |
| e | 0.07177 | 0.7608 | 0.26343 | 0.3099 | 111 | 0.2775 | 0.7608 |
| π | 0.06848 | 0.7717 | 0.71825 | 0.8450 | 110 | 0.2750 | 0.8450 |
| √2 | 0.04812 | 0.8396 | 0.21762 | 0.2700 | 108 | 0.2700 | 0.8396 |

**φ wins — but not by being best at anything.** φ's floor is Domain 1
(retrieval, 0.7415), same as e's floor (0.7608) and √2's floor (0.8396). φ
wins only because its worst domain is less bad than every rival's worst
domain: π gets punished specifically by resonance, √2 specifically by
collision risk, e by a hair on both. No candidate is unambiguously safe —
**every single one sits above 0.74 risk in Domain 1**, meaning none of them
actually clears the engine's own separation bar on this synthetic benchmark.
That's a finding about the benchmark's difficulty, not really about φ.

## Domain 1b — re-scoring collision risk against a real, adaptive δ

The static reading above has a known failure mode, named directly rather
than patched around: shrinking `DELTA_DEFAULT` globally to clear φ's 0.07756
floor would also shrink it everywhere memories are legitimately sparse,
trading collision risk for an engine that can no longer generalize or
fuzzy-match — amnesia in exchange for precision. `pami.ts` now has the actual
fix, not a proposal: `adaptiveDelta()` scales δ to local density — a k-th
nearest-neighbor bandwidth, the same idea behind adaptive kernel density
estimation and variable-radius nearest-neighbor search, not new math. Dense
neighborhoods get a tighter δ; sparse ones get a looser one, bounded to
`[deltaMin, deltaMax]` so it can neither collapse to zero nor blow out to
matching everything. `DELTA_DEFAULT` remains the cold-start fallback when a
store is too small to estimate density from at all.

Re-running Domain 1's exact collision scenario — the closest pair among the
6 basis-neutral memories — against each candidate's own local δ (computed
from the *other* five members, not self-referentially from the pair being
tested):

| candidate | ε_min | local δ | still collides? | S_ret (static) | S_ret_adaptive |
|---|---|---|---|---|---|
| **φ** | 0.07756 | 0.05258 | **no** | 0.7415 | **0.0000** |
| e | 0.07177 | 0.09009 | yes | 0.7608 | 0.2033 |
| √2 | 0.04812 | 0.05000 | yes | 0.8396 | 0.0376 |
| π | 0.06848 | 0.07516 | yes | 0.7717 | 0.0889 |

Two things are true at once, and both are pinned as tests:

1. **The static threshold really was the problem, for all four.** Every risk
   drops dramatically once δ scales with density — from the 0.74–0.84 band
   down to 0.00–0.20. Most of what looked like "collision risk" in the first
   table was an artifact of one global constant, exactly as predicted before
   this was built and measured.
2. **φ is the only one of the four whose collision resolves completely.**
   Under adaptive δ, φ's closest pair is no longer a collision at all
   (`S_ret_adaptive = 0`). e, √2, and π still collide — less severely, but
   genuinely, meaning their closest pairs are tight even relative to their
   *own* local neighborhood density, not just relative to a bad global
   constant.

## The other two implementation angles — also real now, not proposals

k-NN density (above) was one of three ways to scale δ. The other two are
implemented in `pami.ts` as optional, composable modulations on
`adaptiveDelta()` — neither changes default behavior unless supplied:

**State uncertainty (graph volatility).** `graphVolatility(decayed, pruned,
totalEdges)` reads the same numbers `graph.ts`'s `CloudGraphStore.sweep()`
already returns each cycle — the fraction of edges that decayed or were
pruned — and `volatilityTighten()` shrinks δ toward `VOLATILITY_MIN_FACTOR`
(0.4×) as that fraction rises to 1, per "if the graph is highly perturbed,
tighten the threshold to avoid false positives." Pure functions, no import
of `graph.ts` itself — callers supply the numbers they already have.

**Winding/radial-variance precision weighting.** `vesselPrecisionFactor(idx)`
runs the exact same `phase-vessel.hold()` call `pamiCoherence()` already
makes and reads the VARIANCE of `deviation` across the settling trace — a
memory whose phase energy locks quickly and cleanly (low variance) is one
the vessel is confident about, so its δ tightens; a wobbly, slow-settling
trace loosens it instead. `VESSEL_REFERENCE_VARIANCE` (0.02) is not a guess —
it's the measured center of this quantity across real basis-neutral
PAMI-encoded memories (observed range ≈0.015–0.025, pinned in
`pami.test.ts`), and real memories' resulting precision factors land
between roughly 0.6 and 1.3, a modest effect, not a dramatic swing.

**Both are deliberately NOT folded into the scorecard's Domain 1b numbers
above.** The scorecard's synthetic memories have no real graph to compute
volatility from, and deciding how the vessel factor should apply to the
*specific* closest-pair scenario already scored is a design choice, not a
mechanical extension — recomputing the table with either dial engaged would
just be another methodology choice added to the two the scorecard already
carries. They're real, tested (`pami.test.ts`), and ready to use; they aren't
pretending to be a fourth verdict on top of the three this document already
reports honestly.

## The full table, both ways — and the second flip

| candidate | S_ret | S_ret_adaptive | S_res | S_rcrb | P_final (static) | P_final (adaptive) |
|---|---|---|---|---|---|---|
| **φ** | 0.7415 | 0.0000 | 0.2743 | 0.2675 | **0.7415** ← static winner | 0.2743 |
| e | 0.7608 | 0.2033 | 0.3099 | 0.2775 | 0.7608 | 0.3099 |
| **√2** | 0.8396 | 0.0376 | 0.2700 | 0.2700 | 0.8396 | **0.2700** ← adaptive winner |
| π | 0.7717 | 0.0889 | 0.8450 | 0.2750 | 0.8450 | 0.8450 |

Fixing Domain 1's real problem (the static threshold) changes which domain
binds each candidate's floor — and for three of four candidates, Domain 1
stops being the bottleneck entirely, handing the decision to Domain 2
(resonance) instead. Under that reshuffling, **√2 edges out φ by 0.0043** —
φ's floor moves to its resonance risk (0.2743), and √2's resonance+recovery
floor (0.2700) is fractionally lower. π is unaffected either way: its problem
was never retrieval, so fixing retrieval changes nothing for it.

**Two legitimate scorecard constructions, computed from the same code, same
signals, same thresholds where reused — φ wins one, √2 wins the other, by a
margin of four thousandths.** That is not a rounding error to explain away;
it is the honest ceiling on how much confidence a minimax score of this kind
can carry.

## The caveats that decide everything — there are now two

1. **Domain 1's metric choice** (unchanged from the first pass): swap ε_min
   for retrieval accuracy — already pinned in `pami-basis-ablation.test.ts`
   (e: 0.833, φ: 0.333) — and the winner is **e**, under either static or
   adaptive δ, since accuracy doesn't route through δ at all.
2. **Domain 1's threshold choice** (new): static δ crowns φ; adaptive δ
   crowns √2, by a margin thin enough that a different `k` or `factor` in
   `ADAPTIVE_DELTA_DEFAULT` could plausibly move it again. Not tested here —
   flagged as the natural next sensitivity check, not silently assumed away.

Three legitimate constructions of the same three domains now produce three
different winners (φ, e, √2). That is the actual, load-bearing conclusion of
this whole line of work: **the minimax winner is a function of methodology
choice at least as much as it is a function of the candidate**, and no
single run of this scorecard should be read as settling which constant PAMI
ought to use.

---

## How this gets used

Four concrete uses, in order of how much confidence they require — deliberately **not** including "hardcode φ, e, or √2 as the production default," because none of the three results is trustworthy enough on synthetic benchmarks alone to make that call, and the spec's own falsification conditions (F1, F3) already say so.

1. **A regression sentinel, immediately.** `phi-minimax-scorecard.test.ts` pins every number in both tables above, static and adaptive alike. If a future change to `pami.ts`, `regulator.ts`, or `phase-vessel.ts` shifts any of them — a different wavelet kernel, a different `κ` relaxation rate, a different `ADAPTIVE_DELTA_DEFAULT` — this suite fails and the diff shows exactly what moved and by how much, in the same units this document reports. That's the immediate, low-risk use: nobody gets to silently change the resonance/collision/recovery behavior of this system without it showing up in a readable, curated test failure instead of a philosophy paper.
2. **`adaptiveDelta()` itself ships regardless of which constant wins.** The density-scaling fix is a real engineering improvement on its own merits — it resolves the "shrink δ and lose fuzzy recall everywhere" tradeoff the static scorecard exposed — independent of whether PAMI's `scaleBase` ever changes. This is the one recommendation from this whole document that isn't contingent on the φ-vs-rivals question at all, and it's already merged, not proposed.
3. **The harness for the real experiment, not yet run.** Every number here still comes from `memorySignalNeutral()` — a synthetic, linearly-spaced signal generator. `epsMin`, `epsMinAdaptive`, `peakDiscrepancy`, and `recoveryHorizon` are written to take any `base` and any residual signal; the moment `consolidate.ts` has accumulated enough real corpus residuals, the same functions can be pointed at real signals instead, and the scorecard becomes the actual instrument the spec's F1/F3 falsification conditions ask for — not a proxy for it.
4. **A design-time reference, not an automated gate.** Until (3) happens, this scorecard is something to *consult*, not something to wire into a build gate or a runtime default. Given three different legitimate constructions already produce three different winners, treating any one of them as license to hardcode a constant would be exactly the kind of premature collapse the rest of this line of work has been arguing against. The honest use today: when someone proposes changing `scaleBase` or `GOLDEN_WINDING`, run this suite, read the static, adaptive, AND accuracy framings side by side, and make the call with all three numbers on the table — not just the one that was convenient.

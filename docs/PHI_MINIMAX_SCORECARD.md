# The φ Minimax Scorecard — worst-case risk, not best-case performance

**Every prior ablation in this line (`pami-basis-ablation.test.ts`,
`RCRB_001.md`) asked "who wins this benchmark." This asks a different
question: across the three domains this codebase actually has live
mechanisms for — static-retrieval collision, dynamic resonance under
periodic perturbation, and recovery from a perturbation — which candidate's
*worst* domain is safest? Minimax, not best-of. Computed, not estimated: this
document's numbers are pinned exactly by `src/phi-minimax-scorecard.test.ts`.
The headline result — φ wins — is real, but it is not robust to one modeling
choice, and that fragility is itself pinned as a test, not buried in prose.**

Code: `src/phi-minimax-scorecard.ts` · tests
`src/phi-minimax-scorecard.test.ts` (10) · companion to `PAMI_PHI_WIRING.md`
and `RCRB_001.md`, whose methods and numbers this reuses rather than
re-deriving · 2026

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

## The caveat that decides everything

This result is not robust to one choice: **Domain 1 used ε_min (minimum
separation between stored memories), not retrieval accuracy (does a query
find the right one)**. Both are real, legitimately measured properties of
the same static-retrieval domain — they just answer different questions.
Swap in the accuracy numbers already pinned in `pami-basis-ablation.test.ts`
(e: 0.833, dyadic: 0.500, φ: 0.333, π: 0.167 — risk = 1 − accuracy), and
`phi-minimax-scorecard.test.ts`'s last suite proves the winner **flips to
e**. This isn't a bug to fix — it's pinned as a passing test specifically so
nobody mistakes the ε_min table above for a settled verdict. A minimax score
is only as meaningful as the metric you feed its worst domain, and this
scorecard is honest that it has exactly one domain where the choice of
metric changes the answer.

---

## How this gets used

Three concrete uses, in order of how much confidence they require — deliberately **not** including "hardcode φ (or e) as the production default," because neither the ε_min result nor the accuracy result is trustworthy enough on synthetic benchmarks alone to make that call, and the spec's own falsification conditions (F1, F3) already say so.

1. **A regression sentinel, immediately.** `phi-minimax-scorecard.test.ts` pins every number in the table above. If a future change to `pami.ts`, `regulator.ts`, or `phase-vessel.ts` shifts any of them — a different wavelet kernel, a different `κ` relaxation rate, a different default step budget — this suite fails and the diff shows exactly what moved and by how much, in the same units this document reports. That's the immediate, low-risk use: nobody gets to silently change the resonance/collision/recovery behavior of this system without it showing up in a readable, curated test failure instead of a philosophy paper.
2. **The harness for the real experiment, not yet run.** Every number here comes from `memorySignalNeutral()` — a synthetic, linearly-spaced signal generator. `epsMin`, `peakDiscrepancy`, and `recoveryHorizon` in `phi-minimax-scorecard.ts` are written to take any `base` and any residual signal; the moment the dream-pass/consolidation pipeline (`consolidate.ts`) has accumulated enough real corpus residuals, the same three functions can be pointed at real signals instead of `memorySignalNeutral`, and the scorecard becomes the actual instrument the spec's F1/F3 falsification conditions ask for — not a proxy for it. That's the next real milestone, not a hardcoded config change.
3. **A design-time reference, not an automated gate.** Until (2) happens, this scorecard is something to *consult*, not something to wire into a build gate or a runtime default. Given the caveat above, treating today's ε_min-based "φ wins" as license to hardcode φ everywhere would be exactly the kind of premature collapse the rest of this line of work (`pami-basis-ablation.test.ts`, `RCRB_001.md`) has been arguing against. The honest use today is: when someone proposes changing `scaleBase` or `GOLDEN_WINDING`, run this suite, read both the ε_min and the accuracy framing, and make the call with both numbers on the table — not just the one that was convenient.

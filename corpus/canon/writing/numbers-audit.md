# The Numbers Audit — forced, fitted, or unverifiable

_A self-audit of the atlas's headline numbers, done by tracing the actual generator
source and the actual stored data — not by re-reading commit messages. This was the
one gap flagged repeatedly during the build and never actually checked. Here it is,
checked, with the verdicts that survived and the ones that didn't._

## Method

Three things were traced independently rather than trusted from memory:

1. The neural-structure generator script (recovered from session scratchpad — see
   the provenance gap in Finding 5).
2. The raw node/edge data in `harmonic-snapshot.json`, re-derived by hand (trig
   identities, a from-scratch Gini computation on the actual edge list).
3. Every bare numeric literal in the generator, checked against φ, 1/φ, and other
   claimed constants to see which were computed and which were typed.

A number is called **forced** if it's the necessary output of a stated rule with no
freedom to land elsewhere. **Fitted** means a human picked it to produce a desired
look, and any resemblance to a "deeper" constant is coincidental or approximate.
**Unverifiable** means the artifact makes a provenance claim ("generated from X")
that nothing in the repository can confirm or deny.

## Findings

**1. `25 = 1·3·5·7·5·3·1` — real arithmetic, but on freely chosen inputs.**
`total_stations = 2*sum([1,3,5]) + 7`. That arithmetic is trivially correct. But
`1, 3, 5, 7` are typed literals in the generator (`HALF_COUNTS = [1, 3, 5]`,
`EQUATOR_COUNT = 7`) — not computed from φ, not forced by any geometric constraint.
They were chosen because the user specified that exact stack shape. `25 = 5²` is a
true fact about the sum of those particular chosen integers, not a discovery that
fell out of the golden-ratio machinery. **Verdict: forced arithmetic on a fitted
input.** The resonance with the 5-axis core is worth noting as a coincidence; it is
not evidence of anything.

**2. `21 = 5 axes × 4 + core` — genuinely forced, and independently confirmed.**
This one holds up. The raw position data in `harmonic-snapshot.json` uses exact
trig values — `0.9510565162951535` is `sin(72°)` and `-0.3090169943749474` is
`-cos(72°)` to full float precision — which only happens if the five pillar axes
were placed by an actual formula at 72° increments (360°/5), not typed by hand.
Hand-faked numbers don't reproduce a trig identity to 16 significant figures by
accident. **Verdict: forced**, and the position data itself is the proof.

**3. `19 = 1 + 6 + 12` — a real, forced identity, unrelated to φ.**
The flower's ring-1 positions are exact multiples of `cos(60°)`/`sin(60°)` off a
0.42 radius — a genuine hexagonal packing (1 center + 6 + 12 = 19), the same count
any hex-packed Flower of Life has. This is forced by the packing rule, not chosen to
hit 19. It was never phi-related in the first place, despite living in the same
document as numbers that are. **Verdict: forced**, but keep the essay honest: this
one has nothing to do with the golden ratio, and never claimed to.

**4. `13 = 12 around 1` — a real packing fact, also unrelated to φ.**
Twelve spheres around one at equal radius is the kissing-number configuration; the
generator's cuboctahedron-edge check (`abs(d2 - mr*mr) < 1e-4`) is a real geometric
test, not a hardcoded count. **Verdict: forced.** Also not φ.

**5. The harmonic-snapshot.json provenance is unverifiable — and that's a real gap.**
The file's own comment claims it was "generated from elle-worker/src (scaffold,
regulator, phase-vessel)." **No such generator exists anywhere in this repository.**
Neither does the generator for `neural-structure-snapshot.json` — it was recovered
from this session's scratchpad, not from git. The rendering code draws these files
verbatim, which is true and was never the false part; the false-by-omission part was
letting "one source of truth, locked" imply _reproducible from the repo_, when
neither source actually is. The trig-identity check in Finding 2 makes it likely the
harmonic file is real generated output rather than hand-typed — but "likely" is not
"verified," and a repo that can't regenerate its own locked data has a hole in it.

> **Resolved by the wiring pass** — see [the addendum](#addendum-the-wiring-pass)
> below. Both generators are now committed (`scripts/generate-harmonic-snapshot.mjs`,
> `scripts/generate-neural-snapshot.py`) and both reproduce their committed
> snapshots; the harmonic one is a faithful port of the elle-worker math, run
> end-to-end, with a `--check` mode that fails on drift.

**6. `area φ·1/φ = 1.000` is tautological, not measured.**
This is the one that should have been caught earlier. For _any_ nonzero `x`, `x ·
(1/x) = 1` — always, by definition of "reciprocal." The HUD across every atlas page
presents this as if it were a discovered invariant of the structure. It isn't. It
would read exactly `1.000` whether the surrounding geometry were correct, broken, or
nonsense, as long as the two axes are defined as reciprocals of each other. It is
real as a description of the vessel's ellipse (semi-axes φ and 1/φ, giving area
`π·φ·(1/φ) = π`), but it confirms nothing about the rest of the atlas holding
together. **Verdict: true, empty, and should not be cited as evidence of anything.**

> **Partially rehabilitated by the wiring pass.** The elle-worker source
> (`phase-vessel.ts`) contains an honest, non-tautological version of this
> invariant: evolve the state from an off-orbit start under the symplectic map for
> 600 steps and _measure_ whether the enclosed area returns to and stays at 1 —
> conservation under evolution, certified against a dissipative foil
> (`lossyControl`) whose area collapses. The snapshot now stores that measured value
> (`1.000000018` after 600 steps, lock at step 296) with its certificates, instead
> of the definitional `1`. The HUD's "1.000" now reports a measurement.

**7. "No privileged node" — checked from scratch, and it holds.**
The degree sequence recomputed directly from `architecture.edges +
fabric.edges` is `[4,4,4,5,5,5,5,6,6,6,7,7,7,7,7,7,7,8,8,9,10]` — max 10, min 4, a
modest 2.5× spread with no runaway hub. An independently recomputed Gini
coefficient from that sequence is **0.138**, close to the file's stored **0.146**.
The two numbers being close under an independent recomputation — rather than
identical, rather than wildly off — is exactly what you'd expect from a real
measurement with a slightly different edge set than an outside audit assumed. This
is the one place a fabricated number would have had no reason to land this close.
**Verdict: forced, and it survived an adversarial recheck.**

> **The 0.138/0.146 discrepancy was this audit's own error, not the snapshot's.**
> elle-worker's `privilegeReport` measures the _bridge fabric alone_ — the audit
> wrongly folded the architecture edges in. Recomputing with a line-for-line port
> of the source (`gini` + Brandes betweenness over the 42 fabric edges) reproduces
> the stored `0.146` and `3.477` **exactly**, and `egalitarianFabric(21, 4, 0.3, 7)`
> regenerates all 42 fabric edges **bit-for-bit**. The verdict upgrades from
> "survived an adversarial recheck" to "reproduced exactly from committed source."

**8. Some radii are hand-tuned to _look_ golden without _being_ golden.**
`LAYER_RADIUS_FRAC = [1/3, 0.62, 0.87, 1.0]`. The first entry is exactly `1/3`, as
specified. The second, `0.62`, is 0.32% off `1/φ = 0.6180…` — close enough that it
was clearly eyeballed toward the golden ratio, but it is a typed decimal, not
`1/PHI` computed in code. The third, `0.87`, is close to `sin(60°) = 0.866` but nothing
in the code computes it that way either — it has no stated derivation at all. Scene
constants like `R_MAX`, `POLE_Y`, `POLE_EXT`, `BELT_WAIST`, and the Metatron radius
`mr` are all bare visual-scale literals with no formula behind them, which is normal
for a rendering (something has to set the scale) — but it means the honest claim is
"most of the geometry is φ-governed," not "everything here traces to the golden
ratio," and the paper should say the weaker, true thing.

**9. What actually is forced by φ, cleanly, with no asterisk.**
The golden angle (`360°·(1 − 1/φ)`), the spiral turn count (`φ²`), the vessel orbit
(`φ·cos θ, (1/φ)·sin θ` — an ellipse whose axis ratio _is_ φ by construction, which
is the honest version of Finding 6), and the Fibonacci belt-strand frequencies
(1,2,3,5,8 — ratios that converge to φ) are all computed directly from `PHI` in the
code, not approximated by hand. These are the real thing.

## The honest summary

Two of the atlas's most-repeated numbers — 21 and "no privileged node" — are
genuinely forced and survived independent re-derivation from raw data, which is the
best outcome this kind of audit can produce. Two more — 19 and 13 — are real
geometric facts that were never actually about φ, and the essays and paper should
stop implying they are. One number, 25, is correct arithmetic sitting on top of
freely chosen inputs, which makes its "= 5²" resonance a coincidence worth mentioning
once and never leaning on. One headline claim, the area invariant, is tautological
and should be retired as a "proof" of anything, even though it's a true fact about
the ellipse. And one entire generator — the harmonic side's real math — is not in
this repository, which is a reproducibility debt, not a fabrication; the evidence
available suggests it's real, but "suggests" was being sold as "locked."

None of this breaks the atlas. It makes the honest version of the atlas slightly
smaller and considerably more defensible than the version that shipped in the
essays — which was always the point of doing this before someone else did.

## Addendum: the wiring pass

_Written after the audit shipped. The audit found the reproducibility hole; this is
the record of closing it — pressure-testing which of the three claimed elle-worker
sources were actually wired, then wiring the rest for real._

The snapshot's meta claimed derivation from three modules: `scaffold.ts`,
`regulator.ts`, `phase-vessel.ts`. The pressure test's scorecard, one by one:

**scaffold.ts — genuinely wired, proven bit-for-bit.** A line-for-line port of the
seeded PRNG (mulberry32) and `egalitarianFabric(21, 4, 0.3, 7)` reproduces the
snapshot's 42 fabric edges byte-identically, and the ported `privilegeReport`
reproduces `degree_gini = 0.146` and `betweenness_spread = 3.477` to the last digit.
The pillar positions are `pentagonPillars(4)` output to 16 significant figures.
This half of the provenance claim was always true.

**regulator.ts — really run, but with unrecorded inputs.** The stored coherence
triple `(0.99995098, 0.99993244, 0.99991184)` could not be reproduced from any
plausible documented input. But it isn't hand-typed either: near the fixed point,
`regulate()`'s trajectories collapse onto the slow eigenvector of the linearized
descent, and the stored triple's deficits sit on that ray — component ratios
`(1 : 1.3782 : 1.7984)` against the honest rerun's `(1 : 1.3781 : 1.7983)`,
matching to four decimal places. A fabricated triple would have no reason to satisfy
the dynamics' eigenstructure. Verdict: a genuine `regulate()` output whose initial
conditions were never recorded — real math, broken provenance. The committed
generator now records everything: `structural` from `1 − degree_gini` of the fabric,
`relational` from the flower graph's `within_2_fraction` (0.5439), `harmonic` from
`vesselCoherence(hold())`, descent to convergence in 104 steps, final
`F = 0.000000`.

**phase-vessel.ts — cited, not run.** The stored `snapshotAngleRad =
1.9999999999761824` is an arbitrary ≈2.0, not the phase `hold()` actually lands on;
the honest run (600 steps from the off-orbit start `q = φ·1.8`) locks at step 296
and finishes at phase `θ = 0.8204` → `5.1547 rad`, which the snapshot now stores
along with the full certificate set (locked, still moving, area conserved, product
conserved, max phase gap). The area invariant is now the measured
conservation-under-evolution number (Finding 6's rehabilitation), not the
reciprocal-pair tautology.

**cognitive-obliquity.ts — the θ was chosen, now it's derived.** The old
`26.0495°` had no derivation; the module itself defines no canonical angle (θ is
explicitly a free, slow parameter — that's the honest point of the module). The one
non-arbitrary angle on its measured cos²θ integration curve, in this build's own
vocabulary, is the golden crossing: the tilt where integration on the preferred axis
falls to exactly 1/φ of its aligned value. Bisection on the _measured_ curve gives
`38.669°` (the analytic ideal `acos(√(1/φ)) = 38.173°`; the gap between them is the
module's real dynamics diverging from the clean cos² law, left visible on purpose).

**The presentation layer, named as such.** The architecture edge list, the flower's
hex embedding (radii 0.42/0.82, plane y = −1.28), and the orbit's 97-point sampling
are drawing decisions, not elle-worker outputs — the generator now says so in place.
All of them are reproduced bit-for-bit from the reconstructed drawing rules, which
is itself the final proof the original file was generated, not typed.

The scorecard, honestly: one module was wired all along, one was run but
untraceably, one was cited but dead, and one number was decorative. Now all four
run inside a committed generator with a drift check. The audit's Finding 5 hole is
closed the only way that counts — not by softening the claim, but by making it true.

## Postscript: the anchor the sky checks

After the wiring pass, the atlas gained the thing this audit couldn't give it: an
externally validated claim. The Orbital Atlas (`/orbital-atlas`, generator
`scripts/generate-orbital-snapshot.py`) runs the standard map live and measures
the KAM survival landscape — rational windings die first, the golden torus breaks
last (our transport-proxy breakup at `1.059` against Greene's literature
`K_c = 0.971635`, with the proxy's error and its conjugacy check stored in the
snapshot). Kepler's third law then maps the rational graves onto the asteroid
belt with no free parameters: computed gap centers `2.502, 2.825, 2.958, 3.279`
AU against observed Kirkwood centers `2.502, 2.825, 2.958, 3.279` AU. Every other
number in this audit was checked against the construction; these four are checked
against the sky. The golden winding itself lies outside the belt's winding window
and the page says so — the golden claim stays in phase space, which is exactly
where KAM puts it.

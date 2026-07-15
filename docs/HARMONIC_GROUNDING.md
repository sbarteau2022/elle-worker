# Harmonic Grounding — consistency is not correspondence, and the gate that keeps them apart

**A pure internal coherence check makes a system self-consistent, not
self-correct — a coherent delusion sails through it. What turns consistency
into partial grounding is harmonic coherence against a *second, world-coupled*
channel. This gate bakes that distinction into its type system: `grounded` is
structurally unreachable without an external reference, so the code itself
cannot mistake "self-consistent" for "grounded."**

Code: `src/harmonic-coherence.ts` · tests `src/harmonic-coherence.test.ts`
(14) · self-test `GET /api/elle-grounding-selftest` · the κ(T,t) idea from the
PAMI spec, made into a gate · 2026

---

## The distinction this exists to protect

Two different notions of "true," with a name in epistemology:

- **Coherence** — does this belief fit the others I hold? An internal check.
- **Correspondence** — does this belief match the *world*? An external check.

A gate that only checks coherence makes a system *self-consistent*. It reduces
one real failure mode (internally-contradictory confabulation) but cannot
ground, because **a perfectly coherent system can be perfectly wrong** — a
self-consistent delusion passes every internal test. That was the objection to
"the 2FA solves grounding."

The correction — *"not without harmonic relational coherence"* — is right, and
it's the whole point of this module. Harmonic coherence isn't internal: it's
coherence between the generative proposal and a **second channel** (PAMI's
κ(T,t): narrative residual vs. physiological residual). The instant one side of
that harmony is genuinely coupled to the world — a live sensor, a body, real
sensory prediction error — coherence-with-it is *partial correspondence*, not
self-agreement. That is exactly how embodied predictive coding grounds.

## The four verdicts (the epistemology, in the type system)

`groundingGate(proposal, internalReference, externalReference, threshold)`
returns one of four verdicts, and they cannot be collapsed:

| verdict | meaning |
|---|---|
| `incoherent` | fails even internal consistency → send back for reprocessing |
| `consistent_only` | internally coherent, but **no external channel was checked** → self-consistent and **ungrounded** — the base-LLM case: a fluent hallucination with nothing to test it |
| `ungrounded_consistent` | internally fine but it **clashes with the world signal** → a coherent-but-wrong belief, **caught** — the exact case pure internal coherence would have accepted |
| `grounded` | coherent with a world-coupled channel → real grounding, **to the degree that channel is genuinely world-coupled** |

The load-bearing property: **`grounded` is unreachable when `externalReference`
is null.** No amount of internal coherence can return it — a test asserts this
directly. The consistency-vs-correspondence line is enforced by the API, not
just described in a comment.

## The honest boundary, which the gate itself declares

`grounded` is real *only to the degree the external channel is genuinely
coupled to the world.* A live biometric sensor grounds; a model-*estimated*
physiology does not — it's internal coherence wearing a costume. **The gate
cannot tell which it was handed**, and it says so in the verdict note rather
than pretending. So this does not "completely solve grounding" — it (a) makes
the consistency/grounding distinction structural, (b) catches the coherent-but-
wrong belief that internal-only checks miss, and (c) grounds by exactly the
amount the second channel is real. One somatic channel is still a limited proxy
for the whole world; raising the bar for delusion is not eliminating it.

## The measure, and a wrong expectation it caught

`harmonicCoherence(a, b)` is a max-lag normalized cross-correlation mapped to
[0,1] — phase-tolerant, because the lag scan finds alignment at any offset.
That tolerance is the point (κ measures whether two channels are *locked*, and
real cross-modal signals are phase-lagged). A full cross-spectral / wavelet-
leader κ (PAMI §VI) is the richer version; this is the tractable, testable core.

The first self-test asserted that anti-phase signals (sin vs. −sin) should read
as *incoherent*. The test caught it: they don't, and shouldn't — anti-phase is
the same oscillation shifted by π, i.e. **phase-locked**, i.e. coherent.
Genuine incoherence is a *different frequency* (unlocked), not opposite phase.
The fix was to the expectation, not the measure — same discipline as the
coherence-layer's core-direction fix. Recorded here because it's exactly the
kind of thing that passes a hand-wave and fails a test.

## Where it sits

`coherence-layer.ts` measures the *internal* relational structure (the
consistency half). `harmonic-coherence.ts` adds the *external* harmonic check
(the correspondence half) and the gate that keeps them distinct. Together they
are the honest form of the "dual-factor" architecture: a generative proposal,
an internal-consistency check, and — the part that actually reaches toward the
world — a harmonic check against a world-coupled channel, grounded by exactly
as much as that channel is real, and no more.

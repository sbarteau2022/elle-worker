# The Lattice — a 32-axis deduction engine, and what the geometry actually means

**A cross-section-by-cross-section reasoning stack for one specific incident —
the security-analysis counterpart to the Millennium Falcon. Named for a real
structure, not a decoration: the Flower of Life's own build sequence (Seed 7 →
Flower 19 → Fruit 32) IS the layer count, and the layers are wired the way a
message-passing graph neural network is wired — each cross-section reading the
one(s) beneath it, the same pattern a cortical column repeats at every scale.**

Code: `src/lattice.ts` · tests `src/lattice.test.ts` (8) · schema
`lattice_analyses` / `lattice_reckonings` / `lattice_reasoning_log` · door
`POST /api/elle-lattice` (admin-gated, `action: run|list|get`) · sibling to
`falcon.ts` (same architecture, different domain) · reads the doctrine already
built in `security-network.ts` · 2026

---

## What it's for, and what it isn't

The fast Witness (`security-network.ts`) scores every request in real time —
milliseconds, deterministic, no model call. It has to be fast, so it's shallow
by design: a signal maps to a tactic, a tactic has a weight, weights sum to a
posture. That's correct for the hot path and wrong for a hard case.

The Lattice is the other half: point it at ONE incident — an actor, a
pattern, a case the Witness already flagged and a human wants a second,
written opinion on — and it runs 32 separate analytical passes, each one a
real model call with its own curated question, before producing a single
verdict expressed in the same vocabulary the fast systems already use. It is
**deliberate and on-demand**, not a gate: nothing in the live request path
waits on it, and it should not be called per-request — ~32 model calls is a
research report, not a firewall rule.

## The geometry, precisely (not looser than this)

The Flower of Life is conventionally built in three stages, and each stage's
circle count is a real, countable thing, not an association:

- **Seed of Life — 7 circles** (1 center + 6 immediately around it).
- **Flower of Life — 19 circles total**, once a second ring of 12 completes
  the seed (7 + 12 = 19).
- **Fruit of Life — commonly the next ring of 13**, taking the running total
  to 32 (19 + 13).

The Lattice's three layers carry those exact counts as axis counts: **Seed of
Life = 7 axes, Flower of Life = 12 more axes, Fruit of Life = 13 more
axes-and-closing-moves (11 ordinary axes + Validation + The Reckoning) — 7 +
12 + 13 = 32 total.** This is the honest use of the pattern: a real, checkable
number, used as a literal structural count, not "32 feels resonant." (One
aside worth being precise about, the same way an earlier doc corrected an
undercounted bug list rather than leave it vague: different renderings of the
Flower of Life draw the outer ring with different circle counts depending on
how partial edge-circles are handled, so "19" and "32" are the common
counts for this specific staged construction, not the only numbers anyone
has ever called by these names.)

## Why "message-passing," not just "layered"

What makes this more than a fancier Falcon is the reading order matches a
real, cited computational architecture: a **message-passing graph neural
network** (Gilmer et al.'s MPNN framework, and the wider GNN literature) —
each layer is a cross-section, and a transfer step carries the accumulated
signal from one cross-section into the next, the pattern repeating at every
scale rather than living in one flat layer. Concretely, here:

```
Layer 1 — SEED OF LIFE     (7 axes,  parallel,  reads only the raw incident)
Layer 2 — FLOWER OF LIFE   (12 axes, parallel,  reads Layer 1's combined output)
Layer 3 — FRUIT OF LIFE    (11 axes, parallel,  reads Layers 1+2's combined output)
  Validation (axis 31, sequential) — the adversarial check on axes 1-30
  The Reckoning (axis 32, sequential) — the verdict, only once the field held
```

Every axis is a real model call with its own system prompt (chosen deliberately
over a cheaper "LLM only at the layer transitions" design — richer, slower,
built for a deliberate second opinion rather than the live path). Layer 2
receives Layer 1's full output as context; Layer 3 receives Layers 1+2; the
transfer between layers is literally string-concatenation-then-feed, the same
mechanism `falcon.ts` already uses, made explicit here as what it structurally
is: the "synapse," carrying signal from one cross-section to the next.

## The 32 axes

**Seed of Life (1–7)** — the classical deductive fundamentals, plus a
seventh by design: **Who, What, When, Where, Why, How, and Duality** — the
seventh axis exists specifically to hold the strongest honest case that the
incident is benign, open, until the evidence (not instinct) closes it. Seven
axes because the Seed is seven circles, and Duality earns the seventh seat
rather than padding it.

**Flower of Life (8–19)** — deeper, established threat-analysis disciplines:
the **Diamond Model of Intrusion Analysis** (Means/capability, Opportunity,
Infrastructure, Victimology — the Diamond's four core features, adapted),
**kill-chain escalation modeling** (Pattern-of-Life, Escalation Trajectory),
**Analysis-of-Competing-Hypotheses discipline** (Deception Index,
Corroboration), operational realism (Collateral Scope, Cost-to-Attacker,
Blast Radius If Wrong), and — closing the ring at exactly 19 — **Doctrine
Match**, the axis that asks which named tactic in `security-network.ts`'s own
48-Laws/Art-of-War taxonomy this incident resembles, so the Lattice's deep
read and the Witness's live scoring speak one vocabulary, not two.

**Fruit of Life (20–32)** — synthesis rather than more raw observation:
Threat Actor Class, Campaign Hypothesis, Time Pressure, an explicit
**Adversary Model Confidence** axis (self-critical by design — how much of
this rests on evidence versus a good-sounding story), Alternative
Explanations, Historical Precedent, Systemic Weakness Exposed, Proportionality
Check, Reversibility, Human Review Trigger, and Ethical Valence (does the
*response being considered* risk its own harm) — eleven axes, then
**Validation** (axis 31, the adversarial drift check, structurally identical
to Falcon's own Validation Tier) and **The Reckoning** (axis 32, the earned
verdict).

## The Reckoning speaks the Witness's language on purpose

The final axis doesn't just narrate a conclusion — it outputs `posture`
(`normal | watch | throttled | blocked`), `action`
(`allow | challenge | throttle | block`), and, when warranted,
`breach_reason` (`replay_attempt | burst_failures | witness_blocked |
manual_duress`) — the exact vocabulary `security-network.ts` and
`signal-collapse.ts` already use. A human reading the report gets full
sentences; a caller wiring the verdict back into the fast systems gets a
structured field it can act on directly, without translation.

## Honest limits

- **Not a gate.** ~32 model calls per run; this is a deliberate research
  report on one case, never something the live request path should wait on.
- **Every axis can be wrong, individually and in aggregate** — Validation
  exists because the failure mode of a 30-axis analysis isn't "too little
  data," it's "a confident-sounding story that drifted from the evidence."
  Read the Validation output, not just The Reckoning.
- **Doctrine Match only names a resemblance**, not a proof — it points at
  `security-network.ts`'s tactic taxonomy for a human to check, it doesn't
  silently feed a score back into the Witness's live posture.
- **The 19/32 circle counts are the common construction for this staged
  figure, not a universal constant** — said plainly here so it never has to
  be corrected later.

# Convergence — the index between convergence and fact

**When independent sources agree, how much should that raise confidence? A
deterministic engine, shaped after Falcon's real pattern — parallel independent
readings, then an adversarial check that names drift and states what would
change the analysis — rebuilt generic and testable for corpus corroboration.
The one guarantee that makes it honest: an echo (the same author, the same
paper, repeated) can never be mistaken for independent agreement.**

Code: `src/convergence.ts` · tests `src/convergence.test.ts` (7) · self-test
`GET /api/elle-convergence-selftest` · corpus wiring `src/corpus-reasoning.ts`
· endpoint `POST /api/elle-reason-corpus` · 2026

---

## Why not just call Falcon

Falcon (`falcon.ts`) already fires parallel independent readings (Tier 1 six
axes, Tier 2 nine axes reading Tier 1), then an adversarial **Validation Tier**
that names where the analysis drifted, considers alternative conclusions, and
states what evidence would change it — before anything (the Rupture, axis 16)
is allowed to synthesize. That is exactly the right *shape* for "convergence
toward fact." But Falcon's 16 axes are **LLM-prompted and product-intelligence-
specific** (market reality, financial architecture, UX principle) — reusing
them for generic corpus corroboration would be a category error, not a
shortcut. This module takes the *shape* — parallel reads → adversarial
cross-check → named dissent — and rebuilds it as **deterministic, testable
machinery** with no LLM in the loop, for a different job: scoring whether
independent sources actually back a claim up.

## The honest distinction this exists to protect

Agreement across sources is **corroboration**, not **grounding**. Multiple
texts agreeing is still text — it can mean independent confirmation, or it can
mean an **echo**: the same author, the same lab, one paper citing another in a
closed loop. `convergence()` refuses to count an echo as corroboration by
construction: sources are grouped by **origin** (author/paper), and only
**cross-origin** agreement contributes to the convergence index. Same-origin
pairs are skipped outright — not down-weighted, **skipped** — so three chunks
of one paper repeating itself score `convergence_index = 0` no matter how
similar the text is. This is the same discipline as the grounding gate
(`harmonic-coherence.ts`): consistency ≠ correspondence, now applied to "many
documents agreeing with each other" ≠ "independently confirmed."

## The five tiers

| tier | what happened |
|---|---|
| `no_sources` | nothing in the corpus was relevant to the claim |
| `single_source` | exactly one relevant passage — nothing to corroborate it against |
| `echoed` | multiple relevant passages, but all the **same** origin — a voice repeating itself |
| `corroborated` | 2+ **distinct** origins, real cross-origin agreement, no named dissenter |
| `contested` | 2+ distinct origins, but a dissenter is named, or overall cross-origin agreement is too weak to call it settled |

Every case is checked by test, including the load-bearing one: three identical
chunks from **one** origin land on `echoed` with `convergence_index = 0`, and
adding a duplicate of an already-counted origin to a genuinely independent pair
**cannot** move the tier — the engine can't be gamed by citation volume from a
single source.

## The Rupture, kept honest — dissent is named, not hidden

When independent origins disagree, the diverging source is named in
`dissent[]` with its origin, not folded silently into an average. A
documented, real limit: this is **bag-of-words topical agreement**, not logical
negation-detection. A source saying *"this architecture has nothing to do with
any golden ratio"* still **shares the keywords** with sources that affirm the
golden ratio, and will lexically score as agreeing. The engine detects whether
sources are talking about the same *thing* with the same *vocabulary* — it does
not understand that one of them is disagreeing in English. That's a stated
scope boundary, not a hidden bug (the self-test's dissent fixture uses a
genuinely different-vocabulary source for exactly this reason).

## Wired into `reason()` — the third independent axis

`reason(title, segments, profile, { sources, claim })` computes `corroboration`
alongside `modality` and `confidence` — and reports it **separately**, on
purpose. Corroboration never inflates the modality-driven grounding ceiling: a
text-only run with two independently-corroborating corpus sources still
ceilings at `consistent_only`, because agreeing text is still text, not a
world-coupled channel. Three different kinds of evidence — structure (can the
graph be built), grounding (world-coupled channels: audio/vision), corroboration
(independent-origin textual agreement) — reported as three honest, never-merged
numbers.

## Reasoning with the real corpus

`src/corpus-reasoning.ts` is the impure edge: `corpusSourcesFor(env, claim,
limit)` runs the same Vectorize-query + D1-join shape as `index.ts`'s
`ragSearch`, but returns **structured, per-paper** sources (needed because
corroboration has to know which passage came from which independent origin) —
fail-soft to `[]` on any retrieval trouble, same posture as the rest of the
corpus pipeline. `reasonWithCorpus(env, claim, limit)` retrieves real passages,
builds the derivation/recognition graph **from the retrieved corpus text
itself**, and reports corpus corroboration on top. `POST
/api/elle-reason-corpus { claim, limit? }` runs it end to end.

**Origin honesty, stated plainly:** "origin" is the paper (`paper_id`) — the
closest robust proxy for independence this schema carries. Two chunks of the
same paper are obviously not independent; two different papers by the same
author, or one paper citing another, are still counted as independent here,
because `convergence.ts` can only see the text in front of it, not a citation
graph or an author registry. That is a real, stated limit on what "independent"
means in this system — not a hidden one.

## Not yet wired: every chat turn

The per-turn reasoning pass in `router.ts` runs `reason()` on every turn, but
does **not** call `reasonWithCorpus()` automatically — hitting Vectorize + D1 on
every single message is a real latency/cost decision, the same category of
choice that keeps `deep_research` off the unauthenticated `public` door. Corpus
reasoning is available as a deliberate call (`reasonWithCorpus`, the
`/api/elle-reason-corpus` endpoint, or a future router tool), not a silent
per-turn cost.

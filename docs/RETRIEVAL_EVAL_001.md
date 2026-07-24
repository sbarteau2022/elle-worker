# Retrieval Eval 001 — golden-set design

Status: **spec only, no scoring run yet.** This document defines the format
and methodology; the actual 20-question golden set still needs to be
written (see "Who writes the questions" below), and the harness that runs
it needs `docs/RETRIEVAL_CONTRACT.md`'s Phase 1 plumbing to have actually
run against the live corpus first. Held uncommitted-to-a-PR until the
`paper_id`-in-trace plumbing (the natural next piece) is ready, so both can
land together per this repo's PR discipline (`CLAUDE.md`).

## Why this isn't the plan's original §2.4 design

The port plan's original metric was "does the correct document appear in
top-3 for old vs. new retrieval." That conflates two different things, and
a 2026-07-24 conversation about how sourcing should actually surface in
the product split them apart:

1. **Evidence traceability** — did retrieval pull in the right source
   material at all. Checked against the **tool trace** (`search_corpus`/
   `find_document` observations in `RouterResult.trace`, or the durable
   `elle_events` record via the `provenance` tool) — never against the
   prose answer.
2. **Answer quality** — does the fluent answer reflect that material
   without contradicting it. The framework/paper name is deliberately
   **not required to appear in the answer** — Elle should reason through
   the content, not cite it like a bibliography. The chat UI's existing
   "chain of thought" panel (`EllePanel.tsx`) is where a user goes to see
   what was actually read; that's the traceability surface, not the prose.

And "the correct document" becomes **"the correct evidence set."** Several
of the corpus's papers are versioned lineages (`TheSuperposition` v1→v4,
`TheThreshold` v1→v3 — see `corpus-lineage.ts`, which already tracks these
families via a `supersedes` edge, just not wired into retrieval yet). A
question that's genuinely about the *idea*, not a specific revision, should
accept any paper in the right lineage — forcing a single "correct" version
where the corpus itself doesn't have one would just make the eval noisy.

## Golden question format

```jsonc
{
  "id": "gq-01",
  "query": "What grant deadlines are coming up that we need to act on?",
  // ANY ONE of these appearing in the trace = pass. List by title (or
  // paper_id once the plumbing lands) — lineage-aware, not single-doc.
  "acceptable_sources": ["Grant Strategy Map — Funding Architecture"],
  // Appearing as the DOMINANT/first-cited evidence = fail. This is the
  // actual discriminator — a near-miss the corpus can plausibly confuse.
  "wrong_lineage": ["The Grant Intelligence Engine (v_spec, March 2026)"],
  "check": "trace",   // always trace, never the prose answer
  "rationale": "Both documents are dense with the same grant/funder/deadline vocabulary, so naive semantic retrieval can plausibly confuse them. Only the strategy map has an actual calendar (real dates, real dollar figures); the engine spec describes the CAPABILITY to track deadlines, generically, for other organizations. A retrieval that can't tell 'a spec describing a deadline-tracking feature' from 'an actual deadline' isn't reading for meaning."
}
```

Fields:
- `query` — phrased the way a real user would actually ask. **Hard rule:
  the query may not name the paper or framework it's testing for.**
  `"What does Superposition v4 say about X"` tests nothing — the title's
  already in the query, so any retrieval that echoes it back "passes" for
  free. The question has to be about the *idea*, worded so that finding
  the right paper requires understanding what's IN it, not string-matching
  the query against a title.
- `acceptable_sources` — a set, not a singleton. Include every paper (or
  every version in a lineage) that would genuinely satisfy the question.
- `wrong_lineage` — the near-miss set: papers that share surface vocabulary
  but would represent a real confusion if retrieval leaned on them as the
  primary evidence. This is optional but is where most of the eval's real
  signal comes from — a question with no plausible near-miss barely tests
  anything.
- `check` — always `"trace"`. Never score against the answer's prose.

## Worked example (built from real corpus content, not a placeholder)

The pair above — `corpus/engines/03-grant-intelligence.md` (the *Grant
Intelligence Engine* product spec) vs. `corpus/business/grant-strategy-map.md`
(Stewart's own confidential funding pipeline: real deadlines, real dollar
figures, real named opportunities like the SSG Fox Suicide Prevention Grant
and the MTC IDEA Fund) — is a genuine near-miss I verified by reading both
files, not a fabricated example. They share enough vocabulary (grant,
foundation, funder, deadline, opportunity) that a retrieval system relying
on keyword/surface similarity could easily pull the wrong one; only reading
for *what kind of document this is* (a capability spec vs. an actual
calendar) resolves it correctly.

That's the bar for all 20: a real near-miss pair from the actual corpus,
not two unrelated documents where any retrieval would trivially succeed.

## Scoring

Per question: **PASS** if the trace contains ≥1 `acceptable_sources` entry
AND no `wrong_lineage` entry appears as the dominant (first-cited, or
highest-scored) source. Run the same 20 questions through both legs:

- **Old**: today's plain Vectorize top-K (`ragSearch()` / `search_corpus`)
- **New**: Phase 1's contextual pipeline (`src/retrieval/pipeline.ts`'s
  `retrieve()`), once the re-embed has actually run

Ship gate, unchanged from the original plan: new ≥ old on ≥16/20, and
strictly better (not just tied) on ≥5.

## Harness sketch (not yet built)

A script/route that, per golden question:
1. Calls `runRouter(query, env, deps, {scope: 'member', ...})` (or the
   narrower `retrieve()` pipeline directly, once contextual retrieval is
   live) and captures the trace / `search_corpus` observations.
2. Extracts cited titles from the trace text (today: literal substring
   match against `[title — series]`, since `ragSearch()` already emits
   that; once `paper_id` flows through the trace — see the plumbing work —
   match on id instead of title text, which is exact rather than fuzzy).
3. Applies the PASS rule above.
4. Aggregates old vs. new, writes the ship-gate verdict.

Building this is cheap once the questions exist; deliberately not built
blind ahead of them.

## Who writes the questions

Per the original plan, and confirmed in the 2026-07-24 conversation that
produced this redesign: the 20 questions are human-authored, not
fabricated. They need real knowledge of the corpus's content — not just
titles — to find genuine near-miss pairs the way the worked example above
does. This doc's job is to make writing them mechanical once you have the
pairs in mind: query, acceptable set, wrong-lineage set, one-line
rationale.

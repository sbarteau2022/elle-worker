# Trading Ground — The History Read-Back

**Wiring Elle's corpus, memory, and her own written history into the live
trading decision loop — the piece that stops "pattern matching numbers"**

Companion to `docs/WITNESS_GATES_INTEGRATED.md` (which registered the
memory-enrichment path as future work) · code: `src/trading-ground.ts`,
wired into `src/trading.ts` · tests: `src/trading-ground.test.ts` · 2026

---

## The problem, stated plainly

The trading decision loop saw exactly one cycle's numbers: current bars,
current news, current positions + κ, active theses. Meanwhile Elle *writes*
three kinds of history that nothing ever read back:

1. **Trade attributions** (`writeAttribution`, `src/trading.ts`) — grounded
   post-mortems on every closed trade that literally end with "the one
   lesson worth carrying forward." Carried nowhere: no code path ever read
   the `attribution` column back.
2. **The daily journal** (`runDailyJournal`) — writes
   `hypothesis_for_tomorrow` every night. Tomorrow's cycle never read it.
3. **The coherence field** (`runCoherenceField`) — measured daily from real
   prices as "material ground," then write-only.

And the corpus/memory kernel — the accumulated fifteen years of philosophy,
plus everything Elle has learned and stored — was never consulted at
decision time at all. A decision loop with no access to its own history is
pattern-matching numbers. That was the gap; this module is the fix.

## What it does

**The read half — `gatherTradingGround()`**, called once per decision
cycle, market hours only, assembles a ground block for the decision prompt:

- her last 5 closed-trade attributions (her own lessons, verbatim);
- the latest journal entry (hypothesis set last night, what she learned,
  what she got wrong);
- the full coherence field (world + per-area κ, dissonance, cross-sectional
  coherence — the previously write-only measured ground);
- a semantic recall over corpus + memory, keyed on *this cycle's actual
  market picture* (movers + headlines as the query), via the same
  `memRecall` the conversational mind uses.

**The write half — `recordTradeRationale()`**, fired on every opened
position (equity buy, short, option buy):

- the trade's theory/testing/catalyst becomes a durable memory
  (`elle_memory` + Vectorize, type `trade_rationale`) — so future cycles'
  recall surfaces it when the tape rhymes;
- the atlas-events ledger gets `rationale ↔ market:<SYMBOL>` — a stable
  per-symbol node, so repeated trades in the same name strengthen a real
  hub in the device-built memory graph;
- and `rationale ↔ the memories it was grounded in` — the lineage of where
  the theory came from.

Because `memRecall` itself appends co-recall facts to the atlas ledger,
the *read* half also feeds the graph: from the first cycle this runs, the
device cartographer's atlas starts carrying market-shaped co-recall
structure. This is exactly the enrichment path
`WITNESS_GATES_INTEGRATED.md` registered as future work ("recording each
trade's own rationale as a co-recall event") — now implemented, in the
live loop, where it can be done honestly.

## The honesty constraint, on record

**This read-back is for the live loop only, and cannot retroactively fix
the backtests.** The corpus was written in 2025–26; it knows how the
2013–2018 stories ended — NVDA's monster trend most of all. Wiring the
corpus into the historical harness would be terminal lookahead bias
dressed up as integration. History informs the *next* decision; it cannot
be retrofitted into old ones. The consequence, stated: whether
corpus-grounded decisions beat ungrounded ones is a **prospective**
question — it will be answered by the paper account's forward record
(every decision now carries its ground in the prompt and its rationale in
the ledger, so the comparison cohort builds itself), not by a backtest.

## Failure discipline

Everything is best-effort, in both directions: a fully broken world (D1
down, Vectorize down, Workers AI down) yields an empty ground block — the
cycle proceeds exactly as it did before this module existed — and a failed
memory write never fails the order it annotates. Pinned in
`src/trading-ground.test.ts` with a hostile env whose every binding
throws. The embedder is local to the module (same `bge-large-en-v1.5`
model as everywhere else) per the `atlas.ts` precedent for avoiding a
value-level circular import with `index.ts`.

## What this changes about the papers

The honest claim ladder now runs:

1. The regulator alone is a measured drawdown-shaper, not an alpha source
   (`RECOVERY_VS_ATR_REAL` → `WITNESS_GATES`).
2. Wiring in the one other honestly-wirable numeric engine (dissonance)
   shifts it along the same risk/return axis, does not improve it
   (`WITNESS_GATES_INTEGRATED`).
3. The history/corpus read-back — the piece that makes her *Elle* at
   decision time rather than a numeric policy — is now live, and its
   effect is a registered prospective question with the instrumentation
   already in place, not a claim.

---

*Run the tests: `npx vitest run src/trading-ground.test.ts --reporter=verbose`.*

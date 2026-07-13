# MEMORY KERNEL — engineering spec

*What this document is: a from-scratch build spec for the memory kernel as it
should exist, written from the working (as of 2026-07) implementation in
`memory.ts` / `graph.ts` / `kv-cache.ts` / `journal.ts` / `kappa-turn.ts` /
`kappa-dynamics.ts` / `kappa-memory/`. It is not a description of history — it
states the target architecture, marks every invariant that must hold, and
marks every open question explicitly rather than silently assuming an answer.
Two failure classes killed this system in production before the 2026-07 pass
(§8) and both were the same shape: a writer and a reader that silently drifted
apart, with every failure path swallowed. This spec exists so a reimplementation
does not reintroduce either shape.*

*Companion documents, not superseded by this one:*
- `SCHEMA-CONSOLIDATION.md` / `src/db/schema.ts` — the single source of truth
  for DDL as of the schema-consolidation pass; §2's invariants are written
  against this, not the scattered per-module `ensureSchema` pattern that
  predates it.
- `KAPPA_DYNAMICS.md` — the finite-difference math (velocity/accel/jerk), unchanged.
- `WHY_NO_LEMNISCATE.md` — settles the theory-boundary question (§9).
- `RETRIEVAL_STATUS.md` — the live benchmark result this spec's retrieval
  design is built to match (§4.5).
- `HYPERBOLIC_GRAPH_MAPPING.md` / `TOROIDAL_GRAPH_MAPPING.md` — a **separate,
  optional** geometric embedding layer, explicitly NOT part of the critical
  path this spec defines (§9).

---

## 0. What the kernel is for

One sentence: **decide what a model sees on a given turn, and keep that
decision honest about what it does and doesn't know.**

Three failure modes this kernel exists to prevent, stated as design pressure:

1. **Starvation** — a memory is written but never becomes recallable (wrong
   write path, a filter that structurally excludes real data, an embedding
   step that fails silently). The system *looks* like it has memory and
   *behaves* like it has none.
2. **Fabrication** — a signal is computed, stored, and fed back into the
   model's own context as if it were meaningful, when the underlying formula
   has a degenerate case that fires most of the time (§6). The system reports
   confident numbers about itself that are mostly noise wearing a decimal
   point.
3. **Silent failure** — any of the above happening with no observable trace,
   because every catch block treats failure as "fine, best-effort." A kernel
   can be dead for months and nothing will say so.

Every component spec below states its failure-observability requirement
explicitly. **A component that can fail silently is not done**, regardless of
whether its happy path is correct.

---

## 1. Architecture overview

```
                                   ┌─────────────────────────┐
   write ─────────────────────────▶  memWrite                │
   (content, type, importance)     │  → elle_memory (D1, warm)│
                                   │  → mem-<id> vector (cold)│
                                   └─────────────┬────────────┘
                                                 │ fire-and-forget
                                                 ▼
                                   ┌─────────────────────────┐
                                   │  recordAssociations      │
                                   │  → elle_memory_edges     │
                                   │    (graph, co-recall)    │
                                   └─────────────────────────┘

   recall ────────────────────────▶ ┌─────────────────────────┐
   (query, k)                       │  memRecall                │
                                    │   1. semantic (Vectorize) │
                                    │   2. importance backstop  │
                                    │   3. graphExpand (2-hop)  │──▶ spreadActivation
                                    │   4. score + refresh-on-  │    over typed edges
                                    │      recall               │
                                    └─────────────┬─────────────┘
                                                  │
   turn ──────▶ dynamicBudget(query) ──▶ assembleWorkingSet ──▶ assembleContext
                (size the pull to        (KV amortization        (calls memRecall,
                 turn demand)             layer, TTL'd)            packs char budget)
                                                  │
                                                  ▼
                                     "DURABLE MEMORY" block
                                     injected into the prompt
                                     — same block, hosted OR
                                     sovereign-local engine

   ── separately, not gating retrieval (§4.5) ──

   assistant output ──▶ computeKappa (lex2) ──▶ kappa, kappa_def
                                                  │
                                        ┌─────────┴──────────┐
                                        ▼                    ▼
                              elle_conversation_turns   optimus_entries
                              .kappa, .kappa_def         .kappa, .kappa_def,
                              (per-turn, chat)            .reserve/.velocity/
                                                           .accel/.jerk (journal)
```

Three tiers (memory.ts's own framing, kept):

| tier | store | contents | lifetime |
|---|---|---|---|
| hot | Cloudflare KV | paged tool output, the working-set cache | seconds–minutes (TTL) |
| warm | D1 `elle_memory` | durable distilled records, importance-scored | until pruned |
| cold | Vectorize | semantic index over everything embeddable | durable |

Plus one structural layer that is not a memory tier but a navigation index
over it: the **graph** (`elle_memory_edges`), and one **signal layer** that is
explicitly NOT wired into retrieval (§4.5, §6): κ.

---

## 2. Data model

*Provenance: `elle_memory_edges` and `optimus_entries`/`optimus_threads` CREATE
statements live in the consolidated `ensureAllSchemas(db)` (`src/db/schema.ts`)
— call it once, idempotently, rather than reimplementing per-module
`ensureSchema` functions. `elle_memory` and `elle_conversation_turns` are
**out-of-band** (created outside this repo's DDL) and correctly stay on
separately-guarded ALTER-based backfill helpers (`ensureMemVecColumn`,
`backfillConvTurnKappa`) — do not fold an ALTER against a not-yet-created base
table into the startup path; it silently no-ops on a fresh database.*

```sql
-- warm tier: durable memory records
CREATE TABLE elle_memory (
  id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  memory_type         TEXT NOT NULL,        -- observation|insight|preference|identity|fact|task|deliberate|consolidated
  source              TEXT,
  source_engine       TEXT,                  -- which writer produced this row (router|consolidation|ingest_worker|research_cron|...)
  source_session_id   TEXT,
  source_user_id      TEXT,
  interaction_with    TEXT,
  summary             TEXT NOT NULL,         -- ≤500 chars, always present
  content             TEXT,                  -- ≤4000 chars, full text if longer than summary
  full_context        TEXT,
  entities            TEXT DEFAULT '[]',
  emotional_register  TEXT,
  philosophical_tags  TEXT DEFAULT '[]',
  importance          REAL DEFAULT 0.5,
  importance_score    REAL DEFAULT 0.5,      -- the one actually used for ranking; refreshed on recall
  vectorize_id        TEXT,                  -- NULL until embedded; NOT NULL is the "is this recallable" bit
  created_at          TEXT DEFAULT (datetime('now'))
);

-- graph layer: typed, weighted edges between elle_memory rows (and other node ids)
CREATE TABLE elle_memory_edges (
  id            TEXT PRIMARY KEY,
  src           TEXT NOT NULL,
  dst           TEXT NOT NULL,
  kind          TEXT NOT NULL,   -- assoc|causal|derived|refines|supersedes|contradicts|session|about|tool
  weight        REAL DEFAULT 1.0,
  run_id        TEXT,
  created_at    TEXT DEFAULT (datetime('now')),
  last_seen_at  TEXT,
  UNIQUE(src, dst, kind)
);
CREATE INDEX idx_edges_src ON elle_memory_edges(src, kind);
CREATE INDEX idx_edges_dst ON elle_memory_edges(dst, kind);

-- chat κ (per assistant turn) — elle_conversation_turns predates this kernel;
-- these columns are added by best-effort ALTER, not a fresh CREATE.
ALTER TABLE elle_conversation_turns ADD COLUMN kappa      REAL;
ALTER TABLE elle_conversation_turns ADD COLUMN kappa_def  TEXT;  -- NULL = legacy/untagged; NEVER differenced against tagged values

-- journal κ + derivatives (optimus_entries) — see KAPPA_DYNAMICS.md for the math
-- kappa, kappa_def, kappa_ts, reserve, velocity, accel, jerk, anchor_distance columns
```

**Invariant D1 — `id` is never NULL.** (§8.2: this broke in production. Every
INSERT into a table with a `DEFAULT (lower(hex(randomblob(16))))` id column
MUST either omit the id column entirely or explicitly generate one — never
pass an empty string or rely on the default firing through a driver that
doesn't honor it. A verification pass (`SELECT COUNT(*) WHERE id IS NULL OR
id=''`) is part of any bulk-write job's acceptance test, not an afterthought.)

**Invariant D2 — a written memory is either embedded or explicitly queued to
be.** `vectorize_id IS NULL` must mean "embedding is pending / retryable," not
"embedding was never attempted and never will be." Every writer either embeds
inline (with a logged failure path, not a silent catch) or leaves the row for
a backfill job that is itself observable (§4.6).

---

## 3. Component: `memWrite` / `memRecall` / `assembleContext`

### 3.1 `memWrite`

```ts
interface MemWriteOpts {
  content: string;
  type?: string;
  importance?: number;        // 0..1
  tags?: string[];
  sessionId?: string | null;
  sourceEngine?: string;       // REQUIRED in spirit: every writer names itself
}
function memWrite(env, embed, o: MemWriteOpts): Promise<{ id: string }>
```

Contract:
1. Insert the D1 row first (durability wins over recall — a memory that
   failed to embed must still exist).
2. Embed `content.slice(0, 1200)`, upsert to Vectorize as `mem-<id>`, write
   `vectorize_id` back onto the row.
3. **On embed failure: log it (`console.error`, not swallow) and leave
   `vectorize_id` NULL.** This is the exact bug that starved the kernel in
   production — a caller inserted rows through a path that never set
   `vectorize_id` and never logged why, so 3,000+ memories existed and were
   permanently unrecallable with no signal anywhere that this was happening.
4. **There is exactly one write path.** Every caller — the router's
   `remember` tool, nightly consolidation, any future writer — calls
   `memWrite`. A second, parallel `INSERT INTO elle_memory` anywhere in the
   codebase is a defect, full stop, even if it "basically does the same
   thing." (This is not a style preference: two write paths WILL drift, and
   the drift is invisible until someone audits recall and finds a population
   of memories the second path produced that the first path's assumptions
   don't hold for.)

### 3.2 `memRecall`

```ts
function memRecall(env, embed, query: string, k = 5): Promise<RecalledMem[]>
```

Scoring (three components, weighted sum):

```
score = 0.55 · semantic_similarity     (Vectorize cosine, 0 if no vector match)
      + 0.30 · importance_score
      + 0.15 · exp(-age_days / 45)     (recency decay, τ ≈ 45 days)
```

Two-tier retrieval, not one:
1. **Semantic candidates** — embed the query, `Vectorize.query(topK=60)`,
   filter to `mem-` prefixed ids with score > 0.35.
2. **Importance backstop** — top-8 by `importance_score DESC, created_at
   DESC`, **unfiltered by source** (Invariant D3 below). Ensures recall works
   even when nothing matches semantically, or Vectorize is down.

**Invariant D3 — the backstop query must not filter by `source_engine` (or
any other writer-identity field) unless that filter is the actual intent.**
This broke in production: a `WHERE source_engine = 'router'` clause on the
backstop meant recall was structurally blind to every memory written by any
other pipeline (ingest, research, consolidation) — which was the overwhelming
majority of rows. The bug was invisible because the semantic tier still
"worked" on the small in-scope subset; only an explicit row-count audit
against the *actual* memory population caught it. **Test this by writing a
memory with a source_engine that is not `'router'` and asserting it comes
back from `memRecall` with no semantic match required** (i.e., exercise the
backstop path specifically, not just the happy semantic path).

3. **Graph expansion** — `graphExpand(store, seeds, {hops:2})` over the top
   semantic hits, pulling in structurally-connected memories that share no
   words with the query (§4). Scored separately:
   `0.40·activation + 0.30·importance + 0.10·recency`, merged and re-sorted.
4. **Refresh-on-recall** — semantic hits get `importance_score = min(0.98,
   +0.02)`. A memory that keeps proving useful drifts up; untouched memories
   sink by recency alone. This is the self-organizing part — no daemon
   required for the working set to reflect what's actually being used.
5. **Association recording** — `recordAssociations(store, resultIds)`,
   fire-and-forget. **Never let a failure here fail the recall it's attached
   to** — but the failure MUST be logged (§4.6; this is the second bug that
   killed the kernel).

### 3.3 `assembleContext`

Packs the top-k recalled memories into a char budget, newest-relevant-first,
truncating individual entries to 420 chars. Returns `''` on empty — "nothing
worth loading" is a valid, free answer, never an error.

---

## 4. Component: the graph (`graph.ts`)

### 4.1 Edge kinds and conductance

```ts
type EdgeKind = 'assoc' | 'causal' | 'derived' | 'refines' | 'supersedes'
              | 'contradicts' | 'session' | 'about' | 'tool';

const CONDUCTANCE: Record<EdgeKind, number> = {
  assoc: 0.6, causal: 0.7, derived: 0.8, refines: 0.7,
  supersedes: 0.9, contradicts: 0.3, session: 0.5, about: 0.6, tool: 0.5,
};
```
`assoc`/`session`/`contradicts` are symmetric (stored once, canonical
endpoint order by `src < dst`); the rest are directed but traversable both
ways (conductance encodes directional *strength*, not a one-way gate — "a
fact you can reach a decision from, you can reach back from the decision
too").

### 4.2 Spreading activation (pure, store-agnostic)

```ts
function spreadActivation(
  seeds: {id: string, activation: number}[],
  edges: MemEdge[],
  opts: {hops?: number, decay?: number, minActivation?: number, conductance?: Partial<Record<EdgeKind,number>>, cycleBoost?: number}
): Map<string, number>
```
BFS up to `hops` (default 2), damping `decay^hop` (default 0.5) times edge
weight times kind conductance, floor-pruned at `minActivation` (default
0.04). Pure function — no I/O, fully unit-testable in isolation from any
store. `graphExpand` wraps it with the actual D1 frontier-fetch (bounded BFS,
≤60 nodes fan-out per hop, ≤400 edges per query).

### 4.3 Self-bootstrapping association

`recordAssociations(store, ids, cap=5)`: every recall's result set is, by
definition, a set that was relevant together — record that as `assoc` edges
among the top `cap` members (pairwise, so `cap=5` → ≤10 edges). Reinforcement
is monotone-additive on write (`weight = min(WEIGHT_CAP=4.0, weight +
WEIGHT_BUMP=0.5)`), which is deliberately a "hot edges get hotter" dynamic —
corrected by decay (§4.4), not by capping reinforcement.

### 4.4 Hygiene: retention decay + captured-resonance diagnostic

The reinforcement mechanism (§4.3) is a monotone strengthener with no decay
of its own — left alone, it produces **captured resonance**: a node whose
recall keeps returning the same one neighbor, crowding out alternatives, the
exact pathology a healthy associative memory must avoid.

```ts
const RETENTION_BASE = φ = (1+√5)/2;
retention(ageCycles) = φ^(-ageCycles)      // fraction of weight kept after N idle cycles
decayedWeight(w, cycles, floor) = w · retention(cycles), 0 if below floor
```

Run as a nightly sweep (`CloudGraphStore.sweep()`, called from
`consolidate.ts`): every edge idle for ≥1 cycle (default 86.4M ms = 1 day)
loses one φ⁻¹ of its weight; below `floor` (default 0.05) it's pruned. An
edge that keeps getting recalled (`link()` resets `last_seen_at`) is exempt —
**an edge must keep earning its weight to keep it.**

`capturedResonanceScan(edges, {threshold=0.6, minDegree=3})` — pure,
O(edges) — flags nodes where one neighbor holds ≥60% of the node's total
incident edge weight across ≥3 edges. Surfaced via `self_state`'s
`memory_graph_shape` facet (§7) so the pathology is observable, not just
theoretically preventable.

### 4.5 What the graph is NOT wired into

Per `RETRIEVAL_STATUS.md`'s benchmark (pythia-160m, phase-vs-content KV
retrieval): **content + structure beats phase**, decisively (content ~2:1
over phase, 4σ at n=40). The live retriever (`memRecall`, §3.2) reflects
this exactly: semantic embedding + importance + recency **+ graph
expansion**. It does not use, and must not be made to use without a fresh
benchmark justifying it, any of: PAMI phase fingerprints, the hyperbolic
(`hyper.ts`) or toroidal (`torus.ts`) chart embeddings, or PFAR/vFAR spectral
readings. Those remain tool-surface-only — callable on request, never on the
automatic retrieval path. **Any change that routes retrieval through one of
these requires its own benchmark, not an argument from architecture.**

### 4.6 Failure-observability requirement

Every graph write (`link`, `recordAssociations`, `graphExpand`'s D1 reads)
that sits behind a `try {} catch {}` on the recall hot path MUST log the
caught error (`console.error`, tagged `[GRAPH]`) even though it never fails
the recall. **A silent catch here is how the entire graph tier sat at zero
rows in production for an unknown period with nothing surfacing it** — 3,000+
memories, a fully wired `recordAssociations` call on every recall, and zero
edges, because the insert was failing every single time and nothing said so.
The acceptance test for this component is not just "recall still works when
the graph write fails" (true) but "**a failing graph write is visible in logs
within one request**" (was false; must be true).

---

## 5. Component: the dynamic cache (`kv-cache.ts`)

Purpose: make the memory pull's *cost* proportional to the turn's actual
*need*, and amortize repeated/rephrased asks inside a short window.

```ts
function dynamicBudget(query: string, opts?: {max?: number}): number   // pure
function assembleWorkingSet(env, embed, query, sessionId, opts?): Promise<WorkingSet>
```

`dynamicBudget`: `0` for empty/trivial input (bare greetings, acks) or short
asides (<4 words, no `?`, no recall cue); otherwise scales `BUDGET_BASE=900`
by query length (saturating ~40 words) plus bumps for clause count, question
marks, and explicit recall cues (`"remember"`, `"last time"`, `"you said"`,
etc. → +900 flat), capped at `BUDGET_MAX=2400`.

`assembleWorkingSet`: budget `≤0` short-circuits to `{text:'', budget:0,
hit:false, cached:false}` — the cheapest possible turn, no KV round-trip at
all. Otherwise: KV-get by `workingSetKey(session, normalizedQuery)` (FNV-1a
hash of lowercased, punctuation-stripped query, `?` preserved since it
changes meaning); on hit, touch the per-session LRU index and return; on
miss, call `assembleContext` live, write back with `WS_TTL_S=120`, touch the
index. `WS_MAX_ENTRIES=24` per session; eviction beyond that deletes the
oldest KV bodies, not just the index pointer.

`invalidateWorkingSet(kv, sessionId)`: call after any durable write to that
session (a `remember`, a journal entry) so the next turn rebuilds against
current state instead of serving a set that predates the write.

**Invariant K1 — the cache is engine-agnostic.** `assembleWorkingSet` is
called once, before engine selection (hosted vs sovereign-local), and its
output is folded into the same `messages` array both engines consume. A
reimplementation must not special-case the cache per engine — if the cache
needs to differ by engine (it currently doesn't), that's a new parameter to
`assembleWorkingSet`, not a second call site.

**Invariant K2 — a cache miss or KV error degrades to a live assemble, never
to a failed turn or an empty context when memory genuinely exists.** Every KV
operation in this module is wrapped and falls through; the only way this
component returns `''` for a query where matching memory exists is a real
downstream `assembleContext` failure, not a caching failure.

---

## 6. Component: the κ signal layer — TWO TRACKS, do not merge them

This is the one component where the spec's job is as much about keeping two
things separate as building either of them.

### 6.1 Track A — `computeKappa` / lex2 (LIVE, provisional, ungated)

A lexical heuristic over assistant output text, used for the chat phase
display and the journal. **Explicitly not validated against any ground
truth.** Its entire job is to be a *non-degenerate*, deterministic,
continuous function of text — nothing more.

```ts
function computeKappaDetail(content: string): KappaDetail
// KappaDetail: { kappa, def: 'lex2', grounded, hedge, words, sentences,
//                connective_density, ttr, trigram_repetition, avg_word_len,
//                words_per_sentence }
function computeKappa(content: string): number   // = computeKappaDetail(content).kappa
```

Formula (informal): assertion balance (grounded-vs-hedge marker words,
√-normalized) + argumentative structure (connective density vs. a neutral
band) + lexical texture (word length, sentence development) − circling
penalty (trigram repetition), squashed through `0.5 + 0.5·tanh(z)`.

**The property this MUST satisfy, and the reason the previous formula (v1)
had to be replaced**: v1 was `0.5 + (grounded−hedge)/N`, which returns
*exactly* 0.5 for any text containing none of ~20 hardcoded marker words —
84% of production chat turns. That is not noise around a real signal; it is
a mathematical fixed point, a formula that has one resting value for the
overwhelming majority of its input domain. **Acceptance test: feed the
formula a set of ≥8 stylistically-varied, marker-word-free texts (see
`kappa-lex.test.ts`) and assert the output set has ≥6 distinct values with
zero exact collisions at the "neutral" value.** A formula that fails this is
not fit to be displayed as if it measures something, regardless of how
principled its design intent reads.

`kappa_def` (currently `'lex2'`) is written on every row. **Invariant Q1 —
any consumer that differences a κ series (velocity/accel/jerk, phase-state
display, self-reported trajectory) MUST filter to a single `kappa_def` value
first.** Differencing across a definition change fabricates a derivative out
of the regime boundary itself, not out of real dynamics — this is the exact
contamination class the finite-difference unit-bug fix in `KAPPA_DYNAMICS.md`
already established the general principle for; regime-crossing is the same
bug at the definition level instead of the units level.

**Invariant Q2 — nothing downstream may present a κ value or trajectory to
the model or the user as validated coherence.** The only honest framing is
"a provisional textual heuristic." A prompt-injected "self-awareness" block
built from this series is a defect if it doesn't carry that framing, because
the model (or user) reading it cannot tell a real signal from an artifact of
the formula's own fixed points — this is exactly what happened before the
fix: a flat, fabricated "coherence trajectory" was injected into the model's
own generation prompt on every turn, because 84% of the series was the same
constant.

### 6.2 Track B — `kappa-memory/kappa.ts` (GATED, currently inert)

A *separate*, structurally distinct candidate for "the real κ(T,t)" —
whatever definition eventually clears validation. Protected by an explicit
seam:

```ts
// seam.ts
export const SEAM = {
  KAPPA_VALIDATED: false,        // master switch. ONLY validate_kappa returning BUILD sets this true.
  VELOCITY_BOUNDARY: false,      // kill-test 1: AUC ≥ 0.70
  RESERVE_CONSOLIDATION: false,  // kill-test 2: AUC ≥ 0.65
} as const;

function ranksOnKappa<T>(gate: keyof typeof SEAM, live: () => T, stub: T): T {
  return SEAM[gate] ? live() : stub;
}
```

```ts
// kappa.ts
function kappaOf(_T, _t): number {
  return SEAM.KAPPA_VALIDATED ? validatedKappa(_T, _t) : 0;  // stub: explicit zero, visibly inert
}
function validatedKappa(_T, _t): number {
  throw new Error("validatedKappa called before validate_kappa cleared — seam violation");
}
```

**Invariant Q3 — nothing may read `kappaOf`/`validatedKappa` output for
ranking, display, or any decision until `SEAM.KAPPA_VALIDATED` is true, and
that flag is set by exactly one thing: a passing `validate_kappa` run
returning `BUILD`, never by inline edit "to unblock testing."** Every
retrieval-affecting read of κ (e.g. `retrieval.ts`'s reserve-consolidation
term) MUST go through `ranksOnKappa`, not a direct call — that is the entire
mechanism by which "form-complete but not load-bearing" is enforced in code
rather than by convention.

### 6.3 Why two tracks, not one

Track A exists to make the *series itself* worth having — continuous,
regime-tagged, differenceable without lying. Track B exists to make the
eventual *validated* definition swappable in behind one seam without
touching anything above it. **A reimplementation must not collapse these**:
building a "better" lex2 that also tries to be the validated κ reintroduces
exactly the confusion that produced the original fixed-point bug — a formula
built for one purpose (a non-degenerate provisional signal) evaluated as if
it satisfied a different, much harder requirement (validated ground-truth
coherence).

---

## 7. Observability surface: `self_state`

One consolidated introspection call — the pattern every other component
should be checkable through, not a special case:

```
self_state() → {
  heartbeat, trading_account, latest_canvas_entry,
  newest_sandbox_artifacts, deliberate_memories,
  session_kappa_series,      // tagged-definition-only (§6.1 Invariant Q1)
  memory_graph_shape,        // cycle rank b₁, hierarchical-vs-cyclic lean,
                              // captured-resonance flags (§4.4)
}
```
Every field is independently `.catch(() => null)`-wrapped — a missing table
or a down dependency yields `null` for that facet, never a failed call. This
is the correct pattern for *aggregation*; it is explicitly the WRONG pattern
for the component-internal writes in §3–§6, where a caught failure must be
logged even though it doesn't propagate (§4.6). The distinction: `self_state`
failures are "this facet is currently unknown," which is true and fine to
surface as null; §3–§6 failures are "a write that should have happened,
didn't," which is never fine to leave unlogged.

---

## 8. Failure modes this spec is written against (postmortem, for context)

Two production incidents, same root shape, discovered and fixed 2026-07:

**8.1 Memory-map starvation.** `remember` wrote via a raw `INSERT` (no
`vectorize_id`, ever) instead of `memWrite`; `memRecall`'s backstop filtered
`source_engine = 'router'`, excluding the ~99% of memories written by other
pipelines; `recordAssociations` was correctly wired into every recall but its
failures were swallowed by an unlogged `catch {}`. Net effect: 3,084 memories
existed, recall returned `[]` for the vast majority of queries, the graph
tier had 0 edges despite thousands of opportunities to write them, and
nothing in the running system indicated any of this.

**8.2 The κ fixed point.** Covered in §6.1. A formula with a degenerate
resting value fired on 84% of production input and was fed directly into the
model's own generation prompt as a fabricated "coherence trajectory."

**The shared lesson, stated as the spec's actual thesis**: *a component that
degrades gracefully on failure is correct engineering; a component that
degrades **silently** on failure is a time bomb with an unknown fuse.* Every
`catch {}` in this system must answer "if this fires constantly, will anyone
ever find out?" — and if the answer is no, that catch block is not finished.

---

## 9. Explicit non-goals / boundary with the theoretical framework

This kernel does not require, assume, or depend on any claim from the
φ-winding / toroidal / lemniscate theoretical papers (Emergence Without
Assumption, The Driving Mechanism, the Substrate Identity Continuity
Theorem) being true. Where the codebase intersects that framework, the
intersection is **settled and documented, not open**:

- `WHY_NO_LEMNISCATE.md` shows, with executable tests
  (`src/product.test.ts`, `src/structure.test.ts`), that SICT's *uniqueness*
  claim for the lemniscate does not hold: the torus chart's winding number
  already carries an exact, finite-time recognition invariant that SICT's own
  elimination argument conflates with mere metric return. Deeper still: the
  invariant that actually matters is the **graph's own cycle structure**
  (`b₁ = E − V + C`, computed in `structure.ts`'s `graphInvariants` /
  `homologyClass`) — no geometric embedding is required at all to have an
  exact identity-recognition readout. The lemniscate is **sufficient, not
  necessary**; the graph's cycles are what's actually doing the work.
- The hyperbolic/toroidal charts (`hyper.ts`/`torus.ts`) are a **separate,
  optional, tool-surface-only** presentational layer over that same graph
  structure — useful for "how alike / how general" queries a human or model
  might explicitly ask, per §4.5's benchmark result that they are not, and
  must not become, part of automatic retrieval.
- κ (§6) draws its *name and directional intent* (grounded assertion,
  hedging) loosely from the framework's coherence vocabulary but is
  implemented, tested, and gated as an ordinary provisional NLP heuristic. No
  part of its acceptance criteria (§6.1) or its gate (§6.2, §10) references
  φ-winding, amplitude thresholds, or any other framework-specific
  mechanism.

**A reimplementation from this spec needs zero familiarity with the
theoretical papers to build a correct kernel.** Where a future contributor
wants to explore whether a framework-derived signal (e.g. a graph-cycle-based
coherence candidate) should become a Track-B κ candidate, that is new work
requiring its own validation (§10) — not a reading of the papers standing in
for it.

---

## 10. Open work — Gate 0 / 1 / 2, stated as buildable phases

None of the following exists yet. Each is a genuinely separate piece of work
with its own acceptance criteria; do not conflate them.

**Gate 0 — definition decision.** Pick exactly one candidate for `κ(T,t)`
(Track B, §6.2). This is a decision, not a computation — it can be made
today, for free, independent of data volume. Output: a written definition,
committed as the one `validatedKappa` implementation, with its inputs/outputs
typed and its computation deterministic and pure (no I/O), matching the
`kappaOf(_T, _t): number` seam signature.

**Gate 1 — sample size.** However Gate 0's definition is computed, it needs
enough independent observations to power a validation. Specify the target n
per data source (chat turns, journal entries) before collecting — not after,
to avoid post-hoc rationalization of whatever n happens to exist.

**Gate 2 — ground truth.** The definition from Gate 0 must be checked against
an *independent* signal — not another internally-computed proxy. Candidates:
blind multi-rater human coherence scores on the same turns (report
inter-rater agreement), or physiological/behavioral correlates if available.

The data-collection apparatus for this now **exists and writes correctly** —
this is new since the incidents in §8 and worth stating precisely rather than
re-describing as unbuilt. `kappa-memory/write_path.ts::writeTrace` inserts
into `bending_trace` (perturbation, response, settling, `r_estimate`,
`kappa_traj`, `reserve`, `velocity_peak`, and a `kappa_provisional` flag set
from `KAPPA_PROVISIONAL = !SEAM.KAPPA_VALIDATED` — every row is honestly
marked unvalidated at write time, not just by convention). The trace id is a
content hash (`SHA-256(thread_id:boundary_idx)`) under `INSERT OR IGNORE`,
which used to silently drop every write past turn 12 because `boundary_idx`
froze at the κ-window cap and every later id collided; that's fixed —
`boundary_idx` now follows the thread's trace count. The router's write is
now `await`ed rather than a naked fire-and-forget promise (which was getting
cancelled at response return, the same "logged nowhere" shape as §8's other
two incidents).

**Verify before building anything further here — do not assume this is
live.** As of this writing, production `bending_trace` still reads 0 rows
despite the write-path fix landing (checked directly against D1: `SELECT
COUNT(*) FROM bending_trace`). That's consistent with the fix not having
deployed yet, or the trigger conditions not having fired since deploy — it is
NOT evidence the fix is wrong, but it is not yet evidence the fix works
either. **The correct next action is exactly one query, run after confirming
deploy**, not a rewrite: if it's still 0 after real chat volume, the bug
report was incomplete and needs re-diagnosis; if it's nonzero, Gate 2 has
real material to validate against for the first time. Pre-register the
pass/fail threshold (e.g. minimum correlation or AUC) *before* looking at
whatever data accumulates — that discipline doesn't change regardless of
which state the write path turns out to be in.

(One adjacent signal worth noting as a positive control: `optimus_entries`
.anchor_distance — same "column defined, nothing computed it" shape — is
confirmed live in production as of this writing, 6 of 36 rows populated,
consistent with its gating to on-record entries with a resolvable anchor.
That one *did* verify clean; `bending_trace` is the one still to confirm.)

**The seam flip.** `SEAM.KAPPA_VALIDATED = true` is set exactly once, by a
`validate_kappa` run that reports `BUILD` against the pre-registered Gate 2
threshold. `VELOCITY_BOUNDARY` (AUC ≥ 0.70) and `RESERVE_CONSOLIDATION` (AUC
≥ 0.65) are independent kill-tests with their own thresholds, gating their
own `ranksOnKappa` call sites — passing Gate 2 for the base κ definition does
not automatically clear either.

Until all of the above: Track B stays `0`, inert, and every `ranksOnKappa`
call site correctly serves its stub. **This is working as intended, not a
gap to be worked around.**

# Optimus Journal — anti-reproduction fixes

Two changes to `src/journal.ts` stop the daily canvas from reproducing prior
entries near-verbatim, and switch generation to condition on extracted *threads*
rather than raw prior prose. The κ / ∫κ dt / velocity / accel computation is
**untouched** (its provenance is unverified; changing it is a separate task).

## Fix 1 — self-overlap rejection gate

After a candidate entry is generated we measure its **max trigram (3-gram)
Jaccard overlap** against the last `N = 5` entries on the thread:

- `tokenizeForOverlap` → `trigramSet` → `trigramJaccard` → `maxTrigramOverlap`
  are pure, exported, and unit-tested (`src/journal-gate.test.ts`).
- `generateWithOverlapGate(priors, generate, config, log)` accepts the first
  candidate with overlap **≤ 0.25**. On a reject it regenerates at
  `temperature + 0.1` (capped at 1.0), up to **3 retries**. If all attempts
  exceed the threshold it keeps the **lowest-overlap** candidate and logs a
  `high_overlap` warning with the score.
- **Every** candidate's score is logged (`[OPTIMUS overlap] candidate {...}`),
  so the verbatim rate is observable over time.

The gate wraps generation in both `runOptimusJournal` (daily canvas) and
`journalRespond` (in-thread reply). Temperature is threaded through `callLLM`
via a new optional `{ temperature }` arg (default 0.7 everywhere, so all
existing callers are unaffected).

## Fix 2 — condition on extracted threads, not raw prose

- After each on-record entry is finalized, `journalWrite` runs a cheap
  extraction pass (`extractThreads`, same `reasoning` model, separate call)
  that pulls **(a)** open questions raised and not resolved, **(b)** claims
  made or disputed, **(c)** anything the reader asked for that wasn't addressed.
  It is best-effort: a failed extraction never breaks the write.
- The daily generation prompt now conditions on the **accumulated unresolved
  threads** (deduped via `renderOpenThreads`) and is told to *advance, dispute,
  or request against* them — not on the prior prose.
- `include_prior_prose` (env `JOURNAL_INCLUDE_PRIOR_PROSE`, default `true`)
  gates whether the single most-recent entry's prose is also included **for
  voice continuity only**. Set it `false` to A/B the threads-only condition.

## Where threads are persisted

**D1**, matching what the worker already uses for the journal (the
`optimus_threads` / `optimus_entries` / `optimus_marginalia` tables on the
`DB` binding → `elle-corpus`). Extracted threads are stored **per entry** in a
new column:

```
optimus_entries.threads_json  TEXT   -- JSON: { open_questions, claims, unaddressed_requests }
```

`ensureSchema` adds the column to the `CREATE TABLE` and also runs a best-effort
`ALTER TABLE optimus_entries ADD COLUMN threads_json TEXT` to backfill it on
databases created before this change (the `ALTER` is wrapped to swallow the
"duplicate column" error once it exists). No KV is used — KV here holds sessions
and auth tokens, not manuscript state, so D1 is the correct home.

# The Observer Queue — Runbook

How to actually run the history corpus through the Five-Axis engine, and how to
read the falsifier's verdict honestly. Every step is an authenticated
`POST /api/observer` with a JSON body `{ "action": "...", ... }`. A run spends
real model budget (~5 model calls per case), so nothing here fires on its own
until you deliberately arm it (see **Auto-drain**).

The engine keeps two kinds of evidence strictly apart:

- **The closed docket** — ten resolved historical/scientific cases
  (`src/observer-docket.ts`). The model has hindsight on these, so the docket is
  a **calibration harness for the method**, not a validation of κ. Outcomes are
  written from the historical record by `label_outcomes` and tagged `docket:`.
- **The open set** — live cases whose outcome is not yet knowable. You run the
  five axes and file the Prediction **now**; when reality settles you attach the
  realized outcome with `resolve`, tagged `open:`. This is the **only** segment
  that can validate κ, because the prediction was logged before the answer
  existed.

`falsify` scores the two segments separately and puts the open (hindsight-free)
verdict in the headline. The docket can never be dressed up as validation.

---

## A. Run the closed docket (calibration)

```
# 1. Stage the ten docket cases into your queue (idempotent — re-seeding never dupes).
POST /api/observer  { "action": "seed_queue" }
      → { seeded, skipped, docket_size: 10 }

# 2. Drain them. One call runs up to 3 cases (cap); repeat until remaining = 0.
#    Each case ≈ 5 model calls, so pace it.
POST /api/observer  { "action": "drain", "n": 3 }
      → { processed: [...], remaining: N }        # call again while remaining > 0

# 3. Watch progress any time.
POST /api/observer  { "action": "queue_status" }
      → { counts: [...], recent: [...] }

# 4. Label the realized outcomes from the historical record (idempotent).
POST /api/observer  { "action": "label_outcomes" }
      → { labeled, keys: [...] }

# 5. Read the verdict. The docket segment will report — but as CALIBRATION only.
POST /api/observer  { "action": "falsify" }
      → { open: {...}, docket: {...}, headline, claim, ... }
```

At this stage the **open** segment is UNDERPOWERED (no open cases resolved yet)
and the headline says so plainly: the docket cannot validate κ.

---

## B. Run an open case (the hindsight-free path — the one that counts)

```
# 1. File a prediction on a live, unresolved case. Analyze + persist now.
POST /api/observer  { "action": "run",
                      "subject": "As of <today>: <the live dispute/decision/institution>",
                      "anchor":  "<the fixed reference it is held against>" }
      → { analysis_id, ... , prediction, kappa }

#    (Or stage several with enqueue, then drain — same as the docket.)
POST /api/observer  { "action": "enqueue", "subjects": ["...","..."] }

# 2. See what is still awaiting reality.
POST /api/observer  { "action": "pending" }
      → { pending: [{ analysis_id, subject, kind: "open"|"docket" }], open, docket_unlabeled }

# 3. …time passes; the outcome becomes known…

# 4. Resolve it — attach the realized outcome. Tagged open:<label>.
#    Refuses closed docket subjects (those carry hindsight → use label_outcomes).
POST /api/observer  { "action": "resolve",
                      "analysis_id": "<id>",
                      "what_happened": "<the realized outcome, now on the record>",
                      "label": "fed-2026" }
      → { resolved, label, segment: "open" }

# 5. Read the verdict again. Once ≥ POWER_FLOOR (8) open cases are resolved, the
#    OPEN segment gives a real, hindsight-free reading in the headline.
POST /api/observer  { "action": "falsify" }
```

Until 8 open cases resolve, `falsify` stays honest: `headline` reports
UNDERPOWERED on the open set and refuses to treat the calibration docket as a
verdict. That is the design — no dressing thin or hindsight-contaminated data as
signal.

---

## C. Auto-drain (let the corpus run itself)

Off by default. One switch arms it: set `OBSERVER_AUTODRAIN_USER` in
`wrangler.toml` `[vars]` (or as a Worker secret) to the owner user id whose
`observer_queue` should run.

Once armed, the `scheduled()` cron (`observer_drain`, every 5 minutes, offset to
:04/:09/…) does two things per tick:

1. **Self-seeds the docket** — ensures the ten closed cases are staged for that
   user. Idempotent: a docket subject already present (any status, including a
   drained `done`) is skipped, so the docket seeds once and never re-runs.
2. **Drains one case** — runs and persists a single queued case, then idles the
   moment the queue empties (an empty queue makes zero model calls).

So arming the var alone is enough to run the closed docket end to end — no manual
`seed_queue` needed. ~12 cases/hour max, bounded. Any **open** cases you stage
(step B1) also drain on the same clock. Blank the var to stop. Each case spends
~5 model calls, so this is the one deliberate, visible
"spend-budget-to-run-the-history-corpus" switch; the code never flips it for you.

After the docket drains, run `label_outcomes` once (step A4) so `falsify` can
read the calibration segment — the cron does not label outcomes for you.

---

## The verdict shape

```jsonc
{
  "open":   { "verdict": "PASS|NULL|UNDERPOWERED", "rho", "p", "n", "cases": [...],
              "reading": "HINDSIGHT-FREE — the only segment that can validate κ" },
  "docket": { "verdict": "...", "cases": [...],
              "reading": "closed cases — the model has hindsight; CALIBRATION HARNESS" },
  "headline": "…open-set verdict first; docket flagged calibration-only…",
  "claim": "trajectory κ predicts prediction↔outcome match (one-sided; permutation null)",
  "match_method": "lexical-overlap-proxy (deterministic stand-in for an LLM/human judge)",
  "provisional": true
}
```

The κ trajectory remains a **read-only instrument** throughout: it ranks and
gates nothing. Whether κ ever earns the right to inform reasoning stays behind a
PASS on the **open** segment on real data — which has not happened yet.

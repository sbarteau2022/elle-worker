# κ dynamics — real-time derivatives (dt = 1 step)

Adds first/second/third derivatives of κ (velocity, acceleration, jerk) to the
chat path and the journal, computed with **finite differences, dt = 1 step** —
never wall-clock time. The old derivatives were `Δκ/dt` with `dt` in seconds
(~86,400), which made velocity and acceleration structurally ~0; that unit bug
is fixed here. The κ formula itself (`computeKappa`) is unchanged — only what it
is fed (output only) and how it is differenced.

## Shared module — `src/kappa-dynamics.ts`

One module, imported by **both** the chat path and the journal, so the math is
identical:

```
velocity     = κₙ − κₙ₋₁                  (1st diff, needs ≥2 points; else null)
acceleration = κₙ − 2κₙ₋₁ + κₙ₋₂          (2nd diff, needs ≥3 points; else null)
jerk         = κₙ − 3κₙ₋₁ + 3κₙ₋₂ − κₙ₋₃  (3rd diff, needs ≥4 points; else null)
reserve (∫)  = Σκ                         (per-step sum, dt=1; DISPLAY ONLY)
```

`null ≠ 0`: a derivative is `null` when there aren't enough prior points to form
it, and `0` only when the real difference is zero. The module never coerces
`null → 0`, and reserve is never fed into a derivative.

Unit tests (`src/kappa-dynamics.test.ts`, run with `npm test`) include the two
required cases: a constant κ series gives velocity/accel/jerk = 0 where defined
(`[null,0,0,0]` etc.), and the historical series `0.487 → 0.500 → 0.500 → 0.500
→ 0.500` returns per-step velocity `[null, 0.013, 0, 0, 0]`.

## Chat path

`src/kappa-turn.ts` wraps the module with the worker I/O: it reuses
`computeKappa` fed the **model output only**, maintains the per-session κ series
in `elle_conversation_turns.kappa` (a best-effort `ALTER ADD COLUMN`), and
returns one `KappaPoint` per assistant turn. Wired into both chat callsites —
`handleConversation` (`/api/chat`, `/api/elle-conversation`, widget) and the
router's `finish()` (`/api/elle-router`) — and returned to the client as
`kappa_dynamics` on the response. A step = one chat turn.

The dev console renders it as a discrete one-line readout above the conversation
(`src/KappaHeader.tsx` in elle-dev-console): `κ · v · a · j · ∫`, mono, muted,
`—` for null, updating live per turn.

### Where `input_perturbation` is wired

**Wired** (not stubbed). In `src/kappa-turn.ts`, `input_perturbation` is the
**cosine distance between the embedding of the current user turn and the
embedding of the immediately prior user turn**, using the worker's existing
`embed` (Cloudflare Workers AI `@cf/baai/bge-large-en-v1.5`). It exists so that
output-κ change can later be separated from input-driven change. It is `null`
(never silently omitted) when there is no prior user turn or embedding is
unavailable, and the whole computation is best-effort so it can never fail the
answer.

## Journal path

`src/journal.ts` now derives `velocity`/`accel`/`jerk` from the thread's κ
series with the same module (dt = 1 step = one entry), and `reserve` as Σκ.
Added the `jerk` column (best-effort `ALTER`), and `journalThread` returns it so
the dev console can show acceleration and jerk on each entry's metadata line and
in the phase tabs (`—` for the first entries with insufficient history).

### Backfill

`backfillPhaseState(env)` recomputes `reserve/velocity/accel/jerk` for every
existing entry under dt = 1 (fixing the old wall-clock velocity and filling in
the new higher orders; κ itself is not recomputed). Trigger once after deploy:

```
POST /api/cron  { "job": "optimus_backfill" }   # admin-gated
```

New entries are already correct without it (reserve sums the full series), but
run it once so historical entries stop showing the old ~0 velocities.

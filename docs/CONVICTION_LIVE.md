# Built In — The Conviction Channel Goes Live

**The promotion the validation arc earned. The regulator now observes every
open position on the real trading cron.**

Companion to the validation trail: `docs/RECOVERY_VS_ATR_REAL.md` (binary exit
retired) → `docs/RECOVERY_OVERLAY_REAL.md` (overlay + asymmetric regulator,
first 4/4 sweep) → `docs/WITNESS_GATES.md` (costs, leverage, MR niche closed) ·
code: `src/conviction.ts`, wired in `src/trading.ts` · tests:
`src/conviction.test.ts` · 2026

---

## What was promoted, and as what

Six rounds of pressure testing settled the φ machinery's measured identity:
**a drawdown-shaper** — cheaper to run than the incumbent (turnover 1.37 vs
2.00), robust to 10× costs, best-in-class left tail (worst trade −0.89R vs
−1.92R), damage-halving even inside losing strategies. Not an alpha source,
not an exit signal, not an up-levering governor. It is built in as exactly
what it measured to be — nothing more:

1. **The ledger runs unconditionally.** Every open equity position carries an
   asymmetric log-odds regulator (`createAsymmetricRegulator`'s exact
   arithmetic via the pure `stepAsymmetricZ` — proven float-identical in the
   tests). One trading-cron cycle = one observation: direction is
   thesis-relative (a red bar *confirms* a short), weight is the validated
   perturbation form `w = |ret| / (2·ATR)` with the ATR an n=22 Wilder EMA of
   |per-cycle return| on the observation cadence itself — self-consistent, no
   second data feed. State persists in D1 (`elle_conviction`) between
   stateless Worker firings.

2. **The decision loop sees its own strain.** Each position line in the
   trading prompt now carries `conviction κ=… (status, target size …%)`.
   Elle can weigh it or overrule it with reasoning — it informs, it does not
   command.

3. **The trim executor is armed but GATED: `ELLE_CONVICTION_ENFORCE=on`.**
   When thrown, strained positions are reduced toward
   `entryQty · min(1, κ/0.5)` — market orders, market hours only, never on a
   symbol the decision loop already traded that cycle. Until thrown, the
   ledger records what the executor *would* have done, so the live behavior
   is auditable before a single order changes.

## The constraints, carried into the live path

- **De-risk only.** `min(1, κ/0.5)`: neutral or charged conviction ⇒ full
  size. The executor never adds, never re-buys — the Gate-2 lesson (the
  throttle that levered by vol re-amputated the tail) applied as a hard
  design bound rather than a formula to re-tune.
- **Complete failure structurally unreachable, live.** The κ floor is open
  (logistic(−3) ≈ 0.047 ⇒ size floor ≈ 9.5%), and the executor's target is
  floored at 1 unit — a hole the tests caught: `floor()` on a small position
  would have rounded the last share away. The regulator can never flatten a
  position; full exits belong to the decision loop and RULE 0 (price-space
  hard stops, outside κ entirely).
- **Single-cycle-no-collapse, at the wired surface.** One maximal shock bar
  (≥ 2·ATR against the thesis) from neutral trims ≤ 15% and cannot cross the
  strained threshold; re-earning a violation still takes ceil(φ²) = 3
  confirmations. Both re-proven in `conviction.test.ts` against the exact
  functions `trading.ts` calls, not inherited on faith.
- **Churn floor.** Trims below 1 unit or 5% of the position are suppressed —
  the Gate-1 measurement said costs are second-order *because* the overlay
  trades little; the executor keeps it that way.

## What flipping the switch changes — and what it cannot do

With `ELLE_CONVICTION_ENFORCE=on`, the worst the executor can do to a
position in one cycle is a ≤15%-of-entry trim after a genuine 2·ATR adverse
shock; sustained maximal strain walks size down toward (never to) ~9.5% over
~7+ cycles — the measured cost of that protection on 5yr real data was the
documented tail give-up (NVDA 1.26R vs 2.92R unshaped) in exchange for the
series' best left tail. It cannot open positions, add to them, flatten them,
trade options, or touch anything the decision loop handled that cycle.

## Registered next measurements (unchanged from WITNESS_GATES)

%-of-price vol for a leverage gate worth re-testing; the MR niche on a
genuinely mean-reverting universe; intraday cadences; the SHORT side of the
validated envelopes. The live ledger itself is now a data source: once
enough cycles accumulate, the shadow-vs-armed comparison can be run on
Elle's own book.

---

*Run the surface tests: `npx vitest run src/conviction.test.ts --reporter=verbose`.*

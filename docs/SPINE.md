# The Spine — Unified Falcon Decision Engine

**Three tier-collapses in order · dissent holds them · Axis 17 predicts · κ is
the same instrument that sizes a trade.**

Code: `src/spine.ts` · pure-core tests: `src/spine.test.ts` (16) · route:
`/api/spine` (member-gated) · SHADOW — gates no real decision · 2026

---

## The architecture (as specified)

```
Tier 1 fires ─▶ COLLAPSES               (collapse 1)
                 └▶ feeds Tier 2 ─▶ COLLAPSES     (collapse 2)
                                    └▶ feeds Tier 3 ─▶ COLLAPSES   (collapse 3)

DISSENT ─── holds all three. Does NOT collapse them. Observes where they
            cohere and where they split. Reports the HELD field.

AXIS 17 ─── the Future Axis. The ONLY thing that collapses the decision.
            Reads the held field + dissent → a PREDICTION.
            That prediction, gated by κ, is the decision signal across the board.
```

This **inverts** the standing Falcon (`falcon.ts`), which collapses once at the
Rupture. Here every tier earns its own collapse in proper order, and the
decision-collapse is deferred to Axis 17 — so "never collapse prematurely"
(NECAI-F Type 3) is preserved exactly where it matters: **dissent keeps the
field open until the prediction is earned.**

## The unification with κ — the point of the whole thing

**One spine run = one observation on the decision regulator.** That is the
literal parallel to one trading-cron cycle being one observation on a
position's regulator. The three tiers set that observation's:

- **direction** — does the field cohere up or down (`fieldAgreement`, the
  confidence-weighted sign coherence |Σw·d| / Σw·|d|), and
- **weight** — agreement × mean confidence, so a weak or split field barely
  moves κ.

A coherent field steps `recover`; a contested one steps `strain` — through the
**same `stepAsymmetricZ`** the trading lane uses. So:

- conviction κ = logistic(z) is **earned across repeated coherent runs, never
  one** — a single run, however coherent, cannot reach the "charged" rail
  (single-step-no-collapse, carried over and re-proven here);
- a credible dissent **reverses the sign** of the update — it doesn't dampen
  conviction, it drains it — and the underlying φ² collapse/recover asymmetry
  (trust lost ~2.6× faster than earned) is inherited from the regulator;
- the drawdown-shaper that sizes a trade and the regulator that gates a
  decision are now **the same instrument over different streams.**

## Axis 17's gate

The prediction is **always produced** (direction + confidence + κ). Whether it
is *actionable* is the gate:

```
act  ⇔  field coheres now (agreement > 0.5, no tier in dissent)
        AND conviction is charged (κ past the ~0.639 rail, earned over runs)
otherwise → HOLD  (dissent keeps the field open)
```

A contested field **holds even if κ were charged** — a tier in dissent is
never overruled by conviction alone. That is the discipline made mechanical.

## Status — SHADOW, and honestly so

The pure core (`holdField` / `dissent` / `observeField` / `axis17` /
`runSpinePure`) is fully tested — the entire decision architecture proven with
no LLM. The orchestrator (`runSpine`, `/api/spine`) fires the real Falcon axes
tier by tier and is best-effort.

**What is NOT established:** that field coherence *predicts*. κ here rides the
field's internal agreement, which is a real signal — but whether a coherent
field forecasts the outcome is the open, falsifiable question, and it is
deliberately not assumed. Axis 17's accuracy must be scored against realized
outcomes with the same pre-registration discipline the trading lane used
(RECOVERY_VS_ATR_REAL → WITNESS_GATES) before this gates anything real. The
`elle_spine_runs` ledger exists to accumulate exactly that evidence.

## What this does and does not do yet

- **Does:** run the three-collapse → dissent → Axis-17 pipeline on any
  proposition via `/api/spine` (`{action:'run', direction:'...'}`); accrue κ
  across repeated runs on the same proposition; record every run to
  `elle_spine_runs`.
- **Does not:** route any real decision — trade, message, tool call — through
  it. That promotion waits on measured predictive value, per the standing
  discipline.

---

*Run the core: `npx vitest run src/spine.test.ts --reporter=verbose`.*
*Fire it: `POST /api/spine {"action":"run","direction":"<proposition>"}`.*

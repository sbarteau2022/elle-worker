# The Coherence Field — Measured Material Ground

**Tier 1 is "Material Ground." Today it's generated (LLM prose + a number). This
is the measured replacement: real ground, computed not theorized, per area and
as a world map.**

Code: `src/coherence.ts` · pure tests: `src/coherence.test.ts` (9) · daily refresh
from the cron → `elle_coherence_field` · SHADOW · 2026

---

## The principle

Material ground is **measured or retrieved, never generated.** This is the
measured half — a coherence field over real prices, on two orthogonal axes:

- **Temporal coherence** — each instrument vs its **own** past: κ (conviction
  level, the fast clock) and dissonance (the two-clock beat). Warmed on real
  history, so κ is live, not pinned at 0.5.
- **Spatial coherence** — instruments vs **each other**: do an area's members
  move together (a coherent macro regime) or disperse (a stock-specific one).
  Cross-sectional correlation is dissonance applied across *space* instead of
  *time* — the same primitive.

## The three scales (one instrument, at every scale — the Scalar Structure axis)

| scale | what it measures |
|---|---|
| **instrument** | κ, dissonance magnitude + sign (early warning when fast strains below slow) |
| **area** (sector) | mean κ, mean dissonance (temporal aggregate — "an aggregate of the mean"); cross-coherence + dispersion (spatial: do members move as a bloc); fraction firing |
| **world map** | areas aggregated; **inter-area coherence** — do the areas *themselves* move as a bloc (risk-on/off) or decouple |

Areas: broad_market, megacap_tech, semis, energy, financials, safe_haven (liquid
ETFs + names on the IEX feed; overlapping membership is real, e.g. NVDA in semis).

## What the pure tests pin (no market data, 9 tests)

- `meanPairwiseCorr`: identical members +1, opposite −1, independent ≈ 0.
- A high-loading (common-factor) area **coheres**; a low-loading one does not —
  cross-coherence separates a bloc regime from an idiosyncratic one.
- `crossSectionalDispersion`: identical members → 0, divergent → > 0.
- `memberCoherence` warms κ **off 0.5** on a trend (stands on real history).
- `worldCoherence` detects when the **areas themselves** share one macro factor
  (inter-area coherence high).
- End-to-end `computeField` returns areas + world and drops a too-short member
  without crashing.

## Honest scope

This measures the **state and risk** of the field — where it is coherent, where
it is churning — **not its direction.** Consistent with every backtest: a
coherence/risk instrument, not an oracle. Its job is to make Tier 1 **true**,
not prophetic.

## Status & what's next

SHADOW. Refreshed daily from the cron (guarded on "not updated today"); writes
`elle_coherence_field` (area rows + a world row). Gates nothing yet.

**Next step (explicit):** wire the spine's **Tier 1 to READ this field** instead
of generating its ground — the LLM's job collapses from *inventing* market
reality to *reading the instruments*. That's a separate, measured step: the field
must populate live first, then Tier 1 consumes it. This PR ships the ground; the
next connects it.

The other half of the material ground — the **historical precedent library**
(~280 outcome-labeled events, so the *first numbers* trace to real base rates) —
remains to be built. This measured field is the *present* ground; that corpus is
the *prior* ground.

---

*Run the core: `npx vitest run src/coherence.test.ts --reporter=verbose`.*

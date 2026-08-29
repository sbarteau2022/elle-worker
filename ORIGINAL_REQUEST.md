# Original User Request

## Initial Request — 2026-08-29T17:06:46-05:00

Implement and verify Phase 1 of the `elle-worker` rollout: apply the Gate 2 Relative Volatility Normalization repair to resolve tail-amputation in high-beta trends, verify Q0.30 CORDIC integer fixed-point math determinism, and run full test suite validation ensuring zero regressions across all 157+ test files.

Working directory: /Users/stewartbarteau/Documents/antigravity/wise-maxwell
Integrity mode: development

## Requirements

### R1. Gate 2 Relative Volatility Normalization Repair
- Implement and integrate the Relative Percentage-of-Price Volatility Normalization formula in the trading sizing engine (`src/conviction.ts`, `src/order-guards.ts`, `src/witness-gates-real-data.test.ts`):
  $$V_{\text{rel}} = \frac{\text{ATR}_{\text{now}} / P_{\text{now}}}{\text{ATR}_{\text{entry}} / P_{\text{entry}}}$$
  $$\Lambda = \min\left(1, \frac{1}{V_{\text{rel}}}\right)$$
- Ensure that under relative percentage volatility:
  - NVDA tail participation expectancy recovers to > 1.0R (overcoming the historical dollar-ATR 0.439R collapse).
  - Left-tail in-trade drawdown and worst trade metrics retain > 50% risk reduction compared to unnormalized baselines.

### R2. CORDIC Fixed-Point & Poincaré Metric Determinism
- Verify and harden Q0.30 CORDIC integer fixed-point trigonometric and hyperbolic operations (`src/fixed-math.ts`, `src/hyperbolic-sync-fixed.ts`):
  - Ensure bit-exact determinism across all platforms and environments.
  - Verify boundary retractions on the Poincaré manifold (Pi(x) = x * min(1, (1 - 10^-5) / ||x||)) preventing singularity overflow.

### R3. Comprehensive Regression & Invariant Verification
- Execute the full test suite across all 157+ test files (2,124+ unit, integration, and adversarial tests).
- Ensure 100% test pass rate with zero regressions and clean TypeScript typecheck (`npx tsc --noEmit`).

## Acceptance Criteria

### Mathematical Verification
- [ ] `src/witness-gates-real-data.test.ts` passes all test cases with relative volatility expectancy > 1.0R on NVDA.
- [ ] Fixed-point CORDIC unit tests pass with zero floating-point ULP drift.

### Global Test Suite Health
- [ ] All 157+ test files pass cleanly (`npm test`).
- [ ] TypeScript compilation exits with 0 errors (`npx tsc --noEmit`).

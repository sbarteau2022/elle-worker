// ============================================================
// INDIANA TAX RULES — tax year 2026 · src/tax-rules/states/in/2026.ts
//
// Flat 2.95% state rate — cross-checked twice during development after an
// initial search returned a conflicting "3.05%" figure (likely a stale
// cached page reflecting an earlier year of Indiana's scheduled annual
// rate decrease); two independent 2026-dated sources agree on 2.95%.
//
// Like Illinois, Indiana has no traditional standard deduction — a flat
// $1,000 PERSONAL EXEMPTION per filer (self + spouse), reused here in
// standardDeductionCents as the closest fit; the additional $1,500-per-
// dependent exemption is NOT added on top (same simplification as
// Illinois's personal exemption — flagged, not silently assumed correct
// for a filer with dependents).
//
// The genuinely hard part: ALL 92 Indiana counties layer their OWN flat
// income tax rate on top (0.50%-3.38%), and this suite does not maintain
// that 92-row table — confidently hardcoding it risks silent staleness for
// most of it. Instead, county_tax_rate is a MANUAL field on tax_businesses
// (see schema.ts) the operator enters themselves, sourced from Indiana
// DOR's own published table — see indianaCountyTaxCents in tax-calc.ts.
// ============================================================

import type { StateConstants } from '../../../tax-calc';
import type { TaxRule } from '../../types';

const dollars = (d: number) => Math.round(d * 100);

const IN_FLAT_BRACKETS = [{ uptoCents: null, rate: 0.0295 }];

export const IN_2026: StateConstants = {
  state: 'IN',
  year: 2026,
  brackets: { single: IN_FLAT_BRACKETS, mfj: IN_FLAT_BRACKETS, mfs: IN_FLAT_BRACKETS, hoh: IN_FLAT_BRACKETS },
  standardDeductionCents: {
    single: dollars(1_000),
    mfj: dollars(2_000), // self + spouse personal exemptions — dependents' $1,500 each not added
    mfs: dollars(1_000),
    hoh: dollars(1_000),
  },
  lastVerified: '2026-07-30',
  sources: [
    'Indiana Dept. of Revenue — 2026 flat adjusted gross income tax rate 2.95%, cross-checked across two independent sources after an initial conflicting 3.05% figure',
    'Indiana personal/dependent exemption structure ($1,000 personal, $1,500 per dependent — dependent add-on not modeled here)',
    'County income tax NOT modeled here — 92 counties, 0.50%-3.38%, entered manually per business (see tax_businesses.county_tax_rate)',
  ],
};

export const IN_RULES_2026: TaxRule[] = [];

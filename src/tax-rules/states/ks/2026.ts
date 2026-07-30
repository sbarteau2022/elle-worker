// ============================================================
// KANSAS TAX RULES — tax year 2026 · src/tax-rules/states/ks/2026.ts
//
// Confirmed via a multi-pass web-search during development, cross-checking
// an initial conflicting result (a "3.10%/5.70%" figure that turned out to
// be stale/wrong) against the actual 2024 tax-reform narrative: Kansas
// consolidated from 3 brackets to 2 in 2024 (rates lowered from 5.25%/5.7%
// to 5.2%/5.58%), and multiple independent sources agree on 5.20% up to
// $23,000 (single) / $46,000 (MFJ), 5.58% above — the MFJ threshold is
// DOUBLED, unlike Missouri, which is why StateConstants.brackets is a
// per-filing-status record rather than one shared table.
//
// Kansas does NOT conform to the federal standard deduction (unlike
// Missouri) — it sets its own amounts.
// ============================================================

import type { StateConstants } from '../../../tax-calc';
import type { TaxRule } from '../../types';

const dollars = (d: number) => Math.round(d * 100);

const KS_SINGLE_BRACKETS = [
  { uptoCents: dollars(23_000), rate: 0.052 },
  { uptoCents: null, rate: 0.0558 },
];
const KS_MFJ_BRACKETS = [
  { uptoCents: dollars(46_000), rate: 0.052 },
  { uptoCents: null, rate: 0.0558 },
];

export const KS_2026: StateConstants = {
  state: 'KS',
  year: 2026,
  // MFS/HOH use the single table as the closer approximation — not
  // independently confirmed as an exact match for Kansas specifically.
  brackets: { single: KS_SINGLE_BRACKETS, mfj: KS_MFJ_BRACKETS, mfs: KS_SINGLE_BRACKETS, hoh: KS_SINGLE_BRACKETS },
  standardDeductionCents: {
    single: dollars(3_805),
    mfj: dollars(8_640),
    hoh: dollars(6_480),
    // Not independently confirmed for 2026 — Kansas statute has historically
    // set MFS at half of MFJ; used here as the closer approximation.
    mfs: dollars(4_320),
  },
  lastVerified: '2026-07-30',
  sources: [
    'Kansas HB2629 (2025-26 session) — 2026 standard deduction amounts ($3,805/$8,640/$6,480)',
    'Kansas 2024 tax reform (3→2 brackets, rates to 5.20%/5.58%) — cross-checked against multiple independent 2026 bracket-table sources',
  ],
};

export const KS_RULES_2026: TaxRule[] = [];

// ============================================================
// MISSOURI TAX RULES — tax year 2026 · src/tax-rules/states/mo/2026.ts
//
// First state supported (Stewart operates in Missouri). Confirmed via
// web-search pass during development: 8 brackets in ~$1,313 increments,
// 0% on the first $1,313 up to a 4.7% top rate above $9,191 — the SAME
// bracket table applies to every filing status (only the standard
// deduction differs), and Missouri's standard deduction is explicitly tied
// to the FEDERAL standard deduction amount by statute, so it's reused
// directly from FEDERAL_2026 rather than duplicated here.
//
// NO Missouri-specific credit/deduction rules are shipped in v1
// (MO_RULES_2026 is intentionally empty) — a dedicated research pass
// against Missouri DOR's credit list turned up nothing both common enough
// for a typical small pass-through business AND confident enough to state
// as fact without risking a wrong claim. State INCOME TAX CALCULATION
// itself (brackets + standard deduction) is fully implemented below and
// independent of this list.
// ============================================================

import type { StateConstants } from '../../../tax-calc';
import type { TaxRule } from '../../types';
import { FEDERAL_2026 } from '../../federal/2026';

const dollars = (d: number) => Math.round(d * 100);

const MO_BRACKETS = [
  { uptoCents: dollars(1_313), rate: 0.00 },
  { uptoCents: dollars(2_626), rate: 0.02 },
  { uptoCents: dollars(3_939), rate: 0.025 },
  { uptoCents: dollars(5_252), rate: 0.03 },
  { uptoCents: dollars(6_565), rate: 0.035 },
  { uptoCents: dollars(7_878), rate: 0.04 },
  { uptoCents: dollars(9_191), rate: 0.045 },
  { uptoCents: null, rate: 0.047 },
];

export const MO_2026: StateConstants = {
  state: 'MO',
  year: 2026,
  brackets: MO_BRACKETS,
  standardDeductionCents: FEDERAL_2026.standardDeductionCents,
  lastVerified: '2026-07-30',
  sources: [
    'Missouri Dept. of Revenue — 2026 withholding formula (bracket structure)',
    'Missouri SB 3 (2022) revenue-trigger reduction — top rate 4.7% effective 2025-01-01',
  ],
};

export const MO_RULES_2026: TaxRule[] = [];

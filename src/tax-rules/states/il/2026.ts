// ============================================================
// ILLINOIS TAX RULES — tax year 2026 · src/tax-rules/states/il/2026.ts
//
// Illinois has no bracket structure at all — a single flat 4.95% rate — and
// no local/municipal income tax anywhere in the state (unlike Missouri's
// KC/STL earnings taxes). It also has no traditional "standard deduction";
// instead it subtracts a flat PERSONAL EXEMPTION ($2,925/2026) per person
// (self, spouse, each dependent) from federal AGI. This suite's
// standardDeductionCents field is reused to hold that flat per-filer figure
// (1 exemption for single, 2 for MFJ/self+spouse) as the closest fit to the
// existing shape — dependents' additional exemptions are NOT added on top
// (a real simplification, same discipline as QBI's UBIA gap elsewhere),
// and the exemption's full phase-out above $250K single / $500K MFJ AGI is
// not modeled either (an edge case outside this suite's small-business
// focus, not the common case).
//
// The bigger Illinois-specific piece: partnerships and S-corps (NOT sole
// props/single-member LLCs) owe a SEPARATE 1.5% Personal Property
// Replacement Tax on the entity's own net income, on top of the 4.95%
// flowing through to the owner — see passThroughEntityLevelTaxRate.
// ============================================================

import type { StateConstants } from '../../../tax-calc';
import type { TaxRule } from '../../types';

const dollars = (d: number) => Math.round(d * 100);

// One flat rate, no bracket boundaries — a single "unbounded" bracket.
const IL_FLAT_BRACKETS = [{ uptoCents: null, rate: 0.0495 }];

export const IL_2026: StateConstants = {
  state: 'IL',
  year: 2026,
  brackets: { single: IL_FLAT_BRACKETS, mfj: IL_FLAT_BRACKETS, mfs: IL_FLAT_BRACKETS, hoh: IL_FLAT_BRACKETS },
  standardDeductionCents: {
    single: dollars(2_925), // 1 personal exemption
    mfj: dollars(5_850),    // 2 personal exemptions (self + spouse) — dependents not added
    mfs: dollars(2_925),
    hoh: dollars(2_925),
  },
  passThroughEntityLevelTaxRate: 0.015,
  passThroughEntityLevelTaxAppliesTo: ['multi_member_llc', 's_corp'],
  lastVerified: '2026-07-30',
  sources: [
    'Illinois Dept. of Revenue — FY 2026-15 bulletin, personal exemption $2,925/2026',
    'Illinois Dept. of Revenue — Personal Property Replacement Tax (1.5% partnerships/S-corps, 2.5% C-corps)',
    'Illinois flat 4.95% individual rate, no local income tax anywhere in the state',
  ],
};

export const IL_RULES_2026: TaxRule[] = [];

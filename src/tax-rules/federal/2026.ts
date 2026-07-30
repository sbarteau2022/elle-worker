// ============================================================
// FEDERAL TAX RULES — tax year 2026 · src/tax-rules/federal/2026.ts
//
// Every numeric constant below was pulled from a web-search pass against
// IRS/SSA primary and secondary sources during development (see `sources`).
// The mechanics that consume these (tax-calc.ts) are permanent statute and
// exact; these NUMBERS are the part that changes every year and the part
// most worth a human/CPA double-check before this is relied on for a real
// filing — that's the whole reason this lives in its own dated file instead
// of being inlined in the calculator.
//
// Confirmed via multiple independent sources during this build:
//   - SSA wage base $184,500 (SSA Oct-2025 announcement)
//   - Standard mileage: 72.5¢/mi (Jan-Jun) then 76¢/mi (Jul-Dec) — IRS's
//     first mid-year rate change since 2022 (IRS Notice, July 2026)
//   - Federal brackets: 10%-to-$12,400 / 37%-above-$640,600 (single),
//     37%-above-$768,700 (MFJ), and the $201,775/$403,550 24%->32%
//     crossover, all directly confirmed. Intermediate single breakpoints
//     (22%/24%/32%/35%) and the MFJ 12-32% brackets were reconstructed by
//     doubling the single thresholds (the standard TCJA/OBBBA pattern for
//     those bands) — cross-check against IRS Rev. Proc. 2025-32 directly.
//   - QBI: 20% deduction made PERMANENT by OBBBA (H.R.1, signed 2025-07-04)
//     — an earlier House draft's 23% rate was dropped from the final law.
//     New $400 minimum deduction (QBI > $1,000) starting 2026.
//   - 1099-NEC threshold raised from $600 to $2,000 by OBBBA, effective for
//     payments made on/after 2026-01-01.
//   - HOH bracket breakpoints are NOT independently confirmed — using the
//     single-filer table as a placeholder (understates HOH's more
//     favorable brackets). MFS uses half of MFJ's brackets (standard rule
//     of thumb, not independently confirmed for the 35%/37% bands).
// ============================================================

import type { FederalConstants } from '../../tax-calc';
import type { TaxRule } from '../types';
import { vehicleDeductionCents, homeOfficeDeductionCents } from '../../tax-calc';

const dollars = (d: number) => Math.round(d * 100);

const SINGLE_BRACKETS = [
  { uptoCents: dollars(12_400), rate: 0.10 },
  { uptoCents: dollars(50_400), rate: 0.12 },
  { uptoCents: dollars(105_700), rate: 0.22 },
  { uptoCents: dollars(201_775), rate: 0.24 },
  { uptoCents: dollars(256_225), rate: 0.32 },
  { uptoCents: dollars(640_600), rate: 0.35 },
  { uptoCents: null, rate: 0.37 },
];

const MFJ_BRACKETS = [
  { uptoCents: dollars(24_800), rate: 0.10 },
  { uptoCents: dollars(100_800), rate: 0.12 },
  { uptoCents: dollars(211_400), rate: 0.22 },
  { uptoCents: dollars(403_550), rate: 0.24 },
  { uptoCents: dollars(512_450), rate: 0.32 },
  { uptoCents: dollars(768_700), rate: 0.35 }, // confirmed anchor: 37% starts here
  { uptoCents: null, rate: 0.37 },
];

const MFS_BRACKETS = MFJ_BRACKETS.map((b) => ({ uptoCents: b.uptoCents == null ? null : Math.round(b.uptoCents / 2), rate: b.rate }));

export const FEDERAL_2026: FederalConstants = {
  year: 2026,
  seTaxRate: 0.153,
  seNetEarningsFactor: 0.9235,
  ssWageBaseCents: dollars(184_500),
  addlMedicareRate: 0.009,
  addlMedicareThresholdCents: {
    single: dollars(200_000), mfj: dollars(250_000), mfs: dollars(125_000), hoh: dollars(200_000),
  },
  standardMileageRatePeriods: [
    { fromMonth: 1, toMonth: 6, centsPerMile: 72.5 },
    { fromMonth: 7, toMonth: 12, centsPerMile: 76 },
  ],
  qbiRate: 0.20,
  qbiMinDeductionQbiFloorCents: dollars(1_000),
  qbiMinDeductionCents: dollars(400),
  qbiFullDeductionThresholdCents: { single: dollars(201_775), mfj: dollars(403_550) },
  qbiPhaseOutCeilingCents: { single: dollars(275_000), mfj: dollars(550_000) },
  homeOfficeSimplifiedRateCentsPerSqft: dollars(5),
  homeOfficeSimplifiedCapSqft: 300,
  safeHarborCurrentYearPct: 0.90,
  safeHarborPriorYearPct: 1.00,
  safeHarborPriorYearHighIncomePct: 1.10,
  safeHarborHighIncomeThresholdCents: { default: dollars(150_000), mfs: dollars(75_000) },
  standardDeductionCents: {
    single: dollars(16_100), mfs: dollars(16_100), mfj: dollars(32_200), hoh: dollars(24_150),
  },
  brackets: { single: SINGLE_BRACKETS, mfs: MFS_BRACKETS, mfj: MFJ_BRACKETS, hoh: SINGLE_BRACKETS },
  nec1099ThresholdCents: dollars(2_000),
  lastVerified: '2026-07-30',
  sources: [
    'SSA — 2026 Social Security taxable wage base announcement ($184,500)',
    'IRS — 2026 standard mileage rate notices (72.5¢ Jan-Jun, 76¢ Jul-Dec)',
    'IRS Rev. Proc. 2025-32 — 2026 inflation adjustments (brackets, standard deduction)',
    'OBBBA (H.R.1, 2025-07-04) — Section 199A permanence, $400 QBI minimum, 1099-NEC $2,000 threshold',
  ],
};

export const FEDERAL_RULES_2026: TaxRule[] = [
  {
    id: 'qbi-20pct',
    name: 'Qualified Business Income (QBI) deduction',
    category: 'deduction',
    citation: 'IRC §199A; IRS Pub 535',
    lastVerified: '2026-07-30',
    eligible: (facts) => {
      const et = String(facts.entity_type || 'sole_prop');
      // S-corp qualifies too, but only on DISTRIBUTIONS — the salary
      // portion is ordinary W-2 income and never counts as QBI.
      return ['sole_prop', 'single_member_llc', 'multi_member_llc', 's_corp'].includes(et);
    },
    plainLanguage:
      'Pass-through business profit qualifies for a 20% deduction before ordinary income tax is calculated (for an S-corp, this applies only to distributions, never the salary portion) — applied automatically on every quarterly estimate. ' +
      'To maximize it: keep taxable income under $201,775 (single) / $403,550 (MFJ) where possible, since the deduction phases out above that. ' +
      'Maxing out a SEP-IRA or Solo 401(k) contribution lowers taxable income and helps preserve the full deduction.',
    confidence: 'high',
  },
  {
    id: 'home-office-simplified',
    name: 'Home office deduction (simplified method)',
    category: 'deduction',
    citation: 'IRS Rev. Proc. 2013-13; Form 8829',
    lastVerified: '2026-07-30',
    eligible: (facts) => facts.has_home_office === true || facts.has_home_office === 1,
    estimate: (facts) => homeOfficeDeductionCents(facts, FEDERAL_2026).cents || null,
    plainLanguage:
      'Deduct $5/sqft of space used regularly and EXCLUSIVELY for business, up to 300 sqft ($1,500/yr max). ' +
      'To maximize it: measure your actual dedicated office footprint (not your whole home) and make sure nothing else happens in that space — mixed use disqualifies it. ' +
      'If your real expenses (mortgage interest, utilities, depreciation) proportional to office space would exceed $1,500, the actual-expense method (Form 8829) may be worth it instead — ask a CPA.',
    confidence: 'high',
  },
  {
    id: 'se-health-insurance-deduction',
    name: 'Self-employed health insurance deduction',
    category: 'deduction',
    citation: 'IRC §162(l)',
    lastVerified: '2026-07-30',
    eligible: (facts) => facts.health_insurance_type === 'marketplace' && Number(facts.self_employed_health_premiums_ytd || 0) > 0,
    estimate: (facts) => (facts.self_employed_health_premiums_ytd ? Math.round(Number(facts.self_employed_health_premiums_ytd) * 100) : null),
    plainLanguage:
      "Premiums for your own health insurance (and your family's) are 100% deductible above the line if you're not eligible for an employer or spouse's employer plan. " +
      'To maximize it: keep the policy in your name or the business\'s, save every premium statement, and note this deduction cannot exceed your net business profit for the year.',
    confidence: 'needs_review',
  },
  {
    id: 'retirement-sep-solo401k',
    name: 'SEP-IRA / Solo 401(k) contribution deduction',
    category: 'deduction',
    citation: 'IRC §408, §401(k); IRS Pub 560',
    lastVerified: '2026-07-30',
    eligible: (facts) => !!facts.retirement_plan_type && facts.retirement_plan_type !== 'none',
    estimate: (facts) => (facts.retirement_contributions_ytd ? Math.round(Number(facts.retirement_contributions_ytd) * 100) : null),
    plainLanguage:
      'Contributions reduce taxable income dollar-for-dollar. A Solo 401(k) generally allows a higher total contribution than a SEP-IRA at the same income level once you approach the deferral limits — ' +
      "worth comparing before year-end if you haven't opened either yet. Contributions can typically be made up until the (extended) filing deadline.",
    confidence: 'high',
  },
  {
    id: 'vehicle-standard-mileage',
    name: 'Business vehicle mileage deduction (standard rate)',
    category: 'deduction',
    citation: 'IRS Pub 463',
    lastVerified: '2026-07-30',
    eligible: (facts) => (facts.uses_vehicle_for_business === true || facts.uses_vehicle_for_business === 1) && Number(facts.vehicle_business_miles_ytd || 0) > 0 && facts.vehicle_method !== 'actual',
    estimate: (facts) => vehicleDeductionCents(Number(facts.vehicle_business_miles_ytd || 0), FEDERAL_2026, 2026).cents || null,
    plainLanguage:
      "Track every business mile — the 2026 standard rate is 72.5¢/mile through June 30 and 76¢/mile from July 1 on (a rare mid-year IRS increase, so log which trips fall in which half). " +
      "Commuting from home to a fixed office doesn't count; client visits, job sites, supply runs, and business errands do. A mileage-log app beats a paper log for audit defense.",
    confidence: 'high',
  },
  {
    id: 'section179-equipment',
    name: 'Section 179 immediate equipment expensing',
    category: 'deduction',
    citation: 'IRC §179',
    lastVerified: '2026-07-30',
    eligible: (facts) => (facts.section179_candidate === true || facts.section179_candidate === 1) && Number(facts.equipment_purchases_ytd || 0) > 0,
    plainLanguage:
      'Equipment, machinery, and qualifying software placed in service this year can often be expensed immediately instead of depreciated over years, up to a very high annual limit after OBBBA\'s 2025 increase. ' +
      "To maximize it: time large purchases before year-end if you'll have enough profit to absorb the deduction, and confirm the item qualifies (used >50% for business) with Elle or a CPA before relying on the full amount.",
    confidence: 'needs_review',
  },
];

// ============================================================
// tax-calc.test.ts — Pattern C: pure-function exact-value tests, no
// mocking, no D1. Given "must be accurate" is the explicit requirement for
// this feature, every test vector below is hand-derived from the FEDERAL_2026
// / MO_2026 constants (see src/tax-rules/federal/2026.ts for source
// citations on those numbers) so a regression in the ARITHMETIC — not the
// constants, which are a separate verification concern — is caught here.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  applyBrackets, federalIncomeTaxCents, stateIncomeTaxCents, standardDeductionCents,
  netProfitCents, computeSETax, additionalMedicareTaxCents, computeQBIDeduction,
  homeOfficeDeductionCents, vehicleDeductionCents, computeSafeHarbor, allocateNetProfit,
  meets1099Threshold, computeFICA, splitSCorpCompensation, indianaCountyTaxCents,
  entityLevelPassThroughTaxCents, detectLedgerPayroll, bracketApproximationNote, rulesAgeWarning,
} from './tax-calc';
import { FEDERAL_2026 } from './tax-rules/federal/2026';
import { MO_2026 } from './tax-rules/states/mo/2026';

describe('netProfitCents', () => {
  it('is gross receipts minus total expenses', () => {
    expect(netProfitCents({ grossReceiptsCents: 500000, expenseCentsByCategory: { supplies: 100000, advertising: 50000 }, totalExpenseCents: 150000 })).toBe(350000);
  });
});

describe('federalIncomeTaxCents (2026 single)', () => {
  it('applies marginal brackets across the 10%/12% boundary at $50,000 taxable', () => {
    // $12,400 @ 10% = $1,240.00; remaining $37,600 @ 12% = $4,512.00 → $5,752.00
    expect(federalIncomeTaxCents(5_000_000, 'single', FEDERAL_2026)).toBe(575_200);
  });
  it('is zero for zero taxable income', () => {
    expect(federalIncomeTaxCents(0, 'single', FEDERAL_2026)).toBe(0);
  });
});

describe('stateIncomeTaxCents (MO 2026)', () => {
  it('applies all 8 brackets at $20,000 taxable', () => {
    expect(stateIncomeTaxCents(2_000_000, 'single', MO_2026)).toBe(76_406);
  });
});

describe('standardDeductionCents (2026)', () => {
  it('matches the confirmed federal figures Missouri also conforms to', () => {
    expect(standardDeductionCents('single', FEDERAL_2026)).toBe(1_610_000);
    expect(standardDeductionCents('mfj', FEDERAL_2026)).toBe(3_220_000);
    expect(standardDeductionCents('hoh', FEDERAL_2026)).toBe(2_415_000);
  });
});

describe('computeSETax', () => {
  it('computes SS + Medicare on 92.35% of net profit, $80,000 example', () => {
    const r = computeSETax(8_000_000, FEDERAL_2026);
    expect(r.netEarningsCents).toBe(7_388_000);
    expect(r.socialSecurityTaxCents).toBe(916_112);
    expect(r.medicareTaxCents).toBe(214_252);
    expect(r.totalSeTaxCents).toBe(1_130_364);
    expect(r.deductibleHalfCents).toBe(565_182);
  });
  it('is all zero for zero or negative net profit', () => {
    expect(computeSETax(0, FEDERAL_2026)).toEqual({ netEarningsCents: 0, socialSecurityTaxCents: 0, medicareTaxCents: 0, totalSeTaxCents: 0, deductibleHalfCents: 0 });
    expect(computeSETax(-5000, FEDERAL_2026).totalSeTaxCents).toBe(0);
  });
  it('drops the Social Security leg (but not Medicare, which is uncapped) once prior W-2 SS wages already fill the wage base', () => {
    const r = computeSETax(8_000_000, FEDERAL_2026, 20_000_000); // prior SS wages above the $184,500 base
    expect(r.socialSecurityTaxCents).toBe(0);
    expect(r.medicareTaxCents).toBe(214_252);
  });
});

describe('additionalMedicareTaxCents', () => {
  it('is zero below the $200,000 single threshold', () => {
    expect(additionalMedicareTaxCents(7_388_000, 0, 'single', FEDERAL_2026)).toBe(0);
  });
  it('applies 0.9% to the excess above threshold', () => {
    // net earnings + wages = $250,000 combined, threshold $200,000 → $50,000 excess × 0.9%
    expect(additionalMedicareTaxCents(20_000_000, 5_000_000, 'single', FEDERAL_2026)).toBe(45_000);
  });
});

describe('computeQBIDeduction', () => {
  it('is 20% of QBI (net profit less deductible SE tax half) below the phase-in threshold', () => {
    const r = computeQBIDeduction(8_000_000, 565_182, 0, 0, 7_000_000, 'single', FEDERAL_2026);
    expect(r.qbiCents).toBe(7_434_818);
    // capped by 20% of taxable income before QBI ($1,400,000) since that's lower than raw 20% of QBI
    expect(r.finalDeductionCents).toBe(1_400_000);
    expect(r.aboveCeilingApproximation).toBe(false);
  });
  it('applies the $400 minimum when QBI exceeds $1,000 but 20% would round to less', () => {
    // QBI $1,500 → raw 20% = $300, below the $400 floor; taxable income is
    // set high enough ($50,000) that the separate 20%-of-taxable-income cap
    // doesn't also bind, isolating the minimum-deduction behavior.
    const r = computeQBIDeduction(150_000, 0, 0, 0, 5_000_000, 'single', FEDERAL_2026);
    expect(r.rawDeductionCents).toBeLessThan(FEDERAL_2026.qbiMinDeductionCents);
    expect(r.finalDeductionCents).toBe(FEDERAL_2026.qbiMinDeductionCents);
  });
  it('fully phases out (simplified, no W-2/UBIA modeled) above the ceiling', () => {
    const r = computeQBIDeduction(30_000_000, 0, 0, 0, 30_000_000, 'single', FEDERAL_2026); // $300k taxable, above $275k ceiling
    expect(r.finalDeductionCents).toBe(0);
    expect(r.aboveCeilingApproximation).toBe(true);
  });
  it('is zero when QBI is zero or negative', () => {
    expect(computeQBIDeduction(0, 0, 0, 0, 0, 'single', FEDERAL_2026).finalDeductionCents).toBe(0);
  });
});

describe('homeOfficeDeductionCents', () => {
  it('is $5/sqft under the 300 sqft cap', () => {
    const r = homeOfficeDeductionCents({ has_home_office: true, home_office_sqft: 200, home_office_method: 'simplified' }, FEDERAL_2026);
    expect(r.cents).toBe(100_000); // 200 * $5.00
  });
  it('caps at 300 sqft even if more is reported', () => {
    const r = homeOfficeDeductionCents({ has_home_office: true, home_office_sqft: 400, home_office_method: 'simplified' }, FEDERAL_2026);
    expect(r.cents).toBe(150_000); // 300 * $5.00
  });
  it('is zero when no home office is reported', () => {
    expect(homeOfficeDeductionCents({ has_home_office: false }, FEDERAL_2026).cents).toBe(0);
  });
  it('does not compute a figure for the actual-expense method (out of v1 scope)', () => {
    const r = homeOfficeDeductionCents({ has_home_office: true, home_office_sqft: 200, home_office_method: 'actual' }, FEDERAL_2026);
    expect(r.cents).toBe(0);
    expect(r.note).toMatch(/not computed/);
  });
});

describe('vehicleDeductionCents', () => {
  it('blends the two 2026 rate periods by day-count for a YTD mileage total', () => {
    // 181 days @ 72.5¢ + 184 days @ 76¢ over 365 days = 74.2643...¢/mi blended
    const r = vehicleDeductionCents(1_000, FEDERAL_2026, 2026);
    expect(r.cents).toBe(74_264);
  });
  it('is zero for zero miles', () => {
    expect(vehicleDeductionCents(0, FEDERAL_2026, 2026).cents).toBe(0);
  });
});

describe('computeSafeHarbor', () => {
  it('uses the lower of 90% current-year or 100% prior-year when prior AGI is at/below $150,000', () => {
    const r = computeSafeHarbor(2_000_000, 1_500_000, 10_000_000, 'single', FEDERAL_2026);
    expect(r.currentYearBasisCents).toBe(1_800_000);
    expect(r.priorYearBasisCents).toBe(1_500_000);
    expect(r.requiredAnnualPaymentCents).toBe(1_500_000);
    expect(r.requiredQuarterlyPaymentCents).toBe(375_000);
    expect(r.basisUsed).toBe('prior_year_100pct');
  });
  it('uses 110% of prior-year tax once prior AGI exceeds $150,000', () => {
    const r = computeSafeHarbor(2_000_000, 1_500_000, 20_000_000, 'single', FEDERAL_2026);
    expect(r.priorYearBasisCents).toBe(1_650_000);
    expect(r.requiredAnnualPaymentCents).toBe(1_650_000);
    expect(r.basisUsed).toBe('prior_year_110pct');
  });
  it('falls back to 90% of current-year projection when no prior-year figure is on file', () => {
    const r = computeSafeHarbor(2_000_000, null, null, 'single', FEDERAL_2026);
    expect(r.requiredAnnualPaymentCents).toBe(1_800_000);
    expect(r.requiredQuarterlyPaymentCents).toBe(450_000);
    expect(r.basisUsed).toBe('current_year_only');
  });
});

describe('allocateNetProfit', () => {
  it('splits by ownership percentage and always sums back to the exact total, even with remainder cents', () => {
    const shares = allocateNetProfit(101, [{ ownerName: 'A', ownershipPct: 50 }, { ownerName: 'B', ownershipPct: 50 }]);
    expect(shares.reduce((s, o) => s + o.shareCents, 0)).toBe(101);
    expect(shares).toEqual([{ ownerName: 'A', shareCents: 51 }, { ownerName: 'B', shareCents: 50 }]);
  });
  it('handles uneven splits exactly', () => {
    const shares = allocateNetProfit(1_000_000, [{ ownerName: 'A', ownershipPct: 70 }, { ownerName: 'B', ownershipPct: 30 }]);
    expect(shares).toEqual([{ ownerName: 'A', shareCents: 700_000 }, { ownerName: 'B', shareCents: 300_000 }]);
  });
});

describe('meets1099Threshold (2026 OBBBA $2,000 threshold)', () => {
  it('is false just under the threshold and true at/above it', () => {
    expect(meets1099Threshold(199_999, FEDERAL_2026)).toBe(false);
    expect(meets1099Threshold(200_000, FEDERAL_2026)).toBe(true);
    expect(meets1099Threshold(250_000, FEDERAL_2026)).toBe(true);
  });
});

describe('applyBrackets (generic)', () => {
  it('never taxes below zero', () => {
    expect(applyBrackets(-100, FEDERAL_2026.brackets.single)).toBe(0);
  });
  it('taxes the whole amount at the top rate once every lower bracket is exhausted', () => {
    // 3rd bracket boundary is the highest defined; anything above it uses the top (unbounded) rate on the remainder.
    const brackets = [{ uptoCents: 100, rate: 0.10 }, { uptoCents: null, rate: 0.20 }];
    expect(applyBrackets(300, brackets)).toBe(Math.round(100 * 0.10 + 200 * 0.20));
  });
});

describe('computeFICA (W-2 payroll — full wages, NOT the 92.35% SE-tax haircut)', () => {
  it('applies 12.4% SS + 2.9% Medicare on the full wage, split evenly employer/employee', () => {
    const r = computeFICA(8_000_000, FEDERAL_2026); // $80,000 salary
    expect(r.socialSecurityTaxCents).toBe(992_000); // 8,000,000 * 0.124 (full wage, no 92.35% factor)
    expect(r.medicareTaxCents).toBe(232_000); // 8,000,000 * 0.029
    expect(r.totalFICACents).toBe(1_224_000);
    expect(r.employeeShareCents).toBe(612_000);
    expect(r.employerShareCents).toBe(612_000);
  });

  it('caps the Social Security leg at the wage base but leaves Medicare uncapped', () => {
    const r = computeFICA(20_000_000, FEDERAL_2026); // above the $184,500 SS wage base
    expect(r.socialSecurityTaxCents).toBe(Math.round(FEDERAL_2026.ssWageBaseCents * 0.124));
    expect(r.medicareTaxCents).toBe(Math.round(20_000_000 * 0.029));
  });

  it('is all zero for zero or negative wages', () => {
    expect(computeFICA(0, FEDERAL_2026)).toEqual({ socialSecurityTaxCents: 0, medicareTaxCents: 0, totalFICACents: 0, employeeShareCents: 0, employerShareCents: 0 });
  });
});

describe('splitSCorpCompensation', () => {
  it('splits net profit into salary + the remainder as distribution', () => {
    expect(splitSCorpCompensation(10_000_000, 6_000_000)).toEqual({ salaryCents: 6_000_000, distributionCents: 4_000_000, salaryExceedsProfit: false });
  });
  it('floors distributions at zero and flags when reported salary exceeds net profit', () => {
    expect(splitSCorpCompensation(3_000_000, 5_000_000)).toEqual({ salaryCents: 5_000_000, distributionCents: 0, salaryExceedsProfit: true });
  });

  // AUDIT E2 — the ledger convention decides whether salary comes out once or
  // twice. Getting this wrong silently collapsed the QBI base by the entire
  // salary; these pin both readings.
  it('does NOT subtract salary again when the ledger already booked payroll as an expense', () => {
    // $60k profit ALREADY net of a $60k salary — the distribution is that
    // $60k, not zero.
    expect(splitSCorpCompensation(6_000_000, 6_000_000, 'includes_payroll')).toEqual({
      salaryCents: 6_000_000, distributionCents: 6_000_000, salaryExceedsProfit: false,
    });
  });
  it('subtracts salary when the ledger states profit before payroll', () => {
    expect(splitSCorpCompensation(12_000_000, 6_000_000, 'excludes_payroll').distributionCents).toBe(6_000_000);
  });
  it('defaults to the pre-payroll reading so existing callers keep their behaviour', () => {
    expect(splitSCorpCompensation(12_000_000, 6_000_000)).toEqual(splitSCorpCompensation(12_000_000, 6_000_000, 'excludes_payroll'));
  });
});

describe('detectLedgerPayroll', () => {
  it('recognises the words a person actually types for payroll', () => {
    for (const label of ['Payroll', 'wages', 'Wage expense', 'Salaries', 'salary', 'Officer Compensation']) {
      expect(detectLedgerPayroll({ [label]: 500_000 }).convention).toBe('includes_payroll');
    }
  });
  it('reports which categories matched and their total', () => {
    const r = detectLedgerPayroll({ Payroll: 4_000_000, 'Salaries - admin': 2_000_000, Rent: 900_000 });
    expect(r.convention).toBe('includes_payroll');
    expect(r.matchedCategories.sort()).toEqual(['Payroll', 'Salaries - admin']);
    expect(r.centsInLedger).toBe(6_000_000);
  });
  it('reads a ledger with no payroll categories as stating profit before payroll', () => {
    const r = detectLedgerPayroll({ Rent: 900_000, Supplies: 120_000 });
    expect(r.convention).toBe('excludes_payroll');
    expect(r.centsInLedger).toBe(0);
  });
  it('ignores a payroll category with no actual spend', () => {
    expect(detectLedgerPayroll({ Payroll: 0 }).convention).toBe('excludes_payroll');
  });
  it('never throws on an empty or missing ledger', () => {
    expect(detectLedgerPayroll({}).convention).toBe('excludes_payroll');
    expect(detectLedgerPayroll(undefined as unknown as Record<string, number>).convention).toBe('excludes_payroll');
  });
});

describe('bracketApproximationNote', () => {
  it('flags HOH and MFS, whose 2026 tables are stand-ins', () => {
    expect(bracketApproximationNote('hoh', FEDERAL_2026)).toMatch(/stand-in bracket table/);
    expect(bracketApproximationNote('mfs', FEDERAL_2026)).toMatch(/stand-in bracket table/);
  });
  it('stays silent for the filing statuses whose tables are the published ones', () => {
    expect(bracketApproximationNote('single', FEDERAL_2026)).toBeNull();
    expect(bracketApproximationNote('mfj', FEDERAL_2026)).toBeNull();
  });
});

describe('rulesAgeWarning', () => {
  const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
  it('stays silent while the tables are inside the freshness window', () => {
    expect(rulesAgeWarning('2026-07-30', ms('2026-08-04'))).toBeNull();
  });
  it('warns once the tables age past the threshold, naming the age', () => {
    const w = rulesAgeWarning('2026-07-30', ms('2027-06-01'));
    expect(w).toMatch(/last verified 2026-07-30 \(306 days ago\)/);
  });
  it('treats an unparseable date as unverified rather than as fresh', () => {
    expect(rulesAgeWarning('not-a-date', ms('2026-08-04'))).toMatch(/unparseable/);
  });
});

describe('indianaCountyTaxCents', () => {
  it('applies a flat county rate on top of the state rate\'s own taxable-income base', () => {
    expect(indianaCountyTaxCents(5_000_000, 0.0202)).toBe(101_000); // Marion County example rate
  });
  it('is zero with no rate on file or non-positive income', () => {
    expect(indianaCountyTaxCents(5_000_000, null)).toBe(0);
    expect(indianaCountyTaxCents(5_000_000, undefined)).toBe(0);
    expect(indianaCountyTaxCents(0, 0.02)).toBe(0);
  });
});

describe('computeQBIDeduction — real W-2 wage limitation (S-corp path)', () => {
  it('uses the real 50%-of-wages limit above the ceiling instead of fully zeroing out', () => {
    const r = computeQBIDeduction(30_000_000, 0, 0, 0, 30_000_000, 'single', FEDERAL_2026, 10_000_000);
    expect(r.finalDeductionCents).toBe(5_000_000); // min(50% of $100k wages = $50k, 20% of $300k taxable income cap = $60k) = $50k
    expect(r.aboveCeilingApproximation).toBe(false); // a real wage figure was supplied — this is the actual rule, not a stand-in
  });

  it('never lets a disproportionately high wage figure inflate the deduction past the plain 20%-of-QBI amount', () => {
    // QBI only $20,000 (net profit with no other adjustments) → 20% = $4,000, but wages paid are $50,000 (50% = $25,000, far above $4,000).
    const r = computeQBIDeduction(2_000_000, 0, 0, 0, 30_000_000, 'single', FEDERAL_2026, 5_000_000);
    expect(r.finalDeductionCents).toBe(400_000); // capped at the unlimited 20%-of-QBI figure, not the (irrelevant, higher) wage limit
  });

  it('still fully phases out above the ceiling when no wage figure is known at all (unchanged default behavior)', () => {
    const r = computeQBIDeduction(30_000_000, 0, 0, 0, 30_000_000, 'single', FEDERAL_2026);
    expect(r.finalDeductionCents).toBe(0);
    expect(r.aboveCeilingApproximation).toBe(true);
  });
});

describe('entityLevelPassThroughTaxCents', () => {
  const stateWithPPRT = { state: 'IL', year: 2026, brackets: { single: [], mfj: [], mfs: [], hoh: [] }, standardDeductionCents: { single: 0, mfj: 0, mfs: 0, hoh: 0 }, passThroughEntityLevelTaxRate: 0.015, passThroughEntityLevelTaxAppliesTo: ['multi_member_llc', 's_corp'], lastVerified: '2026-07-30', sources: [] };

  it('applies only to the listed entity types', () => {
    expect(entityLevelPassThroughTaxCents(10_000_000, 's_corp', stateWithPPRT)).toBe(150_000);
    expect(entityLevelPassThroughTaxCents(10_000_000, 'sole_prop', stateWithPPRT)).toBe(0); // sole props don't file a separate entity return
  });
  it('is zero for a state with no entity-level tax configured', () => {
    expect(entityLevelPassThroughTaxCents(10_000_000, 's_corp', MO_2026)).toBe(0);
  });
});

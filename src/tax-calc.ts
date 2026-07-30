// ============================================================
// ELLE — deterministic small-business tax arithmetic · src/tax-calc.ts
//
// Same philosophy as calc.ts: "LLMs are unreliable at exact arithmetic on
// real numbers... A deterministic calculator closes that gap." Every dollar
// figure the tax suite ever shows comes from a plain, pure, unit-tested
// TypeScript function in this file — the LLM only narrates the result via
// tax.ts's tool handlers, it never computes a tax number inline.
//
// This file is YEAR-AGNOSTIC on purpose: every rate, threshold, and bracket
// table is passed in as a `FederalConstants`/`StateConstants` argument
// (defined here, populated in src/tax-rules/federal/*.ts and
// src/tax-rules/states/*/*.ts). Adding tax year 2027 support means adding a
// new constants module, not touching this file.
//
// ACCURACY NOTE: mechanics (SE tax = 15.3% of 92.35% of net earnings,
// progressive-bracket math, the 90%/100%/110% safe-harbor test, QBI's
// income-cap and $400-minimum rules) are permanent statute and implemented
// exactly. The NUMBERS fed in via *Constants (wage base, bracket
// breakpoints, mileage rate, QBI thresholds) come from a web-search pass
// against IRS/SSA/MO DOR sources done during development (see the `sources`
// field on each constants object) but were not all independently verified
// against the primary source document — treat any real dollar output as an
// estimate that supplements, not replaces, a CPA's review before filing.
//
// v1 scope: pass-through entities only (sole proprietorship, single- and
// multi-member LLC taxed as pass-through). S-corp/C-corp computation
// (payroll, reasonable salary, 1120-series, double taxation) is NOT
// implemented here — callers must gate on entity_type before calling into
// this module and return an explicit "not yet supported" message instead of
// a guessed number. See tax.ts's tax_estimate_quarterly.
// ============================================================

export type FilingStatus = 'single' | 'mfj' | 'mfs' | 'hoh';

export interface TaxBracket {
  /** Upper bound of this bracket in cents, or null for the top/unbounded bracket. */
  uptoCents: number | null;
  rate: number;
}

export interface MileagePeriod {
  /** 1-12, inclusive start month of this rate period. */
  fromMonth: number;
  /** 1-12, inclusive end month of this rate period. */
  toMonth: number;
  centsPerMile: number;
}

export interface FederalConstants {
  year: number;
  seTaxRate: number;
  seNetEarningsFactor: number;
  ssWageBaseCents: number;
  addlMedicareRate: number;
  addlMedicareThresholdCents: Record<FilingStatus, number>;
  standardMileageRatePeriods: MileagePeriod[];
  qbiRate: number;
  qbiMinDeductionQbiFloorCents: number;
  qbiMinDeductionCents: number;
  qbiFullDeductionThresholdCents: { single: number; mfj: number };
  qbiPhaseOutCeilingCents: { single: number; mfj: number };
  homeOfficeSimplifiedRateCentsPerSqft: number;
  homeOfficeSimplifiedCapSqft: number;
  safeHarborCurrentYearPct: number;
  safeHarborPriorYearPct: number;
  safeHarborPriorYearHighIncomePct: number;
  safeHarborHighIncomeThresholdCents: { default: number; mfs: number };
  standardDeductionCents: Record<FilingStatus, number>;
  brackets: Record<FilingStatus, TaxBracket[]>;
  nec1099ThresholdCents: number;
  lastVerified: string;
  sources: string[];
}

export interface LocalConstants {
  locality: string;
  year: number;
  /** Flat rate on business net profit (KC/STL both levy a flat 1% earnings tax on business net profit, no brackets). */
  earningsTaxRate: number;
  /** Employer-side tax on wages paid to workers in the locality (e.g. STL's 0.5% payroll expense tax) — NOT computed in v1 (no employee-wage data collected), surfaced only as a flag. */
  payrollExpenseTaxRate?: number;
  lastVerified: string;
  sources: string[];
}

export function localEarningsTaxCents(netProfitCents: number, c: LocalConstants): number {
  if (netProfitCents <= 0) return 0;
  return Math.round(netProfitCents * c.earningsTaxRate);
}

// St. Louis's separate 0.5% payroll expense tax — on WAGES PAID TO
// EMPLOYEES, not the business's own net profit, so it's computed against a
// real synced wage total (payroll/sync.ts) rather than netProfitCents.
export function payrollExpenseTaxCents(totalWagesCents: number, rate: number): number {
  if (totalWagesCents <= 0) return 0;
  return Math.round(totalWagesCents * rate);
}

export interface StateConstants {
  state: string;
  year: number;
  /**
   * Per-filing-status bracket tables, same shape as FederalConstants — some
   * states (Missouri) use an identical table for every status; others
   * (Kansas) double the MFJ threshold like federal does. Building it as
   * Record<FilingStatus, ...> from the start means a state that DOES vary
   * by status never needs a special-cased helper function bolted on later.
   */
  brackets: Record<FilingStatus, TaxBracket[]>;
  standardDeductionCents: Record<FilingStatus, number>;
  /**
   * A tax the PASS-THROUGH ENTITY ITSELF owes on its own net income, on top
   * of (not instead of) the owner's personal income tax above — e.g.
   * Illinois's 1.5% Personal Property Replacement Tax on partnerships/
   * S-corps (NOT sole proprietorships/single-member LLCs, which don't file
   * a separate entity return). Applies only to the entity types listed in
   * passThroughEntityLevelTaxAppliesTo.
   */
  passThroughEntityLevelTaxRate?: number;
  passThroughEntityLevelTaxAppliesTo?: string[];
  lastVerified: string;
  sources: string[];
}

export function entityLevelPassThroughTaxCents(netProfitCents: number, entityType: string, c: StateConstants): number {
  if (!c.passThroughEntityLevelTaxRate) return 0;
  if (!c.passThroughEntityLevelTaxAppliesTo?.includes(entityType)) return 0;
  if (netProfitCents <= 0) return 0;
  return Math.round(netProfitCents * c.passThroughEntityLevelTaxRate);
}

export interface TaxFacts {
  /** From tax_businesses, not tax_facts — merged in by the caller (tax.ts) before eligibility checks that need it, e.g. QBI. */
  entity_type?: string | null;
  filing_status?: string | null;
  dependents_count?: number | null;
  spouse_has_income?: boolean | number | null;
  w2_income_estimate?: number | null;
  prior_year_tax_liability?: number | null;
  prior_year_agi?: number | null;
  retirement_plan_type?: string | null;
  retirement_contributions_ytd?: number | null;
  health_insurance_type?: string | null;
  self_employed_health_premiums_ytd?: number | null;
  has_home_office?: boolean | number | null;
  home_office_sqft?: number | null;
  home_total_sqft?: number | null;
  home_office_method?: string | null;
  uses_vehicle_for_business?: boolean | number | null;
  vehicle_business_miles_ytd?: number | null;
  vehicle_method?: string | null;
  equipment_purchases_ytd?: number | null;
  section179_candidate?: boolean | number | null;
  pays_contractors?: boolean | number | null;
}

export interface TxSummary {
  grossReceiptsCents: number;
  expenseCentsByCategory: Record<string, number>;
  totalExpenseCents: number;
}

export interface OwnerShare {
  ownerName: string;
  ownershipPct: number;
}

const truthy = (v: unknown): boolean => v === true || v === 1 || v === '1';

// ── progressive-bracket math ─────────────────────────────────────
export function applyBrackets(taxableCents: number, brackets: TaxBracket[]): number {
  if (taxableCents <= 0) return 0;
  let tax = 0;
  let lower = 0;
  for (const b of brackets) {
    const upper = b.uptoCents ?? Infinity;
    if (taxableCents <= lower) break;
    const slice = Math.min(taxableCents, upper) - lower;
    if (slice > 0) tax += slice * b.rate;
    lower = upper;
    if (taxableCents <= upper) break;
  }
  return Math.round(tax);
}

export function federalIncomeTaxCents(taxableCents: number, filingStatus: FilingStatus, c: FederalConstants): number {
  return applyBrackets(taxableCents, c.brackets[filingStatus]);
}

export function stateIncomeTaxCents(taxableCents: number, filingStatus: FilingStatus, c: StateConstants): number {
  return applyBrackets(taxableCents, c.brackets[filingStatus] ?? c.brackets.single);
}

export function standardDeductionCents(filingStatus: FilingStatus, c: FederalConstants): number {
  return c.standardDeductionCents[filingStatus] ?? c.standardDeductionCents.single;
}

// ── net profit / expense summary ─────────────────────────────────
export function netProfitCents(tx: TxSummary): number {
  return tx.grossReceiptsCents - tx.totalExpenseCents;
}

// ── self-employment tax (IRC §1401/§1402) ────────────────────────
export interface SETaxResult {
  netEarningsCents: number;
  socialSecurityTaxCents: number;
  medicareTaxCents: number;
  totalSeTaxCents: number;
  /** Half of SE tax — the standard above-the-line deduction (IRC §164(f)). */
  deductibleHalfCents: number;
}

export function computeSETax(netProfitCents: number, c: FederalConstants, priorSSWagesCents = 0): SETaxResult {
  if (netProfitCents <= 0) {
    return { netEarningsCents: 0, socialSecurityTaxCents: 0, medicareTaxCents: 0, totalSeTaxCents: 0, deductibleHalfCents: 0 };
  }
  const netEarningsCents = Math.round(netProfitCents * c.seNetEarningsFactor);
  const ssRoom = Math.max(0, c.ssWageBaseCents - priorSSWagesCents);
  const ssTaxableCents = Math.min(netEarningsCents, ssRoom);
  const socialSecurityTaxCents = Math.round(ssTaxableCents * (c.seTaxRate - 0.029));
  const medicareTaxCents = Math.round(netEarningsCents * 0.029);
  const totalSeTaxCents = socialSecurityTaxCents + medicareTaxCents;
  return {
    netEarningsCents,
    socialSecurityTaxCents,
    medicareTaxCents,
    totalSeTaxCents,
    deductibleHalfCents: Math.round(totalSeTaxCents / 2),
  };
}

// ── W-2 payroll FICA (S-corp reasonable salary) ───────────────────────────
// Distinct from computeSETax: W-2 wages get the FULL 15.3% (both employer
// and employee halves) with NO 92.35% haircut — that haircut exists only in
// self-employment tax to approximate the employer-side deduction a W-2
// employee's employer already absorbs separately. An S-corp shareholder's
// salary is real payroll, taxed like anyone else's paycheck.
export interface FICAResult {
  socialSecurityTaxCents: number;
  medicareTaxCents: number;
  totalFICACents: number;
  employeeShareCents: number;
  employerShareCents: number;
}

export function computeFICA(wagesCents: number, c: FederalConstants, priorSSWagesCents = 0): FICAResult {
  if (wagesCents <= 0) return { socialSecurityTaxCents: 0, medicareTaxCents: 0, totalFICACents: 0, employeeShareCents: 0, employerShareCents: 0 };
  const ssRoom = Math.max(0, c.ssWageBaseCents - priorSSWagesCents);
  const ssTaxableCents = Math.min(wagesCents, ssRoom);
  const socialSecurityTaxCents = Math.round(ssTaxableCents * (c.seTaxRate - 0.029));
  const medicareTaxCents = Math.round(wagesCents * 0.029);
  const totalFICACents = socialSecurityTaxCents + medicareTaxCents;
  const employeeShareCents = Math.round(totalFICACents / 2);
  return { socialSecurityTaxCents, medicareTaxCents, totalFICACents, employeeShareCents, employerShareCents: totalFICACents - employeeShareCents };
}

// ── S-corp reasonable-salary / distribution split ─────────────────────────
// Salary is real payroll (subject to computeFICA above, never SE tax);
// distributions are the remainder, subject to ordinary income tax but
// neither SE tax nor FICA. salaryExceedsProfit flags the (real, if rare)
// case where reported salary exceeds net profit — distributions floor at
// zero rather than going negative.
export interface SCorpSplit { salaryCents: number; distributionCents: number; salaryExceedsProfit: boolean }
export function splitSCorpCompensation(netProfitCents: number, salaryCents: number): SCorpSplit {
  const raw = netProfitCents - salaryCents;
  return { salaryCents, distributionCents: Math.max(0, raw), salaryExceedsProfit: raw < 0 };
}

// ── Indiana's flat county income tax (layered on top of the flat state rate) ──
export function indianaCountyTaxCents(taxableIncomeCents: number, countyTaxRate: number | null | undefined): number {
  if (taxableIncomeCents <= 0 || !countyTaxRate) return 0;
  return Math.round(taxableIncomeCents * countyTaxRate);
}

// ── Additional Medicare Tax (IRC §3101(b)(2)) — thresholds are fixed by
// statute, NOT inflation-adjusted, so these don't move year to year. ──
export function additionalMedicareTaxCents(
  netEarningsCents: number,
  w2WagesCents: number,
  filingStatus: FilingStatus,
  c: FederalConstants,
): number {
  const threshold = c.addlMedicareThresholdCents[filingStatus] ?? c.addlMedicareThresholdCents.single;
  const combined = netEarningsCents + w2WagesCents;
  const excess = Math.max(0, combined - threshold);
  return Math.round(excess * c.addlMedicareRate);
}

// ── QBI / Section 199A deduction ──────────────────────────────────
export interface QBIResult {
  qbiCents: number;
  rawDeductionCents: number;
  finalDeductionCents: number;
  /** true if the simplified above-ceiling phase-out was applied — no W-2/UBIA limitation is modeled, so this is a conservative floor, not a precise figure. */
  aboveCeilingApproximation: boolean;
}

export function computeQBIDeduction(
  netProfitCents: number,
  deductibleSeTaxHalfCents: number,
  retirementContributionsCents: number,
  seHealthPremiumsCents: number,
  taxableIncomeBeforeQbiCents: number,
  filingStatus: FilingStatus,
  c: FederalConstants,
  // Real W-2 wages paid BY THE BUSINESS (both owner's and any employees') —
  // when known (e.g. an S-corp's synced payroll), the above-ceiling phase-out
  // uses the actual 50%-of-W-2-wages limitation instead of conservatively
  // zeroing out. UBIA-of-qualified-property is still not modeled (no asset
  // basis tracked in this suite), so this is the 50%-of-wages test only, not
  // the fuller "greater of 50% wages OR 25% wages + 2.5% UBIA" rule — still
  // strictly more accurate than the no-wages-known fallback.
  w2WagesPaidCents?: number,
): QBIResult {
  const qbiCents = Math.max(0, netProfitCents - deductibleSeTaxHalfCents - retirementContributionsCents - seHealthPremiumsCents);
  if (qbiCents <= 0) return { qbiCents: 0, rawDeductionCents: 0, finalDeductionCents: 0, aboveCeilingApproximation: false };

  // rawDeductionCents stays the plain 20%-of-QBI figure for transparency;
  // the minimum bump is applied separately into preMinCents so it doesn't
  // masquerade as "what 20% of QBI actually is" in the returned result.
  const rawDeductionCents = Math.round(qbiCents * c.qbiRate);
  let preMinCents = rawDeductionCents;
  if (qbiCents > c.qbiMinDeductionQbiFloorCents) preMinCents = Math.max(preMinCents, c.qbiMinDeductionCents);

  // Both filing-status buckets that have a documented phase-out; mfs/hoh use
  // the single thresholds as the closer approximation (flagged, not exact).
  const isMfj = filingStatus === 'mfj';
  const fullThreshold = isMfj ? c.qbiFullDeductionThresholdCents.mfj : c.qbiFullDeductionThresholdCents.single;
  const ceiling = isMfj ? c.qbiPhaseOutCeilingCents.mfj : c.qbiPhaseOutCeilingCents.single;

  // Without a real wage figure this is 0 — i.e. the same conservative
  // "fully phased out" floor as before wages were ever available. Capped at
  // preMinCents: the wage/UBIA test is a LIMIT, never a reason the deduction
  // could exceed the plain 20%-of-QBI figure (disproportionately high wages
  // relative to a small QBI must not inflate the deduction past that).
  const wageLimitedCents = w2WagesPaidCents != null ? Math.min(preMinCents, Math.round(w2WagesPaidCents * 0.5)) : 0;
  let deductionBeforeIncomeCap = preMinCents;
  let aboveCeilingApproximation = false;
  if (taxableIncomeBeforeQbiCents > fullThreshold) {
    const range = ceiling - fullThreshold;
    const frac = taxableIncomeBeforeQbiCents >= ceiling ? 1 : (range > 0 ? (taxableIncomeBeforeQbiCents - fullThreshold) / range : 1);
    deductionBeforeIncomeCap = Math.round(preMinCents - frac * (preMinCents - wageLimitedCents));
    // Only flag "approximation" when we DON'T have a real wage figure — with
    // one, this phase-out is the actual IRS formula, not a stand-in for it.
    aboveCeilingApproximation = w2WagesPaidCents == null;
  }

  const capByTaxableIncome = Math.round(taxableIncomeBeforeQbiCents * c.qbiRate);
  const finalDeductionCents = Math.max(0, Math.min(deductionBeforeIncomeCap, capByTaxableIncome));
  return { qbiCents, rawDeductionCents, finalDeductionCents, aboveCeilingApproximation };
}

// ── home office (simplified method only — IRS Rev. Proc. 2013-13) ────────
export function homeOfficeDeductionCents(facts: TaxFacts, c: FederalConstants): { cents: number; note: string } {
  if (!truthy(facts.has_home_office)) return { cents: 0, note: 'no home office reported' };
  if (facts.home_office_method === 'actual') {
    return { cents: 0, note: 'actual-expense method selected — not computed in v1, itemize with a CPA' };
  }
  const sqft = Math.min(Number(facts.home_office_sqft || 0), c.homeOfficeSimplifiedCapSqft);
  const cents = Math.round(sqft * c.homeOfficeSimplifiedRateCentsPerSqft);
  return { cents, note: `simplified method: ${sqft} sqft × $${(c.homeOfficeSimplifiedRateCentsPerSqft / 100).toFixed(2)}/sqft (cap ${c.homeOfficeSimplifiedCapSqft} sqft)` };
}

// ── vehicle — standard mileage method, period-weighted for a split-rate
// year (2026's IRS mid-year rate change is the first since 2022). Facts
// only carry a single YTD mileage total, not a period split, so this blends
// the periods' rates weighted by their day-count — flagged as an
// approximation; splitting mileage by period (before/after the rate
// change) would be exact. ──
export function vehicleDeductionCents(milesYtd: number, c: FederalConstants, year: number): { cents: number; note: string } {
  if (!milesYtd || milesYtd <= 0) return { cents: 0, note: 'no business mileage reported' };
  const periods = c.standardMileageRatePeriods;
  if (periods.length === 1) {
    return { cents: Math.round(milesYtd * periods[0].centsPerMile), note: `${milesYtd} mi × ${periods[0].centsPerMile}¢/mi` };
  }
  const daysInMonth = (m: number) => new Date(Date.UTC(year, m, 0)).getUTCDate();
  let totalDays = 0;
  const weighted = periods.map((p) => {
    let days = 0;
    for (let m = p.fromMonth; m <= p.toMonth; m++) days += daysInMonth(m);
    totalDays += days;
    return { ...p, days };
  });
  const blendedRate = weighted.reduce((sum, p) => sum + p.days * p.centsPerMile, 0) / totalDays;
  const cents = Math.round(milesYtd * blendedRate);
  const desc = weighted.map((p) => `${p.centsPerMile}¢/mi (${p.fromMonth}/1-${p.toMonth}/${daysInMonth(p.toMonth)})`).join(' then ');
  return { cents, note: `${milesYtd} mi × blended ${blendedRate.toFixed(2)}¢/mi (${desc} — split mileage by period for an exact figure)` };
}

// ── quarterly estimated-tax safe harbor (IRC §6654) ───────────────────────
export interface SafeHarborResult {
  currentYearBasisCents: number | null;
  priorYearBasisCents: number | null;
  requiredAnnualPaymentCents: number | null;
  requiredQuarterlyPaymentCents: number | null;
  basisUsed: 'current_year_90pct' | 'prior_year_100pct' | 'prior_year_110pct' | 'current_year_only';
}

export function computeSafeHarbor(
  currentYearProjectedTaxCents: number,
  priorYearTaxLiabilityCents: number | null | undefined,
  priorYearAgiCents: number | null | undefined,
  filingStatus: FilingStatus,
  c: FederalConstants,
): SafeHarborResult {
  const currentYearBasisCents = Math.round(currentYearProjectedTaxCents * c.safeHarborCurrentYearPct);
  if (priorYearTaxLiabilityCents == null) {
    return {
      currentYearBasisCents, priorYearBasisCents: null,
      requiredAnnualPaymentCents: currentYearBasisCents,
      requiredQuarterlyPaymentCents: Math.round(currentYearBasisCents / 4),
      basisUsed: 'current_year_only',
    };
  }
  const highIncomeThreshold = filingStatus === 'mfs' ? c.safeHarborHighIncomeThresholdCents.mfs : c.safeHarborHighIncomeThresholdCents.default;
  const isHighIncome = (priorYearAgiCents ?? 0) > highIncomeThreshold;
  const pct = isHighIncome ? c.safeHarborPriorYearHighIncomePct : c.safeHarborPriorYearPct;
  const priorYearBasisCents = Math.round(priorYearTaxLiabilityCents * pct);
  const requiredAnnualPaymentCents = Math.min(currentYearBasisCents, priorYearBasisCents);
  return {
    currentYearBasisCents, priorYearBasisCents,
    requiredAnnualPaymentCents,
    requiredQuarterlyPaymentCents: Math.round(requiredAnnualPaymentCents / 4),
    basisUsed: requiredAnnualPaymentCents === priorYearBasisCents ? (isHighIncome ? 'prior_year_110pct' : 'prior_year_100pct') : 'current_year_90pct',
  };
}

// ── multi-owner allocation (partnership / multi-member LLC pass-through) ──
export function allocateNetProfit(netProfitCents: number, owners: OwnerShare[]): Array<{ ownerName: string; shareCents: number }> {
  if (!owners.length) return [];
  const totalPct = owners.reduce((s, o) => s + o.ownershipPct, 0) || 100;
  const raw = owners.map((o) => ({ ownerName: o.ownerName, exact: (netProfitCents * o.ownershipPct) / totalPct }));
  const floored = raw.map((r) => ({ ownerName: r.ownerName, shareCents: Math.floor(r.exact), remainder: r.exact - Math.floor(r.exact) }));
  let distributed = floored.reduce((s, r) => s + r.shareCents, 0);
  let remaining = netProfitCents - distributed;
  // Give leftover cents to the largest fractional remainders first, so the
  // allocation always sums to exactly netProfitCents.
  const byRemainder = [...floored].sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; i < byRemainder.length && remaining > 0; i++, remaining--) byRemainder[i].shareCents += 1;
  return floored.map(({ ownerName, shareCents }) => ({ ownerName, shareCents }));
}

// ── 1099-NEC threshold check ───────────────────────────────────────────
export function meets1099Threshold(ytdPaymentsCents: number, c: FederalConstants): boolean {
  return ytdPaymentsCents >= c.nec1099ThresholdCents;
}

// ============================================================
// tax-credits.test.ts — Pattern C: constructed fact profiles asserted
// against the EXACT set of rule ids that should fire. This is what catches
// a rule accidentally over- or under-firing (e.g. an S-corp wrongly getting
// the pass-through-only QBI deduction).
// ============================================================

import { describe, it, expect } from 'vitest';
import { findCredits, DISCLAIMER } from './tax-credits';
import { getFederalConstants, getStateConstants, getRulesForYear, SUPPORTED_YEARS, SUPPORTED_STATES } from './tax-rules';
import type { TxSummary } from './tax-calc';

const emptyTx: TxSummary = { grossReceiptsCents: 10_000_000, expenseCentsByCategory: {}, totalExpenseCents: 4_000_000 };

describe('findCredits', () => {
  it('fires only qbi-20pct for a sole prop with nothing else filled in', () => {
    const hits = findCredits({ entity_type: 'sole_prop' }, emptyTx, 2026);
    expect(hits.map((h) => h.id)).toEqual(['qbi-20pct']);
  });

  it('DOES fire the QBI deduction for an S-corp too — it applies to distributions, just not the salary portion (see tax_estimate_quarterly) — plus entity-agnostic deductions', () => {
    const facts = {
      entity_type: 's_corp',
      retirement_plan_type: 'solo_401k',
      retirement_contributions_ytd: 20_000,
      uses_vehicle_for_business: true,
      vehicle_business_miles_ytd: 5_000,
      vehicle_method: 'standard_mileage',
      has_home_office: false,
      health_insurance_type: 'employer',
      section179_candidate: false,
    };
    const hits = findCredits(facts, emptyTx, 2026);
    const ids = hits.map((h) => h.id).sort();
    expect(ids).toEqual(['qbi-20pct', 'retirement-sep-solo401k', 'vehicle-standard-mileage']);
  });

  it('fires every eligible rule when every fact-group is filled in, with correctly cited estimates', () => {
    const facts = {
      entity_type: 'sole_prop',
      has_home_office: true, home_office_sqft: 250, home_office_method: 'simplified',
      health_insurance_type: 'marketplace', self_employed_health_premiums_ytd: 6_000,
      retirement_plan_type: 'sep_ira', retirement_contributions_ytd: 10_000,
      uses_vehicle_for_business: true, vehicle_business_miles_ytd: 2_000, vehicle_method: 'standard_mileage',
      section179_candidate: true, equipment_purchases_ytd: 5_000,
    };
    const hits = findCredits(facts, emptyTx, 2026);
    const byId = Object.fromEntries(hits.map((h) => [h.id, h]));
    expect(Object.keys(byId).sort()).toEqual([
      'home-office-simplified', 'qbi-20pct', 'retirement-sep-solo401k', 'se-health-insurance-deduction', 'section179-equipment', 'vehicle-standard-mileage',
    ]);
    expect(byId['home-office-simplified'].estimatedValueCents).toBe(125_000); // 250 sqft × $5.00
    expect(byId['se-health-insurance-deduction'].estimatedValueCents).toBe(600_000); // $6,000
    expect(byId['retirement-sep-solo401k'].estimatedValueCents).toBe(1_000_000); // $10,000
    expect(byId['vehicle-standard-mileage'].estimatedValueCents).toBe(148_529); // 2,000mi × blended 2026 rate
    expect(byId['qbi-20pct'].estimatedValueCents).toBeNull(); // computed via tax_estimate_quarterly, not standalone here
    // Every hit carries a citation and a lastVerified date — never a bare claim.
    for (const h of hits) {
      expect(h.citation.length).toBeGreaterThan(0);
      expect(h.lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('never throws on malformed facts — an eligibility check that errors is treated as not-eligible', () => {
    const hits = findCredits({ entity_type: 'sole_prop', vehicle_business_miles_ytd: 'not-a-number' as unknown as number, uses_vehicle_for_business: true }, emptyTx, 2026);
    expect(Array.isArray(hits)).toBe(true);
  });

  it('throws for an unsupported tax year rather than silently using the wrong year\'s rules', () => {
    expect(() => findCredits({ entity_type: 'sole_prop' }, emptyTx, 2099)).toThrow(/no rules for tax year 2099/);
  });

  it('exposes a fixed, tool-level disclaimer rather than relying on the LLM to remember one', () => {
    expect(DISCLAIMER).toMatch(/does not replace a CPA/);
  });
});

describe('tax-rules resolver whitelisting', () => {
  it('lists 2026 as a supported year and MO as a supported state', () => {
    expect(SUPPORTED_YEARS).toContain(2026);
    expect(SUPPORTED_STATES).toContain('MO');
  });
  it('getFederalConstants throws for an unsupported year', () => {
    expect(() => getFederalConstants(2099)).toThrow();
  });
  it('getStateConstants throws for an unsupported state', () => {
    expect(() => getStateConstants('CA', 2026)).toThrow();
  });
  it('getRulesForYear silently omits (does not throw for) an unsupported state — federal rules still apply', () => {
    const rules = getRulesForYear(2026, 'CA');
    expect(rules.length).toBeGreaterThan(0);
  });
});

// ============================================================
// states.test.ts — Pattern C exact-value tests for the newly added
// Kansas/Illinois/Indiana state modules, pinned against the sourced
// figures in each state's own 2026.ts file (see those files for citations).
// ============================================================

import { describe, it, expect } from 'vitest';
import { stateIncomeTaxCents, entityLevelPassThroughTaxCents, indianaCountyTaxCents } from '../tax-calc';
import { KS_2026 } from './states/ks/2026';
import { IL_2026 } from './states/il/2026';
import { IN_2026 } from './states/in/2026';
import { getStateConstants, isStateSupported } from './index';

describe('Kansas — 2-bracket, MFJ threshold DOUBLED (not shared with single, unlike Missouri)', () => {
  it('applies 5.20%/5.58% at the single $23,000 threshold', () => {
    // $23,000 @ 5.20% + $7,000 @ 5.58% = $1,196.00 + $390.60 = $1,586.60
    expect(stateIncomeTaxCents(3_000_000, 'single', KS_2026)).toBe(158_660);
  });
  it('the SAME $30,000 taxable income is taxed less under MFJ, because the doubled $46,000 threshold keeps it all in the lower bracket', () => {
    expect(stateIncomeTaxCents(3_000_000, 'mfj', KS_2026)).toBe(156_000); // 3,000,000 * 0.052, no 5.58% slice at all
  });
  it('does not conform to the federal standard deduction (Kansas sets its own)', () => {
    expect(KS_2026.standardDeductionCents.single).toBe(380_500);
    expect(KS_2026.standardDeductionCents.mfj).toBe(864_000);
  });
});

describe('Illinois — flat 4.95%, no brackets, no local tax, entity-level PPRT', () => {
  it('taxes every dollar at the same flat rate regardless of income level', () => {
    expect(stateIncomeTaxCents(5_000_000, 'single', IL_2026)).toBe(247_500);
    expect(stateIncomeTaxCents(50_000_000, 'single', IL_2026)).toBe(2_475_000); // still exactly 4.95%, no bracket creep
  });
  it('uses the personal-exemption figure (not a bracket-style standard deduction) — 1 exemption single, 2 for MFJ', () => {
    expect(IL_2026.standardDeductionCents.single).toBe(292_500);
    expect(IL_2026.standardDeductionCents.mfj).toBe(585_000);
  });
  it('applies the 1.5% Personal Property Replacement Tax to pass-through entities only, never sole props', () => {
    expect(entityLevelPassThroughTaxCents(10_000_000, 's_corp', IL_2026)).toBe(150_000);
    expect(entityLevelPassThroughTaxCents(10_000_000, 'multi_member_llc', IL_2026)).toBe(150_000);
    expect(entityLevelPassThroughTaxCents(10_000_000, 'sole_prop', IL_2026)).toBe(0);
    expect(entityLevelPassThroughTaxCents(10_000_000, 'single_member_llc', IL_2026)).toBe(0);
  });
});

describe('Indiana — flat 2.95% state + manually-entered county tax (92 counties, not hardcoded)', () => {
  it('applies the flat state rate', () => {
    expect(stateIncomeTaxCents(5_000_000, 'single', IN_2026)).toBe(147_500);
  });
  it('adds a real county rate on top when the business has one on file, e.g. Marion County', () => {
    const stateTax = stateIncomeTaxCents(5_000_000, 'single', IN_2026);
    const countyTax = indianaCountyTaxCents(5_000_000, 0.0202);
    expect(stateTax + countyTax).toBe(147_500 + 101_000);
  });
  it('adds zero county tax when none is on file — never guesses at one of the 92 rates', () => {
    expect(indianaCountyTaxCents(5_000_000, null)).toBe(0);
  });
});

describe('tax-rules resolver — KS/IL/IN are now whitelisted', () => {
  it('isStateSupported is true for all three for 2026', () => {
    expect(isStateSupported('KS', 2026)).toBe(true);
    expect(isStateSupported('IL', 2026)).toBe(true);
    expect(isStateSupported('IN', 2026)).toBe(true);
  });
  it('getStateConstants resolves each to its own real constants object', () => {
    expect(getStateConstants('KS', 2026).state).toBe('KS');
    expect(getStateConstants('IL', 2026).state).toBe('IL');
    expect(getStateConstants('IN', 2026).state).toBe('IN');
  });
});

// ============================================================
// TAX RULES — year/state resolver · src/tax-rules/index.ts
//
// The one place tax.ts and tax-credits.ts go to get "the rules for year Y,
// state S." Whitelisted on purpose: an unsupported year or state throws
// rather than silently falling back to a different year's numbers or
// returning federal-only results without saying so — accuracy-first, per
// the tax suite's "must be accurate" requirement.
// ============================================================

import type { FederalConstants, StateConstants, LocalConstants } from '../tax-calc';
import type { TaxRule } from './types';
import { FEDERAL_2026, FEDERAL_RULES_2026 } from './federal/2026';
import { MO_2026, MO_RULES_2026 } from './states/mo/2026';
import { KC_2026, STL_2026 } from './locals/mo-2026';

const FEDERAL_BY_YEAR: Record<number, { constants: FederalConstants; rules: TaxRule[] }> = {
  2026: { constants: FEDERAL_2026, rules: FEDERAL_RULES_2026 },
};

const STATE_BY_KEY: Record<string, { constants: StateConstants; rules: TaxRule[] }> = {
  'MO:2026': { constants: MO_2026, rules: MO_RULES_2026 },
};

const LOCAL_BY_YEAR: Record<string, LocalConstants> = {
  'KC:2026': KC_2026,
  'STL:2026': STL_2026,
};

export const SUPPORTED_YEARS = Object.keys(FEDERAL_BY_YEAR).map(Number);
export const SUPPORTED_STATES = ['MO'];
export const SUPPORTED_LOCALITIES = ['KC', 'STL'];

export function getFederalConstants(year: number): FederalConstants {
  const entry = FEDERAL_BY_YEAR[year];
  if (!entry) throw new Error(`tax-rules: no federal rules for tax year ${year} (supported: ${SUPPORTED_YEARS.join(', ')})`);
  return entry.constants;
}

export function getStateConstants(state: string, year: number): StateConstants {
  const key = `${state.toUpperCase()}:${year}`;
  const entry = STATE_BY_KEY[key];
  if (!entry) throw new Error(`tax-rules: no state rules for ${state} tax year ${year} (supported: ${SUPPORTED_STATES.join(', ')} for ${SUPPORTED_YEARS.join(', ')})`);
  return entry.constants;
}

export function isStateSupported(state: string | null | undefined, year: number): boolean {
  if (!state) return false;
  return !!STATE_BY_KEY[`${state.toUpperCase()}:${year}`];
}

export function getLocalConstants(locality: string, year: number): LocalConstants {
  const entry = LOCAL_BY_YEAR[`${locality.toUpperCase()}:${year}`];
  if (!entry) throw new Error(`tax-rules: no local rules for ${locality} tax year ${year} (supported: ${SUPPORTED_LOCALITIES.join(', ')} for ${SUPPORTED_YEARS.join(', ')})`);
  return entry;
}

export function isLocalitySupported(locality: string | null | undefined, year: number): boolean {
  if (!locality) return false;
  return !!LOCAL_BY_YEAR[`${locality.toUpperCase()}:${year}`];
}

/** Federal rules always apply; state rules are included only if state is supported for that year. */
export function getRulesForYear(year: number, state?: string | null): TaxRule[] {
  const federal = FEDERAL_BY_YEAR[year];
  if (!federal) throw new Error(`tax-rules: no rules for tax year ${year} (supported: ${SUPPORTED_YEARS.join(', ')})`);
  const rules = [...federal.rules];
  if (state) {
    const stateEntry = STATE_BY_KEY[`${state.toUpperCase()}:${year}`];
    if (stateEntry) rules.push(...stateEntry.rules);
  }
  return rules;
}

// ============================================================
// ELLE — tax credit/deduction eligibility engine · src/tax-credits.ts
//
// Pure, D1-free — mirrors calc.ts / conductor.ts's pure-function
// philosophy. findCredits() runs every TaxRule for the requested year/state
// against the business's onboarding facts and transaction summary, and
// returns only the ones that fire, cited. The LLM (tax.ts's
// tax_credits_finder tool) narrates this structured output; it NEVER
// invents a credit name, citation, or dollar figure itself — every field on
// a CreditResult traces back to a TaxRule in src/tax-rules/*.
// ============================================================

import type { TaxFacts, TxSummary } from './tax-calc';
import type { TaxRule } from './tax-rules/types';
import { getRulesForYear } from './tax-rules';

export interface CreditResult {
  id: string;
  name: string;
  category: 'credit' | 'deduction';
  citation: string;
  lastVerified: string;
  estimatedValueCents: number | null;
  plainLanguage: string;
  confidence: 'high' | 'needs_review';
}

export const DISCLAIMER =
  'Estimates only, based on rules as of the date noted per item — this supplements but does not replace a CPA; verify before filing.';

export function findCredits(facts: TaxFacts, tx: TxSummary, year: number, state?: string | null): CreditResult[] {
  const rules: TaxRule[] = getRulesForYear(year, state);
  const hits: CreditResult[] = [];
  for (const rule of rules) {
    let eligible = false;
    try {
      eligible = rule.eligible(facts, tx);
    } catch {
      continue; // a rule that throws on malformed facts is treated as not-eligible, never as a crash
    }
    if (!eligible) continue;
    let estimatedValueCents: number | null = null;
    if (rule.estimate) {
      try {
        estimatedValueCents = rule.estimate(facts, tx);
      } catch {
        estimatedValueCents = null;
      }
    }
    hits.push({
      id: rule.id,
      name: rule.name,
      category: rule.category,
      citation: rule.citation,
      lastVerified: rule.lastVerified,
      estimatedValueCents,
      plainLanguage: rule.plainLanguage,
      confidence: rule.confidence,
    });
  }
  return hits;
}

// ============================================================
// TAX RULES — shared types · src/tax-rules/types.ts
//
// A TaxRule is DATA plus a pure predicate, never something the LLM invents
// at answer time. tax-credits.ts's findCredits() runs every rule in scope
// and returns the hits, cited; the LLM only narrates the structured result.
// ============================================================

import type { TaxFacts, TxSummary } from '../tax-calc';

export interface TaxRule {
  id: string;
  name: string;
  category: 'credit' | 'deduction';
  /** IRC section, IRS Pub/Form, or state statute — never a bare claim. */
  citation: string;
  /** ISO date this rule's text was last checked against its source. */
  lastVerified: string;
  eligible: (facts: TaxFacts, tx: TxSummary) => boolean;
  /** Cents, or null if not confidently computable from onboarding facts alone. */
  estimate?: (facts: TaxFacts, tx: TxSummary) => number | null;
  /** Plain-language "how to maximize this" guidance for the operator. */
  plainLanguage: string;
  confidence: 'high' | 'needs_review';
}

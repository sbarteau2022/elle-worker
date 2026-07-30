// ============================================================
// MISSOURI LOCAL EARNINGS TAXES — tax year 2026 · src/tax-rules/locals/mo-2026.ts
//
// Missouri's local income tax is narrow: only Kansas City and St. Louis levy
// one, both a flat 1% "earnings tax" on business net profit (no brackets —
// unlike federal/state income tax). Confirmed via web search of each city's
// own government site during development.
//
// St. Louis ALSO levies a separate 0.5% "payroll expense tax" on employers
// for wages paid to people working within city limits — that leg is NOT
// computed here (v1 onboarding doesn't collect per-employee wage data) and
// is surfaced only as a flag on the constants object so callers can warn
// the operator rather than silently omit it.
// ============================================================

import type { LocalConstants } from '../../tax-calc';

export const KC_2026: LocalConstants = {
  locality: 'KC',
  year: 2026,
  earningsTaxRate: 0.01,
  lastVerified: '2026-07-30',
  sources: [
    'City of Kansas City, MO — Earnings Tax (E-Tax) overview, kcmo.gov/city-hall/departments/finance/earnings-tax',
    'Form RD-108/108B — annual business net-profit earnings tax return, due April 15',
  ],
};

export const STL_2026: LocalConstants = {
  locality: 'STL',
  year: 2026,
  earningsTaxRate: 0.01,
  payrollExpenseTaxRate: 0.005, // NOT computed in v1 — flag only, see file header
  lastVerified: '2026-07-30',
  sources: [
    'City of St. Louis Collector of Revenue — Business Earnings Tax Info, stlouis-mo.gov/government/departments/collector/earnings-tax/business-earnings-tax-info.cfm',
    'City of St. Louis — Employer Withholding and Payroll Expense Tax Info (0.5% payroll expense tax, not modeled in v1)',
  ],
};

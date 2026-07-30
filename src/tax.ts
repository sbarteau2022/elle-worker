// ============================================================
// ELLE — small-business tax suite tool handlers · src/tax.ts
//
// Mirrors rapid.ts's shape: one exported async function per router tool,
// each `(env, args) => Promise<string>`. Every dollar figure here comes
// from tax-calc.ts's deterministic functions or a plain SQL sum — never
// something the LLM is asked to compute inline. WRITE tools are marked
// WRITE in their router.ts TOOL_LINES description (regex-derived
// WRITE_TOOLS gate), not here; this file just implements the mechanics.
//
// Unlike rapid.ts's single-venue-per-call design, every tool here takes an
// explicit business_id — a person can run more than one business, so there
// is no VENUE_ID-style env override (see tax-clients.ts's header comment).
// ============================================================

import { ensureAllSchemas } from './db/schema';
import type { Env } from './index';
import {
  createBusiness, resolveBusinessesForUser, addUnit, listUnits, setOwners, listOwners,
  updateTaxFacts, getTaxFactsStatus, getTaxFacts, getBusiness, type FactGroup,
} from './tax-clients';
import {
  computeSETax, additionalMedicareTaxCents, computeQBIDeduction, homeOfficeDeductionCents,
  vehicleDeductionCents, computeSafeHarbor, allocateNetProfit, netProfitCents, federalIncomeTaxCents,
  stateIncomeTaxCents, standardDeductionCents, localEarningsTaxCents, payrollExpenseTaxCents, meets1099Threshold,
  type TxSummary, type TaxFacts, type FilingStatus,
} from './tax-calc';
import { findCredits, DISCLAIMER } from './tax-credits';
import { getFederalConstants, getStateConstants, getLocalConstants, isStateSupported, isLocalitySupported } from './tax-rules';
import { getWageSummaryCents } from './payroll/sync';
import { PASS_THROUGH_ENTITY_TYPES } from './tax-clients';

let schemaReady = false;
async function ensureSchema(env: Env): Promise<void> {
  if (schemaReady) return;
  await ensureAllSchemas(env.DB);
  schemaReady = true;
}

const id = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);
const dollarsToCents = (v: unknown): number => Math.round(Number(v || 0) * 100);
const centsToDollarStr = (c: number): string => `$${(c / 100).toFixed(2)}`;
const currentYear = () => new Date().getUTCFullYear();

function parseOccurredAt(v: unknown): number {
  if (v == null || v === '') return Date.now();
  if (typeof v === 'number') return v;
  const parsed = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

async function requireBusiness(env: Env, businessId: string) {
  const business = await getBusiness(env, businessId);
  if (!business) throw new Error(`no business found for business_id ${businessId}`);
  return business;
}

async function getTxSummary(env: Env, businessId: string, taxYear: number): Promise<TxSummary> {
  const rows = await env.DB.prepare(
    `SELECT direction, category, amount_cents FROM tax_transactions WHERE business_id = ? AND tax_year = ?`
  ).bind(businessId, taxYear).all<{ direction: string; category: string; amount_cents: number }>();
  const results = rows.results || [];
  let grossReceiptsCents = 0;
  const expenseCentsByCategory: Record<string, number> = {};
  let totalExpenseCents = 0;
  for (const r of results) {
    if (r.direction === 'income') grossReceiptsCents += r.amount_cents;
    else {
      expenseCentsByCategory[r.category] = (expenseCentsByCategory[r.category] || 0) + r.amount_cents;
      totalExpenseCents += r.amount_cents;
    }
  }
  return { grossReceiptsCents, expenseCentsByCategory, totalExpenseCents };
}

// ── business / units / owners / facts (thin string-returning wrappers over tax-clients.ts) ──

export async function taxBusinessCreate(env: Env, userId: string, a: Record<string, unknown>): Promise<string> {
  const out = await createBusiness(env, { id: userId }, a);
  return JSON.stringify({ business_id: out.business.id, entity_type: out.business.entity_type, created: out.created, note: out.note });
}

export async function taxBusinessList(env: Env, userId: string): Promise<string> {
  const list = await resolveBusinessesForUser(env, userId);
  return list.length ? JSON.stringify(list) : '(no businesses on file yet — create one with tax_business_create)';
}

export async function taxUnitAdd(env: Env, a: Record<string, unknown>): Promise<string> {
  const businessId = String(a.business_id || '');
  if (!businessId) return 'tax_unit_add: business_id required';
  const unit = await addUnit(env, businessId, String(a.unit_name || ''), a.address ? String(a.address) : null);
  return JSON.stringify({ unit_id: unit.id, unit_name: unit.unit_name });
}

export async function taxUnitList(env: Env, a: Record<string, unknown>): Promise<string> {
  const businessId = String(a.business_id || '');
  if (!businessId) return 'tax_unit_list: business_id required';
  const units = await listUnits(env, businessId);
  return units.length ? JSON.stringify(units) : '(no units on file — this business rolls up as a single location)';
}

export async function taxOwnerSet(env: Env, a: Record<string, unknown>): Promise<string> {
  const businessId = String(a.business_id || '');
  if (!businessId) return 'tax_owner_set: business_id required';
  const owners = Array.isArray(a.owners) ? a.owners as Array<{ owner_name: string; ownership_pct: number }> : [];
  const rows = await setOwners(env, businessId, owners);
  return JSON.stringify(rows.map((o) => ({ owner_name: o.owner_name, ownership_pct: o.ownership_pct })));
}

export async function taxOwnerList(env: Env, a: Record<string, unknown>): Promise<string> {
  const businessId = String(a.business_id || '');
  if (!businessId) return 'tax_owner_list: business_id required';
  const owners = await listOwners(env, businessId);
  return owners.length ? JSON.stringify(owners) : '(single-owner business — no ownership split on file)';
}

export async function taxFactsUpdate(env: Env, a: Record<string, unknown>): Promise<string> {
  const businessId = String(a.business_id || '');
  if (!businessId) return 'tax_facts_update: business_id required';
  const taxYear = Number(a.tax_year) || currentYear();
  const groups = (a.facts && typeof a.facts === 'object') ? a.facts as Partial<Record<FactGroup, Record<string, unknown>>> : {};
  const row = await updateTaxFacts(env, businessId, taxYear, groups);
  return JSON.stringify({ tax_year: row.tax_year, completed_groups: JSON.parse(row.completed_groups) });
}

export async function taxFactsStatus(env: Env, a: Record<string, unknown>): Promise<string> {
  const businessId = String(a.business_id || '');
  if (!businessId) return 'tax_facts_status: business_id required';
  const taxYear = Number(a.tax_year) || currentYear();
  const status = await getTaxFactsStatus(env, businessId, taxYear);
  return JSON.stringify(status);
}

// ── transactions ───────────────────────────────────────────────
const VALID_DIRECTIONS = new Set(['income', 'expense']);

export async function taxTransactionAdd(env: Env, a: Record<string, unknown>): Promise<string> {
  await ensureSchema(env);
  const businessId = String(a.business_id || '');
  if (!businessId) return 'tax_transaction_add: business_id required';
  const direction = String(a.direction || '');
  if (!VALID_DIRECTIONS.has(direction)) return 'tax_transaction_add: direction must be "income" or "expense"';
  const category = String(a.category || '').trim();
  if (!category) return 'tax_transaction_add: category required';
  const amountCents = dollarsToCents(a.amount);
  if (amountCents <= 0) return 'tax_transaction_add: amount must be a positive number of dollars';
  const taxYear = Number(a.tax_year) || currentYear();
  const occurredAt = parseOccurredAt(a.occurred_at);
  const contractorId = a.contractor_id ? String(a.contractor_id) : null;
  const now = Date.now();
  const txId = id();

  await env.DB.prepare(
    `INSERT INTO tax_transactions (id, business_id, unit_id, tax_year, occurred_at, direction, category, amount_cents, description, contractor_id, source, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    txId, businessId, a.unit_id ? String(a.unit_id) : null, taxYear, occurredAt, direction, category,
    amountCents, a.description ? String(a.description).slice(0, 500) : null, contractorId, 'manual', now, now,
  ).run();

  if (contractorId) {
    const c = getFederalConstants(taxYear);
    await env.DB.prepare(
      `UPDATE tax_1099_contractors SET ytd_payments_cents = ytd_payments_cents + ?, threshold_met = CASE WHEN ytd_payments_cents + ? >= ? THEN 1 ELSE 0 END, updated_at = ? WHERE id = ?`
    ).bind(amountCents, amountCents, c.nec1099ThresholdCents, now, contractorId).run();
  }

  return JSON.stringify({ transaction_id: txId, direction, category, amount: centsToDollarStr(amountCents) });
}

export async function taxTransactionList(env: Env, a: Record<string, unknown>): Promise<string> {
  await ensureSchema(env);
  const businessId = String(a.business_id || '');
  if (!businessId) return 'tax_transaction_list: business_id required';
  const taxYear = Number(a.tax_year) || currentYear();
  const category = a.category ? String(a.category) : null;
  const sql = category
    ? `SELECT id, occurred_at, direction, category, amount_cents, description FROM tax_transactions WHERE business_id = ? AND tax_year = ? AND category = ? ORDER BY occurred_at DESC LIMIT 200`
    : `SELECT id, occurred_at, direction, category, amount_cents, description FROM tax_transactions WHERE business_id = ? AND tax_year = ? ORDER BY occurred_at DESC LIMIT 200`;
  const bound = category ? env.DB.prepare(sql).bind(businessId, taxYear, category) : env.DB.prepare(sql).bind(businessId, taxYear);
  const rows = await bound.all<{ id: string; occurred_at: number; direction: string; category: string; amount_cents: number; description: string | null }>();
  const results = rows.results || [];
  if (!results.length) return '(no transactions on file for this business/tax year)';
  return results.map((r) => `${new Date(r.occurred_at).toISOString().slice(0, 10)} | ${r.direction} | ${r.category} | ${centsToDollarStr(r.amount_cents)}${r.description ? ` | ${r.description}` : ''}`).join('\n');
}

export async function taxReport(env: Env, a: Record<string, unknown>): Promise<string> {
  const businessId = String(a.business_id || '');
  if (!businessId) return 'tax_report: business_id required';
  const taxYear = Number(a.tax_year) || currentYear();
  const tx = await getTxSummary(env, businessId, taxYear);
  const netCents = netProfitCents(tx);
  const catLines = Object.entries(tx.expenseCentsByCategory)
    .sort((a2, b2) => b2[1] - a2[1])
    .map(([cat, cents]) => `  ${cat}: ${centsToDollarStr(cents)}`);
  return [
    `${taxYear} P&L for business ${businessId}:`,
    `Gross receipts: ${centsToDollarStr(tx.grossReceiptsCents)}`,
    `Total expenses: ${centsToDollarStr(tx.totalExpenseCents)}`,
    ...(catLines.length ? ['By category:', ...catLines] : []),
    `Net profit: ${centsToDollarStr(netCents)}`,
  ].join('\n');
}

// ── 1099 contractors ───────────────────────────────────────────
export async function tax1099ContractorAdd(env: Env, a: Record<string, unknown>): Promise<string> {
  await ensureSchema(env);
  const businessId = String(a.business_id || '');
  if (!businessId) return 'tax_1099_contractor_add: business_id required';
  const name = String(a.contractor_name || '').trim();
  if (!name) return 'tax_1099_contractor_add: contractor_name required';
  const taxYear = Number(a.tax_year) || currentYear();

  const existing = await env.DB.prepare(
    `SELECT id FROM tax_1099_contractors WHERE business_id = ? AND tax_year = ? AND lower(contractor_name) = lower(?)`
  ).bind(businessId, taxYear, name).first<{ id: string }>();
  if (existing) {
    if (a.w9_on_file != null) {
      await env.DB.prepare(`UPDATE tax_1099_contractors SET w9_on_file = ?, updated_at = ? WHERE id = ?`)
        .bind(a.w9_on_file ? 1 : 0, Date.now(), existing.id).run();
    }
    return JSON.stringify({ contractor_id: existing.id, note: 'existing contractor updated' });
  }
  const now = Date.now();
  const cid = id();
  await env.DB.prepare(
    `INSERT INTO tax_1099_contractors (id, business_id, tax_year, contractor_name, w9_on_file, ytd_payments_cents, threshold_met, notes, created_at, updated_at)
     VALUES (?,?,?,?,?,0,0,?,?,?)`
  ).bind(cid, businessId, taxYear, name, a.w9_on_file ? 1 : 0, a.notes ? String(a.notes).slice(0, 500) : null, now, now).run();
  return JSON.stringify({ contractor_id: cid, note: 'contractor added' });
}

export async function tax1099ContractorList(env: Env, a: Record<string, unknown>): Promise<string> {
  await ensureSchema(env);
  const businessId = String(a.business_id || '');
  if (!businessId) return 'tax_1099_contractor_list: business_id required';
  const taxYear = Number(a.tax_year) || currentYear();
  const rows = await env.DB.prepare(
    `SELECT contractor_name, w9_on_file, ytd_payments_cents, threshold_met FROM tax_1099_contractors WHERE business_id = ? AND tax_year = ? ORDER BY ytd_payments_cents DESC`
  ).bind(businessId, taxYear).all<{ contractor_name: string; w9_on_file: number; ytd_payments_cents: number; threshold_met: number }>();
  const results = rows.results || [];
  if (!results.length) return '(no contractors on file for this business/tax year)';
  const c = getFederalConstants(taxYear);
  return results.map((r) =>
    `${r.contractor_name}: ${centsToDollarStr(r.ytd_payments_cents)} YTD, W-9 ${r.w9_on_file ? 'on file' : 'MISSING'}, 1099-NEC ${r.threshold_met ? `REQUIRED (>= ${centsToDollarStr(c.nec1099ThresholdCents)})` : 'not yet required'}`
  ).join('\n');
}

// ── facts assembly for calc/credit functions ──────────────────
function toTaxFacts(factsRow: Record<string, unknown> | null, entityType: string): TaxFacts {
  const f = (factsRow || {}) as TaxFacts;
  return { ...f, entity_type: entityType };
}

// ── quarterly estimate (federal + state + local, entity-type gated) ──────
export async function taxEstimateQuarterly(env: Env, a: Record<string, unknown>): Promise<string> {
  await ensureSchema(env);
  const businessId = String(a.business_id || '');
  if (!businessId) return 'tax_estimate_quarterly: business_id required';
  const business = await requireBusiness(env, businessId).catch((e) => { throw e; });
  const taxYear = Number(a.tax_year) || currentYear();
  const quarter = Math.min(Math.max(Number(a.quarter) || currentQuarter(), 1), 4);

  if (!(PASS_THROUGH_ENTITY_TYPES as readonly string[]).includes(business.entity_type)) {
    return `tax_estimate_quarterly: entity type "${business.entity_type}" is not yet supported for tax computation in this suite (v1 covers sole proprietorships and pass-through LLCs only) — no estimate is available. This is a scope gap, not a $0 result; do not treat it as one.`;
  }

  const factsRow = await getTaxFacts(env, businessId, taxYear);
  const facts = toTaxFacts(factsRow as Record<string, unknown> | null, business.entity_type);
  const tx = await getTxSummary(env, businessId, taxYear);
  const netCents = netProfitCents(tx);
  const filingStatus = (facts.filing_status as FilingStatus) || 'single';

  const fed = getFederalConstants(taxYear);
  const se = computeSETax(netCents, fed);
  const retirementCents = dollarsToCents(facts.retirement_contributions_ytd);
  const seHealthCents = dollarsToCents(facts.self_employed_health_premiums_ytd);
  const w2Cents = dollarsToCents(facts.w2_income_estimate);
  const stdDeduction = standardDeductionCents(filingStatus, fed);
  const taxableBeforeQbi = Math.max(0, netCents - se.deductibleHalfCents - retirementCents - seHealthCents + w2Cents - stdDeduction);
  const qbi = computeQBIDeduction(netCents, se.deductibleHalfCents, retirementCents, seHealthCents, taxableBeforeQbi, filingStatus, fed);
  const taxableIncome = Math.max(0, taxableBeforeQbi - qbi.finalDeductionCents);
  const fedIncomeTax = federalIncomeTaxCents(taxableIncome, filingStatus, fed);
  const addlMedicare = additionalMedicareTaxCents(se.netEarningsCents, w2Cents, filingStatus, fed);
  const totalFederalTaxCents = se.totalSeTaxCents + fedIncomeTax + addlMedicare;

  const priorYearTaxCents = facts.prior_year_tax_liability != null ? dollarsToCents(facts.prior_year_tax_liability) : null;
  const priorYearAgiCents = facts.prior_year_agi != null ? dollarsToCents(facts.prior_year_agi) : null;
  const safeHarbor = computeSafeHarbor(totalFederalTaxCents, priorYearTaxCents, priorYearAgiCents, filingStatus, fed);

  const now = Date.now();
  const lines: string[] = [
    `Q${quarter} ${taxYear} estimated tax for business ${businessId} (${business.entity_type}):`,
    `Net profit YTD: ${centsToDollarStr(netCents)}`,
    `SE tax: ${centsToDollarStr(se.totalSeTaxCents)} (Social Security ${centsToDollarStr(se.socialSecurityTaxCents)} + Medicare ${centsToDollarStr(se.medicareTaxCents)})`,
    `QBI deduction: ${centsToDollarStr(qbi.finalDeductionCents)}${qbi.aboveCeilingApproximation ? ' (simplified above-threshold phase-out — no W-2/UBIA limitation modeled, verify with a CPA)' : ''}`,
    `Federal income tax: ${centsToDollarStr(fedIncomeTax)}`,
    ...(addlMedicare > 0 ? [`Additional Medicare Tax: ${centsToDollarStr(addlMedicare)}`] : []),
    `Total federal tax (this basis): ${centsToDollarStr(totalFederalTaxCents)}`,
    `Safe-harbor quarterly payment (${safeHarbor.basisUsed}): ${safeHarbor.requiredQuarterlyPaymentCents != null ? centsToDollarStr(safeHarbor.requiredQuarterlyPaymentCents) : 'n/a'}`,
  ];

  await env.DB.prepare(
    `INSERT INTO tax_estimates (id, business_id, tax_year, quarter, jurisdiction, net_profit_cents, se_tax_cents, income_tax_cents, qbi_deduction_cents, total_estimated_tax_cents, safe_harbor_basis, rules_version, computed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(id(), businessId, taxYear, quarter, 'federal', netCents, se.totalSeTaxCents, fedIncomeTax, qbi.finalDeductionCents, totalFederalTaxCents, safeHarbor.basisUsed, String(fed.year), now).run();

  if (isStateSupported(business.state, taxYear)) {
    const st = getStateConstants(business.state!, taxYear);
    const stdDedState = st.standardDeductionCents[filingStatus] ?? st.standardDeductionCents.single;
    const stateTaxableIncome = Math.max(0, netCents - se.deductibleHalfCents - qbi.finalDeductionCents + w2Cents - stdDedState);
    const stateTaxCents = stateIncomeTaxCents(stateTaxableIncome, st);
    lines.push(`${st.state} state income tax: ${centsToDollarStr(stateTaxCents)}`);
    await env.DB.prepare(
      `INSERT INTO tax_estimates (id, business_id, tax_year, quarter, jurisdiction, net_profit_cents, income_tax_cents, total_estimated_tax_cents, rules_version, computed_at) VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).bind(id(), businessId, taxYear, quarter, st.state, netCents, stateTaxCents, stateTaxCents, String(st.year), now).run();
  }

  if (isLocalitySupported(business.locality, taxYear)) {
    const loc = getLocalConstants(business.locality!, taxYear);
    const localEarningsCents = localEarningsTaxCents(netCents, loc);
    let localTotalCents = localEarningsCents;
    let payrollNote = '';
    if (loc.payrollExpenseTaxRate) {
      // St. Louis's separate payroll expense tax on wages paid — real
      // figure when a payroll provider is connected and synced (see
      // payroll/sync.ts), an explicit gap (never a guess) otherwise.
      const wages = await getWageSummaryCents(env, businessId, taxYear);
      if (wages.hasData) {
        const payrollTaxCents = payrollExpenseTaxCents(wages.totalWagesCents, loc.payrollExpenseTaxRate);
        localTotalCents += payrollTaxCents;
        payrollNote = ` + payroll expense tax ${centsToDollarStr(payrollTaxCents)} (on ${centsToDollarStr(wages.totalWagesCents)} synced wages via ${wages.connectedProviders.join(', ')})`;
      } else {
        payrollNote = ' (payroll expense tax on employee wages NOT included — connect and sync a payroll provider first via payroll_connection_status/payroll_sync)';
      }
    }
    lines.push(`${loc.locality} local earnings tax: ${centsToDollarStr(localEarningsCents)}${payrollNote}`);
    await env.DB.prepare(
      `INSERT INTO tax_estimates (id, business_id, tax_year, quarter, jurisdiction, net_profit_cents, income_tax_cents, total_estimated_tax_cents, rules_version, computed_at) VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).bind(id(), businessId, taxYear, quarter, loc.locality, netCents, localEarningsCents, localTotalCents, String(loc.year), now).run();
  }

  lines.push(DISCLAIMER);
  return lines.join('\n');
}

function currentQuarter(): number {
  const m = new Date().getUTCMonth() + 1; // 1-12
  return Math.ceil(m / 3);
}

// ── Schedule C prep (numbers only — not a filed form) ─────────────────────
export async function taxScheduleCPrep(env: Env, a: Record<string, unknown>): Promise<string> {
  const businessId = String(a.business_id || '');
  if (!businessId) return 'tax_schedule_c_prep: business_id required';
  const business = await requireBusiness(env, businessId);
  const taxYear = Number(a.tax_year) || currentYear();

  if (business.entity_type === 's_corp' || business.entity_type === 'c_corp') {
    return `tax_schedule_c_prep: "${business.entity_type}" files Form 1120${business.entity_type === 's_corp' ? '-S' : ''}, not Schedule C — not supported in v1.`;
  }
  if (business.entity_type === 'multi_member_llc') {
    return `tax_schedule_c_prep: a multi-member LLC files Form 1065 (partnership return) with per-owner K-1s, not Schedule C. Use tax_report for the P&L and split by ownership_pct manually until multi-owner K-1 prep is built.`;
  }

  const tx = await getTxSummary(env, businessId, taxYear);
  const net = netProfitCents(tx);
  const catLines = Object.entries(tx.expenseCentsByCategory).sort((a2, b2) => b2[1] - a2[1]).map(([cat, cents]) => `  Line (${cat}): ${centsToDollarStr(cents)}`);
  return [
    `Schedule C prep numbers for ${taxYear} — NUMBERS ONLY, this is not a filed form:`,
    `Part I — Gross receipts: ${centsToDollarStr(tx.grossReceiptsCents)}`,
    `Part II — Expenses by category:`,
    ...catLines,
    `Total expenses: ${centsToDollarStr(tx.totalExpenseCents)}`,
    `Net profit (line 31): ${centsToDollarStr(net)}`,
    'Map each category to its actual Schedule C line with a CPA before filing — this groups by your own category labels, not IRS line numbers.',
  ].join('\n');
}

// ── credit/deduction finder ─────────────────────────────────────
export async function taxCreditsFinder(env: Env, a: Record<string, unknown>): Promise<string> {
  const businessId = String(a.business_id || '');
  if (!businessId) return 'tax_credits_finder: business_id required';
  const business = await requireBusiness(env, businessId);
  const taxYear = Number(a.tax_year) || currentYear();
  const factsRow = await getTaxFacts(env, businessId, taxYear);
  const facts = toTaxFacts(factsRow as Record<string, unknown> | null, business.entity_type);
  const tx = await getTxSummary(env, businessId, taxYear);
  const hits = findCredits(facts, tx, taxYear, business.state);
  if (!hits.length) return `No eligible credits/deductions found for ${taxYear} given the facts on file — fill in more of tax_facts_status's missing groups for a fuller picture.\n\n${DISCLAIMER}`;
  const lines = hits.map((h) =>
    `${h.name} [${h.category}] — ${h.citation}${h.estimatedValueCents != null ? ` — est. ${centsToDollarStr(h.estimatedValueCents)}` : ''}${h.confidence === 'needs_review' ? ' (NEEDS REVIEW)' : ''}\n  ${h.plainLanguage}`
  );
  return [`Eligible credits/deductions for ${taxYear}:`, ...lines, '', DISCLAIMER].join('\n');
}

// ── next deadline (pure date math — deterministic, no LLM guessing) ──────
export async function taxDeadlineNext(env: Env, a: Record<string, unknown>): Promise<string> {
  const businessId = String(a.business_id || '');
  if (!businessId) return 'tax_deadline_next: business_id required';
  await requireBusiness(env, businessId);
  const now = new Date();
  const y = now.getUTCFullYear();
  // Q4's deadline (Jan 15) falls in the FOLLOWING calendar year from the tax
  // year it belongs to, so early January needs last year's Q4 deadline
  // considered too — otherwise a Jan 5 "now" skips straight past it to Apr 15.
  const deadlines = [
    { quarter: 4, date: Date.UTC(y, 0, 15) }, // prior tax year's Q4
    { quarter: 1, date: Date.UTC(y, 3, 15) },
    { quarter: 2, date: Date.UTC(y, 5, 15) },
    { quarter: 3, date: Date.UTC(y, 8, 15) },
    { quarter: 4, date: Date.UTC(y + 1, 0, 15) }, // this tax year's Q4
  ];
  const todayMs = Date.UTC(y, now.getUTCMonth(), now.getUTCDate());
  const next = deadlines.find((d) => d.date >= todayMs) || { quarter: 1, date: Date.UTC(y + 1, 3, 15) };
  const daysRemaining = Math.round((next.date - todayMs) / (24 * 60 * 60 * 1000));
  return JSON.stringify({ quarter: next.quarter, date: new Date(next.date).toISOString().slice(0, 10), days_remaining: daysRemaining });
}

// ── reminder ack (called by the autonomous run a fired watch triggers, so it doesn't refire the same quarter) ──
export async function taxReminderAck(env: Env, a: Record<string, unknown>): Promise<string> {
  await ensureSchema(env);
  const businessId = String(a.business_id || '');
  if (!businessId) return 'tax_reminder_ack: business_id required';
  const quarter = Number(a.quarter);
  if (!(quarter >= 1 && quarter <= 4)) return 'tax_reminder_ack: quarter (1-4) required';
  const taxYear = Number(a.tax_year) || currentYear();
  await env.DB.prepare(
    `INSERT INTO tax_reminders_sent (id, business_id, tax_year, quarter, sent_at) VALUES (?,?,?,?,?)`
  ).bind(id(), businessId, taxYear, quarter, Date.now()).run();
  return `acknowledged — Q${quarter} ${taxYear} reminder recorded, the deadline watch will not refire for this quarter`;
}

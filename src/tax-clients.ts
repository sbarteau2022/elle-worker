// ============================================================
// TAX CLIENTS — business/onboarding CRUD · src/tax-clients.ts
//
// Mirrors atlas-clients.ts's shape (signup → profile → auto-executed
// onboarding workflow) with one structural difference: a person can
// plausibly run several businesses of different entity types, so there is
// no single VENUE_ID-style env override here. Every tool takes an explicit
// business_id; resolveBusinessesForUser gives the caller (the /api/tax
// door, or Elle herself) the list to choose from, defaulting to the most
// recently active one when a caller doesn't specify.
//
// Onboarding is deliberately NOT a step wizard: tax_facts groups (household,
// income, retirement, health, home_office, vehicle, equipment, contractors)
// are independently upsertable in any order, any call — see updateTaxFacts.
// That's what makes "collect the givens in parallel" real rather than a
// sequential form wall.
// ============================================================

import { ensureAllSchemas } from './db/schema';
import { intentTool } from './conductor';
import { watchTool } from './watches';
import type { Env } from './index';

export const PASS_THROUGH_ENTITY_TYPES = ['sole_prop', 'single_member_llc', 'multi_member_llc'] as const;
export const ENTITY_TYPES = [...PASS_THROUGH_ENTITY_TYPES, 's_corp', 'c_corp'] as const;

export const FACT_GROUPS = ['household', 'income', 'retirement', 'health', 'home_office', 'vehicle', 'equipment', 'contractors'] as const;
export type FactGroup = typeof FACT_GROUPS[number];

// group -> DB columns it owns, so updateTaxFacts can build one UPDATE per call touching only the groups present in the request body.
const GROUP_COLUMNS: Record<FactGroup, string[]> = {
  household: ['filing_status', 'dependents_count', 'spouse_has_income'],
  income: ['w2_income_estimate', 'prior_year_tax_liability', 'prior_year_agi'],
  retirement: ['retirement_plan_type', 'retirement_contributions_ytd'],
  health: ['health_insurance_type', 'self_employed_health_premiums_ytd'],
  home_office: ['has_home_office', 'home_office_sqft', 'home_total_sqft', 'home_office_method'],
  vehicle: ['uses_vehicle_for_business', 'vehicle_business_miles_ytd', 'vehicle_method'],
  equipment: ['equipment_purchases_ytd', 'section179_candidate'],
  contractors: ['pays_contractors'],
};

export interface TaxBusiness {
  id: string; user_id: string; business_name: string; entity_type: string;
  ein_last4: string | null; state: string | null; locality: string | null; industry_naics: string | null;
  status: string; onboarding_intent_id: string | null;
  created_at: number; updated_at: number;
}

export interface TaxBusinessUnit { id: string; business_id: string; unit_name: string; address: string | null; created_at: number; updated_at: number }
export interface TaxOwner { id: string; business_id: string; owner_name: string; ownership_pct: number; created_at: number; updated_at: number }
export interface TaxFactsRow { id: string; business_id: string; tax_year: number; completed_groups: string; [col: string]: unknown }

let schemaReady = false;
async function ensureSchema(env: Env): Promise<void> {
  if (schemaReady) return;
  await ensureAllSchemas(env.DB);
  schemaReady = true;
}

const id = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);
const str = (v: unknown, max: number): string | null => {
  const s = String(v ?? '').trim().slice(0, max);
  return s || null;
};
const bool01 = (v: unknown): number | null => (v == null ? null : (v === true || v === 1 || v === '1') ? 1 : 0);
const num = (v: unknown): number | null => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));

// ── businesses ─────────────────────────────────────────────────
export async function listBusinessesForUser(env: Env, userId: string): Promise<TaxBusiness[]> {
  await ensureSchema(env);
  const rows = await env.DB.prepare(
    `SELECT * FROM tax_businesses WHERE user_id = ? ORDER BY updated_at DESC`
  ).bind(userId).all<TaxBusiness>();
  return rows.results || [];
}

export async function getBusiness(env: Env, businessId: string): Promise<TaxBusiness | null> {
  await ensureSchema(env);
  return await env.DB.prepare('SELECT * FROM tax_businesses WHERE id = ?').bind(businessId).first<TaxBusiness>();
}

// Per-request tenant lookup for /api/tax — best-effort empty list on any
// error, mirroring resolveVenueForUser's "degrade, never 500" discipline.
export async function resolveBusinessesForUser(env: Env, userId: string): Promise<Array<{ id: string; name: string; entity_type: string }>> {
  try {
    const rows = await listBusinessesForUser(env, userId);
    return rows.map((b) => ({ id: b.id, name: b.business_name, entity_type: b.entity_type }));
  } catch {
    return [];
  }
}

export interface BusinessResult { business: TaxBusiness; created: boolean; note: string }

export async function createBusiness(
  env: Env,
  user: { id: string; email?: string },
  body: Record<string, unknown>,
): Promise<BusinessResult> {
  await ensureSchema(env);

  const name = str(body.business_name, 200);
  if (!name) throw new Error('business_name required');

  // Idempotent per (user, business_name) — a user can run several
  // businesses, so unlike Atlas this checks the NAME, not "any row exists."
  const existing = await env.DB.prepare(
    `SELECT * FROM tax_businesses WHERE user_id = ? AND lower(business_name) = lower(?) LIMIT 1`
  ).bind(user.id, name).first<TaxBusiness>();
  if (existing) return { business: existing, created: false, note: 'business already exists — resuming' };

  const entityType = ENTITY_TYPES.includes(String(body.entity_type) as any) ? String(body.entity_type) : 'sole_prop';
  const now = Date.now();
  const business: TaxBusiness = {
    id: id(),
    user_id: user.id,
    business_name: name,
    entity_type: entityType,
    ein_last4: str(body.ein_last4, 4),
    state: str(body.state, 2)?.toUpperCase() ?? null,
    locality: str(body.locality, 10)?.toUpperCase() ?? null,
    industry_naics: str(body.industry_naics, 20),
    status: 'onboarding',
    onboarding_intent_id: null,
    created_at: now,
    updated_at: now,
  };

  let intentId: string | null = null;
  const supported = (PASS_THROUGH_ENTITY_TYPES as readonly string[]).includes(entityType);
  const goal =
    `New small-business tax client onboarded: "${name}" (${entityType}${business.state ? `, ${business.state}` : ''}), business_id ${business.id}, contact ${user.email}. ` +
    (supported
      ? `Review tax_facts_status for this business/current tax year; if fact-groups are missing, note which ones in a check-in. ` +
        `Once at least household + income facts are filled in, run tax_estimate_quarterly and tax_credits_finder and summarize the results. ` +
        `Done looks like: a status check has run and either an estimate/credits summary is filed or the missing facts are named for follow-up.`
      : `This entity type (${entityType}) is not yet supported for tax computation in this suite (v1 covers sole proprietorships and pass-through LLCs only) — ` +
        `no estimate should be attempted. Note the gap for a future build pass and do nothing further.`);

  try {
    const res = await intentTool(env, { op: 'create', title: `Tax onboarding — ${name}`, goal, status: 'active', source: 'stewart', priority: 6 });
    const parsed = JSON.parse(res) as { id?: string };
    intentId = parsed.id || null;
  } catch (e) {
    console.error('[TAX-CLIENT] onboarding intent filing failed:', (e as Error).message);
  }
  business.onboarding_intent_id = intentId;

  await env.DB.prepare(
    `INSERT INTO tax_businesses (id, user_id, business_name, entity_type, ein_last4, state, locality, industry_naics, status, onboarding_intent_id, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    business.id, business.user_id, business.business_name, business.entity_type, business.ein_last4,
    business.state, business.locality, business.industry_naics, business.status, business.onboarding_intent_id, business.created_at, business.updated_at,
  ).run();

  // Arm the recurring quarterly-deadline watch only for entity types this
  // suite can actually compute an estimate for — no point reminding toward
  // a number the suite can't yet produce.
  if (supported) {
    await armQuarterlyDeadlineWatch(env, business).catch((e) => console.error('[TAX-CLIENT] deadline watch arm failed:', (e as Error).message));
  }

  await env.DB.prepare(
    `INSERT INTO elle_live_events (id, event_type, source, title, body, severity) VALUES (?, 'tax_client', 'signup', ?, ?, 'info')`
  ).bind(id(), `Tax client onboarded: ${name}`, JSON.stringify({ business_id: business.id, entity_type: entityType, email: user.email, intent_id: intentId })).run().catch(() => {});

  return {
    business,
    created: true,
    note: intentId ? 'business created — onboarding workflow filed and active' : 'business created — onboarding intent failed to file, needs manual re-file',
  };
}

async function armQuarterlyDeadlineWatch(env: Env, business: TaxBusiness): Promise<void> {
  const sql = `SELECT date('now') AS today, b.business_name,
      CAST(strftime('%Y','now') AS INTEGER) AS current_year,
      (SELECT COUNT(*) FROM tax_reminders_sent r WHERE r.business_id = b.id AND r.tax_year = CAST(strftime('%Y','now') AS INTEGER) AND r.quarter = 1) AS q1_sent,
      (SELECT COUNT(*) FROM tax_reminders_sent r WHERE r.business_id = b.id AND r.tax_year = CAST(strftime('%Y','now') AS INTEGER) AND r.quarter = 2) AS q2_sent,
      (SELECT COUNT(*) FROM tax_reminders_sent r WHERE r.business_id = b.id AND r.tax_year = CAST(strftime('%Y','now') AS INTEGER) AND r.quarter = 3) AS q3_sent,
      (SELECT COUNT(*) FROM tax_reminders_sent r WHERE r.business_id = b.id AND r.tax_year = CAST(strftime('%Y','now') AS INTEGER) AND r.quarter = 4) AS q4_sent
    FROM tax_businesses b WHERE b.id = '${business.id}' LIMIT 1`;
  await watchTool(env, {
    op: 'create',
    title: `Quarterly tax deadline — ${business.business_name}`,
    check_tool: 'read_sql',
    check_args: { sql },
    condition:
      "Today's date (the `today` field) falls within 7 days BEFORE one of the federal quarterly estimated-tax deadlines — Q1 Apr 15, Q2 Jun 15, Q3 Sep 15, or Q4 Jan 15 of the following year — " +
      'AND the matching q{N}_sent count for that quarter is 0 (no reminder sent yet).',
    action_goal:
      `Notify the business owner (business_id ${business.id}, "${business.business_name}") via reach_out that a quarterly estimated-tax payment is due soon. ` +
      `Run tax_estimate_quarterly first so the message includes a real figure, not a guess. After notifying, call tax_reminder_ack for that business_id/quarter so this watch does not refire for the same quarter.`,
    recurring: true,
  });
}

// ── business units (multi-location businesses rolling up to one return) ──
export async function addUnit(env: Env, businessId: string, unitName: string, address?: string | null): Promise<TaxBusinessUnit> {
  await ensureSchema(env);
  const name = str(unitName, 200);
  if (!name) throw new Error('unit_name required');
  const now = Date.now();
  const unit: TaxBusinessUnit = { id: id(), business_id: businessId, unit_name: name, address: str(address, 300), created_at: now, updated_at: now };
  await env.DB.prepare(
    `INSERT INTO tax_business_units (id, business_id, unit_name, address, created_at, updated_at) VALUES (?,?,?,?,?,?)`
  ).bind(unit.id, unit.business_id, unit.unit_name, unit.address, unit.created_at, unit.updated_at).run();
  return unit;
}

export async function listUnits(env: Env, businessId: string): Promise<TaxBusinessUnit[]> {
  await ensureSchema(env);
  const rows = await env.DB.prepare('SELECT * FROM tax_business_units WHERE business_id = ? ORDER BY created_at ASC').bind(businessId).all<TaxBusinessUnit>();
  return rows.results || [];
}

// ── owners (pass-through profit allocation for multi-owner entities) ─────
export async function setOwners(env: Env, businessId: string, owners: Array<{ owner_name: string; ownership_pct: number }>): Promise<TaxOwner[]> {
  await ensureSchema(env);
  const cleaned = owners
    .map((o) => ({ owner_name: str(o.owner_name, 200), ownership_pct: Number(o.ownership_pct) }))
    .filter((o): o is { owner_name: string; ownership_pct: number } => !!o.owner_name && Number.isFinite(o.ownership_pct) && o.ownership_pct > 0 && o.ownership_pct <= 100);
  if (!cleaned.length) throw new Error('at least one owner with a valid owner_name and ownership_pct (0-100) required');

  // Replace-all semantics — simplest correct behavior for "set the current ownership split."
  await env.DB.prepare('DELETE FROM tax_owners WHERE business_id = ?').bind(businessId).run();
  const now = Date.now();
  const rows: TaxOwner[] = cleaned.map((o) => ({ id: id(), business_id: businessId, owner_name: o.owner_name, ownership_pct: o.ownership_pct, created_at: now, updated_at: now }));
  await env.DB.batch(rows.map((r) =>
    env.DB.prepare('INSERT INTO tax_owners (id, business_id, owner_name, ownership_pct, created_at, updated_at) VALUES (?,?,?,?,?,?)')
      .bind(r.id, r.business_id, r.owner_name, r.ownership_pct, r.created_at, r.updated_at)
  ));
  return rows;
}

export async function listOwners(env: Env, businessId: string): Promise<TaxOwner[]> {
  await ensureSchema(env);
  const rows = await env.DB.prepare('SELECT * FROM tax_owners WHERE business_id = ? ORDER BY ownership_pct DESC').bind(businessId).all<TaxOwner>();
  return rows.results || [];
}

// ── tax facts (the onboarding "givens," collected in parallel) ───────────
async function getOrCreateFactsRow(env: Env, businessId: string, taxYear: number): Promise<TaxFactsRow> {
  const existing = await env.DB.prepare('SELECT * FROM tax_facts WHERE business_id = ? AND tax_year = ?').bind(businessId, taxYear).first<TaxFactsRow>();
  if (existing) return existing;
  const now = Date.now();
  const row: TaxFactsRow = { id: id(), business_id: businessId, tax_year: taxYear, completed_groups: '[]' };
  await env.DB.prepare(
    `INSERT INTO tax_facts (id, business_id, tax_year, completed_groups, created_at, updated_at) VALUES (?,?,?,?,?,?)`
  ).bind(row.id, row.business_id, row.tax_year, row.completed_groups, now, now).run();
  return row;
}

const GROUP_COERCERS: Record<string, (v: unknown) => unknown> = {
  spouse_has_income: bool01, has_home_office: bool01, uses_vehicle_for_business: bool01, section179_candidate: bool01, pays_contractors: bool01,
  dependents_count: num, w2_income_estimate: num, prior_year_tax_liability: num, prior_year_agi: num,
  retirement_contributions_ytd: num, self_employed_health_premiums_ytd: num, home_office_sqft: num, home_total_sqft: num,
  vehicle_business_miles_ytd: num, equipment_purchases_ytd: num,
};

// Upserts only the groups present in `groups` — any subset, any order, any
// call. This (plus getTaxFactsStatus) is what makes onboarding "collect the
// givens in parallel" real instead of a step wizard.
export async function updateTaxFacts(
  env: Env,
  businessId: string,
  taxYear: number,
  groups: Partial<Record<FactGroup, Record<string, unknown>>>,
): Promise<TaxFactsRow> {
  await ensureSchema(env);
  const present = (Object.keys(groups) as FactGroup[]).filter((g) => FACT_GROUPS.includes(g) && groups[g]);
  if (!present.length) throw new Error(`no valid fact groups in request (expected one or more of: ${FACT_GROUPS.join(', ')})`);

  const row = await getOrCreateFactsRow(env, businessId, taxYear);
  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const g of present) {
    for (const col of GROUP_COLUMNS[g]) {
      const raw = (groups[g] as Record<string, unknown>)[col];
      if (raw === undefined) continue;
      const coerce = GROUP_COERCERS[col];
      sets.push(`${col} = ?`);
      binds.push(col === 'filing_status' || col === 'retirement_plan_type' || col === 'health_insurance_type' || col === 'home_office_method' || col === 'vehicle_method'
        ? str(raw, 40)
        : coerce ? coerce(raw) : raw);
    }
  }
  const completed = new Set<string>(JSON.parse(row.completed_groups || '[]'));
  for (const g of present) completed.add(g);
  sets.push('completed_groups = ?');
  binds.push(JSON.stringify([...completed]));
  sets.push('updated_at = ?');
  binds.push(Date.now());

  binds.push(businessId, taxYear);
  await env.DB.prepare(`UPDATE tax_facts SET ${sets.join(', ')} WHERE business_id = ? AND tax_year = ?`).bind(...binds).run();
  return (await env.DB.prepare('SELECT * FROM tax_facts WHERE business_id = ? AND tax_year = ?').bind(businessId, taxYear).first<TaxFactsRow>())!;
}

export interface FactsStatus { tax_year: number; completed_groups: FactGroup[]; missing_groups: FactGroup[]; all_groups: readonly FactGroup[] }

export async function getTaxFactsStatus(env: Env, businessId: string, taxYear: number): Promise<FactsStatus> {
  await ensureSchema(env);
  const row = await env.DB.prepare('SELECT completed_groups FROM tax_facts WHERE business_id = ? AND tax_year = ?').bind(businessId, taxYear).first<{ completed_groups: string }>();
  const completed = (row ? (JSON.parse(row.completed_groups || '[]') as FactGroup[]) : []).filter((g) => FACT_GROUPS.includes(g));
  const missing = FACT_GROUPS.filter((g) => !completed.includes(g));
  return { tax_year: taxYear, completed_groups: completed, missing_groups: missing, all_groups: FACT_GROUPS };
}

export async function getTaxFacts(env: Env, businessId: string, taxYear: number): Promise<TaxFactsRow | null> {
  await ensureSchema(env);
  return await env.DB.prepare('SELECT * FROM tax_facts WHERE business_id = ? AND tax_year = ?').bind(businessId, taxYear).first<TaxFactsRow>();
}

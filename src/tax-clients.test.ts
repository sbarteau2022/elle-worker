// ============================================================
// tax-clients.test.ts — Pattern A (fake-D1 execution capture), mirroring
// atlas-clients.test.ts's structure. Covers: idempotent business creation
// keyed by (user, name) rather than "any row exists" (multi-business, unlike
// Atlas's one-venue-per-client), the auto-filed conductor intent, the
// entity-type-gated deadline watch, and the parallel fact-group upsert that
// makes onboarding order-independent.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  createBusiness, resolveBusinessesForUser, setOwners, updateTaxFacts, getTaxFactsStatus, FACT_GROUPS,
  type TaxBusiness,
} from './tax-clients';
import type { Env } from './index';

interface Exec { sql: string; binds: unknown[] }

function fakeEnv(opts?: { existingBusiness?: Partial<TaxBusiness> | null }): { env: Env; execs: Exec[] } {
  const execs: Exec[] = [];
  const db = {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) { binds = args; return stmt; },
        async run() { execs.push({ sql, binds }); return { meta: { changes: 1 } }; },
        async all() { execs.push({ sql, binds }); return { results: [] }; },
        async first() {
          execs.push({ sql, binds });
          if (/FROM tax_businesses/.test(sql)) return opts?.existingBusiness ?? null;
          if (/COUNT\(\*\) AS n FROM elle_watches/.test(sql)) return { n: 0 };
          return null;
        },
      };
      return stmt;
    },
    // Real D1 batch() executes each prepared statement; mirror that here
    // (rather than a no-op stub) so batched writes — e.g. setOwners — still
    // land in `execs` for assertions.
    async batch(stmts: Array<{ run: () => Promise<unknown> }>) {
      const results = [];
      for (const s of stmts) results.push(await s.run());
      return results;
    },
  };
  return { env: { DB: db } as unknown as Env, execs };
}

const USER = { id: 'user_1', email: 'owner@business.test' };

describe('createBusiness', () => {
  it('requires business_name', async () => {
    const { env } = fakeEnv();
    await expect(createBusiness(env, USER, {})).rejects.toThrow(/business_name required/);
  });

  it('defaults to sole_prop for a missing or unrecognized entity_type', async () => {
    const { env } = fakeEnv();
    const out = await createBusiness(env, USER, { business_name: 'Acme Consulting' });
    expect(out.business.entity_type).toBe('sole_prop');
  });

  it('AUTO-files an ACTIVE onboarding intent naming the business and business_id', async () => {
    const { env, execs } = fakeEnv();
    const out = await createBusiness(env, USER, { business_name: 'Acme Consulting', state: 'mo' });
    const intentInsert = execs.find((e) => /INSERT INTO elle_intents/.test(e.sql));
    expect(intentInsert, 'no conductor intent was filed').toBeTruthy();
    const [, title, goal, status, , source] = intentInsert!.binds as string[];
    expect(title).toContain('Acme Consulting');
    expect(status).toBe('active');
    expect(source).toBe('stewart');
    expect(goal).toContain(out.business.id);
    expect(out.business.onboarding_intent_id).toBeTruthy();
  });

  it('uppercases the state code', async () => {
    const { env } = fakeEnv();
    const out = await createBusiness(env, USER, { business_name: 'Acme', state: 'mo' });
    expect(out.business.state).toBe('MO');
  });

  it('arms a recurring quarterly-deadline watch for a supported (pass-through) entity type', async () => {
    const { env, execs } = fakeEnv();
    await createBusiness(env, USER, { business_name: 'Acme', entity_type: 'sole_prop' });
    const watchInsert = execs.find((e) => /INSERT INTO elle_watches/.test(e.sql));
    expect(watchInsert, 'no watch was armed').toBeTruthy();
    const binds = watchInsert!.binds as unknown[];
    // column order: id, title, check_tool, check_args, condition, action_goal, recurring, created_at
    expect(binds[6]).toBe(1); // recurring = 1
    expect(String(binds[4])).toMatch(/quarterly estimated-tax deadlines/); // condition text
  });

  it('does NOT arm a deadline watch for an unsupported entity type (c_corp) — no point reminding toward an uncomputable number', async () => {
    const { env, execs } = fakeEnv();
    const out = await createBusiness(env, USER, { business_name: 'Acme Corp', entity_type: 'c_corp' });
    expect(out.business.entity_type).toBe('c_corp');
    expect(execs.find((e) => /INSERT INTO elle_watches/.test(e.sql))).toBeUndefined();
  });

  it('DOES arm a deadline watch for s_corp — computable once payroll is synced, so reminders are still useful', async () => {
    const { env, execs } = fakeEnv();
    const out = await createBusiness(env, USER, { business_name: 'Acme Corp', entity_type: 's_corp' });
    expect(out.business.entity_type).toBe('s_corp');
    const watchInsert = execs.find((e) => /INSERT INTO elle_watches/.test(e.sql));
    expect(watchInsert, 'no watch was armed').toBeTruthy();
  });

  it('is idempotent per (user, business_name) — never creates a second business for the same name', async () => {
    const existing: TaxBusiness = {
      id: 'biz_existing', user_id: USER.id, business_name: 'Acme', entity_type: 'sole_prop',
      ein_last4: null, state: 'MO', locality: null, industry_naics: null, county: null, county_tax_rate: null, status: 'onboarding', onboarding_intent_id: 'intent_1',
      created_at: 1, updated_at: 1,
    };
    const { env, execs } = fakeEnv({ existingBusiness: existing });
    const out = await createBusiness(env, USER, { business_name: 'Acme' });
    expect(out.created).toBe(false);
    expect(out.business.id).toBe('biz_existing');
    expect(execs.find((e) => /INSERT INTO tax_businesses/.test(e.sql))).toBeUndefined();
    expect(execs.find((e) => /INSERT INTO elle_intents/.test(e.sql))).toBeUndefined();
  });

  it('logs a live event', async () => {
    const { env, execs } = fakeEnv();
    await createBusiness(env, USER, { business_name: 'Acme' });
    const ev = execs.find((e) => /INSERT INTO elle_live_events/.test(e.sql));
    expect(ev).toBeTruthy();
    expect(String(ev!.binds[1])).toContain('Tax client onboarded');
  });
});

describe('resolveBusinessesForUser', () => {
  it('is best-effort — a DB error returns an empty list, never a thrown 500', async () => {
    const env = { DB: { prepare() { throw new Error('boom'); }, async batch() { return []; } } } as unknown as Env;
    expect(await resolveBusinessesForUser(env, USER.id)).toEqual([]);
  });
});

describe('setOwners', () => {
  it('rejects an empty or fully-invalid owner list', async () => {
    const { env } = fakeEnv();
    await expect(setOwners(env, 'biz_1', [])).rejects.toThrow(/at least one owner/);
    await expect(setOwners(env, 'biz_1', [{ owner_name: '', ownership_pct: 50 }])).rejects.toThrow(/at least one owner/);
  });

  it('replaces the full owner set and returns the new rows', async () => {
    const { env, execs } = fakeEnv();
    const owners = await setOwners(env, 'biz_1', [{ owner_name: 'Alice', ownership_pct: 60 }, { owner_name: 'Bob', ownership_pct: 40 }]);
    expect(owners.map((o) => o.owner_name)).toEqual(['Alice', 'Bob']);
    expect(execs.find((e) => /DELETE FROM tax_owners/.test(e.sql))).toBeTruthy();
    expect(execs.filter((e) => /INSERT INTO tax_owners/.test(e.sql)).length).toBe(2);
  });
});

// A small stateful fake for tax_facts — updateTaxFacts reads-then-writes-
// then-rereads, so the exec-capture-only fake above isn't enough here.
function factsFakeEnv(): { env: Env } {
  let row: Record<string, unknown> | null = null;
  const db = {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) { binds = args; return stmt; },
        async run() {
          if (/INSERT INTO tax_facts/.test(sql)) {
            row = { id: binds[0], business_id: binds[1], tax_year: binds[2], completed_groups: binds[3] };
          } else if (/UPDATE tax_facts SET/.test(sql)) {
            const setPart = sql.slice(sql.indexOf('SET') + 3, sql.indexOf('WHERE'));
            const cols = setPart.split(',').map((s) => s.trim().split('=')[0].trim());
            cols.forEach((col, i) => { if (row) row[col] = binds[i]; });
          }
          return { meta: { changes: 1 } };
        },
        async all() { return { results: [] }; },
        async first() {
          if (/FROM tax_facts/.test(sql)) return row;
          return null;
        },
      };
      return stmt;
    },
    async batch(stmts: unknown[]) { return stmts.map(() => ({ meta: {} })); },
  };
  return { env: { DB: db } as unknown as Env };
}

describe('updateTaxFacts / getTaxFactsStatus — parallel fact-group onboarding', () => {
  it('creates the facts row on first write and upserts only the groups present', async () => {
    const { env } = factsFakeEnv();
    const row = await updateTaxFacts(env, 'biz_1', 2026, { home_office: { has_home_office: true, home_office_sqft: 200 } });
    expect(row.has_home_office).toBe(1);
    expect(row.home_office_sqft).toBe(200);
    expect(JSON.parse(row.completed_groups)).toEqual(['home_office']);
  });

  it('accumulates completed_groups across independent calls in any order, without clobbering earlier groups', async () => {
    const { env } = factsFakeEnv();
    await updateTaxFacts(env, 'biz_1', 2026, { retirement: { retirement_plan_type: 'sep_ira', retirement_contributions_ytd: 5000 } });
    const row2 = await updateTaxFacts(env, 'biz_1', 2026, { vehicle: { uses_vehicle_for_business: true, vehicle_business_miles_ytd: 1200 } });
    expect(row2.retirement_plan_type).toBe('sep_ira'); // still present from the earlier call
    expect(row2.vehicle_business_miles_ytd).toBe(1200);
    expect(JSON.parse(row2.completed_groups).sort()).toEqual(['retirement', 'vehicle']);
  });

  it('rejects a request with no recognized fact groups', async () => {
    const { env } = factsFakeEnv();
    await expect(updateTaxFacts(env, 'biz_1', 2026, {})).rejects.toThrow(/no valid fact groups/);
  });

  it('getTaxFactsStatus reports missing groups against the full FACT_GROUPS list', async () => {
    const { env } = factsFakeEnv();
    await updateTaxFacts(env, 'biz_1', 2026, { household: { filing_status: 'single' } });
    const status = await getTaxFactsStatus(env, 'biz_1', 2026);
    expect(status.completed_groups).toEqual(['household']);
    expect(status.missing_groups).toEqual(FACT_GROUPS.filter((g) => g !== 'household'));
  });
});

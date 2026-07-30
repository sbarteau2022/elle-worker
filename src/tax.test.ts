// ============================================================
// tax.test.ts — Pattern B (pin the actual SQL text/binds — the level at
// which a wrong tax-year filter or a double-counted category would live)
// plus targeted behavioral tests for the two places a mistake would be most
// dangerous: taxEstimateQuarterly's entity-type gate (must NEVER return a
// guessed number for an unsupported entity type) and the Jan-15 Q4
// deadline-rollover edge case in taxDeadlineNext.
// ============================================================

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  taxReport, taxTransactionAdd, taxTransactionList, tax1099ContractorAdd,
  taxEstimateQuarterly, taxScheduleCPrep, taxDeadlineNext, taxReminderAck,
} from './tax';
import type { Env } from './index';

interface Exec { sql: string; binds: unknown[] }

function fakeEnv(opts?: {
  business?: Record<string, unknown> | null; facts?: Record<string, unknown> | null; txRows?: Array<Record<string, unknown>>;
  contractor?: Record<string, unknown> | null; payrollConnections?: Array<Record<string, unknown>>; payrollRuns?: Array<Record<string, unknown>>;
}): { env: Env; execs: Exec[] } {
  const execs: Exec[] = [];
  const db = {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) { binds = args; return stmt; },
        async run() { execs.push({ sql, binds }); return { meta: { changes: 1 } }; },
        async all() {
          execs.push({ sql, binds });
          if (/FROM tax_transactions/.test(sql)) return { results: opts?.txRows || [] };
          if (/FROM payroll_connections/.test(sql)) return { results: opts?.payrollConnections || [] };
          if (/FROM payroll_runs/.test(sql)) return { results: opts?.payrollRuns || [] };
          return { results: [] };
        },
        async first() {
          execs.push({ sql, binds });
          if (/FROM tax_businesses/.test(sql)) return opts?.business ?? null;
          if (/FROM tax_facts/.test(sql)) return opts?.facts ?? null;
          if (/FROM tax_1099_contractors/.test(sql)) return opts?.contractor ?? null;
          return null;
        },
      };
      return stmt;
    },
    async batch(stmts: Array<{ run: () => Promise<unknown> }>) { const r = []; for (const s of stmts) r.push(await s.run()); return r; },
  };
  return { env: { DB: db } as unknown as Env, execs };
}

const soleProp = { id: 'biz_1', user_id: 'u1', business_name: 'Acme', entity_type: 'sole_prop', state: 'MO', locality: null, industry_naics: null, ein_last4: null, status: 'onboarding', onboarding_intent_id: null, created_at: 0, updated_at: 0 };

describe('getTxSummary (via taxReport) — pins the SQL, verifies aggregation', () => {
  it('sums income separately from categorized expenses and computes net profit correctly', async () => {
    const txRows = [
      { direction: 'income', category: 'income_gross_receipts', amount_cents: 1_000_000 },
      { direction: 'expense', category: 'supplies', amount_cents: 200_000 },
      { direction: 'expense', category: 'supplies', amount_cents: 50_000 },
      { direction: 'expense', category: 'advertising', amount_cents: 30_000 },
    ];
    const { env, execs } = fakeEnv({ txRows });
    const report = await taxReport(env, { business_id: 'biz_1', tax_year: 2026 });
    expect(report).toContain('Gross receipts: $10000.00');
    expect(report).toContain('Total expenses: $2800.00');
    expect(report).toContain('supplies: $2500.00');
    expect(report).toContain('advertising: $300.00');
    expect(report).toContain('Net profit: $7200.00');

    const q = execs.find((e) => /FROM tax_transactions/.test(e.sql));
    expect(q!.sql).toBe('SELECT direction, category, amount_cents FROM tax_transactions WHERE business_id = ? AND tax_year = ?');
    expect(q!.binds).toEqual(['biz_1', 2026]);
  });
});

describe('taxTransactionList — pins the date/category-filtered SQL', () => {
  it('filters by business_id + tax_year only when no category given', async () => {
    const { env, execs } = fakeEnv({ txRows: [] });
    await taxTransactionList(env, { business_id: 'biz_1', tax_year: 2026 });
    const q = execs.find((e) => /SELECT id, occurred_at/.test(e.sql));
    expect(q!.sql).not.toMatch(/AND category/);
    expect(q!.binds).toEqual(['biz_1', 2026]);
  });
  it('adds the category filter and its bind when a category is given', async () => {
    const { env, execs } = fakeEnv({ txRows: [] });
    await taxTransactionList(env, { business_id: 'biz_1', tax_year: 2026, category: 'supplies' });
    const q = execs.find((e) => /SELECT id, occurred_at/.test(e.sql));
    expect(q!.sql).toMatch(/AND category = \?/);
    expect(q!.binds).toEqual(['biz_1', 2026, 'supplies']);
  });
});

describe('taxTransactionAdd', () => {
  it('validates direction, category, and amount before writing anything', async () => {
    const { env } = fakeEnv();
    expect(await taxTransactionAdd(env, { business_id: 'biz_1', direction: 'expense', category: 'x', amount: 0 })).toMatch(/positive number/);
    expect(await taxTransactionAdd(env, { business_id: 'biz_1', direction: 'sideways', category: 'x', amount: 10 })).toMatch(/income.*expense/);
    expect(await taxTransactionAdd(env, { business_id: 'biz_1', direction: 'expense', category: '', amount: 10 })).toMatch(/category required/);
  });

  it('converts dollars to cents and inserts a transaction row', async () => {
    const { env, execs } = fakeEnv();
    const out = await taxTransactionAdd(env, { business_id: 'biz_1', tax_year: 2026, direction: 'expense', category: 'supplies', amount: 125.50 });
    expect(out).toContain('$125.50');
    const insert = execs.find((e) => /INSERT INTO tax_transactions/.test(e.sql));
    expect(insert!.binds[7]).toBe(12_550); // amount_cents
  });

  it('bumps the linked contractor\'s YTD total and threshold flag when contractor_id is given', async () => {
    const { env, execs } = fakeEnv();
    await taxTransactionAdd(env, { business_id: 'biz_1', tax_year: 2026, direction: 'expense', category: 'contract_labor', amount: 500, contractor_id: 'c_1' });
    const upd = execs.find((e) => /UPDATE tax_1099_contractors/.test(e.sql));
    expect(upd, 'contractor was not updated').toBeTruthy();
    expect(upd!.binds[0]).toBe(50_000); // +$500 in cents
  });
});

describe('tax1099ContractorAdd', () => {
  it('inserts a new contractor when none exists by that name', async () => {
    const { env, execs } = fakeEnv({ contractor: null });
    const out = await tax1099ContractorAdd(env, { business_id: 'biz_1', tax_year: 2026, contractor_name: 'Jane Doe' });
    expect(out).toContain('contractor added');
    expect(execs.find((e) => /INSERT INTO tax_1099_contractors/.test(e.sql))).toBeTruthy();
  });
  it('resumes (updates) an existing contractor by name instead of duplicating', async () => {
    const { env, execs } = fakeEnv({ contractor: { id: 'c_existing' } });
    const out = await tax1099ContractorAdd(env, { business_id: 'biz_1', tax_year: 2026, contractor_name: 'Jane Doe', w9_on_file: true });
    expect(out).toContain('existing contractor updated');
    expect(execs.find((e) => /INSERT INTO tax_1099_contractors/.test(e.sql))).toBeUndefined();
  });
});

describe('taxEstimateQuarterly — entity-type gate is the safety-critical path', () => {
  it('NEVER computes a number for an unsupported entity type — returns an explicit gap message instead', async () => {
    const { env, execs } = fakeEnv({ business: { ...soleProp, entity_type: 's_corp' } });
    const out = await taxEstimateQuarterly(env, { business_id: 'biz_1', tax_year: 2026, quarter: 1 });
    expect(out).toMatch(/not yet supported/);
    expect(out).toMatch(/not a \$0 result/);
    expect(execs.find((e) => /INSERT INTO tax_estimates/.test(e.sql))).toBeUndefined();
  });

  it('computes federal + supported state + supported local legs for a pass-through business, with the disclaimer attached', async () => {
    const { env, execs } = fakeEnv({ business: { ...soleProp, locality: 'KC' }, facts: null, txRows: [] });
    const out = await taxEstimateQuarterly(env, { business_id: 'biz_1', tax_year: 2026, quarter: 1 });
    expect(out).toContain('Net profit YTD: $0.00');
    expect(out).toContain('MO state income tax');
    expect(out).toContain('KC local earnings tax');
    expect(out).toMatch(/does not replace a CPA/);
    const jurisdictions = execs.filter((e) => /INSERT INTO tax_estimates/.test(e.sql)).map((e) => e.binds[4]);
    expect(jurisdictions.sort()).toEqual(['KC', 'MO', 'federal']);
  });

  it('flags the St. Louis payroll expense tax as not-included (never a guess) when no payroll provider is synced', async () => {
    const { env } = fakeEnv({ business: { ...soleProp, locality: 'STL' }, facts: null, txRows: [], payrollConnections: [] });
    const out = await taxEstimateQuarterly(env, { business_id: 'biz_1', tax_year: 2026, quarter: 1 });
    expect(out).toContain('STL local earnings tax');
    expect(out).toMatch(/payroll expense tax on employee wages NOT included/);
  });

  it('includes a REAL St. Louis payroll expense tax figure once a payroll provider is connected and synced', async () => {
    const { env, execs } = fakeEnv({
      business: { ...soleProp, locality: 'STL' }, facts: null, txRows: [],
      payrollConnections: [{ id: 'conn_1', business_id: 'biz_1', provider: 'gusto', status: 'connected', last_synced_at: Date.now() }],
      payrollRuns: [{ total_wages_cents: 1_000_000 }], // $10,000 in synced wages for the year
    });
    const out = await taxEstimateQuarterly(env, { business_id: 'biz_1', tax_year: 2026, quarter: 1 });
    // 0.5% of $10,000 = $50.00
    expect(out).toContain('payroll expense tax $50.00');
    expect(out).toContain('$10000.00 synced wages via gusto');
    const jurisdictionInsert = execs.find((e) => /INSERT INTO tax_estimates/.test(e.sql) && e.binds[4] === 'STL');
    // total_estimated_tax_cents (index 7) includes the payroll tax on top of the earnings tax; income_tax_cents (index 6) does not.
    expect(jurisdictionInsert!.binds[7]).toBeGreaterThan(jurisdictionInsert!.binds[6] as number);
  });
});

describe('taxScheduleCPrep — entity-type branching', () => {
  it('refuses an S-corp (files 1120-S, not Schedule C)', async () => {
    const { env } = fakeEnv({ business: { ...soleProp, entity_type: 's_corp' } });
    expect(await taxScheduleCPrep(env, { business_id: 'biz_1' })).toMatch(/1120-S/);
  });
  it('refuses a multi-member LLC (files 1065, not Schedule C)', async () => {
    const { env } = fakeEnv({ business: { ...soleProp, entity_type: 'multi_member_llc' } });
    expect(await taxScheduleCPrep(env, { business_id: 'biz_1' })).toMatch(/1065/);
  });
  it('produces numbers-only output for a sole proprietorship', async () => {
    const { env } = fakeEnv({ business: soleProp, txRows: [{ direction: 'income', category: 'income_gross_receipts', amount_cents: 500_000 }] });
    const out = await taxScheduleCPrep(env, { business_id: 'biz_1', tax_year: 2026 });
    expect(out).toMatch(/not a filed form/);
    expect(out).toContain('Net profit (line 31): $5000.00');
  });
});

describe('taxDeadlineNext', () => {
  afterEach(() => vi.useRealTimers());

  it('finds the ordinary next deadline mid-quarter', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-10T00:00:00Z'));
    const { env } = fakeEnv({ business: soleProp });
    const out = JSON.parse(await taxDeadlineNext(env, { business_id: 'biz_1' }));
    expect(out).toEqual({ quarter: 1, date: '2026-04-15', days_remaining: 5 });
  });

  it('does not skip past the Jan-15 Q4-of-prior-year deadline when "now" is early January', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T00:00:00Z'));
    const { env } = fakeEnv({ business: soleProp });
    const out = JSON.parse(await taxDeadlineNext(env, { business_id: 'biz_1' }));
    expect(out).toEqual({ quarter: 4, date: '2026-01-15', days_remaining: 10 });
  });

  it('rolls over to next year\'s Q1 the day after a Q4 deadline passes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-16T00:00:00Z'));
    const { env } = fakeEnv({ business: soleProp });
    const out = JSON.parse(await taxDeadlineNext(env, { business_id: 'biz_1' }));
    expect(out.quarter).toBe(1);
    expect(out.date).toBe('2026-04-15');
  });
});

describe('taxReminderAck', () => {
  it('requires a valid quarter and records the acknowledgement', async () => {
    const { env, execs } = fakeEnv();
    expect(await taxReminderAck(env, { business_id: 'biz_1', quarter: 5 })).toMatch(/quarter \(1-4\) required/);
    const out = await taxReminderAck(env, { business_id: 'biz_1', quarter: 2, tax_year: 2026 });
    expect(out).toMatch(/Q2 2026 reminder recorded/);
    expect(execs.find((e) => /INSERT INTO tax_reminders_sent/.test(e.sql))).toBeTruthy();
  });
});

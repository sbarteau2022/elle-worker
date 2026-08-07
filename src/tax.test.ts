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
  it('NEVER computes a number for C-corp — returns an explicit gap message instead', async () => {
    const { env, execs } = fakeEnv({ business: { ...soleProp, entity_type: 'c_corp' } });
    const out = await taxEstimateQuarterly(env, { business_id: 'biz_1', tax_year: 2026, quarter: 1 });
    expect(out).toMatch(/not yet supported/);
    expect(out).toMatch(/not a \$0 result/);
    expect(execs.find((e) => /INSERT INTO tax_estimates/.test(e.sql))).toBeUndefined();
  });

  it('NEVER guesses an S-corp salary/distribution split — refuses until real payroll data is synced', async () => {
    const { env, execs } = fakeEnv({ business: { ...soleProp, entity_type: 's_corp' }, payrollConnections: [] });
    const out = await taxEstimateQuarterly(env, { business_id: 'biz_1', tax_year: 2026, quarter: 1 });
    expect(out).toMatch(/requires a real reasonable-salary figure/);
    expect(execs.find((e) => /INSERT INTO tax_estimates/.test(e.sql))).toBeUndefined();
  });

  it('computes a real S-corp estimate once payroll wages are synced: FICA on salary, no SE tax, QBI on distributions only', async () => {
    const { env, execs } = fakeEnv({
      business: { ...soleProp, entity_type: 's_corp' }, facts: null,
      txRows: [{ direction: 'income', category: 'income_gross_receipts', amount_cents: 10_000_000 }], // $100,000 net profit
      payrollConnections: [{ id: 'conn_1', business_id: 'biz_1', provider: 'gusto', status: 'connected', last_synced_at: Date.now() }],
      payrollRuns: [{ total_wages_cents: 6_000_000 }], // $60,000 salary
    });
    const out = await taxEstimateQuarterly(env, { business_id: 'biz_1', tax_year: 2026, quarter: 1 });
    expect(out).toMatch(/FICA on \$60000\.00 salary/);
    expect(out).toMatch(/distributions \(\$40000\.00\) owe NO payroll or SE tax/);
    expect(out).toMatch(/QBI deduction \(on distributions only\)/);
    expect(out).not.toContain('SE tax:');
    const federalInsert = execs.find((e) => /INSERT INTO tax_estimates/.test(e.sql) && e.binds[4] === 'federal');
    // se_tax_cents column (index 6) actually holds the FICA total for an S-corp — real (60,000 salary), not zero.
    expect(federalInsert!.binds[6]).toBeGreaterThan(0);
  });

  // AUDIT E1 — FICA on an S-corp salary is remitted by the corporation via
  // Form 941 payroll deposits. It was being folded into the safe-harbor basis,
  // telling the owner to pay it a second time through 1040-ES ($8,262/yr on
  // this exact fixture).
  it('keeps FICA OUT of the S-corp safe-harbor quarterly payment — it is remitted via Form 941, not 1040-ES', async () => {
    const { env } = fakeEnv({
      business: { ...soleProp, entity_type: 's_corp', state: null, locality: null }, facts: null,
      txRows: [{ direction: 'income', category: 'income_gross_receipts', amount_cents: 12_000_000 }], // $120,000
      payrollConnections: [{ id: 'conn_1', business_id: 'biz_1', provider: 'gusto', status: 'connected', last_synced_at: Date.now() }],
      payrollRuns: [{ total_wages_cents: 6_000_000 }], // $60,000 salary → $9,180 FICA
    });
    const out = await taxEstimateQuarterly(env, { business_id: 'biz_1', tax_year: 2026, quarter: 1 });

    const total = Number(/Total federal tax \(this basis\): \$([\d.]+)/.exec(out)![1]);
    const quarterly = Number(/Safe-harbor quarterly payment \([^)]*\), 1040-ES only: \$([\d.]+)/.exec(out)![1]);
    // 90% of a basis that still contained $9,180 of FICA would be at least
    // 0.9 * 9180 / 4 = $2,065.50 higher than this.
    expect(quarterly).toBeCloseTo(((total - 9180) * 0.9) / 4, 1);
    expect(out).toMatch(/remitted by the corporation via payroll deposits \(Form 941\)/);
    expect(out).toMatch(/excluded from the quarterly figure/);
  });

  it('still includes a sole proprietor\'s SE tax in the safe-harbor basis — that one IS paid through 1040-ES', async () => {
    const { env } = fakeEnv({
      business: { ...soleProp, state: null, locality: null }, facts: null,
      txRows: [{ direction: 'income', category: 'income_gross_receipts', amount_cents: 12_000_000 }],
    });
    const out = await taxEstimateQuarterly(env, { business_id: 'biz_1', tax_year: 2026, quarter: 1 });
    const total = Number(/Total federal tax \(this basis\): \$([\d.]+)/.exec(out)![1]);
    const quarterly = Number(/Safe-harbor quarterly payment \([^)]*\): \$([\d.]+)/.exec(out)![1]);
    expect(quarterly).toBeCloseTo((total * 0.9) / 4, 1); // full basis, nothing removed
    expect(out).not.toMatch(/Form 941/);
  });

  // AUDIT E2 — net profit comes from tax_transactions, wages from
  // payroll_line_items, and nothing reconciles them. If the ledger already
  // books payroll as an expense, subtracting salary again erased the entire
  // QBI base.
  it('does not subtract an S-corp salary twice when the ledger already books payroll as an expense', async () => {
    const { env } = fakeEnv({
      business: { ...soleProp, entity_type: 's_corp', state: null, locality: null }, facts: null,
      txRows: [
        { direction: 'income', category: 'income_gross_receipts', amount_cents: 12_000_000 },
        { direction: 'expense', category: 'Payroll', amount_cents: 6_000_000 }, // salary already expensed → $60k net
      ],
      payrollConnections: [{ id: 'conn_1', business_id: 'biz_1', provider: 'gusto', status: 'connected', last_synced_at: Date.now() }],
      payrollRuns: [{ total_wages_cents: 6_000_000 }],
    });
    const out = await taxEstimateQuarterly(env, { business_id: 'biz_1', tax_year: 2026, quarter: 1 });
    // Net profit is already net of salary, so the distribution is that $60,000
    // — not $0, which is what subtracting the salary a second time produced.
    expect(out).toMatch(/distributions \(\$60000\.00\)/);
    expect(out).toMatch(/payroll IS already booked as an expense \(Payroll = \$60000\.00\)/);
    expect(out).toMatch(/salary was not subtracted twice/);
  });

  it('states which ledger convention it used even when no payroll categories are found', async () => {
    const { env } = fakeEnv({
      business: { ...soleProp, entity_type: 's_corp', state: null, locality: null }, facts: null,
      txRows: [{ direction: 'income', category: 'income_gross_receipts', amount_cents: 12_000_000 }],
      payrollConnections: [{ id: 'conn_1', business_id: 'biz_1', provider: 'gusto', status: 'connected', last_synced_at: Date.now() }],
      payrollRuns: [{ total_wages_cents: 6_000_000 }],
    });
    const out = await taxEstimateQuarterly(env, { business_id: 'biz_1', tax_year: 2026, quarter: 1 });
    expect(out).toMatch(/no payroll-categorised expenses found/);
    expect(out).toMatch(/distributions \(\$60000\.00\)/); // $120k - $60k
  });

  it('never leaves an S-corp\'s local (KC/STL) tax silently unhandled — flags it as not-modeled rather than applying sole-prop mechanics', async () => {
    const { env } = fakeEnv({
      business: { ...soleProp, entity_type: 's_corp', locality: 'KC' }, facts: null, txRows: [],
      payrollConnections: [{ id: 'conn_1', business_id: 'biz_1', provider: 'gusto', status: 'connected', last_synced_at: Date.now() }],
      payrollRuns: [{ total_wages_cents: 1_000_000 }],
    });
    const out = await taxEstimateQuarterly(env, { business_id: 'biz_1', tax_year: 2026, quarter: 1 });
    expect(out).toMatch(/KC local earnings tax NOT included for an S-corp/);
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

  // AUDIT E5 — MO/KS/IL/IN all begin from FEDERAL AGI. Retirement and SE
  // health premiums are above-the-line (they reduce AGI, so they carry into
  // the state base); the QBI deduction is below-the-line (it does not). This
  // was inverted in both directions, which moved every state figure.
  it('state base follows federal AGI: retirement + SE health reduce it, the QBI deduction does not', async () => {
    const mk = (facts: Record<string, unknown> | null) => fakeEnv({
      business: { ...soleProp, locality: null }, facts,
      txRows: [{ direction: 'income', category: 'income_gross_receipts', amount_cents: 10_000_000 }], // $100,000
    });
    const stateTax = async (facts: Record<string, unknown> | null) => {
      const out = await taxEstimateQuarterly(mk(facts).env, { business_id: 'biz_1', tax_year: 2026, quarter: 1 });
      return Number(/MO state income tax: \$([\d.]+)/.exec(out)![1]);
    };

    const plain = await stateTax(null);
    // $20,000 of above-the-line deductions must lower the Missouri base.
    const withAboveTheLine = await stateTax({ retirement_contributions_ytd: 15_000, self_employed_health_premiums_ytd: 5_000 });
    expect(withAboveTheLine).toBeLessThan(plain);

    // MO's top marginal rate is well under 100%, so a $20,000 smaller base
    // cannot move the tax by more than $20,000 — guards against the reduction
    // being applied to the wrong quantity.
    expect(plain - withAboveTheLine).toBeGreaterThan(0);
    expect(plain - withAboveTheLine).toBeLessThan(20_000);
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

  it('adds Illinois\'s entity-level Personal Property Replacement Tax for a multi-member LLC, never for a sole prop', async () => {
    const { env: envMMLLC } = fakeEnv({ business: { ...soleProp, entity_type: 'multi_member_llc', state: 'IL', locality: null }, facts: null, txRows: [{ direction: 'income', category: 'income_gross_receipts', amount_cents: 10_000_000 }] });
    const outMMLLC = await taxEstimateQuarterly(envMMLLC, { business_id: 'biz_1', tax_year: 2026, quarter: 1 });
    expect(outMMLLC).toMatch(/entity-level tax/);

    const { env: envSoleProp } = fakeEnv({ business: { ...soleProp, state: 'IL', locality: null }, facts: null, txRows: [{ direction: 'income', category: 'income_gross_receipts', amount_cents: 10_000_000 }] });
    const outSoleProp = await taxEstimateQuarterly(envSoleProp, { business_id: 'biz_1', tax_year: 2026, quarter: 1 });
    expect(outSoleProp).not.toMatch(/entity-level tax/);
  });

  it('adds Indiana county tax when the business has a rate on file, and flags its absence otherwise', async () => {
    const { env: withCounty } = fakeEnv({ business: { ...soleProp, state: 'IN', locality: null, county: 'Marion', county_tax_rate: 0.0202 }, facts: null, txRows: [] });
    const out1 = await taxEstimateQuarterly(withCounty, { business_id: 'biz_1', tax_year: 2026, quarter: 1 });
    expect(out1).toMatch(/Marion local income tax \(Indiana\)/);

    const { env: withoutCounty } = fakeEnv({ business: { ...soleProp, state: 'IN', locality: null, county: null, county_tax_rate: null }, facts: null, txRows: [] });
    const out2 = await taxEstimateQuarterly(withoutCounty, { business_id: 'biz_1', tax_year: 2026, quarter: 1 });
    expect(out2).toMatch(/Indiana county income tax NOT included/);
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

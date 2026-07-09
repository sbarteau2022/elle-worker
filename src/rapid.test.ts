import { describe, it, expect } from 'vitest';
import { rapidCosts, rapidVariance, type RapidEnv } from './rapid';

// rapid.ts had zero test coverage before this file — which is exactly how
// three real defects in rapidVariance() shipped silently and stayed live in
// production (confirmed against rapid2ai-db, not hypothetical):
//   1. document_date is stored MM/DD/YYYY; comparing it against SQLite's
//      date('now', ...) (ISO) as a raw string is always false, so the 90-day
//      window matched 0 of 147 real invoice rows — rapid_variance() could
//      never return anything but "No variance data available."
//   2. rapidVariance() had no document_type filter (rapidCosts() does),
//      so a CREDIT_MEMO or FWC_INV line could blend into a delivery SKU's
//      price distribution.
//   3. is_catch_weight wasn't part of the GROUP BY, so a SKU flagged
//      catch-weight on some deliveries and not others got priced on two
//      incompatible bases (dollars/lb vs. dollars/qty) under one label.
//
// D1 has no in-process JS driver to execute against here, so these tests
// pin the actual SQL text sent to D1 — the level at which the bugs lived —
// rather than mocking query results. A regression that drops one of these
// clauses again will fail this file loudly, the way it should have the
// first time.

function fakeEnv(): { env: RapidEnv; sqlSeen: string[] } {
  const sqlSeen: string[] = [];
  const stmt = {
    bind: (..._args: unknown[]) => stmt,
    all: async () => ({ results: [] }),
  };
  const db = {
    prepare: (sql: string) => { sqlSeen.push(sql); return stmt; },
  } as unknown as D1Database;
  const env = { RAPID_DB: db, VENUE_ID: 'ven_test' } as unknown as RapidEnv;
  return { env, sqlSeen };
}

describe('rapidVariance SQL', () => {
  it('restricts to actual deliveries, like rapidCosts does', async () => {
    const { env, sqlSeen } = fakeEnv();
    await rapidVariance(env);
    expect(sqlSeen[0]).toMatch(/document_type IN \(\s*'INVOICE'\s*,\s*'VEND_SHIP'\s*\)/);
  });

  it('compares document_date in ISO form, not the raw MM/DD/YYYY string', async () => {
    const { env, sqlSeen } = fakeEnv();
    await rapidVariance(env);
    // the raw-column comparison that was always false for every real row
    expect(sqlSeen[0]).not.toMatch(/vd\.document_date\s*>=\s*date\(/);
    // the reformatted-to-ISO comparison that actually matches real rows
    expect(sqlSeen[0]).toMatch(/substr\(vd\.document_date,\s*7,\s*4\)/);
    expect(sqlSeen[0]).toMatch(/>=\s*date\('now', '-90 days'\)/);
  });

  it('groups by is_catch_weight so mixed-basis deliveries of one SKU never blend', async () => {
    const { env, sqlSeen } = fakeEnv();
    await rapidVariance(env);
    const groupBy = sqlSeen[0].match(/GROUP BY([^\n]+)/)?.[1] ?? '';
    expect(groupBy).toMatch(/vdl\.is_catch_weight/);
  });

  it('excludes zero-dollar / void lines that would zero out MIN() for a SKU', async () => {
    const { env, sqlSeen } = fakeEnv();
    await rapidVariance(env);
    expect(sqlSeen[0]).toMatch(/extended_price_cents\s*>\s*0/);
    expect(sqlSeen[0]).toMatch(/is_catch_weight\s*=\s*0\s*OR\s*vdl\.weight_lb\s*>\s*0/);
  });
});

describe('rapidCosts SQL', () => {
  it('orders by document_date in ISO form, not the raw MM/DD/YYYY string', async () => {
    const { env, sqlSeen } = fakeEnv();
    await rapidCosts(env);
    expect(sqlSeen[0]).not.toMatch(/ORDER BY vd\.document_date DESC/);
    expect(sqlSeen[0]).toMatch(/ORDER BY \(substr\(vd\.document_date,\s*7,\s*4\)[\s\S]*DESC/);
  });
});

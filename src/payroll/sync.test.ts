// ============================================================
// sync.test.ts — Pattern A (fake-D1 capture / in-memory tables) for the
// connect/refresh/store CRUD, plus vi.stubGlobal('fetch') integration tests
// for the two flows that actually call out to a provider (completeConnect,
// syncConnection) since sync.ts doesn't thread a fetchImpl override through
// to the adapters the way the adapter unit tests do.
// ============================================================

import { describe, it, expect, vi, afterEach } from 'vitest';
import { startConnect, completeConnect, syncConnection, getWageSummaryCents, listConnections, decodeState, encodeState } from './sync';
import { decryptToken } from './crypto';
import type { Env } from '../index';

const ENC_KEY = 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=';

type Op = '=' | '!=' | '>=' | '<=' | '>' | '<';
interface Cond { col: string; op: Op }

function makeFakeDB() {
  const tables: Record<string, Array<Record<string, any>>> = { payroll_connections: [], payroll_employees: [], payroll_runs: [], payroll_line_items: [] };
  const tableName = (sql: string): string => {
    const m = sql.match(/FROM\s+(\w+)/i) || sql.match(/INTO\s+(\w+)/i) || sql.match(/UPDATE\s+(\w+)/i);
    return m ? m[1] : '';
  };
  // Ordered longest-operator-first so >=/<=/!= aren't mistaken for a bare =/>/<.
  const whereConditions = (sql: string): Cond[] => {
    if (!/WHERE/i.test(sql)) return [];
    const wherePart = sql.slice(sql.toUpperCase().indexOf('WHERE') + 5);
    return [...wherePart.matchAll(/(\w+)\s*(>=|<=|!=|=|>|<)\s*\?/g)].map((m) => ({ col: m[1], op: m[2] as Op }));
  };
  const matchRow = (row: Record<string, any>, conditions: Cond[], binds: unknown[]): boolean =>
    conditions.every((cond, i) => {
      const v = binds[i] as any; const rv = row[cond.col];
      switch (cond.op) {
        case '=': return rv === v;
        case '!=': return rv !== v;
        case '>=': return rv >= v;
        case '<=': return rv <= v;
        case '>': return rv > v;
        case '<': return rv < v;
      }
    });

  const db = {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) { binds = args; return stmt; },
        async run() {
          const t = tableName(sql);
          if (/^INSERT/i.test(sql.trim())) {
            const cols = sql.match(/\(([^)]+)\)\s*VALUES/i)![1].split(',').map((c) => c.trim());
            const row: Record<string, unknown> = {};
            cols.forEach((c, i) => { row[c] = binds[i]; });
            tables[t].push(row);
          } else if (/^UPDATE/i.test(sql.trim())) {
            const setClause = sql.slice(sql.indexOf('SET') + 3, sql.toUpperCase().indexOf('WHERE'));
            const setPlaceholders = (setClause.match(/\?/g) || []).length;
            const setBinds = binds.slice(0, setPlaceholders);
            const wConditions = whereConditions(sql.slice(sql.toUpperCase().indexOf('WHERE')));
            const wBinds = binds.slice(setPlaceholders);
            const row = tables[t].find((r) => matchRow(r, wConditions, wBinds));
            if (row) {
              let bindIdx = 0;
              for (const segment of setClause.split(',')) {
                const eq = segment.indexOf('=');
                const col = segment.slice(0, eq).trim();
                const val = segment.slice(eq + 1).trim();
                if (val === '?') { row[col] = setBinds[bindIdx]; bindIdx++; }
                else if (/^NULL$/i.test(val)) { row[col] = null; }
                else if (/^COALESCE/i.test(val)) { const v = setBinds[bindIdx]; bindIdx++; if (v != null) row[col] = v; }
              }
            }
          } else if (/^DELETE/i.test(sql.trim())) {
            const wConditions = whereConditions(sql);
            tables[t] = tables[t].filter((r) => !matchRow(r, wConditions, binds));
          }
          return { meta: { changes: 1 } };
        },
        async all() {
          const t = tableName(sql);
          const wConditions = whereConditions(sql);
          return { results: (tables[t] || []).filter((r) => matchRow(r, wConditions, binds)) };
        },
        async first() {
          const t = tableName(sql);
          const wConditions = whereConditions(sql);
          return (tables[t] || []).find((r) => matchRow(r, wConditions, binds)) ?? null;
        },
      };
      return stmt;
    },
    async batch(stmts: Array<{ run: () => Promise<unknown> }>) { const r = []; for (const s of stmts) r.push(await s.run()); return r; },
  };
  return { db, tables };
}

function fakeEnv(extra: Record<string, unknown> = {}) {
  const { db, tables } = makeFakeDB();
  const env = { DB: db, PAYROLL_TOKEN_ENC_KEY: ENC_KEY, ...extra } as unknown as Env;
  return { env, tables };
}

afterEach(() => vi.unstubAllGlobals());

describe('encodeState / decodeState', () => {
  it('round-trips business_id and provider', () => {
    const s = encodeState('biz_1', 'quickbooks');
    expect(decodeState(s)).toEqual({ business_id: 'biz_1', provider: 'quickbooks' });
  });
  it('returns null for garbage input rather than throwing', () => {
    expect(decodeState('not-valid-base64-json!!!')).toBeNull();
  });
});

describe('startConnect', () => {
  it('refuses when the provider is not configured', async () => {
    const { env } = fakeEnv();
    const out = await startConnect(env, 'biz_1', 'quickbooks');
    expect(out.note).toMatch(/not configured/);
    expect(out.authorizationUrl).toBeUndefined();
  });

  it('refuses when the encryption key is unset, even if the provider itself is configured', async () => {
    const { env } = fakeEnv({ PAYROLL_TOKEN_ENC_KEY: undefined, QUICKBOOKS_CLIENT_ID: 'x', QUICKBOOKS_CLIENT_SECRET: 'y', QUICKBOOKS_REDIRECT_URI: 'https://w/cb' });
    const out = await startConnect(env, 'biz_1', 'quickbooks');
    expect(out.note).toMatch(/PAYROLL_TOKEN_ENC_KEY/);
  });

  it('returns an authorization URL for QuickBooks when configured', async () => {
    const { env } = fakeEnv({ QUICKBOOKS_CLIENT_ID: 'x', QUICKBOOKS_CLIENT_SECRET: 'y', QUICKBOOKS_REDIRECT_URI: 'https://w/cb' });
    const out = await startConnect(env, 'biz_1', 'quickbooks');
    expect(out.authorizationUrl).toContain('appcenter.intuit.com');
  });

  it('connects ADP immediately (client-credentials, no redirect) and stores an encrypted token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ access_token: 'adp-at', expires_in: 3600 }), { status: 200 })));
    const { env, tables } = fakeEnv({ ADP_CLIENT_ID: 'x', ADP_CLIENT_SECRET: 'y', ADP_MTLS_CERT: { fetch } });
    const out = await startConnect(env, 'biz_1', 'adp');
    expect(out.connected).toBe(true);
    expect(tables.payroll_connections).toHaveLength(1);
    expect(await decryptToken(tables.payroll_connections[0].access_token_enc, env)).toBe('adp-at');
  });
});

describe('completeConnect', () => {
  it('exchanges a code, encrypts and stores the tokens, and is idempotent per (business, provider)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ access_token: 'qb-at', refresh_token: 'qb-rt', expires_in: 3600, token_type: 'bearer' }), { status: 200 })));
    const { env, tables } = fakeEnv({ QUICKBOOKS_CLIENT_ID: 'x', QUICKBOOKS_CLIENT_SECRET: 'y', QUICKBOOKS_REDIRECT_URI: 'https://w/cb' });
    await completeConnect(env, 'biz_1', 'quickbooks', 'authcode1');
    expect(tables.payroll_connections).toHaveLength(1);
    expect(await decryptToken(tables.payroll_connections[0].access_token_enc, env)).toBe('qb-at');

    await completeConnect(env, 'biz_1', 'quickbooks', 'authcode2');
    expect(tables.payroll_connections).toHaveLength(1); // updated in place, not duplicated
  });
});

describe('syncConnection', () => {
  it('refuses when there is no connection on file', async () => {
    const { env } = fakeEnv();
    const out = await syncConnection(env, 'biz_1', 'gusto');
    expect(out.synced).toBe(false);
    expect(out.note).toMatch(/connect it first/);
  });

  it('pulls employees + payroll runs and stores them, marking the connection synced', async () => {
    const { env, tables } = fakeEnv({ GUSTO_CLIENT_ID: 'x', GUSTO_CLIENT_SECRET: 'y', GUSTO_REDIRECT_URI: 'https://w/cb' });
    const now = Date.now();
    tables.payroll_connections.push({
      id: 'conn_1', business_id: 'biz_1', provider: 'gusto', status: 'connected',
      access_token_enc: await (await import('./crypto')).encryptToken('gusto-at', env),
      refresh_token_enc: null, token_expires_at: now + 3600_000, external_account_id: 'company_1',
      scope: null, last_synced_at: null, last_sync_error: null, created_at: now, updated_at: now,
    });

    vi.stubGlobal('fetch', vi.fn(async (input: any) => {
      const url = String(input);
      if (url.includes('/employees')) return new Response(JSON.stringify([{ id: 'e1', first_name: 'Jane', last_name: 'Doe', jobs: [{ title: 'Server' }] }]), { status: 200 });
      if (url.includes('/payrolls')) return new Response(JSON.stringify([{
        payroll_uuid: 'run1', pay_period: { start_date: '2026-07-01', end_date: '2026-07-15' }, check_date: '2026-07-18', processed: true,
        totals: { gross_pay: '1000.00' }, employee_compensations: [{ employee_id: 'e1', gross_pay: '1000.00', net_pay: '800.00' }],
      }]), { status: 200 });
      throw new Error(`unexpected fetch: ${url}`);
    }));

    const out = await syncConnection(env, 'biz_1', 'gusto');
    expect(out).toEqual({ synced: true, employees: 1, runs: 1, note: 'gusto: synced 1 employee(s), 1 payroll run(s)' });
    expect(tables.payroll_employees).toHaveLength(1);
    expect(tables.payroll_runs).toHaveLength(1);
    expect(tables.payroll_runs[0].total_wages_cents).toBe(100000);
    expect(tables.payroll_line_items).toHaveLength(1);
    expect(tables.payroll_line_items[0].gross_pay_cents).toBe(100000);
    expect(tables.payroll_connections[0].last_synced_at).toBeTruthy();
  });

  it('marks the connection as errored (with the failure message) rather than throwing, when the provider call fails', async () => {
    const { env, tables } = fakeEnv({ GUSTO_CLIENT_ID: 'x', GUSTO_CLIENT_SECRET: 'y', GUSTO_REDIRECT_URI: 'https://w/cb' });
    const now = Date.now();
    tables.payroll_connections.push({
      id: 'conn_1', business_id: 'biz_1', provider: 'gusto', status: 'connected',
      access_token_enc: await (await import('./crypto')).encryptToken('gusto-at', env),
      refresh_token_enc: null, token_expires_at: now + 3600_000, external_account_id: 'company_1',
      scope: null, last_synced_at: null, last_sync_error: null, created_at: now, updated_at: now,
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('server error', { status: 500 })));

    const out = await syncConnection(env, 'biz_1', 'gusto');
    expect(out.synced).toBe(false);
    expect(out.note).toMatch(/sync failed/);
    expect(tables.payroll_connections[0].status).toBe('error');
    expect(tables.payroll_connections[0].last_sync_error).toMatch(/HTTP 500/);
  });
});

describe('getWageSummaryCents', () => {
  it('reports no data when there are no connected+synced providers', async () => {
    const { env } = fakeEnv();
    const out = await getWageSummaryCents(env, 'biz_1', 2026);
    expect(out).toEqual({ totalWagesCents: 0, hasData: false, connectedProviders: [] });
  });

  it('sums total_wages_cents across payroll_runs within the tax year', async () => {
    const { env, tables } = fakeEnv();
    const now = Date.now();
    tables.payroll_connections.push({ id: 'conn_1', business_id: 'biz_1', provider: 'gusto', status: 'connected', last_synced_at: now, created_at: now, updated_at: now });
    tables.payroll_runs.push(
      { id: 'r1', business_id: 'biz_1', pay_period_start: '2026-03-01', total_wages_cents: 100000 },
      { id: 'r2', business_id: 'biz_1', pay_period_start: '2026-11-01', total_wages_cents: 50000 },
      { id: 'r3', business_id: 'biz_1', pay_period_start: '2025-12-01', total_wages_cents: 999999 }, // outside 2026 — must not be counted
    );
    const out = await getWageSummaryCents(env, 'biz_1', 2026);
    expect(out.totalWagesCents).toBe(150000);
    expect(out.hasData).toBe(true);
    expect(out.connectedProviders).toEqual(['gusto']);
  });
});

describe('listConnections', () => {
  it('lists only the given business\'s connections', async () => {
    const { env, tables } = fakeEnv();
    tables.payroll_connections.push({ id: 'c1', business_id: 'biz_1', provider: 'gusto' }, { id: 'c2', business_id: 'biz_2', provider: 'quickbooks' });
    const out = await listConnections(env, 'biz_1');
    expect(out).toEqual([{ id: 'c1', business_id: 'biz_1', provider: 'gusto' }]);
  });
});

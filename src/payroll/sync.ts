// ============================================================
// PAYROLL SYNC — provider-agnostic connect/refresh/pull · src/payroll/sync.ts
//
// Every provider adapter (quickbooks.ts/gusto.ts/adp.ts) speaks the same
// PayrollProviderAdapter shape; this file is the ONLY place that touches
// D1 or encryption for payroll data. Doors (index.ts) and router tools
// (tax.ts) call these functions, never the adapters or crypto.ts directly.
// ============================================================

import { ensureAllSchemas } from '../db/schema';
import type { Env } from '../index';
import { encryptToken, decryptToken, encryptionConfigured } from './crypto';
import { quickbooksAdapter } from './quickbooks';
import { gustoAdapter } from './gusto';
import { adpAdapter } from './adp';
import type { PayrollProviderAdapter, ProviderName, TokenSet } from './provider';

export const ADAPTERS: Record<ProviderName, PayrollProviderAdapter> = {
  quickbooks: quickbooksAdapter,
  gusto: gustoAdapter,
  adp: adpAdapter,
};
export const PROVIDER_NAMES = Object.keys(ADAPTERS) as ProviderName[];

let schemaReady = false;
async function ensureSchema(env: Env): Promise<void> {
  if (schemaReady) return;
  await ensureAllSchemas(env.DB);
  schemaReady = true;
}

const id = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);

export interface PayrollConnectionRow {
  id: string; business_id: string; provider: ProviderName; status: string;
  access_token_enc: string | null; refresh_token_enc: string | null; token_expires_at: number | null;
  external_account_id: string | null; scope: string | null;
  last_synced_at: number | null; last_sync_error: string | null;
  created_at: number; updated_at: number;
}

export function getAdapter(provider: string): PayrollProviderAdapter {
  const adapter = ADAPTERS[provider as ProviderName];
  if (!adapter) throw new Error(`payroll: unknown provider "${provider}" (supported: ${PROVIDER_NAMES.join(', ')})`);
  return adapter;
}

export async function getConnection(env: Env, businessId: string, provider: string): Promise<PayrollConnectionRow | null> {
  await ensureSchema(env);
  return await env.DB.prepare('SELECT * FROM payroll_connections WHERE business_id = ? AND provider = ?').bind(businessId, provider).first<PayrollConnectionRow>();
}

export async function listConnections(env: Env, businessId: string): Promise<PayrollConnectionRow[]> {
  await ensureSchema(env);
  const rows = await env.DB.prepare('SELECT * FROM payroll_connections WHERE business_id = ?').bind(businessId).all<PayrollConnectionRow>();
  return rows.results || [];
}

async function upsertConnection(env: Env, businessId: string, provider: ProviderName, tokens: TokenSet, status: string): Promise<void> {
  const now = Date.now();
  const accessEnc = await encryptToken(tokens.accessToken, env);
  const refreshEnc = tokens.refreshToken ? await encryptToken(tokens.refreshToken, env) : null;
  const existing = await getConnection(env, businessId, provider);
  if (existing) {
    await env.DB.prepare(
      `UPDATE payroll_connections SET status=?, access_token_enc=?, refresh_token_enc=?, token_expires_at=?, external_account_id=COALESCE(?, external_account_id), scope=?, last_sync_error=NULL, updated_at=? WHERE id=?`
    ).bind(status, accessEnc, refreshEnc, tokens.expiresAt, tokens.externalAccountId ?? null, tokens.scope ?? null, now, existing.id).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO payroll_connections (id, business_id, provider, status, access_token_enc, refresh_token_enc, token_expires_at, external_account_id, scope, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(id(), businessId, provider, status, accessEnc, refreshEnc, tokens.expiresAt, tokens.externalAccountId ?? null, tokens.scope ?? null, now, now).run();
  }
}

// ── connect flow ───────────────────────────────────────────────
// State is a base64 JSON blob the callback decodes directly (not looked up
// server-side against a stored nonce) — an accepted simplification for a
// single-operator context; a multi-tenant public rollout should upgrade
// this to a server-verified nonce before going further.
export function encodeState(businessId: string, provider: ProviderName): string {
  return btoa(JSON.stringify({ business_id: businessId, provider, nonce: crypto.randomUUID() }));
}
export function decodeState(state: string): { business_id: string; provider: ProviderName } | null {
  try {
    const d = JSON.parse(atob(state));
    return d.business_id && d.provider ? { business_id: d.business_id, provider: d.provider } : null;
  } catch {
    return null;
  }
}

export interface ConnectStartResult { authorizationUrl?: string; connected?: boolean; note: string }

export async function startConnect(env: Env, businessId: string, provider: string): Promise<ConnectStartResult> {
  await ensureSchema(env);
  const adapter = getAdapter(provider);
  if (!adapter.configured(env)) return { note: `${provider}: not configured — set its client id/secret (and, for ADP, the mTLS certificate binding) as Worker secrets first` };
  if (!encryptionConfigured(env)) return { note: 'payroll: PAYROLL_TOKEN_ENC_KEY not configured — set that before connecting any provider' };

  if (adapter.name === 'adp') {
    // Client-credentials — no redirect, connect immediately.
    const tokens = await adapter.clientCredentialsToken!(env);
    await upsertConnection(env, businessId, 'adp', tokens, 'connected');
    return { connected: true, note: 'adp: connected (client-credentials, no user authorization needed)' };
  }
  const url = adapter.authorizationUrl!(encodeState(businessId, provider as ProviderName), env);
  if (!url) return { note: `${provider}: not configured` };
  return { authorizationUrl: url, note: `redirect the user to this URL to authorize ${provider}` };
}

export async function completeConnect(env: Env, businessId: string, provider: string, code: string, overrideExternalAccountId?: string | null): Promise<{ connected: boolean; note: string }> {
  await ensureSchema(env);
  const adapter = getAdapter(provider);
  if (!adapter.exchangeCode) throw new Error(`${provider}: does not use an authorization-code callback`);
  const tokens = await adapter.exchangeCode(code, env);
  // QuickBooks hands back its company id (realmId) as a callback query
  // param, not part of the token-exchange response — the door passes it in
  // here rather than exchangeCode guessing at it.
  if (overrideExternalAccountId) tokens.externalAccountId = overrideExternalAccountId;
  await upsertConnection(env, businessId, provider as ProviderName, tokens, 'connected');
  return { connected: true, note: `${provider}: connected` };
}

// ── token refresh (proactive — called before every provider API call) ────
async function ensureFreshToken(env: Env, conn: PayrollConnectionRow): Promise<{ accessToken: string; externalAccountId: string | null }> {
  const adapter = getAdapter(conn.provider);
  const accessToken = conn.access_token_enc ? await decryptToken(conn.access_token_enc, env) : null;
  const stillFresh = conn.token_expires_at != null && conn.token_expires_at > Date.now() + 60_000;
  if (accessToken && stillFresh) return { accessToken, externalAccountId: conn.external_account_id };

  const refreshToken = conn.refresh_token_enc ? await decryptToken(conn.refresh_token_enc, env) : null;
  const refreshed = await adapter.refresh(
    { accessToken: accessToken || '', refreshToken, expiresAt: conn.token_expires_at || 0, externalAccountId: conn.external_account_id },
    env,
  );
  await upsertConnection(env, conn.business_id, conn.provider, refreshed, 'connected');
  return { accessToken: refreshed.accessToken, externalAccountId: refreshed.externalAccountId ?? conn.external_account_id };
}

// ── pull + store ───────────────────────────────────────────────
export interface SyncResult { synced: boolean; employees: number; runs: number; note: string }

export async function syncConnection(env: Env, businessId: string, provider: string): Promise<SyncResult> {
  await ensureSchema(env);
  const conn = await getConnection(env, businessId, provider);
  if (!conn) return { synced: false, employees: 0, runs: 0, note: `${provider}: no connection on file for this business — connect it first` };

  const adapter = getAdapter(provider);
  try {
    const creds = await ensureFreshToken(env, conn);
    const employees = await adapter.fetchEmployees(creds, env);
    const now = Date.now();
    for (const e of employees) {
      const existing = await env.DB.prepare('SELECT id FROM payroll_employees WHERE connection_id = ? AND provider_employee_id = ?').bind(conn.id, e.providerId).first<{ id: string }>();
      if (existing) {
        await env.DB.prepare('UPDATE payroll_employees SET full_name=?, job_title=?, employment_status=?, hire_date=?, termination_date=?, updated_at=? WHERE id=?')
          .bind(e.fullName, e.jobTitle, e.employmentStatus, e.hireDate, e.terminationDate, now, existing.id).run();
      } else {
        await env.DB.prepare('INSERT INTO payroll_employees (id, business_id, connection_id, provider_employee_id, full_name, job_title, employment_status, hire_date, termination_date, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
          .bind(id(), businessId, conn.id, e.providerId, e.fullName, e.jobTitle, e.employmentStatus, e.hireDate, e.terminationDate, now, now).run();
      }
    }

    const runs = await adapter.fetchPayrollRuns(creds, env, undefined);
    for (const run of runs) {
      const existingRun = await env.DB.prepare('SELECT id FROM payroll_runs WHERE connection_id = ? AND provider_payroll_id = ?').bind(conn.id, run.providerId).first<{ id: string }>();
      const runId = existingRun?.id || id();
      if (existingRun) {
        await env.DB.prepare('UPDATE payroll_runs SET pay_period_start=?, pay_period_end=?, check_date=?, status=?, total_wages_cents=?, updated_at=? WHERE id=?')
          .bind(run.payPeriodStart, run.payPeriodEnd, run.checkDate, run.status, run.totalWagesCents, now, runId).run();
        await env.DB.prepare('DELETE FROM payroll_line_items WHERE run_id = ?').bind(runId).run();
      } else {
        await env.DB.prepare('INSERT INTO payroll_runs (id, business_id, connection_id, provider_payroll_id, pay_period_start, pay_period_end, check_date, status, total_wages_cents, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
          .bind(runId, businessId, conn.id, run.providerId, run.payPeriodStart, run.payPeriodEnd, run.checkDate, run.status, run.totalWagesCents, now, now).run();
      }
      for (const li of run.lineItems) {
        const employeeRow = await env.DB.prepare('SELECT id FROM payroll_employees WHERE connection_id = ? AND provider_employee_id = ?').bind(conn.id, li.employeeProviderId).first<{ id: string }>();
        if (!employeeRow) continue;
        await env.DB.prepare('INSERT INTO payroll_line_items (id, run_id, employee_id, gross_pay_cents, net_pay_cents, employer_taxes_cents, hours, created_at) VALUES (?,?,?,?,?,?,?,?)')
          .bind(id(), runId, employeeRow.id, li.grossPayCents, li.netPayCents, li.employerTaxesCents, li.hours, now).run();
      }
    }

    await env.DB.prepare('UPDATE payroll_connections SET last_synced_at = ?, last_sync_error = NULL, updated_at = ? WHERE id = ?').bind(now, now, conn.id).run();
    return { synced: true, employees: employees.length, runs: runs.length, note: `${provider}: synced ${employees.length} employee(s), ${runs.length} payroll run(s)` };
  } catch (e) {
    const message = (e as Error).message;
    await env.DB.prepare('UPDATE payroll_connections SET status = ?, last_sync_error = ?, updated_at = ? WHERE id = ?').bind('error', message.slice(0, 500), Date.now(), conn.id).run();
    return { synced: false, employees: 0, runs: 0, note: `${provider}: sync failed — ${message}` };
  }
}

// ── wage summary for the tax suite's STL payroll-expense-tax leg ─────────
// Simplification, flagged: sums ALL synced wages for the business/tax year
// across every connected provider — none of these APIs reliably expose a
// per-employee WORK LOCATION this codebase can map to a specific locality,
// so this assumes all synced wages were earned within the business's own
// registered locality. Good enough for a single-location business (the
// common case); a multi-unit business operating across localities would
// need real per-location wage attribution before this number is precise.
export async function getWageSummaryCents(env: Env, businessId: string, taxYear: number): Promise<{ totalWagesCents: number; hasData: boolean; connectedProviders: string[] }> {
  await ensureSchema(env);
  const connections = await listConnections(env, businessId);
  const connected = connections.filter((c) => c.status === 'connected' && c.last_synced_at);
  if (!connected.length) return { totalWagesCents: 0, hasData: false, connectedProviders: [] };

  const rows = await env.DB.prepare(
    `SELECT total_wages_cents FROM payroll_runs WHERE business_id = ? AND pay_period_start >= ? AND pay_period_start < ?`
  ).bind(businessId, `${taxYear}-01-01`, `${taxYear + 1}-01-01`).all<{ total_wages_cents: number | null }>();
  const totalWagesCents = (rows.results || []).reduce((sum, r) => sum + (r.total_wages_cents || 0), 0);
  return { totalWagesCents, hasData: (rows.results || []).length > 0, connectedProviders: connected.map((c) => c.provider) };
}

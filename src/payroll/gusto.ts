// ============================================================
// GUSTO ADAPTER — src/payroll/gusto.ts
//
// OAuth 2.0 authorization-code flow (Gusto Embedded). Unlike QuickBooks,
// Gusto doesn't hand back a company id as a callback query param — this
// adapter resolves it itself right after the token exchange (one extra
// call to /v1/me) so callers don't need provider-specific glue code.
//
// Dollar amounts on Gusto's API come back as decimal strings (e.g.
// "1234.56"), not integer cents — every parse here goes through
// dollarsStringToCents to avoid a float-vs-string bug at the boundary.
// ============================================================

import type { PayrollProviderAdapter, ProviderEmployee, ProviderPayrollRun, ProviderPayrollLineItem, TokenSet } from './provider';
import { assertOk } from './provider';

function apiBase(env: { GUSTO_ENVIRONMENT?: string }): string {
  return env.GUSTO_ENVIRONMENT === 'production' ? 'https://api.gusto.com' : 'https://api.gusto-demo.com';
}

function dollarsStringToCents(v: unknown): number | null {
  if (v == null) return null;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

interface GustoTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
}

async function tokenRequest(body: Record<string, string>, env: { GUSTO_CLIENT_ID?: string; GUSTO_CLIENT_SECRET?: string; GUSTO_ENVIRONMENT?: string }, fetchImpl: typeof fetch): Promise<Omit<TokenSet, 'externalAccountId'>> {
  const r = await fetchImpl(`${apiBase(env)}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: env.GUSTO_CLIENT_ID, client_secret: env.GUSTO_CLIENT_SECRET, ...body }),
  });
  assertOk(r, 'gusto');
  const d = await r.json() as GustoTokenResponse;
  return { accessToken: d.access_token, refreshToken: d.refresh_token, expiresAt: Date.now() + d.expires_in * 1000, scope: d.scope || null };
}

async function resolveCompanyId(accessToken: string, env: { GUSTO_ENVIRONMENT?: string }, fetchImpl: typeof fetch): Promise<string | null> {
  try {
    const r = await fetchImpl(`${apiBase(env)}/v1/me`, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
    if (!r.ok) return null;
    const d = await r.json() as { roles?: { payroll_admin?: { companies?: Array<{ id: string }> } } };
    return d.roles?.payroll_admin?.companies?.[0]?.id ?? null;
  } catch {
    return null; // best-effort — a connection without a resolvable company id surfaces as "connected, not yet synced" rather than failing the whole OAuth exchange
  }
}

export const gustoAdapter: PayrollProviderAdapter = {
  name: 'gusto',

  configured(env) {
    return !!(env.GUSTO_CLIENT_ID && env.GUSTO_CLIENT_SECRET && env.GUSTO_REDIRECT_URI);
  },

  authorizationUrl(state, env) {
    if (!this.configured(env)) return null;
    const params = new URLSearchParams({ client_id: env.GUSTO_CLIENT_ID!, response_type: 'code', redirect_uri: env.GUSTO_REDIRECT_URI!, state });
    return `${apiBase(env)}/oauth/authorize?${params.toString()}`;
  },

  async exchangeCode(code, env, fetchImpl = fetch) {
    const tokens = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: env.GUSTO_REDIRECT_URI || '' }, env, fetchImpl);
    const externalAccountId = await resolveCompanyId(tokens.accessToken, env, fetchImpl);
    return { ...tokens, externalAccountId };
  },

  async refresh(tokenSet, env, fetchImpl = fetch) {
    if (!tokenSet.refreshToken) throw new Error('gusto: no refresh_token on file — the connection needs full re-authorization');
    const tokens = await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokenSet.refreshToken }, env, fetchImpl);
    return { ...tokens, externalAccountId: tokenSet.externalAccountId };
  },

  async fetchEmployees(creds, env, fetchImpl = fetch) {
    if (!creds.externalAccountId) throw new Error('gusto: no company id on file for this connection');
    const r = await fetchImpl(`${apiBase(env)}/v1/companies/${creds.externalAccountId}/employees`, {
      headers: { Authorization: `Bearer ${creds.accessToken}`, Accept: 'application/json' },
    });
    assertOk(r, 'gusto');
    const rows = await r.json() as Array<Record<string, unknown>>;
    return rows.map((e): ProviderEmployee => {
      const jobs = (e.jobs as Array<Record<string, unknown>>) || [];
      return {
        providerId: String(e.id ?? e.uuid ?? ''),
        fullName: [e.first_name, e.last_name].filter(Boolean).join(' ') || null,
        jobTitle: (jobs[0]?.title as string) || null,
        employmentStatus: e.terminated ? 'terminated' : 'active',
        hireDate: (jobs[0]?.hire_date as string) || null,
        terminationDate: (e.termination_date as string) || null,
      };
    });
  },

  async fetchPayrollRuns(creds, env, sinceIso, fetchImpl = fetch) {
    if (!creds.externalAccountId) throw new Error('gusto: no company id on file for this connection');
    const params = sinceIso ? `?start_date=${encodeURIComponent(sinceIso)}` : '';
    const r = await fetchImpl(`${apiBase(env)}/v1/companies/${creds.externalAccountId}/payrolls${params}`, {
      headers: { Authorization: `Bearer ${creds.accessToken}`, Accept: 'application/json' },
    });
    assertOk(r, 'gusto');
    const rows = await r.json() as Array<Record<string, unknown>>;
    return rows.map((p): ProviderPayrollRun => {
      const period = (p.pay_period as Record<string, unknown>) || {};
      const totals = (p.totals as Record<string, unknown>) || {};
      const comps = (p.employee_compensations as Array<Record<string, unknown>>) || [];
      const lineItems: ProviderPayrollLineItem[] = comps.map((c) => ({
        employeeProviderId: String(c.employee_id ?? ''),
        grossPayCents: dollarsStringToCents(c.gross_pay),
        netPayCents: dollarsStringToCents(c.net_pay),
        employerTaxesCents: dollarsStringToCents(c.employer_taxes),
        hours: c.hours != null ? Number(c.hours) : null,
      }));
      return {
        providerId: String(p.payroll_uuid ?? p.id ?? ''),
        payPeriodStart: (period.start_date as string) || null,
        payPeriodEnd: (period.end_date as string) || null,
        checkDate: (p.check_date as string) || null,
        status: p.processed ? 'processed' : 'unprocessed',
        totalWagesCents: dollarsStringToCents(totals.gross_pay),
        lineItems,
      };
    });
  },
};

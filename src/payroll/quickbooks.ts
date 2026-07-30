// ============================================================
// QUICKBOOKS ONLINE ADAPTER — src/payroll/quickbooks.ts
//
// OAuth 2.0 authorization-code flow. Access token expires ~1hr; refresh
// token ~100 days, so a stale connection needs re-authorization eventually,
// not just a refresh — sync.ts surfaces that as a connection status, not a
// silent failure.
//
// realmId (the company id) is NOT part of the token exchange response —
// Intuit returns it as a `realmId` query param on the OAuth callback
// redirect itself, alongside `code`/`state`. The door in index.ts is
// responsible for reading it off the callback URL and attaching it to the
// TokenSet; exchangeCode here only does the token exchange.
//
// Payroll (wage) data is NOT pulled here: that lives behind Intuit's
// separate, more tightly gated Payroll API, distinct from the general
// Accounting API this adapter targets. fetchPayrollRuns returns [] with
// that documented rather than guessing at an endpoint. fetchEmployees still
// gives real value — the roster itself, from the Accounting API's
// query-based Employee entity.
// ============================================================

import type { PayrollProviderAdapter, PayrollProviderEnv, TokenSet, ProviderEmployee, ProviderPayrollRun, ConnectionCreds } from './provider';
import { assertOk } from './provider';

const AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const SCOPE = 'com.intuit.quickbooks.accounting';

function apiBase(env: PayrollProviderEnv): string {
  return env.QUICKBOOKS_ENVIRONMENT === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';
}

function basicAuthHeader(env: PayrollProviderEnv): string {
  return 'Basic ' + btoa(`${env.QUICKBOOKS_CLIENT_ID}:${env.QUICKBOOKS_CLIENT_SECRET}`);
}

interface QBOTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

async function tokenRequest(body: URLSearchParams, env: PayrollProviderEnv, fetchImpl: typeof fetch): Promise<TokenSet> {
  const r = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: basicAuthHeader(env), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });
  assertOk(r, 'quickbooks');
  const d = await r.json() as QBOTokenResponse;
  return {
    accessToken: d.access_token,
    refreshToken: d.refresh_token,
    expiresAt: Date.now() + d.expires_in * 1000,
    externalAccountId: null, // set by the caller from the callback's realmId query param
    scope: SCOPE,
  };
}

export const quickbooksAdapter: PayrollProviderAdapter = {
  name: 'quickbooks',

  configured(env) {
    return !!(env.QUICKBOOKS_CLIENT_ID && env.QUICKBOOKS_CLIENT_SECRET && env.QUICKBOOKS_REDIRECT_URI);
  },

  authorizationUrl(state, env) {
    if (!this.configured(env)) return null;
    const params = new URLSearchParams({
      client_id: env.QUICKBOOKS_CLIENT_ID!,
      response_type: 'code',
      scope: SCOPE,
      redirect_uri: env.QUICKBOOKS_REDIRECT_URI!,
      state,
    });
    return `${AUTH_URL}?${params.toString()}`;
  },

  async exchangeCode(code, env, fetchImpl = fetch) {
    return tokenRequest(new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: env.QUICKBOOKS_REDIRECT_URI || '' }), env, fetchImpl);
  },

  async refresh(tokenSet, env, fetchImpl = fetch) {
    if (!tokenSet.refreshToken) throw new Error('quickbooks: no refresh_token on file — the connection needs full re-authorization');
    const refreshed = await tokenRequest(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokenSet.refreshToken }), env, fetchImpl);
    return { ...refreshed, externalAccountId: tokenSet.externalAccountId };
  },

  async fetchEmployees(creds, env, fetchImpl = fetch) {
    if (!creds.externalAccountId) throw new Error('quickbooks: no realmId on file for this connection');
    const query = encodeURIComponent('SELECT * FROM Employee MAXRESULTS 1000');
    const r = await fetchImpl(`${apiBase(env)}/v3/company/${creds.externalAccountId}/query?query=${query}`, {
      headers: { Authorization: `Bearer ${creds.accessToken}`, Accept: 'application/json' },
    });
    assertOk(r, 'quickbooks');
    const d = await r.json() as { QueryResponse?: { Employee?: Array<Record<string, unknown>> } };
    const rows = d.QueryResponse?.Employee || [];
    return rows.map((e): ProviderEmployee => ({
      providerId: String(e.Id ?? ''),
      fullName: (e.DisplayName as string) || [e.GivenName, e.FamilyName].filter(Boolean).join(' ') || null,
      jobTitle: null, // QBO's Employee entity has no job-title field
      employmentStatus: e.Active === false ? 'terminated' : 'active',
      hireDate: (e.HiredDate as string) || null,
      terminationDate: (e.ReleasedDate as string) || null,
    }));
  },

  async fetchPayrollRuns(): Promise<ProviderPayrollRun[]> {
    // Deliberately not implemented — see file header. Returning [] (not
    // throwing) so sync.ts still succeeds at pulling the employee roster
    // even when wage-run detail isn't reachable on this QBO plan/scope.
    return [];
  },
};

export type { ConnectionCreds };

// ============================================================
// ADP ADAPTER — src/payroll/adp.ts
//
// The odd one out: OAuth 2.0 CLIENT-CREDENTIALS + mutual TLS, no per-user
// redirect. Every call must go over the mTLS-bound fetch (env.ADP_MTLS_CERT,
// a Cloudflare mTLS certificate binding — see .dev.vars.example for the
// `wrangler mtls-certificate upload` step) rather than plain global fetch;
// without that binding this adapter reports itself unconfigured rather
// than attempting a call that mTLS-gated ADP would reject anyway.
//
// Payroll-run/wage detail sits behind ADP's separately-licensed Payroll
// Output API product, distinct from the core Worker/HR API this adapter
// targets — fetchPayrollRuns returns [] (documented gap, same discipline
// as quickbooks.ts), while fetchEmployees pulls the real worker roster.
// ============================================================

import type { PayrollProviderAdapter, PayrollProviderEnv, ProviderEmployee, ProviderPayrollRun, TokenSet } from './provider';
import { assertOk } from './provider';

const TOKEN_URL = 'https://api.adp.com/auth/oauth/v2/token';
const API_BASE = 'https://api.adp.com';

function mtlsFetch(env: PayrollProviderEnv, fetchImpl?: typeof fetch): typeof fetch {
  if (fetchImpl) return fetchImpl; // test injection wins
  if (env.ADP_MTLS_CERT) return env.ADP_MTLS_CERT.fetch as typeof fetch;
  return fetch;
}

export const adpAdapter: PayrollProviderAdapter = {
  name: 'adp',

  configured(env) {
    return !!(env.ADP_CLIENT_ID && env.ADP_CLIENT_SECRET && env.ADP_MTLS_CERT);
  },

  // No authorizationUrl / exchangeCode — client-credentials has no user redirect.

  async clientCredentialsToken(env, fetchImpl): Promise<TokenSet> {
    if (!this.configured(env)) {
      throw new Error('adp: not configured — needs ADP_CLIENT_ID, ADP_CLIENT_SECRET, and the ADP_MTLS_CERT certificate binding (see .dev.vars.example)');
    }
    const impl = mtlsFetch(env, fetchImpl);
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: env.ADP_CLIENT_ID!, client_secret: env.ADP_CLIENT_SECRET! });
    const r = await impl(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body });
    assertOk(r, 'adp');
    const d = await r.json() as { access_token: string; expires_in: number };
    return { accessToken: d.access_token, refreshToken: null, expiresAt: Date.now() + d.expires_in * 1000, externalAccountId: null, scope: null };
  },

  // client_credentials has no refresh_token — "refreshing" just re-runs the same token fetch.
  async refresh(_tokenSet, env, fetchImpl) {
    return adpAdapter.clientCredentialsToken!(env, fetchImpl);
  },

  async fetchEmployees(creds, env, fetchImpl) {
    const impl = mtlsFetch(env, fetchImpl);
    const r = await impl(`${API_BASE}/hr/v2/workers`, {
      headers: { Authorization: `Bearer ${creds.accessToken}`, Accept: 'application/json' },
    });
    assertOk(r, 'adp');
    const d = await r.json() as { workers?: Array<Record<string, any>> };
    const rows = d.workers || [];
    return rows.map((w): ProviderEmployee => {
      const assignment = (w.workAssignments && w.workAssignments[0]) || {};
      const legalName = w.person?.legalName || {};
      return {
        providerId: String(w.associateOID ?? ''),
        fullName: [legalName.givenName, legalName.familyName].filter(Boolean).join(' ') || null,
        jobTitle: assignment.jobTitle || null,
        employmentStatus: assignment.assignmentStatus?.statusCode?.codeValue || null,
        hireDate: assignment.hireDate || null,
        terminationDate: assignment.terminationDate || null,
      };
    });
  },

  async fetchPayrollRuns(): Promise<ProviderPayrollRun[]> {
    return [];
  },
};

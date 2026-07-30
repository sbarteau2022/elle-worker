// ============================================================
// PAYROLL PROVIDER — shared adapter interface · src/payroll/provider.ts
//
// One shared shape behind three real, meaningfully different providers:
//   - QuickBooks Online: OAuth 2.0 authorization-code flow. Access token
//     expires ~1hr, refresh token ~100 days — must refresh proactively.
//     Employee data lives on the general Accounting API; actual per-run
//     WAGE data is gated behind Intuit's separate Payroll API, which may
//     not be available depending on the connected QBO plan — v1 pulls
//     what the Accounting API's Employee entity exposes and treats
//     payroll-run detail as best-effort.
//   - Gusto: OAuth 2.0 authorization-code flow (Gusto Embedded product).
//     Real payroll-run + compensation data via its own endpoints.
//   - ADP: OAuth 2.0 client-credentials + mutual TLS — no per-user
//     redirect, but requires a Cloudflare mTLS certificate binding that
//     can only be provisioned by the operator (see .dev.vars.example).
//     `authorizationUrl`/`exchangeCode` are simply absent for this adapter;
//     `clientCredentialsToken` is used instead.
//
// v1 is PULL-ONLY — no adapter here writes anything back to a provider.
// Export (journal entries, etc.) is explicitly future "accounting suite"
// work, not this integration.
// ============================================================

export interface TokenSet {
  accessToken: string;
  refreshToken?: string | null;
  /** epoch ms */
  expiresAt: number;
  /** QuickBooks' realmId / Gusto's company_id / ADP's org identifier */
  externalAccountId?: string | null;
  scope?: string | null;
}

export interface ProviderEmployee {
  providerId: string;
  fullName: string | null;
  jobTitle: string | null;
  employmentStatus: string | null;
  hireDate: string | null;
  terminationDate: string | null;
}

export interface ProviderPayrollLineItem {
  employeeProviderId: string;
  grossPayCents: number | null;
  netPayCents: number | null;
  employerTaxesCents: number | null;
  hours: number | null;
}

export interface ProviderPayrollRun {
  providerId: string;
  payPeriodStart: string | null;
  payPeriodEnd: string | null;
  checkDate: string | null;
  status: string | null;
  totalWagesCents: number | null;
  lineItems: ProviderPayrollLineItem[];
}

export interface ConnectionCreds {
  accessToken: string;
  externalAccountId: string | null;
}

export type ProviderName = 'quickbooks' | 'gusto' | 'adp';

export interface PayrollProviderEnv {
  QUICKBOOKS_CLIENT_ID?: string;
  QUICKBOOKS_CLIENT_SECRET?: string;
  QUICKBOOKS_REDIRECT_URI?: string;
  QUICKBOOKS_ENVIRONMENT?: string;
  GUSTO_CLIENT_ID?: string;
  GUSTO_CLIENT_SECRET?: string;
  GUSTO_REDIRECT_URI?: string;
  GUSTO_ENVIRONMENT?: string;
  ADP_CLIENT_ID?: string;
  ADP_CLIENT_SECRET?: string;
  ADP_MTLS_CERT?: { fetch: typeof fetch };
}

export interface PayrollProviderAdapter {
  name: ProviderName;
  /** Whether this provider's required secrets/bindings are present. */
  configured(env: PayrollProviderEnv): boolean;
  /** QuickBooks/Gusto only — the URL to redirect the browser to. ADP has no redirect (client-credentials). */
  authorizationUrl?(state: string, env: PayrollProviderEnv): string | null;
  /** QuickBooks/Gusto only — exchange an authorization code for tokens. */
  exchangeCode?(code: string, env: PayrollProviderEnv, fetchImpl?: typeof fetch): Promise<TokenSet>;
  /** ADP only — client-credentials token fetch, no user redirect involved. */
  clientCredentialsToken?(env: PayrollProviderEnv, fetchImpl?: typeof fetch): Promise<TokenSet>;
  refresh(tokenSet: TokenSet, env: PayrollProviderEnv, fetchImpl?: typeof fetch): Promise<TokenSet>;
  fetchEmployees(creds: ConnectionCreds, env: PayrollProviderEnv, fetchImpl?: typeof fetch): Promise<ProviderEmployee[]>;
  fetchPayrollRuns(creds: ConnectionCreds, env: PayrollProviderEnv, sinceIso: string | undefined, fetchImpl?: typeof fetch): Promise<ProviderPayrollRun[]>;
}

export function assertOk(r: Response, provider: string): void {
  if (!r.ok) throw new Error(`${provider}: HTTP ${r.status} — ${r.statusText}`);
}

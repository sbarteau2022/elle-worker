import { describe, it, expect } from 'vitest';
import { quickbooksAdapter } from './quickbooks';

const ENV = { QUICKBOOKS_CLIENT_ID: 'cid', QUICKBOOKS_CLIENT_SECRET: 'csecret', QUICKBOOKS_REDIRECT_URI: 'https://worker.test/api/payroll/callback' };

function fakeFetch(handlers: Record<string, () => Response>): typeof fetch {
  return (async (input: any) => {
    const url = String(input);
    for (const [match, handler] of Object.entries(handlers)) {
      if (url.includes(match)) return handler();
    }
    throw new Error(`no fake handler for ${url}`);
  }) as typeof fetch;
}

describe('quickbooksAdapter.configured', () => {
  it('is false unless client id/secret/redirect are all set', () => {
    expect(quickbooksAdapter.configured({})).toBe(false);
    expect(quickbooksAdapter.configured(ENV)).toBe(true);
  });
});

describe('quickbooksAdapter.authorizationUrl', () => {
  it('builds the Intuit authorize URL with the accounting scope and state', () => {
    const url = quickbooksAdapter.authorizationUrl!('state123', ENV)!;
    expect(url).toContain('https://appcenter.intuit.com/connect/oauth2?');
    expect(url).toContain('scope=com.intuit.quickbooks.accounting');
    expect(url).toContain('state=state123');
    expect(url).toContain(encodeURIComponent(ENV.QUICKBOOKS_REDIRECT_URI));
  });
  it('returns null when not configured', () => {
    expect(quickbooksAdapter.authorizationUrl!('s', {})).toBeNull();
  });
});

describe('quickbooksAdapter.exchangeCode', () => {
  it('exchanges a code for tokens (realmId left null — set by the caller from the callback query param)', async () => {
    const fetchImpl = fakeFetch({
      'oauth2/v1/tokens/bearer': () => new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, token_type: 'bearer' }), { status: 200 }),
    });
    const tokens = await quickbooksAdapter.exchangeCode!('authcode', ENV, fetchImpl);
    expect(tokens.accessToken).toBe('at');
    expect(tokens.refreshToken).toBe('rt');
    expect(tokens.externalAccountId).toBeNull();
    expect(tokens.expiresAt).toBeGreaterThan(Date.now());
  });
});

describe('quickbooksAdapter.fetchEmployees', () => {
  it('queries the Employee entity and maps fields, preserving realmId on the connection', async () => {
    const fetchImpl = fakeFetch({
      '/query?query=': () => new Response(JSON.stringify({
        QueryResponse: { Employee: [{ Id: '1', DisplayName: 'Jane Doe', Active: true, HiredDate: '2024-01-15' }, { Id: '2', GivenName: 'Bob', FamilyName: 'Smith', Active: false }] },
      }), { status: 200 }),
    });
    const employees = await quickbooksAdapter.fetchEmployees({ accessToken: 'at', externalAccountId: 'realm123' }, ENV, fetchImpl);
    expect(employees).toEqual([
      { providerId: '1', fullName: 'Jane Doe', jobTitle: null, employmentStatus: 'active', hireDate: '2024-01-15', terminationDate: null },
      { providerId: '2', fullName: 'Bob Smith', jobTitle: null, employmentStatus: 'terminated', hireDate: null, terminationDate: null },
    ]);
  });
  it('throws when no realmId is on file', async () => {
    await expect(quickbooksAdapter.fetchEmployees({ accessToken: 'at', externalAccountId: null }, ENV)).rejects.toThrow(/realmId/);
  });
});

describe('quickbooksAdapter.fetchPayrollRuns', () => {
  it('returns an empty array (wage detail is a documented gap, not a guess)', async () => {
    expect(await quickbooksAdapter.fetchPayrollRuns({ accessToken: 'at', externalAccountId: 'realm123' }, ENV, undefined)).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { adpAdapter } from './adp';

function fakeFetch(handlers: Record<string, () => Response>): typeof fetch {
  return (async (input: any) => {
    const url = String(input);
    for (const [match, handler] of Object.entries(handlers)) {
      if (url.includes(match)) return handler();
    }
    throw new Error(`no fake handler for ${url}`);
  }) as typeof fetch;
}

const MTLS_STUB = { fetch: fakeFetch({}) };

describe('adpAdapter.configured', () => {
  it('requires client id, secret, AND the mTLS certificate binding — missing any one is unconfigured', () => {
    expect(adpAdapter.configured({})).toBe(false);
    expect(adpAdapter.configured({ ADP_CLIENT_ID: 'x', ADP_CLIENT_SECRET: 'y' })).toBe(false); // no cert binding
    expect(adpAdapter.configured({ ADP_CLIENT_ID: 'x', ADP_CLIENT_SECRET: 'y', ADP_MTLS_CERT: MTLS_STUB })).toBe(true);
  });
});

describe('adpAdapter.clientCredentialsToken', () => {
  it('refuses to even attempt a call when not configured', async () => {
    await expect(adpAdapter.clientCredentialsToken!({})).rejects.toThrow(/not configured/);
  });

  it('routes the token request through the mTLS certificate binding\'s own fetch, not global fetch, when no override is given', async () => {
    let calledViaMtls = false;
    const mtlsCert = {
      fetch: (async () => { calledViaMtls = true; return new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), { status: 200 }); }) as typeof fetch,
    };
    const tokens = await adpAdapter.clientCredentialsToken!({ ADP_CLIENT_ID: 'cid', ADP_CLIENT_SECRET: 'csecret', ADP_MTLS_CERT: mtlsCert });
    expect(calledViaMtls).toBe(true);
    expect(tokens.accessToken).toBe('at');
    expect(tokens.refreshToken).toBeNull();
  });

  it('an injected fetchImpl (test override) still wins over the mTLS binding', async () => {
    const fetchImpl = fakeFetch({ 'oauth/v2/token': () => new Response(JSON.stringify({ access_token: 'override-at', expires_in: 3600 }), { status: 200 }) });
    const tokens = await adpAdapter.clientCredentialsToken!({ ADP_CLIENT_ID: 'cid', ADP_CLIENT_SECRET: 'csecret', ADP_MTLS_CERT: MTLS_STUB }, fetchImpl);
    expect(tokens.accessToken).toBe('override-at');
  });
});

describe('adpAdapter.fetchEmployees', () => {
  it('maps ADP\'s nested Worker resource shape', async () => {
    const fetchImpl = fakeFetch({
      '/hr/v2/workers': () => new Response(JSON.stringify({
        workers: [{
          associateOID: 'G3N9F7',
          person: { legalName: { givenName: 'Jane', familyName: 'Doe' } },
          workAssignments: [{ jobTitle: 'Cook', hireDate: '2024-03-01', assignmentStatus: { statusCode: { codeValue: 'Active' } } }],
        }],
      }), { status: 200 }),
    });
    const employees = await adpAdapter.fetchEmployees({ accessToken: 'at', externalAccountId: null }, { ADP_MTLS_CERT: MTLS_STUB }, fetchImpl);
    expect(employees).toEqual([{ providerId: 'G3N9F7', fullName: 'Jane Doe', jobTitle: 'Cook', employmentStatus: 'Active', hireDate: '2024-03-01', terminationDate: null }]);
  });
});

describe('adpAdapter.fetchPayrollRuns', () => {
  it('returns an empty array (Payroll Output API is a separate, undocumented-here product)', async () => {
    expect(await adpAdapter.fetchPayrollRuns({ accessToken: 'at', externalAccountId: null }, {}, undefined)).toEqual([]);
  });
});

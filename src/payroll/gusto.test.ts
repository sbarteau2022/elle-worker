import { describe, it, expect } from 'vitest';
import { gustoAdapter } from './gusto';

const ENV = { GUSTO_CLIENT_ID: 'cid', GUSTO_CLIENT_SECRET: 'csecret', GUSTO_REDIRECT_URI: 'https://worker.test/api/payroll/callback' };

function fakeFetch(handlers: Record<string, () => Response>): typeof fetch {
  return (async (input: any) => {
    const url = String(input);
    for (const [match, handler] of Object.entries(handlers)) {
      if (url.includes(match)) return handler();
    }
    throw new Error(`no fake handler for ${url}`);
  }) as typeof fetch;
}

describe('gustoAdapter.configured / authorizationUrl', () => {
  it('is false unless client id/secret/redirect are all set', () => {
    expect(gustoAdapter.configured({})).toBe(false);
    expect(gustoAdapter.configured(ENV)).toBe(true);
  });
  it('builds the demo-environment authorize URL by default', () => {
    const url = gustoAdapter.authorizationUrl!('state123', ENV)!;
    expect(url).toContain('https://api.gusto-demo.com/oauth/authorize?');
    expect(url).toContain('state=state123');
  });
  it('switches to production when GUSTO_ENVIRONMENT is set', () => {
    const url = gustoAdapter.authorizationUrl!('s', { ...ENV, GUSTO_ENVIRONMENT: 'production' })!;
    expect(url).toContain('https://api.gusto.com/oauth/authorize?');
  });
});

describe('gustoAdapter.exchangeCode', () => {
  it('exchanges a code for tokens AND resolves the company id via /v1/me', async () => {
    const fetchImpl = fakeFetch({
      '/oauth/token': () => new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 7200, scope: 'payroll' }), { status: 200 }),
      '/v1/me': () => new Response(JSON.stringify({ roles: { payroll_admin: { companies: [{ id: 'company_1' }] } } }), { status: 200 }),
    });
    const tokens = await gustoAdapter.exchangeCode!('authcode', ENV, fetchImpl);
    expect(tokens.accessToken).toBe('at');
    expect(tokens.externalAccountId).toBe('company_1');
  });

  it('is best-effort on company resolution — a failed /v1/me still returns valid tokens with a null company id', async () => {
    const fetchImpl = fakeFetch({
      '/oauth/token': () => new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 7200 }), { status: 200 }),
      '/v1/me': () => new Response('server error', { status: 500 }),
    });
    const tokens = await gustoAdapter.exchangeCode!('authcode', ENV, fetchImpl);
    expect(tokens.accessToken).toBe('at');
    expect(tokens.externalAccountId).toBeNull();
  });
});

describe('gustoAdapter.fetchEmployees', () => {
  it('maps employee fields including job title/hire date from the jobs array', async () => {
    const fetchImpl = fakeFetch({
      '/employees': () => new Response(JSON.stringify([
        { id: 'e1', first_name: 'Jane', last_name: 'Doe', terminated: false, jobs: [{ title: 'Server', hire_date: '2023-06-01' }] },
        { id: 'e2', first_name: 'Bob', last_name: 'Smith', terminated: true, termination_date: '2025-01-01', jobs: [] },
      ]), { status: 200 }),
    });
    const employees = await gustoAdapter.fetchEmployees({ accessToken: 'at', externalAccountId: 'company_1' }, ENV, fetchImpl);
    expect(employees).toEqual([
      { providerId: 'e1', fullName: 'Jane Doe', jobTitle: 'Server', employmentStatus: 'active', hireDate: '2023-06-01', terminationDate: null },
      { providerId: 'e2', fullName: 'Bob Smith', jobTitle: null, employmentStatus: 'terminated', hireDate: null, terminationDate: '2025-01-01' },
    ]);
  });
});

describe('gustoAdapter.fetchPayrollRuns', () => {
  it('parses decimal-string dollar amounts into integer cents, never a raw float', async () => {
    const fetchImpl = fakeFetch({
      '/payrolls': () => new Response(JSON.stringify([
        {
          payroll_uuid: 'run1', pay_period: { start_date: '2026-07-01', end_date: '2026-07-15' }, check_date: '2026-07-18', processed: true,
          totals: { gross_pay: '5432.10' },
          employee_compensations: [{ employee_id: 'e1', gross_pay: '2716.05', net_pay: '2100.00', employer_taxes: '200.50', hours: 80 }],
        },
      ]), { status: 200 }),
    });
    const runs = await gustoAdapter.fetchPayrollRuns({ accessToken: 'at', externalAccountId: 'company_1' }, ENV, undefined, fetchImpl);
    expect(runs).toHaveLength(1);
    expect(runs[0].totalWagesCents).toBe(543210);
    expect(runs[0].status).toBe('processed');
    expect(runs[0].lineItems[0]).toEqual({ employeeProviderId: 'e1', grossPayCents: 271605, netPayCents: 210000, employerTaxesCents: 20050, hours: 80 });
  });
});

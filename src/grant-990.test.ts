import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveFunderEin, fetch990Overview } from './grant-990';

// Routes by URL substring — same house pattern as llm.test.ts's stubFetch.
function stubFetch(routes: Array<{ match: string; ok?: boolean; status?: number; json?: unknown }>) {
  const fn = vi.fn(async (url: string) => {
    const r = routes.find((x) => String(url).includes(x.match));
    if (!r) throw new Error(`unrouted fetch: ${url}`);
    return { ok: r.ok ?? true, status: r.status ?? 200, json: async () => r.json ?? {} } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
afterEach(() => vi.unstubAllGlobals());

describe('resolveFunderEin', () => {
  it('prefers an exact case-insensitive name match over ProPublica\'s own top result', async () => {
    stubFetch([
      {
        match: 'search.json',
        json: {
          organizations: [
            { ein: 999999999, name: 'Mozilla Foundation Endowment Fund' }, // ranked first by ProPublica
            { ein: 123456789, name: 'Mozilla Foundation' }, // exact match, should win
          ],
        },
      },
    ]);
    const result = await resolveFunderEin('Mozilla Foundation');
    expect(result).toEqual({ ein: '123456789' });
  });

  it('falls back to the top result when no exact match exists', async () => {
    stubFetch([{ match: 'search.json', json: { organizations: [{ ein: 111, name: 'Something Else Foundation' }] } }]);
    const result = await resolveFunderEin('Mozilla Foundation');
    expect(result).toEqual({ ein: '111' });
  });

  it('returns an error when nothing matches', async () => {
    stubFetch([{ match: 'search.json', json: { organizations: [] } }]);
    const result = await resolveFunderEin('Totally Fictional Foundation');
    expect(result).toEqual({ error: expect.stringMatching(/no ProPublica match/) });
  });

  it('returns an error on a non-OK response rather than throwing', async () => {
    stubFetch([{ match: 'search.json', ok: false, status: 503 }]);
    const result = await resolveFunderEin('X');
    expect(result).toEqual({ error: expect.stringMatching(/HTTP 503/) });
  });
});

describe('fetch990Overview', () => {
  it('resolves an EIN by name, then pulls the most recent filing\'s figures', async () => {
    stubFetch([
      { match: 'search.json', json: { organizations: [{ ein: 123456789, name: 'Mozilla Foundation' }] } },
      {
        match: 'organizations/123456789.json',
        json: {
          organization: { name: 'Mozilla Foundation', ein: 123456789, city: 'San Francisco', state: 'CA', ntee_code: 'B99' },
          filings_with_data: [
            { tax_prd_yr: 2023, totrevenue: 50_000_000, totfuncexpns: 40_000_000, totassetsend: 100_000_000, totliabend: 10_000_000, totcntrbgfts: 45_000_000, totprgmrevn: 1_000_000 },
            { tax_prd_yr: 2022, totrevenue: 48_000_000 },
          ],
          filings_without_data: [],
        },
      },
    ]);
    const result = await fetch990Overview('Mozilla Foundation');
    expect(result).toMatchObject({
      funderName: 'Mozilla Foundation',
      ein: '123456789',
      nteeCode: 'B99',
      city: 'San Francisco',
      state: 'CA',
      mostRecentFilingYear: 2023,
      totalRevenueCents: 5_000_000_000,
      totalExpensesCents: 4_000_000_000,
      totalAssetsEndCents: 10_000_000_000,
      totalLiabilitiesEndCents: 1_000_000_000,
      contributionsGiftsGrantsCents: 4_500_000_000,
      programRevenueCents: 100_000_000,
      pdfOnlyFilingYears: [],
    });
  });

  it('picks the most recent year even if filings_with_data is not pre-sorted', async () => {
    stubFetch([
      { match: 'search.json', json: { organizations: [{ ein: 1, name: 'X' }] } },
      {
        match: 'organizations/1.json',
        json: {
          organization: { name: 'X', ein: 1 },
          filings_with_data: [
            { tax_prd_yr: 2020, totrevenue: 1 },
            { tax_prd_yr: 2023, totrevenue: 999 },
            { tax_prd_yr: 2021, totrevenue: 2 },
          ],
        },
      },
    ]);
    const result = await fetch990Overview('X');
    expect((result as { mostRecentFilingYear: number }).mostRecentFilingYear).toBe(2023);
    expect((result as { totalRevenueCents: number }).totalRevenueCents).toBe(99_900);
  });

  it('surfaces PDF-only filing years explicitly rather than treating them as missing data', async () => {
    stubFetch([
      { match: 'search.json', json: { organizations: [{ ein: 1, name: 'Paper Filer Foundation' }] } },
      {
        match: 'organizations/1.json',
        json: {
          organization: { name: 'Paper Filer Foundation', ein: 1 },
          filings_with_data: [],
          filings_without_data: [{ tax_prd_yr: 2023, pdf_url: 'https://example.com/990.pdf' }],
        },
      },
    ]);
    const result = await fetch990Overview('Paper Filer Foundation');
    expect((result as { pdfOnlyFilingYears: number[] }).pdfOnlyFilingYears).toEqual([2023]);
    expect((result as { mostRecentFilingYear: number | null }).mostRecentFilingYear).toBeNull();
  });

  it('accepts an explicit EIN override, skipping the search call entirely', async () => {
    const fn = stubFetch([
      { match: 'organizations/987.json', json: { organization: { name: 'Direct Lookup Org', ein: 987 }, filings_with_data: [] } },
    ]);
    const result = await fetch990Overview('Direct Lookup Org', '987');
    expect((result as { ein: string }).ein).toBe('987');
    expect(fn).toHaveBeenCalledTimes(1); // no search.json call at all
  });

  it('propagates a resolution error without calling the organization endpoint', async () => {
    stubFetch([{ match: 'search.json', json: { organizations: [] } }]);
    const result = await fetch990Overview('Nonexistent Foundation');
    expect(result).toEqual({ error: expect.stringMatching(/no ProPublica match/) });
  });

  it('returns an error when the organization endpoint has nothing for that EIN', async () => {
    stubFetch([{ match: 'organizations/000.json', json: {} }]);
    const result = await fetch990Overview('Whatever', '000');
    expect(result).toEqual({ error: expect.stringMatching(/no organization for EIN 000/) });
  });
});

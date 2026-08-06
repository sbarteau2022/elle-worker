// Live grant-opportunity ingest — mocked fetch (this sandbox can't reach
// api.grants.gov/api.www.sbir.gov at all; see the module header), plus an
// in-memory D1 stub for the upsert/close-stale orchestration. No live
// network calls are exercised here — same house convention as
// grant-990.test.ts.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  fetchGrantsGovOpportunities, fetchSbirOpportunities, normalizeGrantsGovHit,
  normalizeSbirSolicitation, runGrantIngest,
} from './grant-ingest';

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

describe('normalizeGrantsGovHit', () => {
  it('normalizes a well-formed hit', () => {
    const result = normalizeGrantsGovHit({
      number: 'VA-2026-001', title: 'SSG Fox Suicide Prevention Grant', agency: 'U.S. Dept. of Veterans Affairs',
      agencyCode: 'VA', closeDate: '05/05/2026', oppStatus: 'posted',
    });
    expect(result).toMatchObject({
      id: 'grants-gov-VA-2026-001', source: 'grants.gov', funder_name: 'U.S. Dept. of Veterans Affairs',
      funder_type: 'federal', program_name: 'SSG Fox Suicide Prevention Grant', deadline: '05/05/2026',
    });
  });

  it('falls back to numeric id when "number" is missing', () => {
    const result = normalizeGrantsGovHit({ id: 12345, title: 'Some Program' });
    expect(result?.id).toBe('grants-gov-12345');
  });

  it('falls back to agencyCode when "agency" is missing', () => {
    const result = normalizeGrantsGovHit({ number: 'X-1', title: 'X', agencyCode: 'NSF' });
    expect(result?.funder_name).toBe('NSF');
  });

  it('returns null when there is no usable identifier', () => {
    expect(normalizeGrantsGovHit({ title: 'No number or id' })).toBeNull();
  });

  it('returns null when there is no title', () => {
    expect(normalizeGrantsGovHit({ number: 'X-1' })).toBeNull();
  });
});

describe('normalizeSbirSolicitation', () => {
  it('normalizes a well-formed solicitation', () => {
    const result = normalizeSbirSolicitation({
      solicitation_number: 'NSF-26-001', solicitation_title: 'AI for Human-Computer Interaction',
      agency: 'National Science Foundation', branch: 'HCI', close_date: '2026-09-01',
    });
    expect(result).toMatchObject({
      id: 'sbir-gov-NSF-26-001', source: 'sbir.gov', funder_name: 'National Science Foundation',
      funder_type: 'federal', program_name: 'AI for Human-Computer Interaction', deadline: '2026-09-01',
      stated_priorities: 'HCI',
    });
  });

  it('defaults funder_name to NSF when agency is missing', () => {
    const result = normalizeSbirSolicitation({ solicitation_number: 'X-1', solicitation_title: 'X' });
    expect(result?.funder_name).toBe('National Science Foundation');
  });

  it('returns null without a solicitation number', () => {
    expect(normalizeSbirSolicitation({ solicitation_title: 'X' })).toBeNull();
  });

  it('returns null without a title', () => {
    expect(normalizeSbirSolicitation({ solicitation_number: 'X-1' })).toBeNull();
  });
});

describe('fetchGrantsGovOpportunities', () => {
  it('fans out across all three named agency/keyword queries and aggregates hits', async () => {
    const fn = stubFetch([{ match: 'search2', json: { data: { oppHits: [{ number: 'A-1', title: 'A' }] } } }]);
    const { opportunities, errors } = await fetchGrantsGovOpportunities();
    expect(fn).toHaveBeenCalledTimes(3); // VA, HHS-SAMHSA, NSF
    expect(opportunities).toHaveLength(3); // one hit per query, same stub response each time
    expect(errors).toHaveLength(0);
  });

  it('collects a per-query error without losing the other queries\' results', async () => {
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      call++;
      if (call === 2) return { ok: false, status: 503, json: async () => ({}) } as unknown as Response;
      return { ok: true, status: 200, json: async () => ({ data: { oppHits: [{ number: `Q-${call}`, title: 'X' }] } }) } as unknown as Response;
    }));
    const { opportunities, errors } = await fetchGrantsGovOpportunities();
    expect(opportunities).toHaveLength(2); // queries 1 and 3 succeeded
    expect(errors).toEqual([expect.stringMatching(/HHS-SAMHSA.*HTTP 503/)]);
  });

  it('turns a network failure into a collected error, not a throw', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET'); }));
    const { opportunities, errors } = await fetchGrantsGovOpportunities();
    expect(opportunities).toHaveLength(0);
    expect(errors).toHaveLength(3);
    expect(errors[0]).toMatch(/ECONNRESET/);
  });

  it('skips hits with no usable identifier or title rather than throwing', async () => {
    stubFetch([{ match: 'search2', json: { data: { oppHits: [{ title: 'no id' }, { number: 'ok-1', title: 'OK' }] } } }]);
    const { opportunities } = await fetchGrantsGovOpportunities();
    expect(opportunities.filter(o => o.id === 'grants-gov-ok-1')).toHaveLength(3); // once per query
    expect(opportunities.every(o => o.program_name)).toBe(true);
  });
});

describe('fetchSbirOpportunities', () => {
  it('normalizes solicitations from a well-formed response', async () => {
    stubFetch([{ match: 'solicitations', json: [{ solicitation_number: 'S-1', solicitation_title: 'AI Track' }] }]);
    const { opportunities, errors } = await fetchSbirOpportunities();
    expect(errors).toHaveLength(0);
    expect(opportunities).toEqual([expect.objectContaining({ id: 'sbir-gov-S-1', source: 'sbir.gov' })]);
  });

  it('returns an error on a non-OK response rather than throwing', async () => {
    stubFetch([{ match: 'solicitations', ok: false, status: 500 }]);
    const { opportunities, errors } = await fetchSbirOpportunities();
    expect(opportunities).toHaveLength(0);
    expect(errors).toEqual([expect.stringMatching(/HTTP 500/)]);
  });

  it('turns a network failure into a collected error, not a throw', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('DNS fail'); }));
    const { opportunities, errors } = await fetchSbirOpportunities();
    expect(opportunities).toHaveLength(0);
    expect(errors).toEqual([expect.stringMatching(/DNS fail/)]);
  });

  it('tolerates a non-array response body', async () => {
    stubFetch([{ match: 'solicitations', json: { unexpected: 'shape' } }]);
    const { opportunities, errors } = await fetchSbirOpportunities();
    expect(opportunities).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });
});

// In-memory D1 stub for grant_opportunities: tracks real state across
// prepare/bind/run calls (house pattern extended from grant-intelligence.test.ts's
// read-only fakeEnv, since runGrantIngest needs a stateful upsert + a
// separate close-stale pass to actually verify).
function fakeD1Env() {
  const rows = new Map<string, { id: string; source: string; status: string }>();
  const db = {
    prepare: (sql: string) => {
      const bound: unknown[] = [];
      const api = {
        bind: (...args: unknown[]) => { bound.push(...args); return api; },
        first: async () => {
          if (sql.includes('SELECT id FROM grant_opportunities WHERE id = ?')) {
            const id = bound[0] as string;
            return rows.has(id) ? { id } : null;
          }
          return null;
        },
        all: async <T,>() => {
          if (sql.includes('WHERE source = ? AND status = ')) {
            const source = bound[0] as string;
            const results = [...rows.values()].filter(r => r.source === source && r.status === 'open').map(r => ({ id: r.id }));
            return { results } as unknown as D1Result<T>;
          }
          return { results: [] } as unknown as D1Result<T>;
        },
        run: async () => {
          if (sql.startsWith('INSERT INTO grant_opportunities')) {
            const [id, source] = bound as string[];
            rows.set(id, { id, source, status: 'open' });
          } else if (sql.startsWith('UPDATE grant_opportunities SET status = ')) {
            const id = bound[0] as string;
            const row = rows.get(id);
            if (row) row.status = 'closed';
          }
          return { meta: { changes: 1 } } as unknown as D1Result;
        },
      };
      return api;
    },
    batch: async (_stmts: unknown[]) => [],
  };
  return { DB: db as unknown as D1Database, _rows: rows };
}

describe('runGrantIngest · orchestration', () => {
  it('inserts fresh hits from both sources', async () => {
    stubFetch([
      { match: 'search2', json: { data: { oppHits: [{ number: 'V-1', title: 'Veteran Program' }] } } },
      { match: 'solicitations', json: [{ solicitation_number: 'S-1', solicitation_title: 'AI Track' }] },
    ]);
    const env = fakeD1Env();
    const result = await runGrantIngest(env);
    // All 3 grants.gov queries return the same stubbed hit (same id), so the
    // first occurrence inserts and the other two update; the 1 sbir hit inserts.
    expect(result.fetched).toBe(4);
    expect(result.inserted).toBe(2);
    expect(result.updated).toBe(2);
    expect(result.errors).toHaveLength(0);
  });

  it('updates rather than duplicates on a re-run with the same hits', async () => {
    stubFetch([
      { match: 'search2', json: { data: { oppHits: [{ number: 'V-1', title: 'Veteran Program' }] } } },
      { match: 'solicitations', json: [{ solicitation_number: 'S-1', solicitation_title: 'AI Track' }] },
    ]);
    const env = fakeD1Env();
    await runGrantIngest(env);
    const second = await runGrantIngest(env);
    expect(second.inserted).toBe(0);
    expect(second.updated).toBeGreaterThan(0);
  });

  it('closes a previously-open row that no longer appears in a cleanly-fetched source', async () => {
    stubFetch([
      { match: 'search2', json: { data: { oppHits: [{ number: 'V-1', title: 'Veteran Program' }] } } },
      { match: 'solicitations', json: [{ solicitation_number: 'S-1', solicitation_title: 'AI Track' }] },
    ]);
    const env = fakeD1Env();
    await runGrantIngest(env);

    // Second run: sbir.gov now returns nothing for S-1 (it closed upstream).
    vi.unstubAllGlobals();
    stubFetch([
      { match: 'search2', json: { data: { oppHits: [{ number: 'V-1', title: 'Veteran Program' }] } } },
      { match: 'solicitations', json: [] },
    ]);
    const second = await runGrantIngest(env);
    expect(second.closed).toBe(1);
    expect(env._rows.get('sbir-gov-S-1')?.status).toBe('closed');
    expect(env._rows.get('grants-gov-V-1')?.status).toBe('open'); // untouched, still present
  });

  it('never closes rows from a source that errored this run', async () => {
    stubFetch([
      { match: 'search2', json: { data: { oppHits: [{ number: 'V-1', title: 'Veteran Program' }] } } },
      { match: 'solicitations', json: [{ solicitation_number: 'S-1', solicitation_title: 'AI Track' }] },
    ]);
    const env = fakeD1Env();
    await runGrantIngest(env);

    // Second run: sbir.gov now errors outright — must NOT read as "S-1 closed."
    vi.unstubAllGlobals();
    stubFetch([
      { match: 'search2', json: { data: { oppHits: [{ number: 'V-1', title: 'Veteran Program' }] } } },
      { match: 'solicitations', ok: false, status: 500 },
    ]);
    const second = await runGrantIngest(env);
    expect(second.closed).toBe(0);
    expect(env._rows.get('sbir-gov-S-1')?.status).toBe('open');
    expect(second.errors).toEqual([expect.stringMatching(/HTTP 500/)]);
  });
});

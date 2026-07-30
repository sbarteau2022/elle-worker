// Grant Intelligence Engine — pure data-shape tests plus the guard clauses
// that fire before any LLM call (missing rows, the NECAI-F funder-type gate).
// No live LLM calls are exercised here — see falcon.test.ts/observer.test.ts
// for the house convention of keeping engine tests to logic vitest can run
// without a network.
import { describe, it, expect } from 'vitest';
import { SEED_OPPORTUNITIES, runFitAnalysis, runNecaifEvaluation } from './grant-intelligence';

describe('grant intelligence · seed opportunities', () => {
  it('unique ids', () => {
    const ids = SEED_OPPORTUNITIES.map(o => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every row has a funder_name, program_name, and a valid funder_type', () => {
    const validTypes = ['federal', 'state', 'foundation', 'corporate', 'international', 'accelerator'];
    for (const o of SEED_OPPORTUNITIES) {
      expect(o.funder_name.length).toBeGreaterThan(0);
      expect(o.program_name.length).toBeGreaterThan(0);
      expect(validTypes).toContain(o.funder_type);
    }
  });

  it('necaif_applicable is set only on foundation/corporate funders — the same gate runNecaifEvaluation enforces', () => {
    for (const o of SEED_OPPORTUNITIES) {
      if (o.necaif_applicable === 1) {
        expect(['foundation', 'corporate']).toContain(o.funder_type);
      }
    }
  });

  it('covers both tracks named in the map doc (nonprofit + business)', () => {
    const tracks = new Set(SEED_OPPORTUNITIES.map(o => o.track_hint));
    expect(tracks.has('nonprofit')).toBe(true);
    expect(tracks.has('business')).toBe(true);
  });
});

// Minimal in-memory-shaped D1 stub (house pattern — see tool-forge.test.ts):
// `rows` maps a substring of the SQL to what `.first()`/`.all()` should
// return, keyed by whichever table name appears first in the query.
function fakeEnv(rows: Record<string, unknown | null>) {
  const stmt = (sql: string) => ({
    bind: (..._args: unknown[]) => stmt(sql),
    first: async () => {
      const key = Object.keys(rows).find(k => sql.includes(k));
      return key ? rows[key] : null;
    },
    all: async () => ({ results: [] }),
    run: async () => ({ meta: { changes: 0 } }),
  });
  return {
    DB: {
      prepare: (sql: string) => stmt(sql),
      batch: async (_stmts: unknown[]) => [],
    },
  } as any;
}

describe('grant intelligence · runFitAnalysis guard clauses', () => {
  it('throws when the organization id does not exist — no LLM call attempted', async () => {
    const env = fakeEnv({ grant_organizations: null });
    await expect(runFitAnalysis(env, 'missing-org', 'some-opp')).rejects.toThrow(/grant_organizations/);
  });

  it('throws when the opportunity id does not exist — no LLM call attempted', async () => {
    const env = fakeEnv({ grant_organizations: { id: 'org-1', track: 'nonprofit' }, grant_opportunities: null });
    await expect(runFitAnalysis(env, 'org-1', 'missing-opp')).rejects.toThrow(/grant_opportunities/);
  });
});

describe('grant intelligence · NECAI-F funder-type gate', () => {
  it('refuses to evaluate a federal opportunity — NECAI-F is foundation/corporate only', async () => {
    const env = fakeEnv({
      grant_opportunities: { id: 'nsf-sbir-ai', funder_name: 'National Science Foundation', funder_type: 'federal' },
    });
    await expect(runNecaifEvaluation(env, 'nsf-sbir-ai')).rejects.toThrow(/foundation\/corporate/);
  });

  it('refuses to evaluate a state opportunity', async () => {
    const env = fakeEnv({
      grant_opportunities: { id: 'mtc-idea-jul26', funder_name: 'Missouri Technology Corporation', funder_type: 'state' },
    });
    await expect(runNecaifEvaluation(env, 'mtc-idea-jul26')).rejects.toThrow(/foundation\/corporate/);
  });

  it('refuses to evaluate an accelerator opportunity', async () => {
    const env = fakeEnv({
      grant_opportunities: { id: 'arch-grants-rolling', funder_name: 'Arch Grants', funder_type: 'accelerator' },
    });
    await expect(runNecaifEvaluation(env, 'arch-grants-rolling')).rejects.toThrow(/foundation\/corporate/);
  });

  it('throws when the opportunity id does not exist', async () => {
    const env = fakeEnv({ grant_opportunities: null });
    await expect(runNecaifEvaluation(env, 'missing-opp')).rejects.toThrow(/grant_opportunities/);
  });
});

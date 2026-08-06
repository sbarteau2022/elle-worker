// Grant Intelligence Engine — pure guard-clause tests (missing rows, the
// NECAI-F funder-type gate, the GRANT_DB binding check). No live LLM calls
// are exercised here — see falcon.test.ts/observer.test.ts for the house
// convention of keeping engine tests to logic vitest can run without a
// network. The seed data and live-ingest logic this file used to own moved
// to the GrantIntelligence repo's grant-worker — see that repo's
// src/grant-ingest.test.ts for those tests now.
import { describe, it, expect } from 'vitest';
import { runFitAnalysis, runNecaifEvaluation } from './grant-intelligence';

// Minimal in-memory-shaped D1 stub (house pattern — see tool-forge.test.ts).
// grant_organizations/grant_fit_analyses/grant_necaif_evaluations live in
// `dbRows` (env.DB, elle-worker's own tables); grant_opportunities lives in
// `grantDbRows` (env.GRANT_DB, the grant-worker's database) — matching the
// real split in grant-intelligence.ts.
function fakeEnv(dbRows: Record<string, unknown | null>, grantDbRows: Record<string, unknown | null> = {}) {
  const stmtFor = (rows: Record<string, unknown | null>) => (sql: string) => ({
    bind: (..._args: unknown[]) => stmtFor(rows)(sql),
    first: async () => {
      const key = Object.keys(rows).find(k => sql.includes(k));
      return key ? rows[key] : null;
    },
    all: async () => ({ results: [] }),
    run: async () => ({ meta: { changes: 0 } }),
  });
  return {
    DB: { prepare: stmtFor(dbRows), batch: async (_stmts: unknown[]) => [] },
    GRANT_DB: { prepare: stmtFor(grantDbRows), batch: async (_stmts: unknown[]) => [] },
  } as any;
}

describe('grant intelligence · GRANT_DB binding guard', () => {
  it('fails with a specific, actionable error when GRANT_DB is not configured — not a null-deref', async () => {
    // ensureAllSchemas fires ALTER TABLE calls (not just the initial CREATE
    // TABLE batch) before this guard is ever reached, so the stub statement
    // needs every method present, not just the ones this test cares about.
    const env = fakeEnv({});
    delete env.GRANT_DB;
    await expect(runFitAnalysis(env, 'org-1', 'some-opp')).rejects.toThrow(/GRANT_DB binding not configured/);
  });
});

describe('grant intelligence · runFitAnalysis guard clauses', () => {
  it('throws when the organization id does not exist — no LLM call attempted', async () => {
    const env = fakeEnv({ grant_organizations: null });
    await expect(runFitAnalysis(env, 'missing-org', 'some-opp')).rejects.toThrow(/grant_organizations/);
  });

  it('throws when the opportunity id does not exist — no LLM call attempted', async () => {
    const env = fakeEnv({ grant_organizations: { id: 'org-1', track: 'nonprofit' } }, { grant_opportunities: null });
    await expect(runFitAnalysis(env, 'org-1', 'missing-opp')).rejects.toThrow(/grant_opportunities/);
  });
});

describe('grant intelligence · NECAI-F funder-type gate', () => {
  it('refuses to evaluate a federal opportunity — NECAI-F is foundation/corporate only', async () => {
    const env = fakeEnv({}, {
      grant_opportunities: { id: 'nsf-sbir-ai', funder_name: 'National Science Foundation', funder_type: 'federal' },
    });
    await expect(runNecaifEvaluation(env, 'nsf-sbir-ai')).rejects.toThrow(/foundation\/corporate/);
  });

  it('refuses to evaluate a state opportunity', async () => {
    const env = fakeEnv({}, {
      grant_opportunities: { id: 'mtc-idea-jul26', funder_name: 'Missouri Technology Corporation', funder_type: 'state' },
    });
    await expect(runNecaifEvaluation(env, 'mtc-idea-jul26')).rejects.toThrow(/foundation\/corporate/);
  });

  it('refuses to evaluate an accelerator opportunity', async () => {
    const env = fakeEnv({}, {
      grant_opportunities: { id: 'arch-grants-rolling', funder_name: 'Arch Grants', funder_type: 'accelerator' },
    });
    await expect(runNecaifEvaluation(env, 'arch-grants-rolling')).rejects.toThrow(/foundation\/corporate/);
  });

  it('throws when the opportunity id does not exist', async () => {
    const env = fakeEnv({}, { grant_opportunities: null });
    await expect(runNecaifEvaluation(env, 'missing-opp')).rejects.toThrow(/grant_opportunities/);
  });
});

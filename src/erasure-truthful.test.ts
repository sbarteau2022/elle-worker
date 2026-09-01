import { describe, it, expect, vi } from 'vitest';
import { handleMyErasure } from './member-feed';

// Regression: erasure returned {erased:true} unconditionally. Both the DELETE
// batch and the users delete swallowed every error, so a degraded D1 produced
// an API response asserting the user's data was gone while every row survived.
//
// Second regression: the atlas deletes used to share the core batch, with
// "no such table" treated as benign. D1's batch() is one transaction — a
// failing statement rolls back the ENTIRE sequence — so a missing atlas table
// rolled back all six core deletes, and the swallow still returned
// {erased:true} (with the users row, deleted separately, gone). The batches
// are now split: core is fail-loud, and only the atlas batch may treat
// "no such table" as nothing-to-erase.
function makeEnv(opts: { coreFails?: string; atlasFails?: string; usersFails?: boolean } = {}) {
  const executed: string[] = [];
  let batchCalls = 0;
  const env = {
    DB: {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn(() => ({
          sql,
          run: vi.fn(async () => {
            executed.push(sql);
            if (opts.usersFails) throw new Error('D1_ERROR: database is locked');
            return { success: true };
          }),
          all: vi.fn(async () => ({ results: [] })),
          first: vi.fn(async () => null),
        })),
      })),
      batch: vi.fn(async (stmts: Array<{ sql: string }>) => {
        batchCalls += 1;
        const fails = batchCalls === 1 ? opts.coreFails : opts.atlasFails;
        if (fails) throw new Error(fails);
        executed.push(...stmts.map(s => s.sql));
        return [];
      }),
    },
    AUTH_TOKENS: { list: vi.fn(async () => ({ keys: [] })), get: vi.fn(async () => null), delete: vi.fn(async () => {}) },
  };
  return { env: env as never, executed };
}

describe('handleMyErasure reports what actually happened', () => {
  it('returns erased:true only when the deletes succeeded', async () => {
    const { env, executed } = makeEnv();
    const r = await handleMyErasure(env, 'u1') as Record<string, unknown>;
    expect(r.erased).toBe(true);
    expect(executed.some(s => s.includes('FROM users'))).toBe(true);
  });

  it('does NOT claim success when the core record batch fails', async () => {
    const { env } = makeEnv({ coreFails: 'D1_ERROR: database is locked' });
    const r = await handleMyErasure(env, 'u2') as Record<string, unknown>;
    expect(r.erased).toBe(false);
    expect(String((r.errors as string[])[0])).toMatch(/locked/);
  });

  it('does NOT claim success when the account delete fails', async () => {
    const { env } = makeEnv({ usersFails: true });
    const r = await handleMyErasure(env, 'u3') as Record<string, unknown>;
    expect(r.erased).toBe(false);
  });

  it('a missing CORE table is a failure — the rollback means nothing was deleted', async () => {
    const { env, executed } = makeEnv({ coreFails: 'D1_ERROR: no such table: push_devices' });
    const r = await handleMyErasure(env, 'u4') as Record<string, unknown>;
    expect(r.erased).toBe(false);
    // and the login must survive so the erasure can be retried
    expect(executed.some(s => s.includes('FROM users'))).toBe(false);
  });

  it('missing ATLAS tables are nothing-to-erase — erasure still succeeds', async () => {
    const { env, executed } = makeEnv({ atlasFails: 'D1_ERROR: no such table: elle_memory_atlas' });
    const r = await handleMyErasure(env, 'u5') as Record<string, unknown>;
    expect(r.erased).toBe(true);
    expect(executed.some(s => s.includes('FROM users'))).toBe(true);
  });

  it('any other atlas-batch error is a failure, and the login survives', async () => {
    const { env, executed } = makeEnv({ atlasFails: 'D1_ERROR: database is locked' });
    const r = await handleMyErasure(env, 'u6') as Record<string, unknown>;
    expect(r.erased).toBe(false);
    expect(String((r.errors as string[])[0])).toMatch(/locked/);
    expect(executed.some(s => s.includes('FROM users'))).toBe(false);
  });
});

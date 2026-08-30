import { describe, it, expect, vi } from 'vitest';
import { handleMyErasure } from './member-feed';

// Regression: erasure returned {erased:true} unconditionally. Both the DELETE
// batch and the users delete swallowed every error, so a degraded D1 produced
// an API response asserting the user's data was gone while every row survived.
function makeEnv(opts: { batchFails?: string; usersFails?: boolean } = {}) {
  return {
    DB: {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          run: vi.fn(async () => {
            if (opts.usersFails) throw new Error('D1_ERROR: database is locked');
            return { success: true };
          }),
          all: vi.fn(async () => ({ results: [] })),
          first: vi.fn(async () => null),
        })),
      })),
      batch: vi.fn(async () => {
        if (opts.batchFails) throw new Error(opts.batchFails);
        return [];
      }),
    },
    AUTH_TOKENS: { list: vi.fn(async () => ({ keys: [] })), get: vi.fn(async () => null), delete: vi.fn(async () => {}) },
  } as never;
}

describe('handleMyErasure reports what actually happened', () => {
  it('returns erased:true only when the deletes succeeded', async () => {
    const r = await handleMyErasure(makeEnv(), 'u1') as Record<string, unknown>;
    expect(r.erased).toBe(true);
  });

  it('does NOT claim success when the record batch fails', async () => {
    const r = await handleMyErasure(makeEnv({ batchFails: 'D1_ERROR: database is locked' }), 'u2') as Record<string, unknown>;
    expect(r.erased).toBe(false);
    expect(String((r.errors as string[])[0])).toMatch(/locked/);
  });

  it('does NOT claim success when the account delete fails', async () => {
    const r = await handleMyErasure(makeEnv({ usersFails: true }), 'u3') as Record<string, unknown>;
    expect(r.erased).toBe(false);
  });

  it('still succeeds when a table simply does not exist yet', async () => {
    const r = await handleMyErasure(makeEnv({ batchFails: 'D1_ERROR: no such table: push_devices' }), 'u4') as Record<string, unknown>;
    expect(r.erased).toBe(true);
  });
});

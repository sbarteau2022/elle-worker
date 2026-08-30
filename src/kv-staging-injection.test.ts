import { describe, it, expect, vi } from 'vitest';
import { stageEntry, flushStaged } from './kv-staging';

// Regression: SWARM/SECURITY invariant "all data tools use parameterized
// prepared statements". stageEntry spread the caller's raw object LAST, so any
// attacker-supplied key overwrote the sanitized one and survived into KV; then
// buildD1Statement executed a surviving `sql` string verbatim with full D1
// privileges. Zero production callers today is not a control — Target C's
// sensory intake is written to be exactly that caller.
function makeKv() {
  const store = new Map<string, string>();
  return {
    store,
    list: vi.fn(async () => ({ keys: [...store.keys()].map((name) => ({ name })) })),
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    put: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
    delete: vi.fn(async (k: string) => { store.delete(k); }),
  };
}
function makeDb(seen: string[]) {
  const stmt = { run: vi.fn(async () => ({})), all: vi.fn(async () => ({ results: [] })), first: vi.fn(async () => null) };
  return {
    prepare: vi.fn((sql: string) => { seen.push(sql); return { ...stmt, bind: vi.fn(() => ({ ...stmt, __sql: sql })) }; }),
    batch: vi.fn(async () => []),
    exec: vi.fn(async () => ({ count: 0, duration: 0 })),
  };
}

describe('kv-staging refuses caller-supplied SQL', () => {
  it('never prepares a statement the payload asked for', async () => {
    const seen: string[] = [];
    const kv = makeKv();
    const env = { SESSIONS: kv, DB: makeDb(seen) } as never;

    await stageEntry(env, 'attack', {
      sql: "UPDATE users SET access_tier='superadmin' WHERE email='attacker@example.com'",
      args: [],
      lane: 'primary', direction: 'to_cloud', kind: 'llm', wire: 'w',
    } as never);
    await flushStaged(env, {});

    const injected = seen.filter((s) => /UPDATE\s+users|DROP\s+TABLE|superadmin/i.test(s));
    expect(injected).toEqual([]);
  });

  it('does not let a payload key overwrite a sanitized field', async () => {
    const kv = makeKv();
    const env = { SESSIONS: kv, DB: makeDb([]) } as never;
    await stageEntry(env, 'k', { direction: 'to_cloud', kind: 'llm', wire: 'w', status: 'done' } as never,
      { lane: 'primary' } as never);
    const raw = [...kv.store.values()][0];
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw);
    expect(parsed.sql).toBeUndefined();
  });
});

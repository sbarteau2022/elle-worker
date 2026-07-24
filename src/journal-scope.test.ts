// FIX 1 (P0 privacy) acceptance tests: journal reads are scoped to the caller.
//
// The permanent guarantee from the 2026-07-24 audit: two users with
// semantically identical journal content NEVER see each other's entries —
// even when Vectorize returns both as top matches for the same query. The
// enforcement gate is the D1 ownership join in journalRead/journalThread, not
// Vectorize metadata (historic vectors lack user_id).
//
//   npx vitest run src/journal-scope.test.ts
import { describe, it, expect } from 'vitest';
import { journalRead, journalThread, INTERNAL_JOURNAL_ACTORS } from './journal';

const OWNER = 'stewart-user-id';

type Row = Record<string, any>;

// A miniature D1 that faithfully implements the two ownership queries the
// journal read path issues (plus generic no-ops for schema DDL). The join
// semantics mirror SQL: user_id IN (...) never matches a NULL owner.
function makeEnv(fix: {
  threads: Row[];
  entries: Row[];
  owner?: string | null;
  matches: Array<{ id: string; score: number }>;
}) {
  const db: any = {
    prepare(sql: string) {
      const stmt: any = {
        args: [] as any[],
        bind(...a: any[]) { stmt.args = a; return stmt; },
        async run() { return { meta: { changes: 0 } }; },
        async first() {
          if (/access_tier = 'superadmin'/.test(sql)) return fix.owner ? { id: fix.owner } : null;
          const threadGate = sql.match(/FROM optimus_threads WHERE id = \? AND user_id IN \(([^)]*)\)/);
          if (threadGate) {
            const owners = stmt.args.slice(1) as string[];
            return fix.threads.find(t => t.id === stmt.args[0] && t.user_id != null && owners.includes(t.user_id)) ?? null;
          }
          return null;
        },
        async all() {
          if (/FROM optimus_entries e\s+JOIN optimus_threads t/.test(sql)) {
            const idPh = (sql.match(/e\.vectorize_id IN \(([^)]*)\)/) || [])[1] || '';
            const ownerPh = (sql.match(/t\.user_id IN \(([^)]*)\)/) || [])[1] || '';
            const idCount = (idPh.match(/\?/g) || []).length;
            const ownerCount = (ownerPh.match(/\?/g) || []).length;
            const ids = stmt.args.slice(0, idCount) as string[];
            const owners = stmt.args.slice(idCount, idCount + ownerCount) as string[];
            const threadFilter = /e\.thread_id = \?/.test(sql) ? stmt.args[idCount + ownerCount] : null;
            const results = fix.entries.filter(e => {
              const t = fix.threads.find(th => th.id === e.thread_id);
              return ids.includes(e.vectorize_id)
                && t != null && t.user_id != null && owners.includes(t.user_id)
                && (!threadFilter || e.thread_id === threadFilter);
            });
            return { results: results.map(r => ({ ...r })) };
          }
          return { results: [] };
        },
      };
      return stmt;
    },
    async batch(stmts: any[]) { return stmts.map(() => ({})); },
  };
  return {
    DB: db,
    VECTORIZE: {
      async query() { return { matches: fix.matches } as any; },
      async upsert() { return {} as any; },
    },
  } as any;
}

const embed = async () => [0.1, 0.2, 0.3];

// Two users who wrote semantically identical content, Elle's own internal
// thread, and one legacy NULL-owner thread. Vectorize surfaces ALL of them
// for the query — the D1 join is what must keep them apart.
function fixture() {
  return {
    owner: OWNER,
    threads: [
      { id: 'th-a', user_id: 'user-a' },
      { id: 'th-b', user_id: 'user-b' },
      { id: 'th-e', user_id: 'elle' },
      { id: 'th-null', user_id: null },
    ],
    entries: [
      { id: 'e-a', thread_id: 'th-a', role: 'reader', content: 'I fear the deep water', off_record: 0, vectorize_id: 'jrnl-e-a', created_at: 1 },
      { id: 'e-b', thread_id: 'th-b', role: 'reader', content: 'I fear the deep water', off_record: 0, vectorize_id: 'jrnl-e-b', created_at: 2 },
      { id: 'e-e', thread_id: 'th-e', role: 'elle', content: 'the deep water again', off_record: 0, vectorize_id: 'jrnl-e-e', created_at: 3 },
      { id: 'e-null', thread_id: 'th-null', role: 'reader', content: 'deep water, unowned', off_record: 0, vectorize_id: 'jrnl-e-null', created_at: 4 },
    ],
    matches: [
      { id: 'jrnl-e-a', score: 0.99 },
      { id: 'jrnl-e-b', score: 0.98 },
      { id: 'jrnl-e-e', score: 0.97 },
      { id: 'jrnl-e-null', score: 0.96 },
      { id: 'conv-not-journal', score: 0.95 },
    ],
  };
}

async function readAs(userId: string | undefined, over: Parameters<typeof makeEnv>[0] = fixture()) {
  return await journalRead(makeEnv(over), embed, { q: 'deep water', user_id: userId });
}

describe('journalRead user scoping (FIX 1)', () => {
  it('refuses a read with no user_id — no silent global read', async () => {
    expect(await readAs(undefined)).toEqual({ error: 'user_id required' });
    expect(await readAs('')).toEqual({ error: 'user_id required' });
  });

  it("user B never sees user A's semantically identical entry (acceptance)", async () => {
    const r = await readAs('user-b') as { results: any[] };
    expect(r.results.map(x => x.id)).toEqual(['e-b']);
  });

  it("user A sees only their own entry", async () => {
    const r = await readAs('user-a') as { results: any[] };
    expect(r.results.map(x => x.id)).toEqual(['e-a']);
  });

  it('a legacy NULL-owner thread is readable by no one (fail closed until backfill)', async () => {
    for (const uid of ['user-a', 'user-b', OWNER, 'conductor']) {
      const r = await readAs(uid) as { results: any[] };
      expect(r.results.map((x: any) => x.id)).not.toContain('e-null');
    }
  });

  it("the operator's estate includes internal-actor threads, never other users'", async () => {
    const r = await readAs(OWNER) as { results: any[] };
    expect(r.results.map(x => x.id)).toEqual(['e-e']);
  });

  it('internal actors (conductor/volition/router) read as the operator', async () => {
    for (const actor of INTERNAL_JOURNAL_ACTORS) {
      const r = await readAs(actor) as { results: any[] };
      expect(r.results.map((x: any) => x.id)).toEqual(['e-e']);
    }
  });

  it('an internal actor id falls back to strict self-scoping when no superadmin exists', async () => {
    const r = await readAs('conductor', { ...fixture(), owner: null }) as { results: any[] };
    expect(r.results).toEqual([]); // 'conductor' owns no threads directly
  });
});

describe('journalThread user scoping (FIX 1)', () => {
  it("returns 'thread not found' for a thread the caller does not own", async () => {
    const r = await journalThread(makeEnv(fixture()), { thread_id: 'th-a', user_id: 'user-b' });
    expect(r).toEqual({ error: 'thread not found' });
  });

  it('requires user_id', async () => {
    const r = await journalThread(makeEnv(fixture()), { thread_id: 'th-a' });
    expect(r).toEqual({ error: 'user_id required' });
  });

  it('serves the owner their own thread, and the estate to internal actors', async () => {
    const own = await journalThread(makeEnv(fixture()), { thread_id: 'th-a', user_id: 'user-a' }) as any;
    expect(own.thread?.id).toBe('th-a');
    const estate = await journalThread(makeEnv(fixture()), { thread_id: 'th-e', user_id: 'conductor' }) as any;
    expect(estate.thread?.id).toBe('th-e');
  });
});

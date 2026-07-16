import { describe, it, expect } from 'vitest';
import { createClientProfile, getClientByUser, resolveVenueForUser, type AtlasClient } from './atlas-clients';
import type { Env } from './index';

// The self-serve Atlas onboarding path: profile creation must (1) demand only
// company_name — the doc scrape aggregates the rest later, so the form must
// never grow a wall of required fields; (2) mint a per-client venue_id — the
// tenant key; (3) AUTO-file an ACTIVE conductor intent — the "sign up executes
// the workflow" contract; and (4) be idempotent — a double POST must not mint
// a second venue for the same user.

interface Exec { sql: string; binds: unknown[] }

function fakeEnv(opts?: { existingClient?: Partial<AtlasClient> | null }): { env: Env; execs: Exec[] } {
  const execs: Exec[] = [];
  const db = {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) { binds = args; return stmt; },
        async run() { execs.push({ sql, binds }); return { meta: { changes: 1 } }; },
        async all() { execs.push({ sql, binds }); return { results: [] }; },
        async first() {
          execs.push({ sql, binds });
          if (/FROM atlas_clients/.test(sql)) return opts?.existingClient ?? null;
          return null;
        },
      };
      return stmt;
    },
    async batch(stmts: unknown[]) { return stmts.map(() => ({ meta: {} })); },
  };
  const env = { DB: db } as unknown as Env;
  return { env, execs };
}

const USER = { id: 'user_1', email: 'owner@venue.test' };

describe('createClientProfile', () => {
  it('requires company_name and nothing else', async () => {
    const { env } = fakeEnv();
    await expect(createClientProfile(env, USER, {})).rejects.toThrow(/company_name required/);
    const ok = await createClientProfile(fakeEnv().env, USER, { company_name: 'The Copper Kettle' });
    expect(ok.created).toBe(true);
    expect(ok.client.company_name).toBe('The Copper Kettle');
  });

  it('mints a per-client venue_id (UUID) — the tenant key', async () => {
    const { env } = fakeEnv();
    const out = await createClientProfile(env, USER, { company_name: 'The Copper Kettle' });
    expect(out.client.venue_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('AUTO-files an ACTIVE onboarding intent naming the venue — signup executes the workflow', async () => {
    const { env, execs } = fakeEnv();
    const out = await createClientProfile(env, USER, { company_name: 'The Copper Kettle', pos_provider: 'Toast' });
    const intentInsert = execs.find(e => /INSERT INTO elle_intents/.test(e.sql));
    expect(intentInsert, 'no conductor intent was filed').toBeTruthy();
    const [, title, goal, status, , source] = intentInsert!.binds as string[];
    expect(title).toContain('Atlas onboarding — The Copper Kettle');
    expect(status).toBe('active');           // picked up on the next tick, no human dispatch
    expect(source).toBe('stewart');          // files as operator work, not a self-proposal
    expect(goal).toContain(out.client.venue_id);
    expect(goal).toContain('Toast');
    expect(goal).toContain('first-look report');
    expect(out.client.onboarding_intent_id).toBeTruthy();
  });

  it('persists the client row with status onboarding and the intent id', async () => {
    const { env, execs } = fakeEnv();
    const out = await createClientProfile(env, USER, { company_name: 'Kettle' });
    const rowInsert = execs.find(e => /INSERT INTO atlas_clients/.test(e.sql));
    expect(rowInsert).toBeTruthy();
    const binds = rowInsert!.binds as unknown[];
    expect(binds[0]).toBe(USER.id);
    expect(binds[8]).toBe('onboarding');
    expect(binds[9]).toBe(out.client.onboarding_intent_id);
  });

  it('is idempotent — a second POST resumes, it never mints a second venue', async () => {
    const existing = { user_id: USER.id, venue_id: 'venue-already', company_name: 'Kettle', status: 'onboarding' };
    const { env, execs } = fakeEnv({ existingClient: existing });
    const out = await createClientProfile(env, USER, { company_name: 'Kettle Again' });
    expect(out.created).toBe(false);
    expect(out.client.venue_id).toBe('venue-already');
    expect(execs.find(e => /INSERT INTO atlas_clients/.test(e.sql))).toBeUndefined();
    expect(execs.find(e => /INSERT INTO elle_intents/.test(e.sql))).toBeUndefined();
  });

  it('logs a live event so the workbench feed shows the signup', async () => {
    const { env, execs } = fakeEnv();
    await createClientProfile(env, USER, { company_name: 'Kettle' });
    const ev = execs.find(e => /INSERT INTO elle_live_events/.test(e.sql));
    expect(ev).toBeTruthy();
    expect(String(ev!.binds[1])).toContain('Atlas client signed up');
  });
});

describe('tenancy resolution', () => {
  it('resolveVenueForUser returns the client venue, and null for non-clients', async () => {
    const withRow = fakeEnv({ existingClient: { user_id: USER.id, venue_id: 'v-42' } });
    expect(await resolveVenueForUser(withRow.env, USER.id)).toBe('v-42');
    expect(await resolveVenueForUser(fakeEnv().env, 'stranger')).toBeNull();
  });

  it('resolveVenueForUser is best-effort — a DB error means fallback, never a thrown 500', async () => {
    const env = { DB: { prepare() { throw new Error('boom'); }, async batch() { return []; } } } as unknown as Env;
    expect(await resolveVenueForUser(env, USER.id)).toBeNull();
  });

  it('getClientByUser queries by user_id', async () => {
    const { env, execs } = fakeEnv();
    await getClientByUser(env, USER.id);
    const q = execs.find(e => /FROM atlas_clients WHERE user_id = \?/.test(e.sql));
    expect(q).toBeTruthy();
    expect(q!.binds[0]).toBe(USER.id);
  });
});

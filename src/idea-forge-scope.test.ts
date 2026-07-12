// idea{op:forge|build} ships code through forge_open/forge_write/forge_pr
// exactly like the named tools do (see router.ts's 'idea' case) — it must be
// refused by the SAME scopes that forge_open itself refuses (everyone but
// 'full', per SHIP_DENY). This proves the gate fires BEFORE any DB access
// (ensureIdeasSchema/getIdea never run for a denied scope) by handing runTool
// a DB stub that throws the moment it's touched.
import { describe, it, expect } from 'vitest';
import { runTool } from './router';
import type { RouterDeps } from './router';

const DB_TOUCHED = 'DB_TOUCHED';
function envThatThrowsIfDbIsTouched() {
  return {
    DB: { prepare: () => { throw new Error(DB_TOUCHED); } },
  } as any;
}

const noopDeps: RouterDeps = {
  embed: async () => [],
  ragSearch: async () => '',
  recallPastConversations: async () => '',
  handleCodeEngine: async () => new Response(''),
  handleIngest: async () => new Response(''),
  handleDiagnose: async () => new Response(''),
  handleResearch: async () => new Response(''),
  runLibreMode: async () => {},
  journalWrite: async () => ({}),
  journalRead: async () => ({}),
  journalThread: async () => ({}),
  journalAnnotate: async () => ({}),
};

const ctx = { userId: 'u1', sessionId: null as string | null };

describe('idea{op:forge/build} honors the forge_open boundary', () => {
  // 'idea' itself isn't in MEMBER_TOOLS/PUBLIC_TOOLS/HOSPITALITY_TOOLS, so
  // those three scopes never even reach the switch — runTool's outer
  // toolAllowed() gate (router.ts:512) refuses the whole tool first. Only
  // 'cofounder' reaches the new op-specific check, because 'idea' (unlike
  // forge_open/forge_write/forge_pr) is not in SHIP_DENY.
  const OUTER_GATE_SCOPES = ['member', 'public', 'hospitality'] as const;

  for (const scope of OUTER_GATE_SCOPES) {
    it(`refuses the whole "idea" tool for ${scope} scope before any op-level logic runs`, async () => {
      const out = await runTool('idea', { op: 'forge', id: 'x' }, envThatThrowsIfDbIsTouched(), noopDeps, ctx, scope);
      expect(out).toBe('tool "idea" is not available in this scope');
      expect(out).not.toMatch(new RegExp(DB_TOUCHED));
    });
  }

  it('refuses idea{op:forge} for cofounder scope, without touching the DB', async () => {
    const out = await runTool('idea', { op: 'forge', id: 'x' }, envThatThrowsIfDbIsTouched(), noopDeps, ctx, 'cofounder');
    expect(out).toMatch(/forging ships code/);
    expect(out).not.toMatch(new RegExp(DB_TOUCHED));
  });

  it('refuses idea{op:build} for cofounder scope the same way', async () => {
    const out = await runTool('idea', { op: 'build', id: 'x' }, envThatThrowsIfDbIsTouched(), noopDeps, ctx, 'cofounder');
    expect(out).toMatch(/forging ships code/);
  });

  it('does not gate non-shipping ops (e.g. op=list) for cofounder scope', async () => {
    // op=list still reaches ideaTool (and therefore the DB) for every scope —
    // proven here because our stub DB throws the instant it's touched. The
    // point of this test is only that the *forging* refusal text is absent;
    // ordinary idea reads/writes are unaffected by this gate.
    const out = await runTool('idea', { op: 'list' }, envThatThrowsIfDbIsTouched(), noopDeps, ctx, 'cofounder');
    expect(out).not.toMatch(/forging ships code/);
  });

  it('lets scope=full past the gate (reaches ideaTool, which then touches the DB)', async () => {
    const out = await runTool('idea', { op: 'forge', id: 'x' }, envThatThrowsIfDbIsTouched(), noopDeps, ctx, 'full');
    expect(out).not.toMatch(/forging ships code/);
    expect(out).toMatch(new RegExp(DB_TOUCHED));
  });
});

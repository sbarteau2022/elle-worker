// ============================================================
// ELLE WORKER — test/lane-dispatch-key.spec.ts
//
// ELLE_LANE_DISPATCH_KEY is a least-privilege credential: it opens
// { action: 'dispatch' } on /api/elle-sandbox-lane and NOTHING else. The whole
// point of it is the scope boundary, so the boundary is what gets tested —
// every other action must still refuse it, an unknown action must not inherit
// its looser gate, and an unset secret must never turn a blank header into a
// valid credential (the failure mode that makes "optional" secrets dangerous).
//
// Every case here stops at the authorization decision: an authorized-but-
// incomplete dispatch answers 400 before laneDispatch() touches any binding,
// so the suite needs no live D1/KV and 400-vs-401 reads as authorized-vs-not.
// ============================================================

import { describe, it, expect } from 'vitest';
import worker from '../src/index';
import type { Env } from '../src/index';

const GOOD = 'lane-dispatch-key-value-0123456789abcdef';
const SERVICE = 'service-key-value-fedcba9876543210';

// Minimal env: the lane gate reads three fields. ensureAllSchemas() is wrapped
// in .catch(() => {}) on the request path, so a DB that rejects is harmless and
// keeps the test honest about touching no real storage.
function mkEnv(over: Partial<Env> = {}): Env {
  return {
    DB: { prepare: () => { throw new Error('no db in this test'); } },
    AUTH_TOKENS: { get: async () => null },
    JWT_SECRET: 'jwt-secret',
    ELLE_SERVICE_KEY: SERVICE,
    ...over,
  } as unknown as Env;
}

function call(headers: Record<string, string>, payload: Record<string, unknown>, env: Env) {
  const request = new Request('https://w.example/api/elle-sandbox-lane', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
  return worker.fetch(request, env, { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext);
}

describe('ELLE_LANE_DISPATCH_KEY — scope boundary', () => {
  const env = () => mkEnv({ ELLE_LANE_DISPATCH_KEY: GOOD } as Partial<Env>);

  it('opens action=dispatch', async () => {
    // 400 "provide { name, kind }" is the authorized answer: the gate let it
    // through and the handler rejected it on arguments, not on credentials.
    const r = await call({ 'x-lane-dispatch-key': GOOD }, { action: 'dispatch' }, env());
    expect(r.status).toBe(400);
    expect((await r.json() as { error: string }).error).toMatch(/provide \{ name, kind/);
  });

  it.each(['create', 'list', 'remove', 'stability', 'report'])(
    'refuses action=%s — dispatch scope does not widen',
    async (action) => {
      const r = await call({ 'x-lane-dispatch-key': GOOD }, { action, name: 'primary', laneA: 'a', laneB: 'b' }, env());
      expect(r.status).toBe(401);
    },
  );

  it('refuses an unknown action rather than falling through to 400', async () => {
    // A future action added to the handler must not silently inherit the
    // narrow key's gate; it fails closed at 401 until someone opts it in.
    const r = await call({ 'x-lane-dispatch-key': GOOD }, { action: 'exfiltrate' }, env());
    expect(r.status).toBe(401);
  });

  it('refuses a wrong key value', async () => {
    const r = await call({ 'x-lane-dispatch-key': `${GOOD}x` }, { action: 'dispatch' }, env());
    expect(r.status).toBe(401);
  });

  it('does not accept the dispatch key in the Authorization header', async () => {
    // Distinct header on purpose — a narrow secret must never be presented
    // where the god credential is compared.
    const r = await call({ authorization: `Bearer ${GOOD}` }, { action: 'dispatch' }, env());
    expect(r.status).toBe(401);
  });
});

describe('ELLE_LANE_DISPATCH_KEY — unset', () => {
  it('never matches a blank or absent header when the secret is unset', async () => {
    for (const headers of [{}, { 'x-lane-dispatch-key': '' }, { 'x-lane-dispatch-key': 'undefined' }]) {
      const r = await call(headers, { action: 'dispatch' }, mkEnv());
      expect(r.status).toBe(401);
    }
  });
});

describe('ELLE_SERVICE_KEY — unchanged on this route', () => {
  it('still opens every action', async () => {
    const r = await call({ authorization: `Bearer ${SERVICE}` }, { action: 'dispatch' }, mkEnv());
    expect(r.status).toBe(400); // authorized, then rejected on arguments

    // An unknown action reaching the handler's own 400 proves the service key
    // passed the gate for actions the narrow key is refused for.
    const u = await call({ authorization: `Bearer ${SERVICE}` }, { action: 'exfiltrate' }, mkEnv());
    expect(u.status).toBe(400);
    expect((await u.json() as { error: string }).error).toMatch(/unknown action/);
  });
});

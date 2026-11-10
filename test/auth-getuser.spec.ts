// ============================================================
// ELLE WORKER — test/auth-getuser.spec.ts
//
// getUser's local-dev fallback used to fire on ANY non-production
// ENVIRONMENT and hand back tier:'admin' unconditionally — which isAdmin()
// (below) trusts directly to unlock every internal/admin route in this file.
// A dropped ENVIRONMENT var, or a future [env.preview] block, would have
// reopened a full admin bypass with zero attacker skill required. These
// tests pin the fix: the fallback requires a dedicated DEV_AUTH_BYPASS
// secret, never grants admin, and a token that was actually presented but
// failed verification never falls through to it.
// ============================================================

import { describe, it, expect } from 'vitest';
import { getUser, isAdmin, signJWT, verifyJWT } from '../src/index';
import type { Env } from '../src/index';

const SECRET = 'test-jwt-secret-0123456789abcdef';

function mkEnv(over: Partial<Env> = {}): Env {
  return {
    JWT_SECRET: SECRET,
    ENVIRONMENT: 'production',
    AUTH_TOKENS: { get: async () => 'present' }, // token not revoked, by default
    ...over,
  } as unknown as Env;
}

function reqWith(auth?: string): Request {
  const headers = new Headers();
  if (auth) headers.set('Authorization', auth);
  return new Request('https://w.example/x', { headers });
}

describe('getUser — local-dev fallback', () => {
  it('returns null with no Authorization header when DEV_AUTH_BYPASS is unset', async () => {
    const env = mkEnv({ ENVIRONMENT: 'development' });
    expect(await getUser(reqWith(), env)).toBeNull();
  });

  it('returns null with no Authorization header in production, even with DEV_AUTH_BYPASS set', async () => {
    const env = mkEnv({ ENVIRONMENT: 'production', DEV_AUTH_BYPASS: 'dev-secret' });
    expect(await getUser(reqWith(), env)).toBeNull();
  });

  it('returns a non-admin dev identity when both ENVIRONMENT!=production AND DEV_AUTH_BYPASS are set', async () => {
    const env = mkEnv({ ENVIRONMENT: 'development', DEV_AUTH_BYPASS: 'dev-secret' });
    const u = await getUser(reqWith(), env);
    expect(u).toEqual({ id: 'local-dev', email: 'dev@localhost', tier: 'standard' });
  });

  it('the dev fallback tier never satisfies isAdmin()', async () => {
    const env = mkEnv({ ENVIRONMENT: 'development', DEV_AUTH_BYPASS: 'dev-secret' });
    expect(await isAdmin(reqWith(), env)).toBe(false);
  });
});

describe('getUser — a presented-but-invalid token never falls through to the dev identity', () => {
  const devEnv = () => mkEnv({ ENVIRONMENT: 'development', DEV_AUTH_BYPASS: 'dev-secret' });

  it('a malformed bearer token returns null, not the dev identity', async () => {
    expect(await getUser(reqWith('Bearer not-a-jwt'), devEnv())).toBeNull();
  });

  it('a token signed with the wrong secret returns null', async () => {
    const bad = await signJWT({ sub: 'u1', email: 'a@b.com', tier: 'admin', jti: 'j1' }, 'wrong-secret');
    expect(await getUser(reqWith(`Bearer ${bad}`), devEnv())).toBeNull();
  });

  it('an expired token returns null', async () => {
    const expired = await signJWT({ sub: 'u1', email: 'a@b.com', tier: 'standard', jti: 'j1', exp: Math.floor(Date.now() / 1000) - 3600 }, SECRET);
    expect(await getUser(reqWith(`Bearer ${expired}`), devEnv())).toBeNull();
  });

  it('a token with no subject returns null', async () => {
    const noSub = await signJWT({ email: 'a@b.com', tier: 'standard', jti: 'j1' }, SECRET);
    expect(await getUser(reqWith(`Bearer ${noSub}`), devEnv())).toBeNull();
  });

  it('a revoked jti (absent from AUTH_TOKENS) returns null', async () => {
    const revoked = await signJWT({ sub: 'u1', email: 'a@b.com', tier: 'admin', jti: 'j1' }, SECRET);
    const env = { ...devEnv(), AUTH_TOKENS: { get: async () => null } } as unknown as Env;
    expect(await getUser(reqWith(`Bearer ${revoked}`), env)).toBeNull();
  });
});

describe('getUser — a valid token resolves normally', () => {
  it('returns the token identity regardless of the dev-bypass config', async () => {
    const token = await signJWT({ sub: 'u1', email: 'a@b.com', tier: 'admin', jti: 'j1' }, SECRET);
    const env = mkEnv({ ENVIRONMENT: 'development', DEV_AUTH_BYPASS: 'dev-secret' });
    expect(await getUser(reqWith(`Bearer ${token}`), env)).toEqual({ id: 'u1', email: 'a@b.com', tier: 'admin' });
  });

  it('a real admin-tier token still satisfies isAdmin()', async () => {
    const token = await signJWT({ sub: 'u1', email: 'a@b.com', tier: 'admin', jti: 'j1' }, SECRET);
    expect(await isAdmin(reqWith(`Bearer ${token}`), mkEnv())).toBe(true);
  });
});

describe('signJWT / verifyJWT — fail closed on an unset secret', () => {
  it('signJWT throws rather than signing with an empty/undefined secret', async () => {
    await expect(signJWT({ sub: 'u1' }, '')).rejects.toThrow(/JWT_SECRET/);
  });

  it('verifyJWT returns null rather than verifying against an empty secret', async () => {
    const token = await signJWT({ sub: 'u1', jti: 'j1' }, SECRET);
    expect(await verifyJWT(token, '')).toBeNull();
  });
});

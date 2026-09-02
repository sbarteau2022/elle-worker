// ============================================================
// ELLE WORKER — test/atlas-oauth-csrf.spec.ts
//
// Route-level coverage for the OAuth CSRF cookie binding (see
// atlas-business-auth.ts's oauthCsrfCookie doc comment): /oauth/start must
// hand back a Set-Cookie carrying `state`, and /oauth/callback must refuse a
// request whose Cookie header doesn't carry the matching value — BEFORE it
// ever attempts a code exchange with Google — so a code+state pair captured
// from one browser can't be completed by handing the URL to a different one.
// ============================================================

import { describe, it, expect } from 'vitest';
import worker from '../src/index';
import type { Env } from '../src/index';

function fakeKV() {
  const store = new Map<string, string>();
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => { store.set(k, v); },
    delete: async (k: string) => { store.delete(k); },
  } as unknown as KVNamespace;
}

function mkEnv(over: Partial<Env> = {}): Env {
  return {
    AUTH_TOKENS: fakeKV(),
    GOOGLE_CLIENT_ID: 'client-abc.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'secret',
    GOOGLE_OAUTH_REDIRECT: 'https://worker.example/api/atlas/oauth/callback',
    ATLAS_APP_URL: 'https://rapidai.pages.dev',
    JWT_SECRET: 'jwt-secret',
    ...over,
  } as unknown as Env;
}

function ctx() {
  return { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
}

function getCookieValue(setCookieHeader: string | null): string | null {
  if (!setCookieHeader) return null;
  const m = setCookieHeader.match(/^atlas_oauth_csrf=([^;]*)/);
  return m ? m[1] : null;
}

describe('/api/atlas/oauth/start — sets the CSRF cookie', () => {
  it('redirects to Google and sets an HttpOnly cookie carrying the same state', async () => {
    const req = new Request('https://worker.example/api/atlas/oauth/start', { redirect: 'manual' });
    const res = await worker.fetch(req, mkEnv(), ctx());
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('Location')!);
    const stateInUrl = location.searchParams.get('state');
    expect(stateInUrl).toBeTruthy();
    const cookie = res.headers.get('Set-Cookie');
    expect(cookie).toContain('HttpOnly');
    expect(getCookieValue(cookie)).toBe(stateInUrl);
  });
});

describe('/api/atlas/oauth/callback — refuses a browser without the matching CSRF cookie', () => {
  it('refuses when no cookie is presented at all, before any code exchange', async () => {
    const env = mkEnv();
    // A real /start would have stashed this in KV; a legitimate callback also
    // needs it, so seed it to isolate the case under test: cookie missing.
    await env.AUTH_TOKENS.put('atlas_oauth_state:some-state', JSON.stringify({ returnTo: 'https://rapidai.pages.dev/start' }));
    const req = new Request('https://worker.example/api/atlas/oauth/callback?state=some-state&code=abc', { redirect: 'manual' });
    const res = await worker.fetch(req, env, ctx());
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('Location')!);
    expect(loc.searchParams.get('atlas_error')).toBe('state_mismatch');
    // The state token must NOT be consumed by a mismatched-cookie attempt —
    // the legitimate browser (the one that actually holds the cookie) must
    // still be able to complete the flow afterwards.
    expect(await env.AUTH_TOKENS.get('atlas_oauth_state:some-state')).not.toBeNull();
  });

  it('refuses when the cookie carries a DIFFERENT state than the URL — the captured-URL relay attack', async () => {
    const env = mkEnv();
    await env.AUTH_TOKENS.put('atlas_oauth_state:victim-state', JSON.stringify({ returnTo: 'https://rapidai.pages.dev/start' }));
    // The victim's browser only ever visited /start for a DIFFERENT flow (or
    // never visited it at all) — its cookie, if any, won't be this value.
    const req = new Request('https://worker.example/api/atlas/oauth/callback?state=victim-state&code=abc', {
      redirect: 'manual',
      headers: { Cookie: 'atlas_oauth_csrf=attacker-own-state' },
    });
    const res = await worker.fetch(req, env, ctx());
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('Location')!);
    expect(loc.searchParams.get('atlas_error')).toBe('state_mismatch');
    expect(await env.AUTH_TOKENS.get('atlas_oauth_state:victim-state')).not.toBeNull();
  });

  it('clears the CSRF cookie on the way out even on refusal', async () => {
    const env = mkEnv();
    const req = new Request('https://worker.example/api/atlas/oauth/callback?state=nope&code=abc', { redirect: 'manual' });
    const res = await worker.fetch(req, env, ctx());
    expect(res.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });

  it('proceeds past the CSRF check (to expired_state) when the cookie matches the URL state', async () => {
    // No KV entry seeded ⇒ consumeState returns null ⇒ expired_state — proving
    // the CSRF check itself passed and let the request through to the next
    // stage, rather than failing on cookie mismatch.
    const env = mkEnv();
    const req = new Request('https://worker.example/api/atlas/oauth/callback?state=matches&code=abc', {
      redirect: 'manual',
      headers: { Cookie: 'atlas_oauth_csrf=matches' },
    });
    const res = await worker.fetch(req, env, ctx());
    const loc = new URL(res.headers.get('Location')!);
    expect(loc.searchParams.get('atlas_error')).toBe('expired_state');
  });
});

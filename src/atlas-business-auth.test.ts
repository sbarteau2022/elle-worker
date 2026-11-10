import { describe, it, expect } from 'vitest';
import {
  businessAuthConfigured,
  startBusinessAuth,
  consumeState,
  decodeIdentity,
  buildIntakePayload,
  storeCredentials,
  decryptGcred,
  BUSINESS_SCOPES,
  oauthCsrfCookie,
  oauthCsrfCookieClear,
  readCookie,
  OAUTH_CSRF_COOKIE,
  type BusinessAuthEnv,
  type GoogleIdentity,
} from './atlas-business-auth';

// ── a KV stub good enough for state + credential storage ────────────────
function fakeKV() {
  const store = new Map<string, string>();
  const ttls = new Map<string, number | undefined>();
  return {
    store,
    ttls,
    kv: {
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, v: string, opts?: { expirationTtl?: number }) => {
        store.set(k, v);
        ttls.set(k, opts?.expirationTtl);
      },
      delete: async (k: string) => { store.delete(k); },
    } as unknown as KVNamespace,
  };
}

function env(overrides: Partial<BusinessAuthEnv> = {}): BusinessAuthEnv {
  const { kv } = fakeKV();
  return {
    GOOGLE_CLIENT_ID: 'client-abc.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'secret',
    GOOGLE_OAUTH_REDIRECT: 'https://worker.example/api/atlas/oauth/callback',
    ATLAS_APP_URL: 'https://rapidai.pages.dev',
    AUTH_TOKENS: kv,
    ...overrides,
  };
}

describe('businessAuthConfigured', () => {
  it('is false until the secret and redirect URI both exist', () => {
    expect(businessAuthConfigured(env({ GOOGLE_CLIENT_SECRET: undefined }))).toBe(false);
    expect(businessAuthConfigured(env({ GOOGLE_OAUTH_REDIRECT: undefined }))).toBe(false);
    expect(businessAuthConfigured(env({ GOOGLE_CLIENT_ID: undefined }))).toBe(false);
    expect(businessAuthConfigured(env())).toBe(true);
  });
});

describe('startBusinessAuth', () => {
  it('asks for the business scope and offline access', async () => {
    const { url } = await startBusinessAuth(env());
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('scope')).toContain('business.manage');
    // Without offline+consent there is no refresh token, so no later re-sync.
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('prompt')).toBe('consent');
    expect(u.searchParams.get('state')).toBeTruthy();
  });

  it('uses only the first client id when an allowlist is configured', async () => {
    const { url } = await startBusinessAuth(env({ GOOGLE_CLIENT_ID: 'web-id,ios-id' }));
    expect(new URL(url).searchParams.get('client_id')).toBe('web-id');
  });

  it('round-trips state exactly once', async () => {
    const e = env();
    const { state } = await startBusinessAuth(e);
    expect(await consumeState(e, state)).not.toBeNull();
    // Replay must fail — this is the CSRF defence.
    expect(await consumeState(e, state)).toBeNull();
  });

  it('rejects an unknown state', async () => {
    expect(await consumeState(env(), 'never-issued')).toBeNull();
  });

  it('keeps return_to on our own origin', async () => {
    const e = env();
    const { state } = await startBusinessAuth(e, { returnTo: 'https://evil.example/steal' });
    expect((await consumeState(e, state))!.returnTo).toBe('https://rapidai.pages.dev/start');
  });

  it('refuses a protocol-relative return_to', async () => {
    const e = env();
    const { state } = await startBusinessAuth(e, { returnTo: '//evil.example' });
    expect((await consumeState(e, state))!.returnTo).toBe('https://rapidai.pages.dev/start');
  });

  it('allows a relative path on our own origin', async () => {
    const e = env();
    const { state } = await startBusinessAuth(e, { returnTo: '/start?step=2' });
    expect((await consumeState(e, state))!.returnTo).toBe('https://rapidai.pages.dev/start?step=2');
  });
});

// ── CSRF cookie: binds state to the browser that started the flow ───────
describe('oauth CSRF cookie', () => {
  it('binds the state value, is HttpOnly/Secure/SameSite=Lax, and scoped to the oauth path', () => {
    const header = oauthCsrfCookie('abc123');
    expect(header).toMatch(/^atlas_oauth_csrf=abc123;/);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Secure');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/api/atlas/oauth');
  });

  it('the clear cookie expires immediately and carries no value', () => {
    const header = oauthCsrfCookieClear();
    expect(header).toMatch(/^atlas_oauth_csrf=;/);
    expect(header).toContain('Max-Age=0');
  });

  it('readCookie extracts one named cookie among several', () => {
    const header = `foo=bar; ${OAUTH_CSRF_COOKIE}=the-state-value; baz=qux`;
    expect(readCookie(header, OAUTH_CSRF_COOKIE)).toBe('the-state-value');
  });

  it('readCookie returns null when the cookie is absent', () => {
    expect(readCookie('foo=bar', OAUTH_CSRF_COOKIE)).toBeNull();
    expect(readCookie('', OAUTH_CSRF_COOKIE)).toBeNull();
  });
});

// ── stored credentials: bounded retention + opt-in encryption ───────────
describe('storeCredentials', () => {
  it('bounds retention with a TTL on both KV keys — no code path re-reads this today', async () => {
    const { kv, ttls } = fakeKV();
    const e = env({ AUTH_TOKENS: kv });
    const ref = await storeCredentials(e, 'sub-1', { access_token: 'at', refresh_token: 'rt', scope: BUSINESS_SCOPES });
    expect(ttls.get(`atlas_gcred:${ref}`)).toBeGreaterThan(0);
    expect(ttls.get('atlas_gcred_by_sub:sub-1')).toBeGreaterThan(0);
  });

  it('stores the refresh token in plaintext when ATLAS_TOKEN_ENC_KEY is unset (unchanged, opt-in)', async () => {
    const { kv, store } = fakeKV();
    const e = env({ AUTH_TOKENS: kv });
    const ref = await storeCredentials(e, 'sub-1', { access_token: 'at', refresh_token: 'rt', scope: BUSINESS_SCOPES });
    const stored = JSON.parse(store.get(`atlas_gcred:${ref}`)!);
    expect(stored.refresh_token).toBe('rt');
  });

  it('encrypts the refresh token at rest when ATLAS_TOKEN_ENC_KEY is configured, and decryptGcred round-trips it', async () => {
    const { kv, store } = fakeKV();
    const encKey = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    const e = env({ AUTH_TOKENS: kv, ATLAS_TOKEN_ENC_KEY: encKey });
    const ref = await storeCredentials(e, 'sub-1', { access_token: 'at', refresh_token: 'rt', scope: BUSINESS_SCOPES });
    const stored = JSON.parse(store.get(`atlas_gcred:${ref}`)!);
    expect(stored.refresh_token).not.toBe('rt');
    expect(stored.refresh_token).toMatch(/^enc:/);
    expect(await decryptGcred(stored.refresh_token, e)).toBe('rt');
  });

  it('decryptGcred reads a legacy plaintext value unchanged, even with a key configured', async () => {
    const encKey = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    const e = env({ ATLAS_TOKEN_ENC_KEY: encKey });
    expect(await decryptGcred('a-plaintext-refresh-token', e)).toBe('a-plaintext-refresh-token');
  });

  it('decryptGcred throws rather than returning garbage when the key is missing', async () => {
    const { kv, store } = fakeKV();
    const encKey = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    const e = env({ AUTH_TOKENS: kv, ATLAS_TOKEN_ENC_KEY: encKey });
    const ref = await storeCredentials(e, 'sub-1', { access_token: 'at', refresh_token: 'rt', scope: BUSINESS_SCOPES });
    const stored = JSON.parse(store.get(`atlas_gcred:${ref}`)!);
    await expect(decryptGcred(stored.refresh_token, env())).rejects.toThrow(/ATLAS_TOKEN_ENC_KEY/);
  });
});

// ── identity ────────────────────────────────────────────────────────────
function idToken(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'RS256' })}.${b64(claims)}.sig`;
}

const AUD = 'client-abc.apps.googleusercontent.com';
const future = Math.floor(Date.now() / 1000) + 3600;

describe('decodeIdentity', () => {
  it('reads the claims we care about', () => {
    const id = decodeIdentity(idToken({
      sub: '1234', email: 'Owner@Riverbend.com', email_verified: true,
      name: 'Sam Rivers', hd: 'riverbend.com', aud: AUD, exp: future,
    }), AUD)!;
    expect(id.sub).toBe('1234');
    expect(id.email).toBe('owner@riverbend.com'); // normalized
    expect(id.email_verified).toBe(true);
    expect(id.hd).toBe('riverbend.com');
  });

  it('refuses a token minted for another client', () => {
    expect(decodeIdentity(idToken({ sub: '1', email: 'a@b.com', aud: 'someone-else', exp: future }), AUD)).toBeNull();
  });

  it('refuses an expired token', () => {
    const past = Math.floor(Date.now() / 1000) - 7200;
    expect(decodeIdentity(idToken({ sub: '1', email: 'a@b.com', aud: AUD, exp: past }), AUD)).toBeNull();
  });

  it('refuses a malformed token', () => {
    expect(decodeIdentity('nope', AUD)).toBeNull();
    expect(decodeIdentity('a.b', AUD)).toBeNull();
    expect(decodeIdentity('a.!!!not-base64!!!.c', AUD)).toBeNull();
  });

  it('refuses a token with no subject or email', () => {
    expect(decodeIdentity(idToken({ email: 'a@b.com', aud: AUD, exp: future }), AUD)).toBeNull();
    expect(decodeIdentity(idToken({ sub: '1', aud: AUD, exp: future }), AUD)).toBeNull();
  });

  it('reports an unverified email rather than silently trusting it', () => {
    const id = decodeIdentity(idToken({
      sub: '1', email: 'a@b.com', email_verified: false, aud: AUD, exp: future,
    }), AUD)!;
    expect(id.email_verified).toBe(false);
  });
});

// ── intake payload shaping ──────────────────────────────────────────────
const IDENTITY: GoogleIdentity = {
  sub: 'sub-1', email: 'owner@riverbend.com', email_verified: true,
  name: 'Sam Rivers', given_name: 'Sam', family_name: 'Rivers', hd: 'riverbend.com',
};

const LOCATION = {
  name: 'locations/456',
  title: 'Riverbend Kitchen',
  storeCode: 'RBK-1',
  websiteUri: 'https://riverbendkitchen.com',
  phoneNumbers: { primaryPhone: '+1 573-555-0100' },
  categories: {
    primaryCategory: { displayName: 'Restaurant' },
    additionalCategories: [{ displayName: 'Caterer' }, { displayName: 'Bar' }],
  },
  storefrontAddress: {
    addressLines: ['101 Wharf St', 'Suite B'], locality: 'Hermann',
    administrativeArea: 'MO', postalCode: '65041', regionCode: 'US',
  },
  latlng: { latitude: 38.7, longitude: -91.4 },
  metadata: { hasVoiceOfMerchant: true },
  regularHours: { periods: [] },
  openInfo: { openingDate: { year: 2016, month: 4, day: 1 } },
};

describe('buildIntakePayload', () => {
  const base = {
    identity: IDENTITY,
    tokens: { access_token: 'at', refresh_token: 'rt', scope: BUSINESS_SCOPES },
    tokenRef: 'gcred_x',
  };

  it('flattens the business account and its locations', () => {
    const p: any = buildIntakePayload({
      ...base,
      profile: { account: { name: 'accounts/123', accountName: 'Riverbend Hospitality', type: 'ORGANIZATION' }, locations: [LOCATION] },
    });
    expect(p.google_account_id).toBe('accounts/123');
    expect(p.display_name).toBe('Riverbend Hospitality');
    expect(p.locality).toBe('Hermann');
    expect(p.region).toBe('MO');
    expect(p.address_line1).toBe('101 Wharf St');
    expect(p.address_line2).toBe('Suite B');
    expect(p.primary_category).toBe('Restaurant');
    expect(p.additional_categories).toEqual(['Caterer', 'Bar']);
    expect(p.google_verified).toBe(true);
    expect(p.website).toBe('https://riverbendkitchen.com');
    expect(p.locations).toHaveLength(1);
    expect(p.locations[0].google_location_id).toBe('locations/456');
    expect(p.locations[0].opened_date).toBe('2016-4-1');
  });

  it('carries the person through for the owner record', () => {
    const p: any = buildIntakePayload({ ...base, profile: { locations: [] } });
    expect(p.person.email).toBe('owner@riverbend.com');
    expect(p.person.google_sub).toBe('sub-1');
    expect(p.person.full_name).toBe('Sam Rivers');
  });

  it('records the grant by reference and never carries a token', () => {
    const p: any = buildIntakePayload({ ...base, profile: { locations: [] } });
    expect(p.grant.token_ref).toBe('gcred_x');
    expect(p.grant.has_refresh_token).toBe(true);
    expect(p.grant.granted_scopes).toContain('business.manage');
    // The whole payload must not contain the credential values anywhere.
    const serialized = JSON.stringify(p);
    expect(serialized).not.toContain('"rt"');
    expect(serialized).not.toContain('"at"');
  });

  it('flags a grant with no refresh token, rather than assuming one', () => {
    const p: any = buildIntakePayload({
      ...base, tokens: { access_token: 'at', scope: BUSINESS_SCOPES }, profile: { locations: [] },
    });
    expect(p.grant.has_refresh_token).toBe(false);
  });

  it('falls back to the workspace domain when there is no business profile', () => {
    const p: any = buildIntakePayload({ ...base, profile: { locations: [] } });
    expect(p.display_name).toBe('riverbend.com');
    expect(p.locations).toEqual([]);
    expect(p.google_verified).toBe(false);
  });

  it('falls back to the email domain for a consumer account', () => {
    const p: any = buildIntakePayload({
      ...base,
      identity: { ...IDENTITY, hd: undefined, email: 'joe@gmail.com' },
      profile: { locations: [] },
    });
    expect(p.display_name).toBe('gmail.com');
    expect(p.primary_domain).toBeUndefined();
  });

  it('prefers a location title over the domain when the account has no name', () => {
    const p: any = buildIntakePayload({
      ...base, profile: { account: { name: 'accounts/123' }, locations: [LOCATION] },
    });
    expect(p.display_name).toBe('Riverbend Kitchen');
  });

  it('marks the business verified when any location is', () => {
    const unverified = { ...LOCATION, name: 'locations/789', metadata: {} };
    const p: any = buildIntakePayload({
      ...base, profile: { account: { name: 'accounts/1' }, locations: [unverified, LOCATION] },
    });
    expect(p.google_verified).toBe(true);
  });
});

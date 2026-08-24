// ============================================================
// ATLAS — Google BUSINESS sign-in  (src/atlas-business-auth.ts)
//
// Two doors, and they are not equal.
//
//   1. BUSINESS (this module). The authorization-code flow with the Google
//      Business Profile scope. The operator consents once; we exchange the
//      code for tokens, read their business account and locations, and land
//      the whole thing in the CRM in one sweep. This door ESTABLISHES a
//      business, and whoever walks through it first becomes its owner.
//
//   2. SINGLE USER (identityGate below). A plain Google identity token — no
//      business scope, nothing to establish. It is honoured ONLY when the
//      email already holds an active role on a business someone established
//      through door 1. No business, no membership, no sign-in. The role and
//      its permission scope then travel in the session JWT, so every
//      downstream check reads the same claim.
//
// Why the code flow rather than the ID-token/One Tap flow the funnel used
// before: an ID token proves who someone is and nothing more. It cannot carry
// the business.manage scope, so it can never tell us WHICH business they run —
// which is the entire point of the beta intake. It is also the flow that was
// silently failing in the browser (Chrome suppresses One Tap under FedCM with
// no callback and no error), so the redirect flow fixes the dead button and
// unlocks the business data in the same move.
//
// Tokens: the refresh token stays in this worker's AUTH_TOKENS KV. The CRM
// gets scope metadata and an opaque token_ref only — see the note at the top
// of RAPIDAi's schema/migrations/006_crm_business_intake.sql.
// ============================================================

export interface BusinessAuthEnv {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  // Absolute URL of this worker's /api/atlas/oauth/callback, registered as an
  // Authorized redirect URI in the Google Cloud console. Unlike the old
  // ID-token flow, the code flow REQUIRES one.
  GOOGLE_OAUTH_REDIRECT?: string;
  // Where to send the browser after a successful exchange (the /start funnel).
  ATLAS_APP_URL?: string;
  // The ingestion worker — the only writer of the CRM tables.
  INGEST_URL?: string;
  INGEST_API_TOKEN?: string;
  AUTH_TOKENS: KVNamespace;
}

export const BUSINESS_SCOPES = [
  'openid',
  'email',
  'profile',
  // The business scope. Read/manage the operator's Business Profile:
  // accounts, locations, hours, categories, verification state.
  'https://www.googleapis.com/auth/business.manage',
].join(' ');

const STATE_TTL_SECONDS = 600; // 10 minutes to complete a consent screen

export function businessAuthConfigured(env: BusinessAuthEnv): boolean {
  return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_OAUTH_REDIRECT);
}

/** The single client ID used for the code flow (first entry of the allowlist). */
function primaryClientId(env: BusinessAuthEnv): string {
  return (env.GOOGLE_CLIENT_ID || '').split(',')[0].trim();
}

// ── Step 1: hand the browser a consent URL ──────────────────────────────

export interface StartResult { url: string; state: string }

/**
 * Build the consent URL and stash a one-time state token. `state` is the CSRF
 * defence: it must come back on the callback and is deleted on use, so a
 * replayed or forged callback has nothing to match.
 *
 * access_type=offline + prompt=consent is what yields a refresh token; without
 * it we would hold a one-hour access token and could never re-sync a location
 * or hours change afterwards.
 */
export async function startBusinessAuth(env: BusinessAuthEnv, opts: { returnTo?: string } = {}): Promise<StartResult> {
  const state = crypto.randomUUID().replace(/-/g, '');
  const returnTo = sanitizeReturnTo(opts.returnTo, env);
  await env.AUTH_TOKENS.put(`atlas_oauth_state:${state}`, JSON.stringify({ returnTo, createdAt: Date.now() }), {
    expirationTtl: STATE_TTL_SECONDS,
  });
  const params = new URLSearchParams({
    client_id: primaryClientId(env),
    redirect_uri: env.GOOGLE_OAUTH_REDIRECT || '',
    response_type: 'code',
    scope: BUSINESS_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, state };
}

/**
 * Only ever redirect back to our own funnel. An open redirect on an auth
 * callback hands an attacker a credible way to bounce a freshly-authenticated
 * operator somewhere hostile.
 */
function sanitizeReturnTo(returnTo: string | undefined, env: BusinessAuthEnv): string {
  const base = env.ATLAS_APP_URL || 'https://rapidai.pages.dev';
  if (!returnTo) return `${base}/start`;
  // Relative paths only — never an absolute URL, however plausible its host.
  if (returnTo.startsWith('/') && !returnTo.startsWith('//')) return `${base}${returnTo}`;
  return `${base}/start`;
}

export async function consumeState(env: BusinessAuthEnv, state: string): Promise<{ returnTo: string } | null> {
  if (!state) return null;
  const key = `atlas_oauth_state:${state}`;
  const raw = await env.AUTH_TOKENS.get(key);
  if (!raw) return null;
  await env.AUTH_TOKENS.delete(key); // one-time use
  try {
    const parsed = JSON.parse(raw) as { returnTo?: string };
    return { returnTo: parsed.returnTo || '' };
  } catch { return { returnTo: '' }; }
}

// ── Step 2: exchange the code ───────────────────────────────────────────

export interface TokenSet {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
}

export async function exchangeCode(env: BusinessAuthEnv, code: string): Promise<TokenSet> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: primaryClientId(env),
      client_secret: env.GOOGLE_CLIENT_SECRET || '',
      redirect_uri: env.GOOGLE_OAUTH_REDIRECT || '',
      grant_type: 'authorization_code',
    }),
  });
  const body = await res.json().catch(() => null) as any;
  if (!res.ok) throw new Error(`token exchange failed: ${body?.error_description || body?.error || res.status}`);
  if (!body?.access_token) throw new Error('token exchange returned no access_token');
  return body as TokenSet;
}

export interface GoogleIdentity {
  sub: string; email: string; email_verified: boolean;
  name?: string; given_name?: string; family_name?: string; picture?: string; hd?: string;
}

/**
 * Read the identity out of the id_token. The token came straight from
 * Google's token endpoint over TLS in exchange for our client secret, so the
 * signature adds nothing here — but the audience still gets checked, because
 * a token minted for a different client must never be accepted.
 */
export function decodeIdentity(idToken: string, clientId: string): GoogleIdentity | null {
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  let claims: any;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    claims = JSON.parse(atob(b64 + pad));
  } catch { return null; }
  if (!claims?.sub || !claims?.email) return null;
  if (clientId && claims.aud !== clientId) return null;
  if (claims.exp && Date.now() / 1000 > Number(claims.exp) + 300) return null;
  return {
    sub: String(claims.sub),
    email: String(claims.email).toLowerCase(),
    email_verified: claims.email_verified === true || claims.email_verified === 'true',
    name: claims.name, given_name: claims.given_name, family_name: claims.family_name,
    picture: claims.picture, hd: claims.hd,
  };
}

// ── Step 3: read the Business Profile ───────────────────────────────────

export interface BusinessProfile {
  account?: { name?: string; accountName?: string; type?: string; verificationState?: string };
  locations: Array<Record<string, any>>;
}

/**
 * Pull the operator's business account and its locations. Best-effort by
 * design: a brand-new Google account may have no Business Profile at all, and
 * that must not block the signup — we still create the org from the identity
 * and let the research pass fill the gaps.
 */
export async function fetchBusinessProfile(accessToken: string): Promise<BusinessProfile> {
  const auth = { Authorization: `Bearer ${accessToken}` };
  const out: BusinessProfile = { locations: [] };

  const accRes = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', { headers: auth });
  if (!accRes.ok) return out;
  const accBody = await accRes.json().catch(() => null) as any;
  const account = Array.isArray(accBody?.accounts) ? accBody.accounts[0] : null;
  if (!account?.name) return out;
  out.account = account;

  // readMask is required by the Business Information API; ask for exactly the
  // fields the CRM has columns for.
  const readMask = [
    'name', 'title', 'storeCode', 'phoneNumbers', 'categories', 'storefrontAddress',
    'websiteUri', 'regularHours', 'latlng', 'metadata', 'openInfo', 'profile', 'serviceArea',
  ].join(',');
  const locRes = await fetch(
    `https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations?readMask=${encodeURIComponent(readMask)}&pageSize=100`,
    { headers: auth },
  );
  if (locRes.ok) {
    const locBody = await locRes.json().catch(() => null) as any;
    if (Array.isArray(locBody?.locations)) out.locations = locBody.locations;
  }
  return out;
}

// ── Step 4: shape it for the CRM ────────────────────────────────────────

/** Flatten Google's location shape into the intake payload's location shape. */
function mapLocation(loc: Record<string, any>) {
  const addr = loc.storefrontAddress || {};
  const lines: string[] = Array.isArray(addr.addressLines) ? addr.addressLines : [];
  return {
    google_location_id: loc.name,
    store_code: loc.storeCode,
    display_name: loc.title || loc.storeCode || 'Location',
    address_line1: lines[0],
    address_line2: lines.slice(1).join(', ') || undefined,
    locality: addr.locality,
    region: addr.administrativeArea,
    postal_code: addr.postalCode,
    country: addr.regionCode,
    latitude: loc.latlng?.latitude,
    longitude: loc.latlng?.longitude,
    phone: loc.phoneNumbers?.primaryPhone,
    primary_category: loc.categories?.primaryCategory?.displayName,
    google_verified: loc.metadata?.hasVoiceOfMerchant === true,
    regular_hours: loc.regularHours,
    opened_date: loc.openInfo?.openingDate
      ? [loc.openInfo.openingDate.year, loc.openInfo.openingDate.month, loc.openInfo.openingDate.day]
          .filter(Boolean).join('-')
      : undefined,
  };
}

export function buildIntakePayload(args: {
  identity: GoogleIdentity;
  profile: BusinessProfile;
  tokens: TokenSet;
  tokenRef: string;
  betaCohort?: string;
}): Record<string, unknown> {
  const { identity, profile, tokens, tokenRef } = args;
  const locations = (profile.locations || []).map(mapLocation);
  const primary = locations[0];
  const account = profile.account;

  // Business name, best available: the Business Profile account name, else the
  // first location's title, else the Workspace domain, else the email's domain.
  const displayName =
    account?.accountName || primary?.display_name || identity.hd ||
    identity.email.split('@')[1] || identity.email;

  return {
    google_account_id: account?.name,
    google_account_type: account?.type,
    primary_domain: identity.hd,
    display_name: displayName,
    legal_name: account?.accountName,
    business_email: identity.email,
    phone: primary?.phone,
    website: (profile.locations?.[0]?.websiteUri as string | undefined),
    address_line1: primary?.address_line1,
    address_line2: primary?.address_line2,
    locality: primary?.locality,
    region: primary?.region,
    postal_code: primary?.postal_code,
    country: primary?.country,
    latitude: primary?.latitude,
    longitude: primary?.longitude,
    primary_category: primary?.primary_category,
    additional_categories: profile.locations?.[0]?.categories?.additionalCategories?.map(
      (c: any) => c?.displayName,
    ).filter(Boolean),
    google_verified: locations.some((l) => l.google_verified),
    regular_hours: primary?.regular_hours,
    service_area: profile.locations?.[0]?.serviceArea,
    beta_cohort: args.betaCohort,
    locations,
    person: {
      email: identity.email,
      google_sub: identity.sub,
      full_name: identity.name,
      given_name: identity.given_name,
      family_name: identity.family_name,
      avatar_url: identity.picture,
    },
    grant: {
      granted_scopes: tokens.scope || BUSINESS_SCOPES,
      token_ref: tokenRef,
      has_refresh_token: !!tokens.refresh_token,
      google_sub: identity.sub,
    },
  };
}

// ── Step 5: hand it to the ingestion worker ─────────────────────────────

export interface IntakeResponse {
  org_id: string; created: boolean; person_id: string | null;
  role: string | null; permissions: string[]; locations: number; warnings: string[];
}

export async function postIntake(env: BusinessAuthEnv, payload: Record<string, unknown>): Promise<IntakeResponse> {
  if (!env.INGEST_API_TOKEN) throw new Error('INGEST_API_TOKEN not set — CRM intake unavailable');
  const base = env.INGEST_URL || 'https://rapid2ai-ingestion.sbarteau2022.workers.dev';
  const res = await fetch(`${base}/crm/intake`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.INGEST_API_TOKEN}`,
      'X-Intake-Source': 'elle-worker',
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null) as any;
  if (!res.ok) throw new Error(body?.error || `CRM intake failed (${res.status})`);
  return body as IntakeResponse;
}

/** Stash the credential set in KV and return the opaque ref the CRM stores. */
export async function storeCredentials(env: BusinessAuthEnv, googleSub: string, tokens: TokenSet): Promise<string> {
  const ref = `gcred_${crypto.randomUUID().replace(/-/g, '')}`;
  await env.AUTH_TOKENS.put(`atlas_gcred:${ref}`, JSON.stringify({
    google_sub: googleSub,
    refresh_token: tokens.refresh_token || null,
    scope: tokens.scope || BUSINESS_SCOPES,
    stored_at: Date.now(),
  }));
  // Second key so a later re-auth by the same person overwrites rather than
  // orphaning a credential nothing points at.
  await env.AUTH_TOKENS.put(`atlas_gcred_by_sub:${googleSub}`, ref);
  return ref;
}

// ── The single-user gate ────────────────────────────────────────────────

export interface Membership {
  org_id: string; org_name: string; person_id: string; role: string;
  permissions: string[]; venue_id: string | null; onboarding_status: string;
}

/**
 * Ask the CRM whether this email may sign in at all. This is the rule that
 * makes single-user access secondary to the business: the CRM answers only
 * for an ACTIVE person on an established org, so an operator who has not been
 * granted a role has no way in, however valid their Google account is.
 */
export async function lookupMembership(env: BusinessAuthEnv, email: string): Promise<Membership | null> {
  if (!env.INGEST_API_TOKEN) return null;
  const base = env.INGEST_URL || 'https://rapid2ai-ingestion.sbarteau2022.workers.dev';
  const res = await fetch(`${base}/crm/membership?email=${encodeURIComponent(email.toLowerCase())}`, {
    headers: { Authorization: `Bearer ${env.INGEST_API_TOKEN}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`membership lookup failed (${res.status})`);
  return await res.json() as Membership;
}

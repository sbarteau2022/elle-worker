// ============================================================
// ATLAS CLIENTS — src/atlas-clients.ts
//
// Self-serve onboarding for RAPID/Atlas hospitality clients. The flow the
// consumer surface drives:
//
//   1. Google sign-in (POST /api/atlas/signup — same ID-token verification
//      as /api/elle-oauth, same JWT out) creates or resumes the account.
//   2. The company profile (POST /api/atlas/profile) takes JUST ENOUGH to
//      stand the account up — company name, and optionally venue name, POS
//      provider, vendors, phone, address. Everything else is aggregated
//      later from the doc scrape of the client's business backlog; the
//      profile is deliberately not a form wall.
//   3. Creating the profile AUTO-EXECUTES the onboarding workflow: it mints
//      the client's venue_id (the tenant key every rapid_* query scopes by),
//      files an ACTIVE conductor intent to verify feeds / aggregate the
//      backlog / produce the first-look report, and logs a live event so
//      the workbench feed shows the signup the moment it happens.
//
// Tenancy: /api/atlas resolves the venue PER REQUEST — a signed-in client
// with a row here reaches THEIR venue (resolveVenueForUser), and the global
// VENUE_ID var remains only as the legacy/demo fallback for anonymous
// callers. The rapid_* tools stay single-venue-per-call by construction;
// what changed is where that venue comes from.
// ============================================================

import { ensureAllSchemas } from './db/schema';
import { intentTool } from './conductor';
import type { Env } from './index';

export interface AtlasClient {
  user_id: string;
  venue_id: string;
  company_name: string;
  venue_name: string | null;
  pos_provider: string | null;
  vendors: string | null;
  contact_phone: string | null;
  address: string | null;
  status: string;
  onboarding_intent_id: string | null;
  created_at: number;
  updated_at: number;
}

let schemaReady = false;
async function ensureSchema(env: Env): Promise<void> {
  if (schemaReady) return;
  await ensureAllSchemas(env.DB);
  schemaReady = true;
}

export async function getClientByUser(env: Env, userId: string): Promise<AtlasClient | null> {
  await ensureSchema(env);
  return await env.DB.prepare('SELECT * FROM atlas_clients WHERE user_id = ?')
    .bind(userId).first() as AtlasClient | null;
}

// The per-request tenant lookup /api/atlas runs for signed-in callers.
// Best-effort null: no row simply means "not an Atlas client" and the door
// falls back to the global demo venue — never an error.
export async function resolveVenueForUser(env: Env, userId: string): Promise<string | null> {
  try {
    const c = await getClientByUser(env, userId);
    return c?.venue_id || null;
  } catch { return null; }
}

const str = (v: unknown, max: number): string | null => {
  const s = String(v ?? '').trim().slice(0, max);
  return s || null;
};

export interface ProfileResult { client: AtlasClient; created: boolean; note: string }

export async function createClientProfile(
  env: Env,
  user: { id: string; email: string },
  body: Record<string, unknown>,
): Promise<ProfileResult> {
  await ensureSchema(env);

  // Idempotent: a second POST resumes the existing account rather than
  // minting a second venue for the same user.
  const existing = await getClientByUser(env, user.id);
  if (existing) return { client: existing, created: false, note: 'profile already exists — resuming' };

  const company = str(body.company_name, 200);
  if (!company) throw new Error('company_name required — the one field we cannot scrape');

  const now = Date.now();
  const venueId = crypto.randomUUID();
  const client: AtlasClient = {
    user_id: user.id,
    venue_id: venueId,
    company_name: company,
    venue_name: str(body.venue_name, 200),
    pos_provider: str(body.pos_provider, 100),
    vendors: str(body.vendors, 500),
    contact_phone: str(body.contact_phone, 50),
    address: str(body.address, 300),
    status: 'onboarding',
    onboarding_intent_id: null,
    created_at: now,
    updated_at: now,
  };

  // Auto-execute the onboarding workflow: file it ACTIVE so the conductor
  // picks it up on its next tick, no human dispatch step in between.
  const goal =
    `New Atlas hospitality client just signed up: "${company}"` +
    (client.venue_name ? ` (venue "${client.venue_name}")` : '') +
    `, venue_id ${venueId}, contact ${user.email}` +
    (client.pos_provider ? `, POS: ${client.pos_provider}` : '') +
    (client.vendors ? `, vendors: ${client.vendors}` : '') +
    `. Run onboarding: ` +
    `(1) Check rapid2ai-db for rows landing under venue_id ${venueId} ` +
    `(vendor_document_payload, pos_daily_close, pos_item_sale) and report which feeds are live and which are missing. ` +
    `(2) As business-backlog documents for this client land in the corpus (tagged atlas:${venueId}), ` +
    `aggregate what the signup form didn't capture — vendors, menu, cost structure — into a venue brief. ` +
    `(3) Once at least one feed is live, produce a first-look report (costs, variance, menu performance) and file it for review. ` +
    `Done looks like: a feed-status report exists, and either a first-look report is filed or the missing feeds are named for follow-up.`;

  let intentId: string | null = null;
  try {
    const res = await intentTool(env, {
      op: 'create',
      title: `Atlas onboarding — ${company}`,
      goal,
      status: 'active',
      source: 'stewart',
      priority: 7,
    });
    const parsed = JSON.parse(res) as { id?: string };
    intentId = parsed.id || null;
  } catch (e) {
    // The account must stand up even if the conductor queue hiccups; the
    // live event below still records the signup so it can be re-filed.
    console.error('[ATLAS-CLIENT] onboarding intent filing failed:', (e as Error).message);
  }
  client.onboarding_intent_id = intentId;

  await env.DB.prepare(
    `INSERT INTO atlas_clients
       (user_id, venue_id, company_name, venue_name, pos_provider, vendors,
        contact_phone, address, status, onboarding_intent_id, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    client.user_id, client.venue_id, client.company_name, client.venue_name,
    client.pos_provider, client.vendors, client.contact_phone, client.address,
    client.status, client.onboarding_intent_id, client.created_at, client.updated_at,
  ).run();

  await env.DB.prepare(
    `INSERT INTO elle_live_events (id, event_type, source, title, body, severity)
     VALUES (?, 'atlas_client', 'signup', ?, ?, 'info')`
  ).bind(
    crypto.randomUUID().replace(/-/g, '').slice(0, 32),
    `Atlas client signed up: ${company}`,
    JSON.stringify({ venue_id: venueId, email: user.email, intent_id: intentId }),
  ).run().catch(() => {});

  return {
    client,
    created: true,
    note: intentId
      ? 'account created — onboarding workflow filed and active'
      : 'account created — onboarding intent failed to file, needs manual re-file',
  };
}

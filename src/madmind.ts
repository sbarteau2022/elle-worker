// ============================================================
// MADMIND — submissions layer (Cloudflare-only)
//
// "Sitting with a MadMind" used to file manuscripts into a Supabase
// `submissions` table. This moves that onto the worker's own D1 so the whole
// site runs on Cloudflare behind the worker's JWT auth — the same identity that
// owns the Optimus journal. Append-only by construction: there is no update or
// delete path, mirroring the old RLS (INSERT + SELECT only).
//
// Auth is enforced upstream in index.ts (getUser → 401); this module trusts the
// resolved { userId, email }.
// ============================================================

import type { Env } from './index';

function id(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 24);
}

let schemaReady = false;
async function ensureSchema(env: Env): Promise<void> {
  if (schemaReady) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS madmind_submissions (
      id TEXT PRIMARY KEY, author_id TEXT, author_email TEXT, byline TEXT,
      title TEXT, abstract TEXT, body TEXT, keywords TEXT,
      status TEXT DEFAULT 'submitted', created_at INTEGER)`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS madmind_sub_created ON madmind_submissions (created_at DESC)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS madmind_sub_author ON madmind_submissions (author_id)'),
  ]);
  schemaReady = true;
}

// Same bounds the old client-side zod schema enforced — re-checked server-side
// because the gate is the server now, not the browser.
function validate(args: { title?: string; abstract?: string; body?: string }): string | null {
  const title = String(args.title || '').trim();
  const abstract = String(args.abstract || '').trim();
  const body = String(args.body || '').trim();
  if (title.length < 3 || title.length > 255) return 'Title must be 3–255 characters';
  if (abstract.length < 20 || abstract.length > 2000) return 'Abstract must be 20–2,000 characters';
  if (body.length < 100 || body.length > 80000) return 'Manuscript must be 100–80,000 characters';
  return null;
}

export async function handleMadmind(
  body: Record<string, unknown>, env: Env, userId: string, email: string,
): Promise<Response> {
  await ensureSchema(env);
  const op = String(body?.op || '').trim();
  const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), {
    status: s,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
    },
  });

  switch (op) {
    case 'submit': {
      const reason = validate(body as { title?: string; abstract?: string; body?: string });
      if (reason) return json({ error: reason }, 400);
      const sid = id();
      const now = Date.now();
      await env.DB.prepare(
        `INSERT INTO madmind_submissions (id, author_id, author_email, byline, title, abstract, body, keywords, status, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        sid, userId, email,
        String((body as { byline?: string }).byline || '').slice(0, 200),
        String((body as { title?: string }).title || '').trim(),
        String((body as { abstract?: string }).abstract || '').trim(),
        String((body as { body?: string }).body || '').trim(),
        String((body as { keywords?: string }).keywords || '').slice(0, 255),
        'submitted', now,
      ).run();
      return json({ id: sid, created_at: now });
    }
    // The reading room is communal: every authenticated reader sees the archive
    // (the old SELECT policy was "viewable by authenticated users").
    case 'archive': {
      const rows = await env.DB.prepare(
        `SELECT id, author_email, byline, title, abstract, body, keywords, status, created_at
           FROM madmind_submissions ORDER BY created_at DESC LIMIT 200`
      ).all();
      return json({ submissions: rows.results });
    }
    case 'mine': {
      const rows = await env.DB.prepare(
        `SELECT id, byline, title, abstract, body, keywords, status, created_at
           FROM madmind_submissions WHERE author_id = ? ORDER BY created_at DESC LIMIT 200`
      ).bind(userId).all();
      return json({ submissions: rows.results });
    }
    default:
      return json({ error: 'op required: submit|archive|mine' }, 400);
  }
}

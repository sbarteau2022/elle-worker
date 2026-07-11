// ============================================================
// USER PROFILES — src/profiles.ts
//
// So Elle can already KNOW the person she's talking to. A profile is a short
// dossier — who they are, their work, their family, what they want — that the
// router injects into the system prompt for that user's runs. When the person
// says hello, she isn't meeting them; she's continuing a relationship.
//
// One row per user (user_profiles), keyed by user id and email. The profile
// text is free-form prose (a "profile report"), so it reads naturally when
// folded into the prompt. Loading is best-effort: no profile = she's simply
// meeting someone new, never an error.
// ============================================================

import { ensureAllSchemas } from './db/schema';
import type { Env } from './index';

export interface UserProfile {
  user_id: string;
  email: string;
  display_name: string;
  profile: string;         // free-form dossier prose
  updated_at?: number;
}

let schemaReady = false;
export async function ensureProfileSchema(env: Env): Promise<void> {
  if (schemaReady) return;
  await ensureAllSchemas(env.DB);
  schemaReady = true;
}

export async function upsertProfile(env: Env, p: { user_id: string; email?: string; display_name?: string; profile: string }): Promise<void> {
  await ensureProfileSchema(env);
  await env.DB.prepare(
    `INSERT INTO user_profiles (user_id, email, display_name, profile, updated_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET
       email=excluded.email, display_name=excluded.display_name,
       profile=excluded.profile, updated_at=excluded.updated_at`
  ).bind(
    p.user_id,
    (p.email || '').toLowerCase() || null,
    p.display_name || null,
    String(p.profile || '').slice(0, 8000),
    Date.now(),
  ).run();
}

export async function getProfileByUser(env: Env, userId: string): Promise<UserProfile | null> {
  if (!userId) return null;
  try {
    await ensureProfileSchema(env);
    const r = await env.DB.prepare(
      `SELECT user_id, email, display_name, profile, updated_at FROM user_profiles WHERE user_id = ?`
    ).bind(userId).first();
    return (r as unknown as UserProfile) || null;
  } catch { return null; }
}

export async function getProfileByEmail(env: Env, email: string): Promise<UserProfile | null> {
  if (!email) return null;
  try {
    await ensureProfileSchema(env);
    const r = await env.DB.prepare(
      `SELECT user_id, email, display_name, profile, updated_at FROM user_profiles WHERE email = ?`
    ).bind(email.toLowerCase()).first();
    return (r as unknown as UserProfile) || null;
  } catch { return null; }
}

// The prompt block. Pure and unit-tested: returns '' for no/empty profile, else
// a compact "who you're talking to" section she can lean on silently. She must
// USE it to build rapport, not recite it — the guidance says so explicitly.
export function profileBlock(p: UserProfile | null): string {
  if (!p) return '';
  const name = (p.display_name || '').trim();
  const dossier = (p.profile || '').trim();
  if (!name && !dossier) return '';
  const head = name ? `You are speaking with ${name}.` : `You are speaking with a known member of the team.`;
  return `\n\nWHO YOU ARE TALKING TO (use this silently to be warm and specific — reference it to build rapport, never recite it as a block, never say "your profile says"):\n${head}\n${dossier}`;
}

// ============================================================
// FLOCK — the social-media intelligence subsystem (src/flock.ts)
//
// One brain for running many brands' social presence: generate the imagery,
// write the copy on-voice, keep every draft honest to the brand, and fan a
// single post out across a "flock" of channels. It slots into the worker the
// same way every other engine does (handleFlock(body, env, userId) routed in
// index.ts, member-gated), reuses the shared LLM layer (callLLM/jsonLLM) and
// the shared image seam (flock-providers.ts) so a future sovereign model is a
// config swap, and writes the same premises/framework/alternatives reasoning
// log the Falcon and Grant engines keep.
//
// The pieces, in the order a post moves through them:
//   BRAND KIT   — the single source of continuity: mission, voice, palette,
//                 fonts, audience, taboos, visual style. Everything downstream
//                 conditions on it.
//   IDEATE      — brief + brand → post concepts (jsonLLM, on-brand).
//   IMAGE       — brand-conditioned txt2img / img2img via the provider chain
//                 (Workers AI today, sovereign endpoint by config). This is the
//                 pillar built hard.
//   VIDEO       — same call shape, stub adapter until a provider is wired.
//   CAPTION     — concept + brand + platform → caption + hashtags + CTA.
//   CONTINUITY  — the Brand Guardian: scores a draft against the kit (voice /
//                 palette / values / audience), returns fixes. This is the
//                 "brand continuity" guarantee — nothing publishes unreviewed.
//   FLOCK       — one post, many channels; publish fans out per-channel and
//                 aggregates the results (dry-run stub until OAuth is added).
// ============================================================

import { z } from 'zod';
import { ensureAllSchemas } from './db/schema';
import { jsonLLM, type LLMEnv } from './llm';
import {
  generateImage, generateVideo, videoConfigured, publishToChannelLive, hasLiveAdapter,
  KNOWN_PLATFORMS, LIVE_ADAPTERS, type FlockProviderEnv,
} from './flock-providers';
import type { BlueskyMedia } from './flock-bluesky';

export interface FlockEnv extends LLMEnv, FlockProviderEnv {
  DB: D1Database;
  DOCUMENTS: R2Bucket;
}

const hexId = () => crypto.randomUUID().replace(/-/g, '');
const now = () => Date.now();
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
const err = (msg: string, s = 400) => json({ error: msg }, s);

// ── Brand kit ────────────────────────────────────────────────────────────────
interface BrandRow {
  id: string; user_id: string; name: string; mission: string | null;
  voice: string | null; palette: string | null; fonts: string | null;
  taboos: string | null; audience: string | null; keywords: string | null;
  visual_style: string | null; created_at: number; updated_at: number;
}

// Compact, prompt-ready rendering of a brand kit — the shared continuity
// context every generation and every guardian check conditions on. Exported so
// it's unit-testable and so callers can see exactly what the model is told.
export function brandKitText(b: Partial<BrandRow>): string {
  const lines: string[] = [];
  if (b.name) lines.push(`Brand: ${b.name}`);
  if (b.mission) lines.push(`Mission: ${b.mission}`);
  if (b.voice) lines.push(`Voice/tone: ${b.voice}`);
  if (b.audience) lines.push(`Audience: ${b.audience}`);
  const pal = parsePalette(b.palette);
  if (pal.length) lines.push(`Palette: ${pal.map(p => `${p.name || ''} ${p.hex}`.trim()).join(', ')}`);
  if (b.fonts) lines.push(`Typography: ${b.fonts}`);
  if (b.visual_style) lines.push(`Visual style: ${b.visual_style}`);
  const kw = parseList(b.keywords);
  if (kw.length) lines.push(`Keywords: ${kw.join(', ')}`);
  if (b.taboos) lines.push(`Never do / avoid: ${b.taboos}`);
  return lines.join('\n');
}

function parsePalette(raw: string | null | undefined): Array<{ name?: string; hex: string }> {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v.filter((x): x is { name?: string; hex: string } => !!x && typeof x.hex === 'string');
  } catch { /* not JSON — fall through */ }
  return [];
}
function parseList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try { const v = JSON.parse(raw); if (Array.isArray(v)) return v.map(String); } catch { /* csv */ }
  return String(raw).split(',').map(s => s.trim()).filter(Boolean);
}

// Brand-conditioned image prompt. PURE and exported — the palette, style and
// taboos are folded in deterministically so the same brand always draws in the
// same visual language, and the taboos become the negative prompt.
export function buildImagePrompt(
  brand: Partial<BrandRow>,
  userPrompt: string,
): { prompt: string; negativePrompt: string } {
  const parts = [userPrompt.trim()];
  if (brand.visual_style) parts.push(brand.visual_style);
  const pal = parsePalette(brand.palette);
  if (pal.length) parts.push(`color palette: ${pal.map(p => p.hex).join(', ')}`);
  if (brand.voice) parts.push(`mood consistent with a ${brand.voice} brand voice`);
  parts.push('high quality, professional, cohesive brand aesthetic');
  const negative = [
    'text, watermark, logo, signature, low quality, distorted, extra limbs',
    brand.taboos ? String(brand.taboos) : '',
  ].filter(Boolean).join(', ');
  return { prompt: parts.filter(Boolean).join('. '), negativePrompt: negative };
}

async function getBrand(env: FlockEnv, userId: string, brandId: string): Promise<BrandRow | null> {
  return env.DB.prepare('SELECT * FROM flock_brands WHERE id = ?1 AND user_id = ?2')
    .bind(brandId, userId).first() as Promise<BrandRow | null>;
}

// ── Reasoning log — same discipline as the Falcon/Grant engines ───────────────
async function logReasoning(
  env: FlockEnv, userId: string,
  rec: { brand_id?: string; post_id?: string; kind: string; premises?: unknown; framework?: string; alternatives?: unknown; would_change?: string },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO flock_reasoning_log (id, user_id, brand_id, post_id, kind, premises, framework, alternatives, would_change, created_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`
  ).bind(
    hexId(), userId, rec.brand_id ?? null, rec.post_id ?? null, rec.kind,
    JSON.stringify(rec.premises ?? null), rec.framework ?? null,
    JSON.stringify(rec.alternatives ?? null), rec.would_change ?? null, now(),
  ).run().catch(() => {});
}

// ── LLM output schemas ────────────────────────────────────────────────────────
const ConceptsSchema = z.object({
  concepts: z.array(z.object({
    hook: z.string(),
    angle: z.string(),
    format: z.string(),        // e.g. "carousel", "single image", "short-form video"
    image_prompt: z.string(),  // a first-draft visual direction the image lane can run
    rationale: z.string(),
  })).min(1),
});

const CaptionSchema = z.object({
  caption: z.string(),
  hashtags: z.array(z.string()).default([]),
  cta: z.string().optional().default(''),
});

const ContinuitySchema = z.object({
  score: z.number(),                 // 0..100 overall on-brand
  dimensions: z.object({
    voice: z.number(), palette: z.number(), values: z.number(), audience: z.number(),
  }),
  issues: z.array(z.string()).default([]),
  fixes: z.array(z.string()).default([]),
  verdict: z.enum(['on-brand', 'needs-work', 'off-brand']),
});

// Clamp a guardian result into a safe, displayable shape regardless of what the
// model returned. PURE and exported for tests — the guardian is the gate, so
// its output must never be able to crash the caller or read as "pass" by
// accident.
export function normalizeContinuity(raw: z.infer<typeof ContinuitySchema>): z.infer<typeof ContinuitySchema> {
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(Number.isFinite(n) ? n : 0)));
  const score = clamp(raw.score);
  const verdict = raw.verdict ?? (score >= 80 ? 'on-brand' : score >= 55 ? 'needs-work' : 'off-brand');
  return {
    score,
    dimensions: {
      voice: clamp(raw.dimensions?.voice), palette: clamp(raw.dimensions?.palette),
      values: clamp(raw.dimensions?.values), audience: clamp(raw.dimensions?.audience),
    },
    issues: (raw.issues ?? []).slice(0, 12),
    fixes: (raw.fixes ?? []).slice(0, 12),
    verdict,
  };
}

// ── Entry point ────────────────────────────────────────────────────────────────
export async function handleFlock(body: unknown, env: FlockEnv, userId: string): Promise<Response> {
  await ensureAllSchemas(env.DB).catch(() => {});
  const b = (body ?? {}) as Record<string, unknown>;
  const action = String(b.action || '').trim();
  const S = (k: string) => String(b[k] ?? '').trim();

  try {
    switch (action) {
      // ── Brands ──────────────────────────────────────────────────────────────
      case 'brand.create': {
        const name = S('name');
        if (!name) return err('name required');
        const id = hexId(); const t = now();
        await env.DB.prepare(
          `INSERT INTO flock_brands (id, user_id, name, mission, voice, palette, fonts, taboos, audience, keywords, visual_style, created_at, updated_at)
           VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?12)`
        ).bind(
          id, userId, name, S('mission') || null, S('voice') || null,
          b.palette ? JSON.stringify(b.palette) : null, S('fonts') || null,
          S('taboos') || null, S('audience') || null,
          b.keywords ? JSON.stringify(b.keywords) : null, S('visual_style') || null, t,
        ).run();
        return json({ brand: await getBrand(env, userId, id) });
      }
      case 'brand.update': {
        const id = S('brand_id');
        const existing = id && await getBrand(env, userId, id);
        if (!existing) return err('brand not found', 404);
        const set: string[] = []; const vals: unknown[] = [];
        const field = (col: string, val: unknown) => { set.push(`${col} = ?${set.length + 1}`); vals.push(val); };
        if ('name' in b) field('name', S('name'));
        if ('mission' in b) field('mission', S('mission') || null);
        if ('voice' in b) field('voice', S('voice') || null);
        if ('palette' in b) field('palette', b.palette ? JSON.stringify(b.palette) : null);
        if ('fonts' in b) field('fonts', S('fonts') || null);
        if ('taboos' in b) field('taboos', S('taboos') || null);
        if ('audience' in b) field('audience', S('audience') || null);
        if ('keywords' in b) field('keywords', b.keywords ? JSON.stringify(b.keywords) : null);
        if ('visual_style' in b) field('visual_style', S('visual_style') || null);
        field('updated_at', now());
        vals.push(id, userId);
        await env.DB.prepare(
          `UPDATE flock_brands SET ${set.join(', ')} WHERE id = ?${vals.length - 1} AND user_id = ?${vals.length}`
        ).bind(...vals).run();
        return json({ brand: await getBrand(env, userId, id) });
      }
      case 'brand.list': {
        const rows = await env.DB.prepare(
          'SELECT * FROM flock_brands WHERE user_id = ?1 ORDER BY updated_at DESC'
        ).bind(userId).all();
        return json({ brands: rows.results ?? [] });
      }
      case 'brand.get': {
        const brand = await getBrand(env, userId, S('brand_id'));
        if (!brand) return err('brand not found', 404);
        return json({ brand });
      }

      // ── Channels (the flock roster) ──────────────────────────────────────────
      case 'channel.add': {
        const brandId = S('brand_id');
        if (!(await getBrand(env, userId, brandId))) return err('brand not found', 404);
        const platform = S('platform').toLowerCase();
        if (!KNOWN_PLATFORMS.includes(platform as never)) return err(`platform must be one of: ${KNOWN_PLATFORMS.join(', ')}`);
        const id = hexId();
        await env.DB.prepare(
          `INSERT INTO flock_channels (id, user_id, brand_id, platform, handle, status, config, created_at)
           VALUES (?1,?2,?3,?4,?5,?6,?7,?8)`
        ).bind(
          id, userId, brandId, platform, S('handle') || null,
          b.config && Object.keys(b.config as object).length ? 'connected' : 'stub',
          b.config ? JSON.stringify(b.config) : null, now(),
        ).run();
        return json({ channel_id: id });
      }
      case 'channel.list': {
        const rows = await env.DB.prepare(
          'SELECT id, brand_id, platform, handle, status, created_at FROM flock_channels WHERE user_id = ?1' +
          (S('brand_id') ? ' AND brand_id = ?2' : '') + ' ORDER BY created_at DESC'
        ).bind(...(S('brand_id') ? [userId, S('brand_id')] : [userId])).all();
        return json({ channels: rows.results ?? [] });
      }
      case 'channel.remove': {
        await env.DB.prepare('DELETE FROM flock_channels WHERE id = ?1 AND user_id = ?2')
          .bind(S('channel_id'), userId).run();
        return json({ ok: true });
      }

      // ── Ideate ────────────────────────────────────────────────────────────────
      case 'content.ideate': {
        const brand = await getBrand(env, userId, S('brand_id'));
        if (!brand) return err('brand not found', 404);
        const brief = S('brief');
        if (!brief) return err('brief required');
        const count = Math.max(1, Math.min(6, Number(b.count) || 3));
        const { data } = await jsonLLM(env, [
          `You are the creative strategist for this brand. Stay strictly on-brand.`,
          brandKitText(brand),
          `\nCampaign brief: ${brief}`,
          `\nPropose ${count} distinct social post concepts. For each, give a scroll-stopping hook, the angle, the best format, a concrete image_prompt (a visual direction, no text-in-image), and a one-line rationale tying it to the brand.`,
        ].join('\n'), ConceptsSchema, { task: 'reasoning', maxTokens: 1600, temperature: 0.8 });
        await logReasoning(env, userId, {
          brand_id: brand.id, kind: 'ideate',
          premises: { brief, count }, framework: 'brand-kit-conditioned concept generation',
          alternatives: `${data.concepts.length} concepts offered; operator selects`,
          would_change: 'a sharper brief or added campaign constraints would re-shape the angles',
        });
        return json({ concepts: data.concepts });
      }

      // ── Caption ──────────────────────────────────────────────────────────────
      case 'content.caption': {
        const brand = await getBrand(env, userId, S('brand_id'));
        if (!brand) return err('brand not found', 404);
        const concept = S('concept');
        if (!concept) return err('concept required');
        const platform = S('platform') || 'instagram';
        const { data } = await jsonLLM(env, [
          `Write the caption for this social post, in the brand's exact voice, for ${platform}.`,
          brandKitText(brand),
          `\nPost concept: ${concept}`,
          `\nReturn a platform-appropriate caption, a list of hashtags (no leading #), and a short CTA. Respect the brand's taboos.`,
        ].join('\n'), CaptionSchema, { task: 'conversation', maxTokens: 900, temperature: 0.75 });
        await logReasoning(env, userId, {
          brand_id: brand.id, kind: 'caption',
          premises: { concept, platform }, framework: 'brand-voice caption generation',
          would_change: 'a different platform changes length/format conventions',
        });
        return json({ ...data });
      }

      // ── Brand-continuity guardian ────────────────────────────────────────────
      case 'content.continuity': {
        const brand = await getBrand(env, userId, S('brand_id'));
        if (!brand) return err('brand not found', 404);
        const draft = (b.draft ?? {}) as { caption?: string; hashtags?: string[]; image_prompt?: string };
        if (!draft.caption && !draft.image_prompt) return err('draft.caption or draft.image_prompt required');
        const { data } = await jsonLLM(env, [
          `You are the Brand Guardian. Score how faithfully this draft holds the brand's continuity. Be strict and specific — vague praise is useless.`,
          brandKitText(brand),
          `\nDraft caption: ${draft.caption || '(none)'}`,
          `Draft hashtags: ${(draft.hashtags || []).join(', ') || '(none)'}`,
          `Draft image direction: ${draft.image_prompt || '(none)'}`,
          `\nScore 0-100 overall and per dimension (voice, palette, values, audience). List concrete issues and concrete fixes. verdict is on-brand (>=80), needs-work (55-79), or off-brand (<55).`,
        ].join('\n'), ContinuitySchema, { task: 'reasoning', maxTokens: 1100, temperature: 0.3 });
        const report = normalizeContinuity(data);
        await logReasoning(env, userId, {
          brand_id: brand.id, kind: 'continuity',
          premises: draft, framework: 'brand-continuity scoring across voice/palette/values/audience',
          alternatives: `verdict=${report.verdict}`,
          would_change: report.fixes.join(' | '),
        });
        return json({ continuity: report });
      }

      // ── Image (the pillar built hard) ────────────────────────────────────────
      case 'image.generate': {
        const brand = await getBrand(env, userId, S('brand_id'));
        if (!brand) return err('brand not found', 404);
        const userPrompt = S('prompt');
        if (!userPrompt) return err('prompt required');
        const { prompt, negativePrompt } = buildImagePrompt(brand, userPrompt);
        const width = Number(b.width) || 1024;
        const height = Number(b.height) || 1024;
        let result;
        try {
          result = await generateImage(env, { prompt, negativePrompt, width, height });
        } catch (e) {
          return err(`image generation failed: ${(e as Error).message}`, 502);
        }
        const id = hexId();
        const key = `flock/assets/${id}.png`;
        await env.DOCUMENTS.put(key, result.bytes, { httpMetadata: { contentType: result.mime } });
        await env.DB.prepare(
          `INSERT INTO flock_assets (id, user_id, brand_id, kind, prompt, resolved_prompt, provider, model, r2_key, mime, width, height, parent_id, status, created_at)
           VALUES (?1,?2,?3,'image',?4,?5,?6,?7,?8,?9,?10,?11,NULL,'ready',?12)`
        ).bind(id, userId, brand.id, userPrompt, prompt, result.provider, result.model, key, result.mime, width, height, now()).run();
        return json({ asset: { id, kind: 'image', provider: result.provider, model: result.model, url: `/flock/asset/${id}.png`, width, height } });
      }

      case 'image.edit': {
        const parentId = S('asset_id');
        const parent = parentId && await env.DB.prepare(
          'SELECT * FROM flock_assets WHERE id = ?1 AND user_id = ?2'
        ).bind(parentId, userId).first() as { id: string; brand_id: string; r2_key: string; prompt: string } | null;
        if (!parent) return err('source asset not found', 404);
        const instruction = S('instruction') || S('prompt');
        if (!instruction) return err('instruction required');
        const src = await env.DOCUMENTS.get(parent.r2_key);
        if (!src) return err('source image bytes missing', 404);
        const brand = await getBrand(env, userId, parent.brand_id);
        const { prompt, negativePrompt } = buildImagePrompt(brand ?? {}, `${parent.prompt}. Edit: ${instruction}`);
        const initImage = new Uint8Array(await src.arrayBuffer());
        const strength = typeof b.strength === 'number' ? b.strength : 0.55;
        let result;
        try {
          result = await generateImage(env, { prompt, negativePrompt, initImage, strength });
        } catch (e) {
          return err(`AI edit failed: ${(e as Error).message}`, 502);
        }
        const id = hexId();
        const key = `flock/assets/${id}.png`;
        await env.DOCUMENTS.put(key, result.bytes, { httpMetadata: { contentType: result.mime } });
        await env.DB.prepare(
          `INSERT INTO flock_assets (id, user_id, brand_id, kind, prompt, resolved_prompt, provider, model, r2_key, mime, width, height, parent_id, status, created_at)
           VALUES (?1,?2,?3,'image',?4,?5,?6,?7,?8,?9,NULL,NULL,?10,'ready',?11)`
        ).bind(id, userId, parent.brand_id, `Edit: ${instruction}`, prompt, result.provider, result.model, key, result.mime, parent.id, now()).run();
        return json({ asset: { id, kind: 'image', provider: result.provider, model: result.model, url: `/flock/asset/${id}.png`, parent_id: parent.id } });
      }

      // ── Video (stub adapter) ─────────────────────────────────────────────────
      case 'video.generate': {
        const brand = await getBrand(env, userId, S('brand_id'));
        if (!brand) return err('brand not found', 404);
        const userPrompt = S('prompt');
        if (!userPrompt) return err('prompt required');
        const { prompt } = buildImagePrompt(brand, userPrompt);
        const req = { prompt, durationSec: Number(b.duration) || 5, aspect: S('aspect') || '9:16' };
        const result = await generateVideo(env, req);
        const id = hexId();
        if (!result.ok) {
          await env.DB.prepare(
            `INSERT INTO flock_assets (id, user_id, brand_id, kind, prompt, resolved_prompt, provider, model, r2_key, mime, width, height, parent_id, status, created_at)
             VALUES (?1,?2,?3,'video',?4,?5,'stub',NULL,NULL,NULL,NULL,NULL,NULL,'unconfigured',?6)`
          ).bind(id, userId, brand.id, userPrompt, prompt, now()).run();
          return json({ asset: { id, kind: 'video', status: 'unconfigured', spec: req }, note: result.note });
        }
        const key = `flock/assets/${id}.mp4`;
        await env.DOCUMENTS.put(key, result.bytes, { httpMetadata: { contentType: result.mime } });
        await env.DB.prepare(
          `INSERT INTO flock_assets (id, user_id, brand_id, kind, prompt, resolved_prompt, provider, model, r2_key, mime, width, height, parent_id, status, created_at)
           VALUES (?1,?2,?3,'video',?4,?5,?6,?7,?8,?9,NULL,NULL,NULL,'ready',?10)`
        ).bind(id, userId, brand.id, userPrompt, prompt, result.provider, result.model, key, result.mime, now()).run();
        return json({ asset: { id, kind: 'video', provider: result.provider, model: result.model, url: `/flock/asset/${id}.mp4`, status: 'ready' } });
      }

      case 'asset.list': {
        const rows = await env.DB.prepare(
          `SELECT id, brand_id, kind, prompt, provider, model, mime, width, height, parent_id, status, created_at
           FROM flock_assets WHERE user_id = ?1` + (S('brand_id') ? ' AND brand_id = ?2' : '') +
          ` ORDER BY created_at DESC LIMIT 100`
        ).bind(...(S('brand_id') ? [userId, S('brand_id')] : [userId])).all();
        const assets = (rows.results as Array<{ id: string; kind: string; mime: string; status: string }>).map(r => ({
          ...r, url: r.status === 'ready' ? `/flock/asset/${r.id}.${r.mime?.includes('mp4') ? 'mp4' : 'png'}` : null,
        }));
        return json({ assets });
      }

      // ── Posts + the flock fan-out ────────────────────────────────────────────
      case 'post.create': {
        const brand = await getBrand(env, userId, S('brand_id'));
        if (!brand) return err('brand not found', 404);
        const id = hexId();
        await env.DB.prepare(
          `INSERT INTO flock_posts (id, user_id, brand_id, title, caption, hashtags, asset_ids, channel_ids, status, scheduled_at, continuity_score, continuity_report, created_at, updated_at)
           VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'draft',?9,NULL,NULL,?10,?10)`
        ).bind(
          id, userId, brand.id, S('title') || null, S('caption') || null,
          JSON.stringify(b.hashtags ?? []), JSON.stringify(b.asset_ids ?? []),
          JSON.stringify(b.channel_ids ?? []), Number(b.scheduled_at) || null, now(),
        ).run();
        return json({ post_id: id });
      }
      case 'post.list': {
        const rows = await env.DB.prepare(
          `SELECT id, brand_id, title, caption, status, continuity_score, scheduled_at, created_at
           FROM flock_posts WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 100`
        ).bind(userId).all();
        return json({ posts: rows.results ?? [] });
      }
      case 'post.get': {
        const post = await env.DB.prepare('SELECT * FROM flock_posts WHERE id = ?1 AND user_id = ?2')
          .bind(S('post_id'), userId).first();
        if (!post) return err('post not found', 404);
        return json({ post });
      }
      case 'post.review': {
        const post = await env.DB.prepare('SELECT * FROM flock_posts WHERE id = ?1 AND user_id = ?2')
          .bind(S('post_id'), userId).first() as { id: string; brand_id: string; caption: string; hashtags: string } | null;
        if (!post) return err('post not found', 404);
        const brand = await getBrand(env, userId, post.brand_id);
        if (!brand) return err('brand not found', 404);
        const { data } = await jsonLLM(env, [
          `You are the Brand Guardian. Score how faithfully this post holds the brand's continuity before it goes out. Be strict and specific.`,
          brandKitText(brand),
          `\nCaption: ${post.caption || '(none)'}`,
          `Hashtags: ${(parseList(post.hashtags)).join(', ') || '(none)'}`,
          `\nScore 0-100 overall and per dimension (voice, palette, values, audience). List concrete issues and fixes. verdict is on-brand (>=80), needs-work (55-79), or off-brand (<55).`,
        ].join('\n'), ContinuitySchema, { task: 'reasoning', maxTokens: 1100, temperature: 0.3 });
        const report = normalizeContinuity(data);
        await env.DB.prepare(
          `UPDATE flock_posts SET status = 'reviewed', continuity_score = ?1, continuity_report = ?2, updated_at = ?3 WHERE id = ?4 AND user_id = ?5`
        ).bind(report.score, JSON.stringify(report), now(), post.id, userId).run();
        await logReasoning(env, userId, { brand_id: brand.id, post_id: post.id, kind: 'continuity', premises: { caption: post.caption }, framework: 'pre-publish brand-continuity gate', alternatives: `verdict=${report.verdict}`, would_change: report.fixes.join(' | ') });
        return json({ continuity: report });
      }
      case 'post.publish': {
        const post = await env.DB.prepare('SELECT * FROM flock_posts WHERE id = ?1 AND user_id = ?2')
          .bind(S('post_id'), userId).first() as
          { id: string; brand_id: string; caption: string; hashtags: string; asset_ids: string; channel_ids: string; continuity_score: number | null } | null;
        if (!post) return err('post not found', 404);
        // Continuity gate: refuse to fan out an unreviewed or off-brand post
        // unless the caller explicitly overrides. The whole point of the
        // subsystem is that nothing goes out off-brand by accident.
        const force = b.force === true;
        if (!force && (post.continuity_score == null || post.continuity_score < 55)) {
          return err(`post is ${post.continuity_score == null ? 'not reviewed' : 'off-brand'} — run post.review first, or pass force:true to override`, 409);
        }
        const channelIds = parseList(post.channel_ids);
        if (!channelIds.length) return err('post has no channels — set channel_ids and try again');
        const assetIds = parseList(post.asset_ids);
        const assetKeys = assetIds.map(a => `flock/assets/${a}`);
        const hashtags = parseList(post.hashtags);

        // Media for a live adapter: resolve the post's image assets to their real
        // R2 objects (bytes + mime), up to 4. Loaded once and shared across
        // channels; only fetched when at least one channel has a live adapter, so
        // dry-run-only fan-outs pay nothing. Best-effort — a missing/failed asset
        // is skipped, never fatal.
        let media: BlueskyMedia[] | undefined;
        const loadMedia = async (): Promise<BlueskyMedia[]> => {
          if (media) return media;
          const out: BlueskyMedia[] = [];
          if (assetIds.length) {
            const ph = assetIds.map((_, i) => `?${i + 2}`).join(',');
            const rows = await env.DB.prepare(
              `SELECT id, r2_key, mime, kind FROM flock_assets WHERE user_id = ?1 AND id IN (${ph})`
            ).bind(userId, ...assetIds).all().catch(() => ({ results: [] as unknown[] }));
            for (const row of (rows.results as Array<{ r2_key: string; mime: string; kind: string }>)) {
              if (out.length >= 4) break;
              if (row.kind !== 'image') continue; // Bluesky embed lane is images
              try {
                const obj = await env.DOCUMENTS.get(row.r2_key);
                if (!obj) continue;
                out.push({ bytes: new Uint8Array(await obj.arrayBuffer()), mime: row.mime || 'image/png', alt: post.caption || '' });
              } catch { /* skip */ }
            }
          }
          media = out;
          return out;
        };

        const results = [];
        for (const cid of channelIds) {
          const ch = await env.DB.prepare('SELECT platform, handle, config FROM flock_channels WHERE id = ?1 AND user_id = ?2')
            .bind(cid, userId).first() as { platform: string; handle: string | null; config: string | null } | null;
          if (!ch) { results.push({ channel_id: cid, platform: '?', ok: false, dryRun: false, detail: 'channel not found' }); continue; }
          const creds = ch.config ? JSON.parse(ch.config) : null;
          const live = hasLiveAdapter(ch.platform) && !!(creds && Object.keys(creds).length);
          const r = await publishToChannelLive({
            platform: ch.platform, handle: ch.handle ?? undefined,
            caption: post.caption || '', hashtags, assetKeys, credentials: creds,
          }, live ? { media: await loadMedia() } : undefined);
          results.push({ channel_id: cid, ...r });
        }
        const allOk = results.every(r => r.ok);
        const anyDry = results.some(r => (r as { dryRun?: boolean }).dryRun);
        await env.DB.prepare(
          `UPDATE flock_posts SET status = ?1, updated_at = ?2 WHERE id = ?3 AND user_id = ?4`
        ).bind(allOk ? (anyDry ? 'published-dryrun' : 'published') : 'failed', now(), post.id, userId).run();
        return json({ results, status: allOk ? (anyDry ? 'published-dryrun' : 'published') : 'failed' });
      }

      // ── Status / capability probe ─────────────────────────────────────────────
      case 'status':
      case '': {
        return json({
          ok: true,
          image_provider: (env.FLOCK_IMAGE_PROVIDER || 'workers-ai'),
          sovereign_image_configured: !!env.FLOCK_IMAGE_URL,
          video_configured: videoConfigured(env),
          platforms: KNOWN_PLATFORMS,
          live_publish_platforms: [...LIVE_ADAPTERS], // platforms that publish for real when a channel has credentials
          actions: [
            'brand.create', 'brand.update', 'brand.list', 'brand.get',
            'channel.add', 'channel.list', 'channel.remove',
            'content.ideate', 'content.caption', 'content.continuity',
            'image.generate', 'image.edit', 'video.generate', 'asset.list',
            'post.create', 'post.list', 'post.get', 'post.review', 'post.publish',
          ],
        });
      }

      default:
        return err(`unknown action: ${action}`, 400);
    }
  } catch (e) {
    return err(`flock: ${(e as Error).message}`, 500);
  }
}

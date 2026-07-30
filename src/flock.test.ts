import { describe, it, expect, vi } from 'vitest';
import { brandKitText, buildImagePrompt, normalizeContinuity, handleFlock, type FlockEnv } from './flock';
import { selectImageChain, buildSovereignPayload, publishToChannel, KNOWN_PLATFORMS } from './flock-providers';

// ── Provider chain selection — the sovereign-transfer contract ───────────────
describe('selectImageChain', () => {
  it('defaults to workers-ai when nothing is configured', () => {
    expect(selectImageChain({})).toEqual(['workers-ai']);
  });
  it('leads with sovereign when explicitly selected and configured', () => {
    expect(selectImageChain({ FLOCK_IMAGE_PROVIDER: 'sovereign', FLOCK_IMAGE_URL: 'https://x' }))
      .toEqual(['sovereign', 'workers-ai']);
  });
  it('falls back to workers-ai when sovereign is selected but not configured', () => {
    expect(selectImageChain({ FLOCK_IMAGE_PROVIDER: 'sovereign' })).toEqual(['workers-ai']);
  });
  it('auto prefers a configured sovereign endpoint', () => {
    expect(selectImageChain({ FLOCK_IMAGE_PROVIDER: 'auto', FLOCK_IMAGE_URL: 'https://x' }))
      .toEqual(['sovereign', 'workers-ai']);
  });
  it('default mode still keeps a configured sovereign box as a fallback', () => {
    expect(selectImageChain({ FLOCK_IMAGE_URL: 'https://x' })).toEqual(['workers-ai', 'sovereign']);
  });
});

describe('buildSovereignPayload', () => {
  it('carries prompt + dimensions and the model when given', () => {
    const p = buildSovereignPayload({ prompt: 'a fox', width: 512, height: 512 }, 'my-model');
    expect(p).toMatchObject({ prompt: 'a fox', width: 512, height: 512, model: 'my-model' });
  });
  it('base64-encodes an init image for the img2img path', () => {
    const p = buildSovereignPayload({ prompt: 'edit', initImage: new Uint8Array([1, 2, 3]), strength: 0.4 });
    expect(typeof p.image).toBe('string');
    expect(p.strength).toBe(0.4);
  });
});

// ── Brand-conditioned prompt building ────────────────────────────────────────
describe('buildImagePrompt', () => {
  const brand = { name: 'Aurora', voice: 'calm, premium', visual_style: 'soft natural light',
    palette: JSON.stringify([{ name: 'gold', hex: '#C9A84C' }]), taboos: 'no neon, no clutter' };
  it('folds palette, style and voice into the positive prompt', () => {
    const { prompt } = buildImagePrompt(brand, 'a coffee cup');
    expect(prompt).toContain('a coffee cup');
    expect(prompt).toContain('#C9A84C');
    expect(prompt).toContain('soft natural light');
  });
  it('routes brand taboos into the negative prompt', () => {
    const { negativePrompt } = buildImagePrompt(brand, 'x');
    expect(negativePrompt).toContain('no neon, no clutter');
    expect(negativePrompt).toContain('watermark');
  });
});

describe('brandKitText', () => {
  it('renders only the fields present', () => {
    const t = brandKitText({ name: 'Aurora', mission: 'warmth' });
    expect(t).toContain('Brand: Aurora');
    expect(t).toContain('Mission: warmth');
    expect(t).not.toContain('Voice');
  });
});

// ── Guardian normalization — the gate must never crash or accidentally pass ──
describe('normalizeContinuity', () => {
  it('clamps out-of-range scores and derives a verdict when missing', () => {
    const r = normalizeContinuity({ score: 250, dimensions: { voice: -5, palette: 90, values: 70, audience: 80 }, issues: [], fixes: [], verdict: undefined as never });
    expect(r.score).toBe(100);
    expect(r.dimensions.voice).toBe(0);
    expect(r.verdict).toBe('on-brand');
  });
  it('caps issue/fix lists', () => {
    const many = Array.from({ length: 30 }, (_, i) => `x${i}`);
    const r = normalizeContinuity({ score: 40, dimensions: { voice: 40, palette: 40, values: 40, audience: 40 }, issues: many, fixes: many, verdict: 'off-brand' });
    expect(r.issues.length).toBe(12);
    expect(r.fixes.length).toBe(12);
  });
});

// ── Posting fan-out ──────────────────────────────────────────────────────────
describe('publishToChannel', () => {
  it('dry-runs a channel with no credentials and reports honestly', () => {
    const r = publishToChannel({ platform: 'instagram', caption: 'hi', hashtags: ['brand'], assetKeys: ['k'], credentials: null });
    expect(r.ok).toBe(true);
    expect(r.dryRun).toBe(true);
    expect(r.detail).toContain('DRY RUN');
  });
  it('does not fake a publish when credentials exist but no adapter is implemented', () => {
    const r = publishToChannel({ platform: 'tiktok', caption: 'hi', hashtags: [], assetKeys: [], credentials: { token: 'x' } });
    expect(r.ok).toBe(false);
    expect(r.dryRun).toBe(false);
  });
  it('exposes a known platform roster', () => {
    expect(KNOWN_PLATFORMS).toContain('instagram');
    expect(KNOWN_PLATFORMS).toContain('tiktok');
  });
});

// ── Handler smoke test on a routed D1 stub (same pattern as judge.test.ts) ───
function fakeDb(routes: Array<{ match: string; results?: unknown[]; first?: unknown }>) {
  const inserts: Array<{ sql: string; args: unknown[] }> = [];
  const stmtFor = (sql: string, args: unknown[]) => ({
    run: vi.fn(async () => { if (/^\s*INSERT/i.test(sql)) inserts.push({ sql, args }); return { success: true }; }),
    all: vi.fn(async () => ({ results: routes.find(r => sql.includes(r.match))?.results ?? [] })),
    first: vi.fn(async () => { const r = routes.find(x => sql.includes(x.match)); return r && 'first' in r ? r.first : null; }),
  });
  const db = {
    prepare: vi.fn((sql: string) => ({ ...stmtFor(sql, []), bind: vi.fn((...args: unknown[]) => stmtFor(sql, args)) })),
    batch: vi.fn(async () => []),
  };
  return { db, inserts };
}

describe('handleFlock', () => {
  it('status reports the image provider and platform roster', async () => {
    const { db } = fakeDb([]);
    const env = { DB: db } as unknown as FlockEnv;
    const res = await handleFlock({ action: 'status' }, env, 'u1');
    const body = await res.json() as { image_provider: string; platforms: string[]; sovereign_image_configured: boolean };
    expect(res.status).toBe(200);
    expect(body.image_provider).toBe('workers-ai');
    expect(body.platforms).toContain('instagram');
    expect(body.sovereign_image_configured).toBe(false);
  });

  it('rejects a brand.create with no name', async () => {
    const { db } = fakeDb([]);
    const env = { DB: db } as unknown as FlockEnv;
    const res = await handleFlock({ action: 'brand.create' }, env, 'u1');
    expect(res.status).toBe(400);
  });

  it('refuses to publish an unreviewed post without force', async () => {
    const { db } = fakeDb([
      { match: 'SELECT * FROM flock_posts', first: { id: 'p1', brand_id: 'b1', caption: 'hi', hashtags: '[]', asset_ids: '[]', channel_ids: '["c1"]', continuity_score: null } },
    ]);
    const env = { DB: db } as unknown as FlockEnv;
    const res = await handleFlock({ action: 'post.publish', post_id: 'p1' }, env, 'u1');
    expect(res.status).toBe(409);
  });
});

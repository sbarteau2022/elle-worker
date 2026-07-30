// ============================================================
// FLOCK — provider adapter layer (src/flock-providers.ts)
//
// The generative backends behind the Flock subsystem (src/flock.ts), kept
// deliberately separate from the subsystem's own logic so the answer to
// "which model actually drew this?" is ONE swappable seam, not a decision
// smeared through the feature code.
//
// SOVEREIGN TRANSFER (operator directive, 2026-07-30): image generation runs
// on Cloudflare Workers AI (env.AI — free, always-on) TODAY, but the whole
// point of this seam is that moving to a self-hosted / "sovereign" image model
// is a CONFIG CHANGE, never a rewrite. Set FLOCK_IMAGE_PROVIDER=sovereign
// (+ FLOCK_IMAGE_URL / FLOCK_IMAGE_KEY / FLOCK_IMAGE_MODEL) and every draw in
// the app routes to the operator's own endpoint instead. This mirrors exactly
// how the LLM layer already carries a local/Ollama lane (see llm.ts
// prefer:'local'): the same "spend your own compute first" philosophy, one
// tier up into pixels.
//
// Video generation and live social posting have NO free always-on binding, so
// they ship as honest STUB adapters: they describe the job they WOULD run and
// return `configured:false` until the operator wires a real provider. Nothing
// here silently pretends to have posted or rendered something it did not.
// ============================================================

// ── Environment surface these adapters read ─────────────────────────────────
export interface FlockProviderEnv {
  // Same structural shape as LLMEnv.AI (llm.ts) so FlockEnv can extend both.
  AI?: { run(model: string, inputs: Record<string, unknown>): Promise<unknown> };
  // Image lane. provider: 'workers-ai' (default) | 'sovereign' | 'auto'.
  // 'auto' prefers the sovereign endpoint when configured, else Workers AI.
  FLOCK_IMAGE_PROVIDER?: string;
  FLOCK_IMAGE_URL?: string;          // sovereign endpoint, e.g. a ComfyUI / SD-server front door
  FLOCK_IMAGE_KEY?: string;          // bearer for the sovereign endpoint (optional)
  FLOCK_IMAGE_MODEL?: string;        // text->image model id on the sovereign endpoint
  FLOCK_IMAGE_MODEL_EDIT?: string;   // img->img model id on the sovereign endpoint
  // Video lane — stub until a provider is wired.
  FLOCK_VIDEO_PROVIDER?: string;     // 'sovereign' | (unset ⇒ stub)
  FLOCK_VIDEO_URL?: string;
  FLOCK_VIDEO_KEY?: string;
  FLOCK_VIDEO_MODEL?: string;
}

// Workers AI defaults. flux-1-schnell is fast and returns base64 JSON;
// SDXL is the img2img lane (accepts an input image + strength).
const CF_TXT2IMG = '@cf/black-forest-labs/flux-1-schnell';
const CF_IMG2IMG = '@cf/stabilityai/stable-diffusion-xl-base-1.0';

export interface ImageRequest {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  /** PNG/JPEG bytes of a source image ⇒ img2img "edit" mode. */
  initImage?: Uint8Array;
  /** 0..1, how far the edit may travel from the source (img2img only). */
  strength?: number;
}

export interface ImageResult {
  bytes: Uint8Array;
  mime: string;
  provider: string;   // which adapter produced it — recorded on the asset
  model: string;
}

// ── Chain selection — PURE, so provider policy is unit-testable ──────────────
// Returns the ordered list of adapter ids to try. The first that is available
// AND succeeds wins; a sovereign miss falls back to Workers AI so a run never
// dead-ends just because the self-hosted box is down.
export function selectImageChain(env: FlockProviderEnv): Array<'sovereign' | 'workers-ai'> {
  const mode = (env.FLOCK_IMAGE_PROVIDER || 'workers-ai').toLowerCase();
  const sovereignConfigured = !!env.FLOCK_IMAGE_URL;
  if (mode === 'sovereign') {
    // Explicit sovereign: it leads, Workers AI is the safety net.
    return sovereignConfigured ? ['sovereign', 'workers-ai'] : ['workers-ai'];
  }
  if (mode === 'auto') {
    return sovereignConfigured ? ['sovereign', 'workers-ai'] : ['workers-ai'];
  }
  // Default 'workers-ai': lead with the free pool; still allow a configured
  // sovereign box as fallback so it's never wasted.
  return sovereignConfigured ? ['workers-ai', 'sovereign'] : ['workers-ai'];
}

// Normalize whatever Workers AI / a sovereign endpoint hands back into bytes.
// Handles: base64 JSON ({image}/{images:[]}), a raw ReadableStream, an
// ArrayBuffer/Uint8Array, or a base64 string.
async function toBytes(result: unknown): Promise<Uint8Array | null> {
  if (!result) return null;
  if (result instanceof Uint8Array) return result;
  if (result instanceof ArrayBuffer) return new Uint8Array(result);
  if (typeof (result as ReadableStream).getReader === 'function') {
    const reader = (result as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }
  const b64 =
    typeof result === 'string' ? result
    : (result as { image?: string; images?: string[] }).image
      ?? (result as { images?: string[] }).images?.[0]
      ?? null;
  if (typeof b64 === 'string' && b64.length) {
    try { return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); } catch { return null; }
  }
  return null;
}

// ── Workers AI adapter ───────────────────────────────────────────────────────
async function workersAiImage(env: FlockProviderEnv, req: ImageRequest): Promise<ImageResult> {
  if (!env.AI) throw new Error('Workers AI binding (env.AI) not available');
  if (req.initImage && req.initImage.length) {
    // img2img "edit": SDXL takes the source as an int array + a strength.
    const model = CF_IMG2IMG;
    const result = await env.AI.run(model, {
      prompt: req.prompt,
      negative_prompt: req.negativePrompt,
      image: Array.from(req.initImage),
      strength: typeof req.strength === 'number' ? Math.max(0.05, Math.min(1, req.strength)) : 0.6,
      num_steps: 20,
    });
    const bytes = await toBytes(result);
    if (!bytes) throw new Error('Workers AI img2img returned no image bytes');
    return { bytes, mime: 'image/png', provider: 'workers-ai', model };
  }
  const model = CF_TXT2IMG;
  const result = await env.AI.run(model, {
    prompt: req.prompt,
    // flux-schnell honours steps 1..8; keep it snappy for interactive use.
    steps: 6,
  });
  const bytes = await toBytes(result);
  if (!bytes) throw new Error('Workers AI txt2img returned no image bytes');
  return { bytes, mime: 'image/png', provider: 'workers-ai', model };
}

// ── Sovereign adapter (self-hosted / operator-owned) ─────────────────────────
// Contract, kept intentionally minimal so any front door can satisfy it:
//   POST {prompt, negative_prompt?, width?, height?, model?, image?(b64), strength?}
//   → JSON {image: "<base64>"} | {images: ["<base64>", …]}  OR  raw image bytes.
// This is the seam the operator swaps their own model in behind.
export function buildSovereignPayload(req: ImageRequest, model?: string): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    prompt: req.prompt,
    negative_prompt: req.negativePrompt ?? '',
    width: req.width ?? 1024,
    height: req.height ?? 1024,
  };
  if (model) payload.model = model;
  if (req.initImage && req.initImage.length) {
    payload.image = btoa(String.fromCharCode(...req.initImage));
    payload.strength = typeof req.strength === 'number' ? req.strength : 0.6;
  }
  return payload;
}

async function sovereignImage(env: FlockProviderEnv, req: ImageRequest): Promise<ImageResult> {
  if (!env.FLOCK_IMAGE_URL) throw new Error('sovereign image endpoint (FLOCK_IMAGE_URL) not configured');
  const model = req.initImage ? (env.FLOCK_IMAGE_MODEL_EDIT || env.FLOCK_IMAGE_MODEL) : env.FLOCK_IMAGE_MODEL;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (env.FLOCK_IMAGE_KEY) headers.Authorization = `Bearer ${env.FLOCK_IMAGE_KEY}`;
  const r = await fetch(env.FLOCK_IMAGE_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(buildSovereignPayload(req, model)),
  });
  if (!r.ok) throw new Error(`sovereign image endpoint HTTP ${r.status}`);
  const ct = r.headers.get('content-type') || '';
  let bytes: Uint8Array | null = null;
  if (ct.includes('application/json')) {
    bytes = await toBytes(await r.json().catch(() => null));
  } else {
    bytes = new Uint8Array(await r.arrayBuffer());
  }
  if (!bytes || !bytes.length) throw new Error('sovereign image endpoint returned no image bytes');
  const mime = ct.includes('jpeg') || ct.includes('jpg') ? 'image/jpeg' : 'image/png';
  return { bytes, mime, provider: 'sovereign', model: model || 'sovereign' };
}

// Try the chain in order; return the first success. Collects errors so the
// caller can surface why every lane failed.
export async function generateImage(env: FlockProviderEnv, req: ImageRequest): Promise<ImageResult> {
  const chain = selectImageChain(env);
  const errors: string[] = [];
  for (const id of chain) {
    try {
      return id === 'sovereign' ? await sovereignImage(env, req) : await workersAiImage(env, req);
    } catch (e) {
      errors.push(`${id}: ${(e as Error).message}`);
    }
  }
  throw new Error(`image generation failed on all providers — ${errors.join('; ')}`);
}

// ── Video lane (stub until a provider is wired) ──────────────────────────────
export interface VideoRequest {
  prompt: string;
  durationSec?: number;
  aspect?: string;   // '9:16' | '1:1' | '16:9'
}
export type VideoResult =
  | { ok: true; bytes: Uint8Array; mime: string; provider: string; model: string }
  | { ok: false; configured: false; provider: string; spec: VideoRequest; note: string };

export function videoConfigured(env: FlockProviderEnv): boolean {
  return !!(env.FLOCK_VIDEO_PROVIDER && env.FLOCK_VIDEO_URL);
}

export async function generateVideo(env: FlockProviderEnv, req: VideoRequest): Promise<VideoResult> {
  if (!videoConfigured(env)) {
    return {
      ok: false, configured: false, provider: 'stub', spec: req,
      note: 'No video provider configured. Set FLOCK_VIDEO_PROVIDER + FLOCK_VIDEO_URL (+ _KEY/_MODEL) to a text-to-video endpoint (e.g. a self-hosted model or a hosted API), and this same call path renders for real — the job spec above is what it will send.',
    };
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (env.FLOCK_VIDEO_KEY) headers.Authorization = `Bearer ${env.FLOCK_VIDEO_KEY}`;
  const r = await fetch(env.FLOCK_VIDEO_URL!, {
    method: 'POST',
    headers,
    body: JSON.stringify({ prompt: req.prompt, duration: req.durationSec ?? 5, aspect: req.aspect ?? '9:16', model: env.FLOCK_VIDEO_MODEL }),
  });
  if (!r.ok) throw new Error(`video endpoint HTTP ${r.status}`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  return { ok: true, bytes, mime: r.headers.get('content-type') || 'video/mp4', provider: env.FLOCK_VIDEO_PROVIDER!, model: env.FLOCK_VIDEO_MODEL || 'sovereign' };
}

// ── Posting lane (the "flock" fan-out) ───────────────────────────────────────
// A channel is one social destination. Live posting needs per-platform OAuth,
// so real adapters are not implemented here — a channel with no credentials
// runs the DRY-RUN stub: it validates and records the exact payload it WOULD
// publish, and returns ok:true with dryRun:true. This lets the whole flock
// fan-out and continuity flow work end-to-end today; wiring a real platform is
// dropping one adapter into PLATFORM_ADAPTERS keyed by platform.
export type Platform = 'instagram' | 'tiktok' | 'x' | 'youtube' | 'linkedin' | 'facebook' | 'threads' | 'bluesky';
export const KNOWN_PLATFORMS: Platform[] = ['instagram', 'tiktok', 'x', 'youtube', 'linkedin', 'facebook', 'threads', 'bluesky'];

export interface PublishRequest {
  platform: string;
  handle?: string;
  caption: string;
  hashtags: string[];
  assetKeys: string[];      // R2 keys of the media riding along
  credentials?: Record<string, unknown> | null;  // channel.config — presence ⇒ a real adapter could run
}
export interface PublishResult {
  platform: string;
  ok: boolean;
  dryRun: boolean;
  externalId?: string;
  detail: string;
}

export function publishToChannel(req: PublishRequest): PublishResult {
  const hasCreds = !!(req.credentials && Object.keys(req.credentials).length);
  const caption = `${req.caption}${req.hashtags.length ? '\n\n' + req.hashtags.map(h => (h.startsWith('#') ? h : `#${h}`)).join(' ') : ''}`;
  if (hasCreds) {
    // A real adapter would run here. None implemented yet ⇒ be honest rather
    // than claim a publish. Still not a dry run: the operator asked for live.
    return {
      platform: req.platform, ok: false, dryRun: false,
      detail: `Credentials present for ${req.platform}, but no live adapter is implemented yet. Payload validated (${caption.length} chars, ${req.assetKeys.length} asset(s)). Implement the ${req.platform} adapter to publish for real.`,
    };
  }
  return {
    platform: req.platform, ok: true, dryRun: true,
    externalId: `dryrun-${crypto.randomUUID().slice(0, 8)}`,
    detail: `DRY RUN — would publish to ${req.platform}${req.handle ? ` (@${req.handle})` : ''}: ${caption.length} char caption, ${req.assetKeys.length} asset(s). Connect ${req.platform} to publish for real.`,
  };
}

import { describe, it, expect } from 'vitest';
import {
  resolveBlueskyCreds, buildPostText, capGraphemes, computeFacets,
  permalinkFromUri, publishToBluesky,
} from './flock-bluesky';

describe('resolveBlueskyCreds', () => {
  it('resolves the canonical shape and defaults the service host', () => {
    const c = resolveBlueskyCreds({ identifier: 'brand.bsky.social', app_password: 'abcd-efgh-ijkl-mnop' });
    expect(c).toEqual({ identifier: 'brand.bsky.social', password: 'abcd-efgh-ijkl-mnop', service: 'https://bsky.social' });
  });
  it('accepts alternate key spellings and a bare service host', () => {
    const c = resolveBlueskyCreds({ handle: 'me', password: 'pw', pds: 'pds.example.com' });
    expect(c).toEqual({ identifier: 'me', password: 'pw', service: 'https://pds.example.com' });
  });
  it('strips a trailing slash from the service', () => {
    expect(resolveBlueskyCreds({ identifier: 'x', password: 'y', service: 'https://bsky.social/' })!.service)
      .toBe('https://bsky.social');
  });
  it('returns null when either required field is missing', () => {
    expect(resolveBlueskyCreds({ identifier: 'only' })).toBeNull();
    expect(resolveBlueskyCreds({ password: 'only' })).toBeNull();
    expect(resolveBlueskyCreds(null)).toBeNull();
    expect(resolveBlueskyCreds({})).toBeNull();
  });
});

describe('buildPostText', () => {
  it('appends normalized, de-duped hashtags after a blank line', () => {
    expect(buildPostText('Hello world', ['flock', '#flock', 'birds']))
      .toBe('Hello world\n\n#flock #birds');
  });
  it('keeps just the caption when there are no tags', () => {
    expect(buildPostText('Just this', [])).toBe('Just this');
  });
  it('drops tags and caps the caption when the whole thing exceeds 300 graphemes', () => {
    const long = 'a'.repeat(320);
    const out = buildPostText(long, ['tag']);
    expect(Array.from(out).length).toBe(300);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toContain('#tag');
  });
});

describe('capGraphemes', () => {
  it('leaves short strings untouched', () => {
    expect(capGraphemes('short', 300)).toBe('short');
  });
  it('caps to exactly the limit with an ellipsis', () => {
    const out = capGraphemes('x'.repeat(50), 10);
    expect(Array.from(out).length).toBe(10);
    expect(out.endsWith('…')).toBe(true);
  });
  it('counts by code point, not UTF-16 unit (never splits a surrogate pair)', () => {
    // 5 emoji = 5 code points (10 UTF-16 units). Cap 4 → 3 emoji + ellipsis.
    const out = capGraphemes('😀😀😀😀😀', 4);
    expect(Array.from(out).length).toBe(4);
    expect(out).toBe('😀😀😀…');
  });
});

describe('computeFacets — UTF-8 byte offsets', () => {
  it('locates a hashtag by byte range and carries the bare tag', () => {
    const text = 'love #birds';
    const f = computeFacets(text);
    const tag = f.find(x => x.features[0].$type.endsWith('#tag'))!;
    expect(tag.features[0].tag).toBe('birds');
    // byteStart at the '#', byteEnd after 's'
    expect(text.slice(0, 0)).toBe(''); // sanity
    const enc = new TextEncoder();
    expect(enc.encode(text).slice(tag.index.byteStart, tag.index.byteEnd)).toEqual(enc.encode('#birds'));
  });
  it('shifts byte offsets correctly past a multi-byte emoji', () => {
    const text = '😀 #x';           // emoji is 4 UTF-8 bytes
    const f = computeFacets(text);
    const tag = f[0];
    const enc = new TextEncoder();
    expect(enc.encode(text).slice(tag.index.byteStart, tag.index.byteEnd)).toEqual(enc.encode('#x'));
  });
  it('detects a bare URL and strips trailing punctuation', () => {
    const text = 'see https://example.com/a.';
    const f = computeFacets(text);
    const link = f.find(x => x.features[0].$type.endsWith('#link'))!;
    expect(link.features[0].uri).toBe('https://example.com/a');
  });
  it('returns facets sorted by byteStart', () => {
    const f = computeFacets('#a then https://x.com then #b');
    const starts = f.map(x => x.index.byteStart);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(f.length).toBe(3);
  });
});

describe('permalinkFromUri', () => {
  it('builds a bsky.app permalink from an at:// uri', () => {
    expect(permalinkFromUri('at://did:plc:abc/app.bsky.feed.post/xyz', 'brand.bsky.social'))
      .toBe('https://bsky.app/profile/brand.bsky.social/post/xyz');
  });
  it('returns undefined for a non-post uri', () => {
    expect(permalinkFromUri('at://did:plc:abc/app.bsky.feed.like/xyz', 'me')).toBeUndefined();
  });
});

// ── Network sequence, driven by an injected fetch double ──────────────────────
function seqFetch(steps: Record<string, { status: number; body: unknown }>) {
  const calls: Array<{ method: string; body: unknown; headers: Record<string, string> }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    const method = url.split('/xrpc/')[1];
    const headers = (init.headers || {}) as Record<string, string>;
    let parsed: unknown = init.body;
    if (typeof init.body === 'string') { try { parsed = JSON.parse(init.body); } catch { /* raw */ } }
    calls.push({ method, body: parsed, headers });
    const step = steps[method] ?? { status: 404, body: {} };
    return {
      ok: step.status >= 200 && step.status < 300,
      status: step.status,
      json: async () => step.body,
      text: async () => (typeof step.body === 'string' ? step.body : JSON.stringify(step.body)),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('publishToBluesky (sequence)', () => {
  const creds = { identifier: 'me.bsky.social', password: 'app-pw', service: 'https://bsky.social' };

  it('createSession → createRecord for a text post, returning uri + permalink', async () => {
    const { impl, calls } = seqFetch({
      'com.atproto.server.createSession': { status: 200, body: { accessJwt: 'JWT', did: 'did:plc:me' } },
      'com.atproto.repo.createRecord': { status: 200, body: { uri: 'at://did:plc:me/app.bsky.feed.post/rk1', cid: 'cid1' } },
    });
    const r = await publishToBluesky(creds, { caption: 'hi #flock', hashtags: ['flock'] }, impl);
    expect(r.ok).toBe(true);
    expect(r.externalId).toBe('at://did:plc:me/app.bsky.feed.post/rk1');
    expect(r.url).toContain('bsky.app/profile/');
    // record carried the auth header and a facet for the hashtag
    const rec = calls.find(c => c.method === 'com.atproto.repo.createRecord')!;
    expect(rec.headers.Authorization).toBe('Bearer JWT');
    expect((rec.body as { record: { facets?: unknown[] } }).record.facets!.length).toBeGreaterThan(0);
  });

  it('uploads image blobs and attaches an images embed', async () => {
    const { impl, calls } = seqFetch({
      'com.atproto.server.createSession': { status: 200, body: { accessJwt: 'JWT', did: 'did:plc:me' } },
      'com.atproto.repo.uploadBlob': { status: 200, body: { blob: { $type: 'blob', ref: 'r' } } },
      'com.atproto.repo.createRecord': { status: 200, body: { uri: 'at://did:plc:me/app.bsky.feed.post/rk2', cid: 'c' } },
    });
    const r = await publishToBluesky(creds, {
      caption: 'pic', hashtags: [], media: [{ bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' }],
    }, impl);
    expect(r.ok).toBe(true);
    expect(r.detail).toContain('1 image');
    const rec = calls.find(c => c.method === 'com.atproto.repo.createRecord')!;
    expect((rec.body as { record: { embed?: { $type: string } } }).record.embed!.$type).toBe('app.bsky.embed.images');
  });

  it('a failed login returns ok:false with the status, and never throws', async () => {
    const { impl } = seqFetch({
      'com.atproto.server.createSession': { status: 401, body: 'Invalid identifier or password' },
    });
    const r = await publishToBluesky(creds, { caption: 'x', hashtags: [] }, impl);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('createSession HTTP 401');
  });

  it('a blob upload failure drops the image but still posts', async () => {
    const { impl, calls } = seqFetch({
      'com.atproto.server.createSession': { status: 200, body: { accessJwt: 'J', did: 'did:plc:me' } },
      'com.atproto.repo.uploadBlob': { status: 413, body: 'too big' },
      'com.atproto.repo.createRecord': { status: 200, body: { uri: 'at://did:plc:me/app.bsky.feed.post/rk3', cid: 'c' } },
    });
    const r = await publishToBluesky(creds, {
      caption: 'still posts', hashtags: [], media: [{ bytes: new Uint8Array([9]), mime: 'image/png' }],
    }, impl);
    expect(r.ok).toBe(true);
    const rec = calls.find(c => c.method === 'com.atproto.repo.createRecord')!;
    expect((rec.body as { record: { embed?: unknown } }).record.embed).toBeUndefined();
  });
});

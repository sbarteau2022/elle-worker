// ============================================================
// FLOCK — the Bluesky posting adapter (src/flock-bluesky.ts)
//
// The first REAL live-publishing adapter behind the flock fan-out. Everything
// else in the posting lane (flock-providers.ts) is an honest dry-run/stub until
// a platform is wired; Bluesky is wired here because it is the one major
// network that publishes for free with no paywalled developer program and no
// OAuth server round-trip — an app password is enough. That makes it the
// honest "this actually posts" proof the whole subsystem was built toward.
//
// Auth model: the channel's stored config carries { identifier, app_password }
// (an APP PASSWORD from Settings → App Passwords, never the account password)
// and an optional { service } PDS host. We createSession → (optionally)
// uploadBlob for up to 4 images → createRecord an app.bsky.feed.post.
//
// The pure helpers (credential resolution, text assembly, grapheme cap, and the
// UTF-8 byte-offset facets for hashtags and links) are separated from the
// network calls so the fiddly parts are unit-tested and the adapter itself is a
// thin, auditable sequence of three xrpc POSTs.
// ============================================================

export interface BlueskyCreds {
  identifier: string; // handle or DID, e.g. "brand.bsky.social"
  password: string;   // an APP PASSWORD
  service: string;    // PDS base URL, defaults to https://bsky.social
}

// Pull credentials out of an arbitrary channel.config blob. Tolerant of the
// common key spellings so a channel set up by hand still resolves. Returns null
// when the two required fields aren't both present — the caller then falls back
// to the honest not-configured path rather than attempting a broken login.
export function resolveBlueskyCreds(config: Record<string, unknown> | null | undefined): BlueskyCreds | null {
  if (!config) return null;
  const c = config as Record<string, unknown>;
  const identifier = String(c.identifier ?? c.handle ?? c.username ?? c.did ?? '').trim();
  const password = String(c.app_password ?? c.appPassword ?? c.password ?? c.app_pw ?? '').trim();
  if (!identifier || !password) return null;
  let service = String(c.service ?? c.pds ?? c.host ?? 'https://bsky.social').trim();
  if (!/^https?:\/\//i.test(service)) service = `https://${service}`;
  service = service.replace(/\/+$/, '');
  return { identifier, password, service };
}

// Bluesky posts cap at 300 graphemes. We approximate graphemes with the string's
// Unicode code points (Array.from splits on code points, so surrogate pairs stay
// whole — good enough that we never split a character, and conservative for the
// rare multi-codepoint emoji). Truncation appends an ellipsis inside the cap.
const GRAPHEME_CAP = 300;
export function capGraphemes(text: string, cap = GRAPHEME_CAP): string {
  const cps = Array.from(text);
  if (cps.length <= cap) return text;
  return cps.slice(0, cap - 1).join('') + '…';
}

// Assemble the post text from the caption + hashtags, then cap it. Hashtags are
// normalized to a single leading '#', de-duped, and appended after a blank line
// only if they fit; the caption is never dropped in favour of tags.
export function buildPostText(caption: string, hashtags: string[]): string {
  const tags = Array.from(new Set(
    (hashtags || [])
      .map(h => String(h || '').trim())
      .filter(Boolean)
      .map(h => (h.startsWith('#') ? h : `#${h}`))
      .map(h => h.replace(/\s+/g, '')),
  ));
  const base = String(caption || '').trim();
  const withTags = tags.length ? `${base}\n\n${tags.join(' ')}` : base;
  if (Array.from(withTags).length <= GRAPHEME_CAP) return withTags;
  // Tags don't fit alongside the full caption — keep the caption, drop tags,
  // then cap. A truncated caption reads better than an orphaned tag list.
  return capGraphemes(base);
}

export interface Facet {
  index: { byteStart: number; byteEnd: number };
  features: Array<{ $type: string; tag?: string; uri?: string }>;
}

// Rich-text facets over the FINAL text, indexed in UTF-8 BYTES (the AT-proto
// requirement — not JS char offsets). Detects #hashtags and bare http(s) URLs.
// Pure and deterministic: same text in, same facets out.
export function computeFacets(text: string): Facet[] {
  const enc = new TextEncoder();
  const byteLen = (s: string) => enc.encode(s).length;
  const facets: Facet[] = [];

  // Hashtags: '#' + one-or-more tag chars, not part of a word (so "a#b" is out).
  const tagRe = /(^|[\s(])(#[^\s#.,;:!?)\]]+)/g;
  for (let m = tagRe.exec(text); m; m = tagRe.exec(text)) {
    const lead = m[1];
    const hash = m[2];
    const start = m.index + lead.length;
    const byteStart = byteLen(text.slice(0, start));
    const byteEnd = byteStart + byteLen(hash);
    facets.push({
      index: { byteStart, byteEnd },
      features: [{ $type: 'app.bsky.richtext.facet#tag', tag: hash.slice(1) }],
    });
  }

  // Links: bare http(s) URLs. Trailing sentence punctuation is trimmed off.
  const urlRe = /https?:\/\/[^\s]+/g;
  for (let m = urlRe.exec(text); m; m = urlRe.exec(text)) {
    let uri = m[0];
    const trimmed = uri.replace(/[.,;:!?)\]]+$/, '');
    uri = trimmed;
    const start = m.index;
    const byteStart = byteLen(text.slice(0, start));
    const byteEnd = byteStart + byteLen(uri);
    facets.push({
      index: { byteStart, byteEnd },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri }],
    });
  }

  facets.sort((a, b) => a.index.byteStart - b.index.byteStart);
  return facets;
}

// ── The network adapter ───────────────────────────────────────────────────────
export interface BlueskyMedia { bytes: Uint8Array; mime: string; alt?: string; }
export interface BlueskyPublishResult {
  ok: boolean;
  externalId?: string; // the at:// uri of the created post
  url?: string;        // a bsky.app permalink when derivable
  detail: string;
}

type FetchLike = typeof fetch;

async function xrpc(
  fetchImpl: FetchLike, service: string, method: string,
  body: BodyInit, headers: Record<string, string>,
): Promise<Response> {
  return fetchImpl(`${service}/xrpc/${method}`, { method: 'POST', headers, body });
}

// Publish one post to Bluesky. Sequence: createSession → uploadBlob (≤4 images)
// → createRecord. Any failure returns ok:false with the failing step and status
// in `detail` — never throws, so one bad channel can't sink the fan-out.
export async function publishToBluesky(
  creds: BlueskyCreds,
  args: { caption: string; hashtags: string[]; media?: BlueskyMedia[] },
  fetchImpl: FetchLike = fetch,
): Promise<BlueskyPublishResult> {
  try {
    // 1. Session
    const sres = await xrpc(fetchImpl, creds.service, 'com.atproto.server.createSession',
      JSON.stringify({ identifier: creds.identifier, password: creds.password }),
      { 'Content-Type': 'application/json' });
    if (!sres.ok) {
      const t = await sres.text().catch(() => '');
      return { ok: false, detail: `bluesky createSession HTTP ${sres.status}${t ? ` — ${t.slice(0, 200)}` : ''} (check the app password, not the account password)` };
    }
    const session = await sres.json() as { accessJwt: string; did: string };
    const auth = { Authorization: `Bearer ${session.accessJwt}` };

    // 2. Media blobs (best-effort, up to 4 — a blob failure drops the image,
    //    it does not fail the post).
    const images: Array<{ alt: string; image: unknown }> = [];
    for (const m of (args.media || []).slice(0, 4)) {
      try {
        const bres = await xrpc(fetchImpl, creds.service, 'com.atproto.repo.uploadBlob',
          m.bytes as unknown as BodyInit, { ...auth, 'Content-Type': m.mime || 'image/png' });
        if (!bres.ok) continue;
        const blob = (await bres.json() as { blob: unknown }).blob;
        images.push({ alt: (m.alt || '').slice(0, 280), image: blob });
      } catch { /* skip this image, keep posting */ }
    }

    // 3. Record
    const text = buildPostText(args.caption, args.hashtags);
    const record: Record<string, unknown> = {
      $type: 'app.bsky.feed.post',
      text,
      createdAt: new Date().toISOString(),
      langs: ['en'],
    };
    const facets = computeFacets(text);
    if (facets.length) record.facets = facets;
    if (images.length) record.embed = { $type: 'app.bsky.embed.images', images };

    const cres = await xrpc(fetchImpl, creds.service, 'com.atproto.repo.createRecord',
      JSON.stringify({ repo: session.did, collection: 'app.bsky.feed.post', record }),
      { ...auth, 'Content-Type': 'application/json' });
    if (!cres.ok) {
      const t = await cres.text().catch(() => '');
      return { ok: false, detail: `bluesky createRecord HTTP ${cres.status}${t ? ` — ${t.slice(0, 200)}` : ''}` };
    }
    const created = await cres.json() as { uri: string; cid: string };
    return {
      ok: true,
      externalId: created.uri,
      url: permalinkFromUri(created.uri, creds.identifier),
      detail: `Published to Bluesky${images.length ? ` with ${images.length} image(s)` : ''} (${Array.from(text).length} graphemes).`,
    };
  } catch (e) {
    return { ok: false, detail: `bluesky publish failed: ${(e as Error).message}` };
  }
}

// at://did:plc:xxx/app.bsky.feed.post/rkey → https://bsky.app/profile/<id>/post/<rkey>
export function permalinkFromUri(uri: string, identifier: string): string | undefined {
  const m = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/(.+)$/.exec(uri);
  if (!m) return undefined;
  const who = identifier || m[1];
  return `https://bsky.app/profile/${who}/post/${m[2]}`;
}

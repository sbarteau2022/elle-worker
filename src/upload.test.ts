import { describe, it, expect, vi } from 'vitest';
import { parseUpload, imageExt, isTextLike } from './upload';
import { isIntakePath } from './artifacts';

const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

function makeEnv(overrides: { toMarkdown?: unknown; put?: unknown } = {}) {
  const put = overrides.put ?? vi.fn(async () => ({}));
  return {
    env: {
      AI: { toMarkdown: overrides.toMarkdown ?? vi.fn(async () => ({ format: 'markdown', data: 'a heron over water' })) },
      DOCUMENTS: { put },
    } as unknown as Parameters<typeof parseUpload>[0],
    put: put as ReturnType<typeof vi.fn>,
  };
}

describe('imageExt', () => {
  it('reads the mime first, since the browser knows best', () => {
    expect(imageExt('whatever', 'image/png')).toBe('png');
    expect(imageExt('whatever', 'image/jpeg')).toBe('jpg');
    expect(imageExt('whatever', 'IMAGE/WEBP')).toBe('webp');
  });

  it('falls back to the extension when the mime is missing or useless', () => {
    expect(imageExt('photo.JPEG', '')).toBe('jpg');
    expect(imageExt('photo.png', 'application/octet-stream')).toBe('png');
  });

  it('is null for anything that is not a keepable image', () => {
    expect(imageExt('report.pdf', 'application/pdf')).toBeNull();
    expect(imageExt('sheet.xlsx', '')).toBeNull();
    // SVG is markup that can carry script — never an intake image.
    expect(imageExt('logo.svg', 'image/svg+xml')).toBeNull();
  });
});

describe('parseUpload — documents are unchanged', () => {
  it('decodes text-like files directly and stores nothing', async () => {
    const { env, put } = makeEnv();
    const out = await parseUpload(env, { name: 'notes.md', type: 'text/markdown', bytes: bytes('# hi') });
    expect(out).toMatchObject({ via: 'text', kind: 'document', text: '# hi' });
    expect(out.stored).toBeUndefined();
    expect(put).not.toHaveBeenCalled();
  });

  it('sends a PDF through toMarkdown and stores nothing', async () => {
    const { env, put } = makeEnv();
    const out = await parseUpload(env, { name: 'paper.pdf', type: 'application/pdf', bytes: bytes('%PDF') });
    expect(out).toMatchObject({ via: 'toMarkdown', kind: 'document' });
    expect(out.stored).toBeUndefined();
    expect(put).not.toHaveBeenCalled();
  });

  it('still throws on an unparseable non-image', async () => {
    const { env } = makeEnv({ toMarkdown: vi.fn(async () => ({ format: 'error' })) });
    await expect(parseUpload(env, { name: 'x.bin', type: 'application/octet-stream', bytes: bytes('..') }))
      .rejects.toThrow(/could not parse/);
  });
});

describe('parseUpload — images are kept', () => {
  it('stores the bytes under intake/ and returns a valid intake path', async () => {
    const { env, put } = makeEnv();
    const out = await parseUpload(env, { name: 'heron.png', type: 'image/png', bytes: bytes('PNGDATA') });
    expect(out.kind).toBe('image');
    expect(isIntakePath(out.stored)).toBe(true);
    expect(put).toHaveBeenCalledTimes(1);
    const [key, , opts] = put.mock.calls[0] as [string, unknown, { httpMetadata: { contentType: string } }];
    expect(key).toMatch(/^intake\/[0-9a-f]{32}\.png$/);
    expect(opts.httpMetadata.contentType).toBe('image/png');
    // The parsed text still rides the turn — storing is additive.
    expect(out.text).toBe('a heron over water');
  });

  // The bytes are the point. A picture toMarkdown can say nothing about is
  // exactly the picture her own eyes are for.
  it('keeps a stored image even when the parse fails', async () => {
    const { env } = makeEnv({ toMarkdown: vi.fn(async () => ({ format: 'error' })) });
    const out = await parseUpload(env, { name: 'noisy.jpg', type: 'image/jpeg', bytes: bytes('JPEG') });
    expect(isIntakePath(out.stored)).toBe(true);
    expect(out.kind).toBe('image');
    expect(out.text).toBe('');
  });

  it('never lets a store failure cost the upload', async () => {
    const { env } = makeEnv({ put: vi.fn(async () => { throw new Error('R2 down'); }) });
    const out = await parseUpload(env, { name: 'heron.png', type: 'image/png', bytes: bytes('PNGDATA') });
    expect(out.stored).toBeUndefined();
    expect(out.text).toBe('a heron over water');   // the turn still gets its text
  });

  it('degrades cleanly when no bucket is bound at all', async () => {
    const env = { AI: { toMarkdown: vi.fn(async () => ({ format: 'markdown', data: 'x' })) } } as unknown as Parameters<typeof parseUpload>[0];
    const out = await parseUpload(env, { name: 'heron.png', type: 'image/png', bytes: bytes('PNGDATA') });
    expect(out.stored).toBeUndefined();
  });

  it('gives every upload its own id', async () => {
    const { env, put } = makeEnv();
    await parseUpload(env, { name: 'a.png', type: 'image/png', bytes: bytes('A') });
    await parseUpload(env, { name: 'b.png', type: 'image/png', bytes: bytes('B') });
    const keys = put.mock.calls.map((c) => c[0]);
    expect(new Set(keys).size).toBe(2);
  });
});

describe('isTextLike', () => {
  it('is unchanged by any of this', () => {
    expect(isTextLike('a.md', '')).toBe(true);
    expect(isTextLike('a.png', 'image/png')).toBe(false);
  });
});

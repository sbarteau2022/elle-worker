// ============================================================
// ELLE — FILE UPLOAD / PARSE · src/upload.ts
//
// The chat composer's upload button hands a file here. We turn it into text so
// Elle can read it — and, on your instruction, ingest_paper it (chunk → embed →
// vectorize) through the existing corpus pipeline. The text is returned to the
// caller, which attaches it to the next turn.
//
// IMAGES are also KEPT. toMarkdown turns a picture into a description, and a
// description is a lossy shadow: with only that text, her actual visual
// instruments (vfar describe's vision model, vfar rip's deterministic
// structure) had nothing to read, so she could analyse a picture she made and
// not one you handed her. The bytes now land in the private intake store, and
// the returned `stored` path is what lets those instruments reach them.
//
// Private on purpose — see the INTAKE block in artifacts.ts. Uploads are YOUR
// content, so they never join the publicly-served /vfar/ artifacts.
//
// Parsing is server-side and format-agnostic via Workers AI toMarkdown()
// (env.AI.toMarkdown): PDF, DOCX, XLSX, images, HTML, … all become markdown in
// one path. Plain text / markdown / obvious source files are decoded directly —
// no need to round-trip them through the converter.
// ============================================================

import { INTAKE_EXT, INTAKE_MIME } from './artifacts';

const MAX_TEXT = 400_000;     // hard cap on returned text (chars)
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB upload ceiling

// Extensions we decode as UTF-8 straight, skipping the converter.
const TEXT_EXT = /\.(txt|md|markdown|csv|log|json|ya?ml|toml|ini|xml|html?|tsx?|jsx?|py|rb|go|rs|java|c|cc|cpp|h|hpp|cs|php|sh|bash|zsh|sql|css|scss)$/i;
const TEXT_MIME = /^text\/|application\/(json|xml|x-yaml|javascript|typescript)/i;

export interface ParsedUpload {
  name: string;
  text: string;
  chars: number;
  truncated: boolean;
  via: 'text' | 'toMarkdown';
  /** 'image' when the bytes were kept in the intake store, else 'document'. */
  kind: 'image' | 'document';
  /** /intake/<id>.<ext> — present only for a stored image. */
  stored?: string;
  mime?: string;
}

function clip(s: string): { text: string; truncated: boolean } {
  if (s.length <= MAX_TEXT) return { text: s, truncated: false };
  return { text: s.slice(0, MAX_TEXT), truncated: true };
}

// Decide if a file should be read as plain text (by extension or mime).
export function isTextLike(name: string, mime: string): boolean {
  return TEXT_EXT.test(name) || TEXT_MIME.test(mime || '');
}

/**
 * Is this an image we can keep? Mime first (the browser knows best), falling
 * back to the extension for the case where it sent nothing useful.
 */
export function imageExt(name: string, mime: string): string | null {
  const byMime = INTAKE_EXT[(mime || '').toLowerCase()];
  if (byMime) return byMime;
  const m = /\.(png|jpe?g|webp|gif)$/i.exec(name || '');
  if (!m) return null;
  const e = m[1].toLowerCase();
  return e === 'jpeg' ? 'jpg' : e;
}

export async function parseUpload(
  env: { AI: Ai; DOCUMENTS?: R2Bucket },
  file: { name: string; type: string; bytes: ArrayBuffer },
): Promise<ParsedUpload> {
  const name = (file.name || 'upload').slice(0, 200);
  const mime = file.type || '';
  if (file.bytes.byteLength > MAX_BYTES) {
    throw new Error(`file too large (${Math.round(file.bytes.byteLength / 1024 / 1024)}MB > 25MB)`);
  }

  if (isTextLike(name, mime)) {
    const raw = new TextDecoder().decode(file.bytes);
    const { text, truncated } = clip(raw);
    return { name, text, chars: raw.length, truncated, via: 'text', kind: 'document' };
  }

  // An image: keep the bytes before parsing, so that even if toMarkdown has
  // nothing useful to say about the picture, her eyes can still reach it.
  // Best-effort — a store failure costs the artifact, never the upload.
  const ext = imageExt(name, mime);
  let stored: string | undefined;
  if (ext && env.DOCUMENTS) {
    try {
      const id = crypto.randomUUID().replace(/-/g, '');
      const key = `intake/${id}.${ext}`;
      await env.DOCUMENTS.put(key, file.bytes, { httpMetadata: { contentType: INTAKE_MIME[ext] } });
      stored = `/${key}`;
    } catch (e) {
      console.error('[UPLOAD] intake store failed:', (e as Error).message);
    }
  }

  // Binary / rich document → Workers AI toMarkdown.
  if (!env.AI) throw new Error('parse unavailable: Workers AI (env.AI) not bound');
  const blob = new Blob([file.bytes], { type: mime || 'application/octet-stream' });
  const res = await env.AI.toMarkdown({ name, blob }) as { format?: string; data?: string; error?: unknown };
  if (!res || res.format !== 'markdown' || typeof res.data !== 'string') {
    // A stored image whose parse failed is still worth returning: the bytes are
    // the point, and she can look at them directly. Only an unstorable,
    // unparseable file is a real failure.
    if (stored) return { name, text: '', chars: 0, truncated: false, via: 'toMarkdown', kind: 'image', stored, mime };
    throw new Error(`could not parse "${name}" (${mime || 'unknown type'})`);
  }
  const { text, truncated } = clip(res.data);
  return {
    name, text, chars: res.data.length, truncated, via: 'toMarkdown',
    kind: ext ? 'image' : 'document',
    ...(stored ? { stored, mime } : {}),
  };
}

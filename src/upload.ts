// ============================================================
// ELLE — FILE UPLOAD / PARSE · src/upload.ts
//
// The chat composer's upload button hands a file here. We turn it into text so
// Elle can read it — and, on your instruction, ingest_paper it (chunk → embed →
// vectorize) through the existing corpus pipeline. Nothing is stored here; the
// text is returned to the caller, which attaches it to the next turn.
//
// Parsing is server-side and format-agnostic via Workers AI toMarkdown()
// (env.AI.toMarkdown): PDF, DOCX, XLSX, images, HTML, … all become markdown in
// one path. Plain text / markdown / obvious source files are decoded directly —
// no need to round-trip them through the converter.
// ============================================================

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
}

function clip(s: string): { text: string; truncated: boolean } {
  if (s.length <= MAX_TEXT) return { text: s, truncated: false };
  return { text: s.slice(0, MAX_TEXT), truncated: true };
}

// Decide if a file should be read as plain text (by extension or mime).
export function isTextLike(name: string, mime: string): boolean {
  return TEXT_EXT.test(name) || TEXT_MIME.test(mime || '');
}

export async function parseUpload(
  env: { AI: Ai },
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
    return { name, text, chars: raw.length, truncated, via: 'text' };
  }

  // Binary / rich document → Workers AI toMarkdown.
  if (!env.AI) throw new Error('parse unavailable: Workers AI (env.AI) not bound');
  const blob = new Blob([file.bytes], { type: mime || 'application/octet-stream' });
  const res = await env.AI.toMarkdown({ name, blob }) as { format?: string; data?: string; error?: unknown };
  if (!res || res.format !== 'markdown' || typeof res.data !== 'string') {
    throw new Error(`could not parse "${name}" (${mime || 'unknown type'})`);
  }
  const { text, truncated } = clip(res.data);
  return { name, text, chars: res.data.length, truncated, via: 'toMarkdown' };
}

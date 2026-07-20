// ============================================================
// MULTIMODAL INTAKE — src/multimodal-intake.ts
//
// The corpus door only speaks text: /api/ingest → chunk → bge-large (a TEXT
// embedder) → Vectorize. So an image-only document (a NotebookLM slide deck, a
// scanned page, a whiteboard photo) or a video has nothing the door can eat.
// This module is the worker-side eye that fixes that: it turns pixels and audio
// into TEXT, then hands that text to the SAME ingest pipeline — one vector
// space, one retrieval path, no second brain.
//
// Deliberately worker-side (the operator's call): the encoding runs on Workers
// AI (vision + whisper), so the worker can ingest a deck without the laptop
// online. That is a real cost tradeoff — the "eye" now sits on the substrate
// and bills Workers AI per image/clip — made on purpose. The memory lane
// (mem-intake.ts) keeps its sovereign local-encode option; this is the
// autonomous corpus lane beside it, not a replacement.
//
// What a pure Worker CAN and CANNOT do, stated honestly:
//   • CAN: describe/OCR an image (vision model), transcribe an audio track
//     (whisper). Both are single Workers AI calls over bytes.
//   • CANNOT: demux a video container (.mp4/.mov) into frames + audio — that
//     needs ffmpeg, which does not run in a Worker. So "video" here means the
//     caller supplies the keyframes (as image parts) and the audio track (as
//     an audio part); this module transcribes and assembles them in order.
//     Frame/audio extraction is the caller's job (the workbench, or an upload
//     step), NOT this module's — and we say so rather than pretend otherwise.
//
// SHAPE: pure parse/validate/assemble (unit-tested, no I/O) + a thin impure
// edge (transcribeImage/transcribeAudio) that takes an INJECTED AI runner, so
// the whole dispatch is testable with a mock and the real Workers AI binding
// is the only thing not covered by unit tests.
// ============================================================

// The Workers AI models, overridable per request. Vision defaults to the
// instruct-tuned multimodal model (good at dense OCR + description); audio to
// whisper. Both are @cf/* Workers AI model ids.
export const DEFAULT_VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
export const DEFAULT_AUDIO_MODEL = '@cf/openai/whisper';

// The default vision instruction: transcribe first (verbatim, the load-bearing
// signal for a text-in-images deck), then briefly describe non-text visual
// structure so a diagram is not lost. Overridable per request.
export const DEFAULT_VISION_PROMPT =
  'Transcribe ALL text visible in this image verbatim, preserving reading order and structure ' +
  '(titles, headings, body, captions, labels). Then, in one short paragraph prefixed "VISUAL:", ' +
  'describe any non-text visual structure that carries meaning (diagrams, charts, layout, arrows). ' +
  'Do not invent text that is not present; if a region is unreadable, write [unreadable].';

// The injected AI runner — env.AI.run's shape, narrowed. Kept as its own type
// so callers pass env.AI.run.bind(env.AI) and tests pass a mock.
export type AIRun = (model: string, inputs: Record<string, unknown>) => Promise<unknown>;

// One piece of media to encode. Exactly one of b64 / r2Key supplies the bytes.
// `label` orders and names it in the assembled document (e.g. "slide 3",
// "frame 00:12", "audio"). `kind` picks the encoder.
export interface MediaPart {
  kind: 'image' | 'audio';
  b64?: string;   // base64 (data: URL prefix tolerated)
  r2Key?: string; // key into the DOCUMENTS bucket (pulled at encode time)
  label?: string;
}

export interface ParsedMultimodal {
  error?: string;
  doc?: {
    title: string;
    series: string;
    tag: string;
    abstract?: string;
    source_url?: string;
    parts: MediaPart[];
    visionModel: string;
    audioModel: string;
    visionPrompt: string;
    trusted: boolean; // pass-through to the ingest gate (skip_verification)
  };
}

const MAX_PARTS = 64; // a long deck, bounded — one Workers AI call per part

// Pure: request body → validated intake spec, or a precise { error }. No I/O.
// Mirrors mem-intake's posture: a malformed request is a specific 400, never a
// silent coercion into a plausible-looking ingest.
export function parseMultimodalIntake(body: unknown): ParsedMultimodal {
  const b = (body || {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const title = str(b.title);
  const series = str(b.series);
  const tag = str(b.tag);
  if (!title) return { error: 'title (non-empty string) is required' };
  if (!series) return { error: 'series (non-empty string) is required' };
  if (!tag) return { error: 'tag (non-empty string) is required' };

  const rawParts = Array.isArray(b.parts) ? b.parts : [];
  if (!rawParts.length) return { error: 'parts (non-empty array of {kind, b64|r2Key}) is required' };
  if (rawParts.length > MAX_PARTS) return { error: `too many parts (${rawParts.length}); max ${MAX_PARTS}` };

  const parts: MediaPart[] = [];
  for (let i = 0; i < rawParts.length; i++) {
    const p = (rawParts[i] || {}) as Record<string, unknown>;
    const kind = p.kind;
    if (kind !== 'image' && kind !== 'audio')
      return { error: `parts[${i}].kind must be 'image' or 'audio'` };
    const b64 = str(p.b64);
    const r2Key = str(p.r2Key);
    if (!b64 && !r2Key) return { error: `parts[${i}] needs b64 or r2Key` };
    if (b64 && r2Key) return { error: `parts[${i}] has both b64 and r2Key — supply exactly one` };
    parts.push({ kind, b64: b64 || undefined, r2Key: r2Key || undefined, label: str(p.label) || undefined });
  }

  return {
    doc: {
      title, series, tag,
      abstract: str(b.abstract) || undefined,
      source_url: str(b.source_url) || undefined,
      parts,
      visionModel: str(b.vision_model) || DEFAULT_VISION_MODEL,
      audioModel: str(b.audio_model) || DEFAULT_AUDIO_MODEL,
      visionPrompt: str(b.vision_prompt) || DEFAULT_VISION_PROMPT,
      trusted: b.skip_verification === true || b.trusted === true,
    },
  };
}

// Pure: base64 (with or without a data: URL prefix) → bytes. Throws on invalid
// input so a bad part fails loudly at its own boundary. Uses atob (Workers global).
export function decodeBase64(b64: string): Uint8Array {
  const comma = b64.indexOf(',');
  const raw = b64.startsWith('data:') && comma !== -1 ? b64.slice(comma + 1) : b64;
  const clean = raw.replace(/\s+/g, '');
  const bin = atob(clean); // throws on malformed base64
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Pull a part's bytes from its b64 or from the DOCUMENTS R2 bucket.
export async function partBytes(
  part: MediaPart,
  getFromR2: (key: string) => Promise<ArrayBuffer | null>,
): Promise<Uint8Array> {
  if (part.b64) return decodeBase64(part.b64);
  if (part.r2Key) {
    const buf = await getFromR2(part.r2Key);
    if (!buf) throw new Error(`r2Key not found: ${part.r2Key}`);
    return new Uint8Array(buf);
  }
  throw new Error('part has neither b64 nor r2Key'); // parse guarantees one; defensive
}

// Impure edge — one Workers AI vision call. Reads the model's text field
// defensively (different vision models name it response/description/text).
export async function transcribeImage(run: AIRun, model: string, prompt: string, bytes: Uint8Array): Promise<string> {
  const res = (await run(model, { image: Array.from(bytes), prompt, max_tokens: 2048 })) as Record<string, unknown>;
  const text = (res?.response ?? res?.description ?? res?.text ?? '') as string;
  return String(text).trim();
}

// Impure edge — one Workers AI whisper call.
export async function transcribeAudio(run: AIRun, model: string, bytes: Uint8Array): Promise<string> {
  const res = (await run(model, { audio: Array.from(bytes) })) as Record<string, unknown>;
  return String((res?.text ?? '') as string).trim();
}

export interface PartTranscript {
  index: number;
  kind: MediaPart['kind'];
  label: string;
  text: string;
  error?: string;
}

// Encode every part to text. Fail-soft PER PART: one unreadable image or a
// whisper hiccup records an error on that part and leaves the rest — a 63-slide
// deck must not lose everything to one bad slide. Order is preserved.
export async function encodeParts(
  parts: MediaPart[],
  opts: { run: AIRun; visionModel: string; audioModel: string; visionPrompt: string; getFromR2: (key: string) => Promise<ArrayBuffer | null> },
): Promise<PartTranscript[]> {
  const out: PartTranscript[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const label = p.label || `${p.kind} ${i + 1}`;
    try {
      const bytes = await partBytes(p, opts.getFromR2);
      const text = p.kind === 'image'
        ? await transcribeImage(opts.run, opts.visionModel, opts.visionPrompt, bytes)
        : await transcribeAudio(opts.run, opts.audioModel, bytes);
      out.push({ index: i, kind: p.kind, label, text });
    } catch (e) {
      out.push({ index: i, kind: p.kind, label, text: '', error: String((e as Error)?.message || e).slice(0, 300) });
    }
  }
  return out;
}

// Pure: assemble the per-part transcripts into one document, with a provenance
// header (so the corpus can never mistake a machine transcription for a
// primary text) and a marker per part. Deterministic; unit-tested.
export function assembleDocument(title: string, transcripts: PartTranscript[], visionModel: string, audioModel: string): string {
  const models = Array.from(new Set(transcripts.map(t => (t.kind === 'image' ? visionModel : audioModel)))).join(', ');
  const header =
    `# ${title}\n\n` +
    `_Machine transcription — this document was produced by transcribing ${transcripts.length} media part(s) ` +
    `(${models}) at ingest time. It is a derived text, not a primary source: treat OCR/ASR errors as possible ` +
    `and weight it accordingly. Provenance is per-part below._\n`;
  const body = transcripts.map(t => {
    const head = `\n\n## [${t.kind}] ${t.label}\n`;
    if (t.error) return `${head}\n_[transcription failed: ${t.error}]_`;
    if (!t.text) return `${head}\n_[no text extracted]_`;
    return `${head}\n${t.text}`;
  }).join('');
  return header + body + '\n';
}

// Count what actually carried text — the caller decides whether an all-empty
// encode is worth ingesting (usually not).
export function transcriptStats(transcripts: PartTranscript[]): { parts: number; withText: number; failed: number; chars: number } {
  let withText = 0, failed = 0, chars = 0;
  for (const t of transcripts) {
    if (t.error) failed++;
    if (t.text) { withText++; chars += t.text.length; }
  }
  return { parts: transcripts.length, withText, failed, chars };
}

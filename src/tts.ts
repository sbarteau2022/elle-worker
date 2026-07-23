// ============================================================
// TTS — src/tts.ts  ·  Elle's own voice, server-side
//
// The atlas chat speaks with the visitor's random OS voice (Web Speech API).
// This gives her ONE voice everywhere: a Workers AI text-to-speech call that
// returns audio the browser just plays. The page keeps the browser-speech
// path as a fallback, so a TTS hiccup (or the rate limit) degrades to the old
// behavior rather than going silent.
//
// Worker-side and public (the atlas is public): the /api/tts route in index.ts
// gates it with the same IP rate-limit as /api/widget-chat. Billed per call on
// Workers AI, so the cap and the browser fallback both matter.
//
// SHAPE (house style): pure parse/validate + a thin impure edge over an
// INJECTED runner, so the contract is unit-tested with a mock and only the
// real AI binding is uncovered.
// ============================================================

// Workers AI's text-to-speech model. MeloTTS: { prompt, lang } → { audio: b64 mp3 }.
export const TTS_MODEL = '@cf/myshell-ai/melotts';
export const MAX_TTS_CHARS = 1500; // one narration step / answer; TTS is billed per call

// MeloTTS language codes. Default English; anything unknown falls back to EN.
const LANGS = new Set(['EN', 'ES', 'FR', 'ZH', 'JP', 'KR']);

export interface ParsedTTS {
  error?: string;
  text?: string;
  lang?: string;
}

// Pure: request body → validated { text, lang }, or a precise { error }.
export function parseTTS(body: unknown): ParsedTTS {
  const b = (body || {}) as Record<string, unknown>;
  let text = typeof b.text === 'string' ? b.text.replace(/\s+/g, ' ').trim() : '';
  if (!text) return { error: 'text (non-empty string) is required' };
  text = text.slice(0, MAX_TTS_CHARS);
  const raw = typeof b.lang === 'string' ? b.lang.toUpperCase() : '';
  const lang = LANGS.has(raw) ? raw : 'EN';
  return { text, lang };
}

// The injected AI runner — env.AI.run's shape, narrowed (tests pass a mock).
export type TTSRun = (model: string, inputs: Record<string, unknown>) => Promise<unknown>;

// Impure edge — one Workers AI TTS call. Returns base64 mp3 (the model's
// `audio` field). Throws on a shape the model shouldn't return, so the caller
// can fall back to browser speech rather than serve a broken response.
export async function synthesizeSpeech(run: TTSRun, text: string, lang: string): Promise<string> {
  const res = (await run(TTS_MODEL, { prompt: text, lang })) as Record<string, unknown>;
  const audio = res?.audio;
  if (typeof audio !== 'string' || !audio) throw new Error('tts: model returned no audio');
  return audio;
}

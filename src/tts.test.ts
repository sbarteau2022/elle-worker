// Pure + injected-runner tests for the TTS lane. No network, no AI binding.
import { describe, it, expect } from 'vitest';
import { parseTTS, synthesizeSpeech, TTS_MODEL, MAX_TTS_CHARS, type TTSRun } from './tts';

describe('tts · parseTTS', () => {
  it('requires non-empty text', () => {
    expect(parseTTS({}).error).toMatch(/text/);
    expect(parseTTS({ text: '   ' }).error).toMatch(/text/);
  });
  it('collapses whitespace and caps length', () => {
    const r = parseTTS({ text: 'a'.repeat(MAX_TTS_CHARS + 500) });
    expect(r.text!.length).toBe(MAX_TTS_CHARS);
    expect(parseTTS({ text: '  hello   world \n ' }).text).toBe('hello world');
  });
  it('defaults lang to EN and validates known codes', () => {
    expect(parseTTS({ text: 'hi' }).lang).toBe('EN');
    expect(parseTTS({ text: 'hi', lang: 'fr' }).lang).toBe('FR');
    expect(parseTTS({ text: 'hi', lang: 'xx' }).lang).toBe('EN'); // unknown → EN
  });
});

describe('tts · synthesizeSpeech (mock runner)', () => {
  it('calls the TTS model with prompt+lang and returns the base64 audio', async () => {
    let seen: { model?: string; inputs?: Record<string, unknown> } = {};
    const run: TTSRun = async (model, inputs) => {
      seen = { model, inputs };
      return { audio: 'BASE64AUDIO' };
    };
    const out = await synthesizeSpeech(run, 'hello there', 'EN');
    expect(out).toBe('BASE64AUDIO');
    expect(seen.model).toBe(TTS_MODEL);
    expect(seen.inputs).toEqual({ prompt: 'hello there', lang: 'EN' });
  });
  it('throws when the model returns no audio — so the caller can fall back', async () => {
    const run: TTSRun = async () => ({});
    await expect(synthesizeSpeech(run, 'x', 'EN')).rejects.toThrow(/no audio/);
  });
});

// Pure-logic + injected-runner tests for the worker-side multimodal intake.
// No network, no Workers AI binding: the vision/whisper calls run through a
// mock AIRun, so the whole parse → encode → assemble dispatch is covered.
import { describe, it, expect } from 'vitest';
import {
  parseMultimodalIntake, decodeBase64, encodeParts, assembleDocument,
  transcriptStats, transcribeImage, transcribeAudio,
  DEFAULT_VISION_MODEL, DEFAULT_AUDIO_MODEL,
  type AIRun, type MediaPart,
} from './multimodal-intake';

const b64 = (s: string) => btoa(s);

describe('multimodal-intake · parse/validate', () => {
  it('requires title, series, tag', () => {
    expect(parseMultimodalIntake({}).error).toMatch(/title/);
    expect(parseMultimodalIntake({ title: 'T' }).error).toMatch(/series/);
    expect(parseMultimodalIntake({ title: 'T', series: 's' }).error).toMatch(/tag/);
  });
  it('requires a non-empty parts array', () => {
    expect(parseMultimodalIntake({ title: 'T', series: 's', tag: 'g' }).error).toMatch(/parts/);
    expect(parseMultimodalIntake({ title: 'T', series: 's', tag: 'g', parts: [] }).error).toMatch(/parts/);
  });
  it('rejects a part without kind, or with neither/both of b64 and r2Key', () => {
    const base = { title: 'T', series: 's', tag: 'g' };
    expect(parseMultimodalIntake({ ...base, parts: [{ b64: 'x' }] }).error).toMatch(/kind/);
    expect(parseMultimodalIntake({ ...base, parts: [{ kind: 'image' }] }).error).toMatch(/b64 or r2Key/);
    expect(parseMultimodalIntake({ ...base, parts: [{ kind: 'image', b64: 'x', r2Key: 'k' }] }).error).toMatch(/exactly one/);
  });
  it('accepts a valid image+audio spec and fills model/prompt defaults', () => {
    const r = parseMultimodalIntake({
      title: 'Deck', series: 'canon', tag: 'canon-deck',
      parts: [{ kind: 'image', b64: 'x', label: 'slide 1' }, { kind: 'audio', r2Key: 'clips/a.mp3' }],
    });
    expect(r.error).toBeUndefined();
    expect(r.doc!.parts).toHaveLength(2);
    expect(r.doc!.visionModel).toBe(DEFAULT_VISION_MODEL);
    expect(r.doc!.audioModel).toBe(DEFAULT_AUDIO_MODEL);
    expect(r.doc!.visionPrompt).toMatch(/Transcribe/);
    expect(r.doc!.trusted).toBe(false);
  });
  it('honors model/prompt overrides and the trusted flag', () => {
    const r = parseMultimodalIntake({
      title: 'T', series: 's', tag: 'g', parts: [{ kind: 'image', b64: 'x' }],
      vision_model: '@cf/custom/vision', audio_model: '@cf/custom/asr', vision_prompt: 'just OCR', skip_verification: true,
    });
    expect(r.doc!.visionModel).toBe('@cf/custom/vision');
    expect(r.doc!.audioModel).toBe('@cf/custom/asr');
    expect(r.doc!.visionPrompt).toBe('just OCR');
    expect(r.doc!.trusted).toBe(true);
  });
  it('caps the number of parts', () => {
    const parts = Array.from({ length: 65 }, () => ({ kind: 'image', b64: 'x' }));
    expect(parseMultimodalIntake({ title: 'T', series: 's', tag: 'g', parts }).error).toMatch(/too many/);
  });
});

describe('multimodal-intake · decodeBase64', () => {
  it('round-trips plain base64 to bytes', () => {
    const bytes = decodeBase64(b64('hello'));
    expect(new TextDecoder().decode(bytes)).toBe('hello');
  });
  it('tolerates a data: URL prefix', () => {
    const bytes = decodeBase64('data:image/png;base64,' + b64('PNG'));
    expect(new TextDecoder().decode(bytes)).toBe('PNG');
  });
});

describe('multimodal-intake · transcribe (mock runner reads the right fields)', () => {
  it('image reads response ?? description ?? text and passes image bytes + prompt', async () => {
    const seen: Record<string, unknown>[] = [];
    const run: AIRun = async (_m, inp) => { seen.push(inp); return { response: 'TITLE\nbody' }; };
    const txt = await transcribeImage(run, DEFAULT_VISION_MODEL, 'do ocr', new Uint8Array([1, 2, 3]));
    expect(txt).toBe('TITLE\nbody');
    expect(Array.isArray(seen[0].image)).toBe(true);
    expect(seen[0].prompt).toBe('do ocr');
  });
  it('image falls back to description when response is absent', async () => {
    const run: AIRun = async () => ({ description: 'a chart' });
    expect(await transcribeImage(run, 'm', 'p', new Uint8Array([0]))).toBe('a chart');
  });
  it('audio reads text and passes audio bytes', async () => {
    let got: Record<string, unknown> = {};
    const run: AIRun = async (_m, inp) => { got = inp; return { text: 'spoken words' }; };
    expect(await transcribeAudio(run, DEFAULT_AUDIO_MODEL, new Uint8Array([9, 9]))).toBe('spoken words');
    expect(Array.isArray(got.audio)).toBe(true);
  });
});

describe('multimodal-intake · encodeParts (fail-soft per part, order preserved)', () => {
  const run: AIRun = async (model, inp) => {
    if (String(model).includes('whisper') || 'audio' in inp) return { text: 'AUDIO_OK' };
    return { response: 'IMG_OK' };
  };
  const getFromR2 = async () => null;

  it('encodes each part in order with the right encoder', async () => {
    const parts: MediaPart[] = [
      { kind: 'image', b64: b64('a'), label: 'slide 1' },
      { kind: 'audio', b64: b64('b') },
    ];
    const t = await encodeParts(parts, { run, visionModel: DEFAULT_VISION_MODEL, audioModel: DEFAULT_AUDIO_MODEL, visionPrompt: 'p', getFromR2 });
    expect(t.map(x => x.text)).toEqual(['IMG_OK', 'AUDIO_OK']);
    expect(t[0].label).toBe('slide 1');
    expect(t[1].label).toBe('audio 2'); // default label
  });

  it('a bad part records an error and does not sink the rest', async () => {
    const parts: MediaPart[] = [
      { kind: 'image', r2Key: 'missing/key' }, // getFromR2 returns null → throws → per-part error
      { kind: 'image', b64: b64('ok') },
    ];
    const t = await encodeParts(parts, { run, visionModel: 'm', audioModel: 'm', visionPrompt: 'p', getFromR2 });
    expect(t[0].error).toMatch(/r2Key not found/);
    expect(t[0].text).toBe('');
    expect(t[1].text).toBe('IMG_OK');
  });
});

describe('multimodal-intake · assembleDocument + stats', () => {
  const transcripts = [
    { index: 0, kind: 'image' as const, label: 'slide 1', text: 'The Title\nVISUAL: rings' },
    { index: 1, kind: 'image' as const, label: 'slide 2', text: '', error: 'unreadable' },
    { index: 2, kind: 'audio' as const, label: 'narration', text: 'spoken words' },
  ];

  it('emits a provenance header naming it a machine transcription, plus a marker per part', () => {
    const doc = assembleDocument('My Deck', transcripts, DEFAULT_VISION_MODEL, DEFAULT_AUDIO_MODEL);
    expect(doc).toMatch(/^# My Deck/);
    expect(doc).toMatch(/Machine transcription/);
    expect(doc).toContain('## [image] slide 1');
    expect(doc).toContain('## [image] slide 2');
    expect(doc).toContain('## [audio] narration');
    expect(doc).toContain('transcription failed: unreadable');
    expect(doc).toContain('spoken words');
  });

  it('transcriptStats counts text-bearing, failed, and chars', () => {
    const s = transcriptStats(transcripts);
    expect(s.parts).toBe(3);
    expect(s.withText).toBe(2);
    expect(s.failed).toBe(1);
    expect(s.chars).toBeGreaterThan(0);
  });

  it('an all-failed encode yields withText 0 — the handler signal to refuse ingest', () => {
    const s = transcriptStats([{ index: 0, kind: 'image', label: 'x', text: '', error: 'e' }]);
    expect(s.withText).toBe(0);
  });
});

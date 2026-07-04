import { describe, it, expect } from 'vitest';
import { normalizeTitle, structuralReason, MIN_WORDS } from './ingest-gate';
import { resolveVoice, isVoiceId, VOICE_LIST, VOICES, ELLE_VOICE } from './mind';

// Varied, prose-like text: distinct words dominate (ratio well above the gate's
// 0.15 floor), mostly letters, comfortably over the word minimum.
const prose = (n: number) =>
  Array.from({ length: n }, (_, i) => `notion${i} contends that reason${i} follows plainly`).join(' ');

describe('ingest gate — structural check', () => {
  const ok = { title: 'A Real Paper', text: prose(120), series: 'observer', tag: 'phi' };

  it('passes a well-formed paper', () => {
    expect(structuralReason(ok)).toBeNull();
  });
  it('rejects a short title', () => {
    expect(structuralReason({ ...ok, title: 'ab' })).toMatch(/title/);
  });
  it('requires series and tag', () => {
    expect(structuralReason({ ...ok, series: '' })).toMatch(/series and tag/);
    expect(structuralReason({ ...ok, tag: '' })).toMatch(/series and tag/);
  });
  it(`rejects a body under ${MIN_WORDS} words`, () => {
    expect(structuralReason({ ...ok, text: 'too short to be real' })).toMatch(/too short/);
  });
  it('rejects non-prose (mostly symbols)', () => {
    expect(structuralReason({ ...ok, text: '@@@ '.repeat(80) })).toMatch(/prose|too repetitive/);
  });
  it('rejects a pathologically repetitive body', () => {
    expect(structuralReason({ ...ok, text: 'spam '.repeat(200) })).toMatch(/repetitive/);
  });
});

describe('ingest gate — title normalization (dedup key)', () => {
  it('collapses case, punctuation, and whitespace', () => {
    expect(normalizeTitle('The  Proof, Revisited!')).toBe('the proof revisited');
    expect(normalizeTitle('the proof revisited')).toBe('the proof revisited');
    expect(normalizeTitle('')).toBe('');
  });
});

describe('prose registers', () => {
  it('has six distinct registers, stewart default = ELLE_VOICE', () => {
    expect(VOICE_LIST).toHaveLength(6);
    expect(VOICES.stewart.prose).toBe(ELLE_VOICE);
    expect(resolveVoice('stewart')).toBe(ELLE_VOICE);
  });
  it('includes the Screwtape adversarial register', () => {
    expect(isVoiceId('screwtape')).toBe(true);
    expect(resolveVoice('screwtape')).toMatch(/adversarial|War Room|Screwtape/i);
  });
  it('resolves each id to a non-empty, distinct prose', () => {
    const proses = VOICE_LIST.map(v => resolveVoice(v.id));
    expect(new Set(proses).size).toBe(6);
    for (const p of proses) expect(p.length).toBeGreaterThan(200);
  });
  it('falls back to the canonical self on a bad/missing id', () => {
    expect(resolveVoice('nonsense')).toBe(ELLE_VOICE);
    expect(resolveVoice(undefined)).toBe(ELLE_VOICE);
    expect(isVoiceId('einstein')).toBe(true);
    expect(isVoiceId('nope')).toBe(false);
  });
});

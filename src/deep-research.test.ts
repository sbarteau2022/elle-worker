import { describe, it, expect, vi } from 'vitest';
import { deepResearch, parseNextQuery, clipText } from './deep-research';
import type { Env } from './index';

describe('parseNextQuery', () => {
  it('treats DONE (any case, trailing period) as "no more gaps"', () => {
    expect(parseNextQuery('DONE')).toBeNull();
    expect(parseNextQuery('done.')).toBeNull();
    expect(parseNextQuery('  Done  ')).toBeNull();
  });

  it('treats empty output as done rather than an empty search query', () => {
    expect(parseNextQuery('')).toBeNull();
    expect(parseNextQuery('   ')).toBeNull();
  });

  it('strips surrounding quotes and whitespace off a real query', () => {
    expect(parseNextQuery('"who funded the study"')).toBe('who funded the study');
    expect(parseNextQuery("  who funded it  ")).toBe('who funded it');
  });

  it('clips an absurdly long reply rather than passing it straight to search', () => {
    const long = 'x'.repeat(500);
    const out = parseNextQuery(long);
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(201); // 200 + the ellipsis char
  });
});

describe('clipText', () => {
  it('passes short text through unchanged', () => {
    expect(clipText('hello', 10)).toBe('hello');
  });
  it('truncates and marks long text', () => {
    const out = clipText('abcdefghij', 5);
    expect(out.startsWith('abcde')).toBe(true);
    expect(out.length).toBe(6); // 5 chars + the ellipsis marker
  });
});

describe('deepResearch — single round (no env-dependent code touched)', () => {
  const env = {} as Env;

  it('refuses an empty topic without calling search at all', async () => {
    const search = vi.fn();
    const out = await deepResearch(env, '', search, 1);
    expect(out).toMatch(/topic required/);
    expect(search).not.toHaveBeenCalled();
  });

  it('returns the raw search content + sources when maxRounds=1', async () => {
    const search = vi.fn(async (q: string) => ({
      content: `findings about ${q}`,
      search_results: 'https://example.com/a',
    }));
    const out = await deepResearch(env, 'quantum foo', search, 1);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('quantum foo');
    expect(out).toContain('findings about quantum foo');
    expect(out).toContain('SOURCES:');
    expect(out).toContain('https://example.com/a');
    // single round never synthesizes a multi-round dossier framing
    expect(out).not.toMatch(/\[deep research —/);
  });

  it('folds a search failure into the round instead of throwing', async () => {
    const search = vi.fn(async () => { throw new Error('network down'); });
    const out = await deepResearch(env, 'anything', search, 1);
    expect(out).toContain('search failed: network down');
  });

  it('missing sources renders as "(none)" rather than "undefined"', async () => {
    const search = vi.fn(async () => ({ content: 'stuff' }));
    const out = await deepResearch(env, 'topic', search, 1);
    expect(out).toContain('SOURCES:\n(none)');
  });
});

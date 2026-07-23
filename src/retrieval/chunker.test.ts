import { describe, it, expect } from 'vitest';
import { chunkDocument, estimateTokens } from './chunker';

describe('estimateTokens', () => {
  it('counts whitespace-delimited words', () => {
    expect(estimateTokens('the quick brown fox')).toBe(4);
  });

  it('returns 0 for empty/whitespace-only text', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('   \n\t  ')).toBe(0);
  });
});

describe('chunkDocument', () => {
  it('returns a single chunk for text shorter than the target', () => {
    const chunks = chunkDocument('one two three four five', { targetTokens: 320 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ text: 'one two three four five', index: 0, tokenCount: 5 });
  });

  it('returns an empty array for empty text', () => {
    expect(chunkDocument('')).toEqual([]);
    expect(chunkDocument('   ')).toEqual([]);
  });

  it('splits long text into overlapping windows and makes forward progress', () => {
    const words = Array.from({ length: 1000 }, (_, i) => `w${i}`);
    const chunks = chunkDocument(words.join(' '), { targetTokens: 100, overlapRatio: 0.15 });

    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach(c => expect(c.tokenCount).toBeLessThanOrEqual(100));
    // indices are sequential starting at 0
    expect(chunks.map(c => c.index)).toEqual(chunks.map((_, i) => i));
    // last chunk reaches the end of the document
    expect(chunks[chunks.length - 1].text.endsWith('w999')).toBe(true);
    // consecutive chunks overlap: the tail of one appears at the head of the next
    const firstWords = chunks[0].text.split(' ');
    const secondWords = chunks[1].text.split(' ');
    expect(secondWords[0]).toBe(firstWords[firstWords.length - 15]);
  });

  it('rejects a non-positive targetTokens or an overlapRatio outside [0,1)', () => {
    expect(() => chunkDocument('a b c', { targetTokens: 0 })).toThrow();
    expect(() => chunkDocument('a b c', { overlapRatio: 1 })).toThrow();
    expect(() => chunkDocument('a b c', { overlapRatio: -0.1 })).toThrow();
  });
});

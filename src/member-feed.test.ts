import { describe, it, expect } from 'vitest';
import { assistantText, toMs, mergeFeed, type FeedItem } from './member-feed';

describe('assistantText', () => {
  it('recovers her answer from the persisted Q+A pair', () => {
    expect(assistantText('Q: what is κ?\nA: A coherence measure over my output.'))
      .toBe('A coherence measure over my output.');
  });

  it('keeps multi-line answers whole and leaves non-pair content untouched', () => {
    expect(assistantText('Q: hi\nA: line one\nline two')).toBe('line one\nline two');
    expect(assistantText('plain assistant text')).toBe('plain assistant text');
    expect(assistantText('')).toBe('');
  });
});

describe('toMs', () => {
  it('passes epoch ms through and promotes epoch seconds', () => {
    expect(toMs(1751900000000)).toBe(1751900000000);
    expect(toMs(1751900000)).toBe(1751900000000);
  });

  it('parses SQLite datetime text as UTC and sinks garbage to 0', () => {
    expect(toMs('2026-07-07 12:00:00')).toBe(Date.parse('2026-07-07T12:00:00Z'));
    expect(toMs('not a date')).toBe(0);
    expect(toMs(null)).toBe(0);
  });
});

describe('mergeFeed', () => {
  const items: FeedItem[] = [
    { kind: 'journal', title: '', body: 'a', at: 300 },
    { kind: 'dream',   title: 'd', body: 'b', at: 100 },
    { kind: 'watch',   title: 'w', body: 'c', at: 200 },
  ];

  it('sorts newest first and respects the limit', () => {
    const out = mergeFeed(items, 2);
    expect(out.map(i => i.at)).toEqual([300, 200]);
  });

  it('pages with before (strictly older) and clamps a wild limit', () => {
    expect(mergeFeed(items, 10, 300).map(i => i.at)).toEqual([200, 100]);
    expect(mergeFeed(items, 1000, undefined)).toHaveLength(3);
  });
});

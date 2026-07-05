// Pure-logic tests for the self-tools: oracle calibration, scar matching,
// dead-drop tripwires, watch due-selection. No network, no D1 — the same
// discipline as the other suites.
import { describe, it, expect } from 'vitest';
import { calibrationBuckets } from './oracle';
import { scarMatches } from './scars';
import { cosineSim, keywordHit, DROP_THRESHOLD } from './dead-drop';
import { dueWatches } from './watches';

describe('oracle · calibrationBuckets', () => {
  it('separates stated confidence from observed hit rate per bucket', () => {
    const rows = [
      { confidence: 0.9, status: 'true' },
      { confidence: 0.9, status: 'false' },
      { confidence: 0.85, status: 'false' },
      { confidence: 0.85, status: 'false' },
      { confidence: 0.3, status: 'true' },
    ];
    const buckets = calibrationBuckets(rows);
    const high = buckets.find(b => b.bucket === '80–100%');
    expect(high).toBeDefined();
    expect(high!.n).toBe(4);
    expect(high!.observed).toBe(0.25);          // 1 of 4 — overconfident
    expect(high!.stated).toBeGreaterThan(0.8);
    const low = buckets.find(b => b.bucket === '20–40%');
    expect(low!.observed).toBe(1);              // sandbagging
  });

  it('ignores open and void predictions', () => {
    const buckets = calibrationBuckets([
      { confidence: 0.7, status: 'open' },
      { confidence: 0.7, status: 'void' },
    ]);
    expect(buckets).toEqual([]);
  });
});

describe('scars · scarMatches', () => {
  const scar = { tool: 'read_sql', pattern: 'elle_trades' };
  it('fires on a matching tool + args substring, case-insensitive', () => {
    expect(scarMatches(scar, 'read_sql', '{"sql":"SELECT * FROM ELLE_TRADES"}')).toBe(true);
  });
  it('stays quiet on a different tool', () => {
    expect(scarMatches(scar, 'web_search', '{"q":"elle_trades"}')).toBe(false);
  });
  it('a tool-less scar applies to any tool', () => {
    expect(scarMatches({ tool: null, pattern: 'drop table' }, 'read_sql', '{"sql":"drop table x"}')).toBe(true);
  });
  it('an empty pattern never fires', () => {
    expect(scarMatches({ tool: null, pattern: '  ' }, 'calc', '{"expression":"1+1"}')).toBe(false);
  });
});

describe('dead-drop · tripwires', () => {
  it('cosine of identical vectors is 1, orthogonal is 0', () => {
    expect(cosineSim([1, 0, 2], [1, 0, 2])).toBeCloseTo(1);
    expect(cosineSim([1, 0], [0, 1])).toBe(0);
  });
  it('mismatched or empty vectors read as 0, never throw', () => {
    expect(cosineSim([], [1, 2])).toBe(0);
    expect(cosineSim([1, 2, 3], [1, 2])).toBe(0);
  });
  it('threshold is a real fraction', () => {
    expect(DROP_THRESHOLD).toBeGreaterThan(0);
    expect(DROP_THRESHOLD).toBeLessThan(1);
  });
  it('keyword tripwire needs every significant trigger word in the question', () => {
    expect(keywordHit('the alpaca sandbox', 'is the ALPACA sandbox still dormant?')).toBe(true);
    expect(keywordHit('the alpaca sandbox', 'is the sandbox still dormant?')).toBe(false);
  });
  it('long triggers defer to the semantic path (no keyword fire)', () => {
    const long = 'when stewart next asks about the trading account balance history export feature';
    expect(keywordHit(long, long)).toBe(false);
  });
});

describe('watches · dueWatches', () => {
  const now = 100 * 60 * 1000; // 100 min
  it('picks armed, never-checked watches first, capped', () => {
    const ws = [
      { id: 'a', status: 'armed', last_checked: null },
      { id: 'b', status: 'armed', last_checked: null },
      { id: 'c', status: 'armed', last_checked: null },
      { id: 'p', status: 'paused', last_checked: null },
    ] as any[];
    const due = dueWatches(ws, now, 2);
    expect(due.map((w: any) => w.id)).toEqual(['a', 'b']);
  });
  it('skips a watch checked within the interval, oldest-checked runs first', () => {
    const ws = [
      { id: 'fresh', status: 'armed', last_checked: now - 5 * 60 * 1000 },
      { id: 'stale2', status: 'armed', last_checked: now - 60 * 60 * 1000 },
      { id: 'stale1', status: 'armed', last_checked: now - 90 * 60 * 1000 },
    ] as any[];
    const due = dueWatches(ws, now, 5);
    expect(due.map((w: any) => w.id)).toEqual(['stale1', 'stale2']);
  });
});

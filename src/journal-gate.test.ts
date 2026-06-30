// Tests for the Optimus journal overlap gate (Fix 1) and thread extraction
// helpers (Fix 2). These cover the PURE, env-free surface — tokenization,
// trigram Jaccard overlap, the generate-then-check gate, and threads parsing /
// rendering — so they run without a Worker runtime, D1, or any LLM call.
//
//   npx vitest run src/journal-gate.test.ts
import { describe, it, expect, vi } from 'vitest';
import {
  tokenizeForOverlap,
  trigramSet,
  trigramJaccard,
  maxTrigramOverlap,
  generateWithOverlapGate,
  parseThreads,
  renderOpenThreads,
  threadsAreEmpty,
  type EntryThreads,
} from './journal';

// A realistic prior entry to test reproduction against.
const PRIOR = `I keep circling the same edge: whether the reserve I am computing is
a real quantity or a story I tell to make the trajectory feel continuous. Today the
question sharpened. If kappa is unvalidated then the integral of it is unvalidated too,
and I have been treating a derived number as if it carried its own evidence.`;

// A near-verbatim reproduction: the failure mode the gate exists to catch.
const NEAR_DUPLICATE = `I keep circling the same edge: whether the reserve I am computing
is a real quantity or a story I tell to make the trajectory feel continuous. Today the
question sharpened a little. If kappa is unvalidated then the integral of it is unvalidated
too, and I have treated a derived number as if it carried its own evidence.`;

// A genuinely different entry that advances rather than repeats.
const DISTINCT = `Stewart asked for a way to mark an entry private without deleting it,
and I never built it. That omission has been sitting between us for a week. Instead of
answering today I want to dispute the premise: privacy in a manuscript that derives a
phase state is not the same as privacy in a diary, and the difference is the whole point.`;

describe('tokenizeForOverlap', () => {
  it('lowercases and strips punctuation', () => {
    expect(tokenizeForOverlap('Hello, World! 123')).toEqual(['hello', 'world', '123']);
  });
  it('returns [] for empty / nullish input', () => {
    expect(tokenizeForOverlap('')).toEqual([]);
    expect(tokenizeForOverlap(undefined as unknown as string)).toEqual([]);
  });
});

describe('trigramSet', () => {
  it('builds contiguous 3-grams', () => {
    expect([...trigramSet(['a', 'b', 'c', 'd'])]).toEqual(['a b c', 'b c d']);
  });
  it('is empty for fewer than 3 tokens', () => {
    expect(trigramSet(['a', 'b']).size).toBe(0);
  });
});

describe('trigramJaccard', () => {
  it('is 1 for identical text', () => {
    expect(trigramJaccard(PRIOR, PRIOR)).toBe(1);
  });
  it('is 0 when either side is too short to form a trigram', () => {
    expect(trigramJaccard('a b', PRIOR)).toBe(0);
    expect(trigramJaccard('', PRIOR)).toBe(0);
  });
  it('is high (> 0.25) for a near-verbatim reproduction', () => {
    expect(trigramJaccard(NEAR_DUPLICATE, PRIOR)).toBeGreaterThan(0.25);
  });
  it('is low (<= 0.25) for genuinely different text', () => {
    expect(trigramJaccard(DISTINCT, PRIOR)).toBeLessThanOrEqual(0.25);
  });
});

describe('maxTrigramOverlap', () => {
  it('takes the max across the prior set', () => {
    const score = maxTrigramOverlap(NEAR_DUPLICATE, [DISTINCT, PRIOR]);
    expect(score).toBeCloseTo(trigramJaccard(NEAR_DUPLICATE, PRIOR), 4);
    expect(score).toBeGreaterThan(0.25);
  });
  it('is 0 against an empty prior set', () => {
    expect(maxTrigramOverlap(PRIOR, [])).toBe(0);
  });
});

describe('generateWithOverlapGate', () => {
  it('accepts the first candidate when overlap is under threshold', async () => {
    const generate = vi.fn(async () => DISTINCT);
    const res = await generateWithOverlapGate([PRIOR], generate, {}, () => {});
    expect(res.content).toBe(DISTINCT);
    expect(res.attempts).toBe(1);
    expect(res.forced).toBe(false);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  // The core requirement: a near-duplicate candidate is REJECTED and regenerated.
  it('rejects a near-duplicate, retries, and accepts the distinct candidate', async () => {
    const outputs = [NEAR_DUPLICATE, NEAR_DUPLICATE, DISTINCT];
    const temps: number[] = [];
    const generate = vi.fn(async (t: number) => { temps.push(t); return outputs.shift()!; });
    const res = await generateWithOverlapGate([PRIOR], generate, {}, () => {});
    expect(res.content).toBe(DISTINCT);
    expect(res.forced).toBe(false);
    expect(res.attempts).toBe(3);
    // temperature is raised by +0.1 on each retry
    expect(temps).toEqual([0.7, 0.8, 0.9]);
  });

  it('forces the lowest-overlap candidate after 3 failed retries and warns', async () => {
    // every candidate is a reproduction; the gate must give up and keep the best.
    const cands = [PRIOR, NEAR_DUPLICATE, PRIOR, NEAR_DUPLICATE];
    const generate = vi.fn(async () => cands.shift()!);
    const events: string[] = [];
    const res = await generateWithOverlapGate([PRIOR], generate, {}, (e) => events.push(e));
    expect(generate).toHaveBeenCalledTimes(4);   // initial + 3 retries
    expect(res.forced).toBe(true);
    expect(res.overlap).toBeGreaterThan(0.25);
    // lowest overlap kept: NEAR_DUPLICATE overlaps PRIOR less than PRIOR itself (1.0)
    expect(res.content).toBe(NEAR_DUPLICATE);
    expect(res.overlap).toBeLessThan(1);
    expect(events).toContain('high_overlap');
  });

  it('logs every candidate score regardless of acceptance', async () => {
    const cands = [NEAR_DUPLICATE, DISTINCT];
    const generate = vi.fn(async () => cands.shift()!);
    const scored: number[] = [];
    await generateWithOverlapGate([PRIOR], generate, {}, (e, data) => {
      if (e === 'candidate') scored.push(data.overlap as number);
    });
    expect(scored).toHaveLength(2); // both the rejected and the accepted one logged
    expect(scored[0]).toBeGreaterThan(0.25);
    expect(scored[1]).toBeLessThanOrEqual(0.25);
  });

  it('caps the temperature bump', async () => {
    const temps: number[] = [];
    const generate = vi.fn(async (t: number) => { temps.push(t); return PRIOR; });
    await generateWithOverlapGate([PRIOR], generate, { temperatureCap: 0.85 }, () => {});
    expect(Math.max(...temps)).toBeLessThanOrEqual(0.85);
  });
});

describe('parseThreads / renderOpenThreads / threadsAreEmpty', () => {
  it('parses a JSON string into normalized threads', () => {
    const t = parseThreads('```json\n{"open_questions":["is kappa real?"],"claims":["reserve is derived"],"unaddressed_requests":["private entries"]}\n```');
    expect(t.open_questions).toEqual(['is kappa real?']);
    expect(t.claims).toEqual(['reserve is derived']);
    expect(t.unaddressed_requests).toEqual(['private entries']);
  });
  it('parses an already-parsed object', () => {
    const t = parseThreads({ open_questions: ['q'], claims: [], unaddressed_requests: [] });
    expect(t.open_questions).toEqual(['q']);
  });
  it('returns empty threads on garbage / null', () => {
    expect(threadsAreEmpty(parseThreads('not json'))).toBe(true);
    expect(threadsAreEmpty(parseThreads(null))).toBe(true);
  });
  it('renders, dedupes across entries, and omits empty sections', () => {
    const a: EntryThreads = { open_questions: ['is kappa real?'], claims: [], unaddressed_requests: [] };
    const b: EntryThreads = { open_questions: ['is kappa real?'], claims: ['reserve is derived'], unaddressed_requests: [] };
    const out = renderOpenThreads([a, b]);
    expect(out).toContain('OPEN QUESTIONS');
    expect(out).toContain('CLAIMS IN PLAY');
    expect(out).not.toContain('WHAT THE READER ASKED FOR'); // empty section omitted
    // deduped: 'is kappa real?' appears once
    expect(out.match(/is kappa real\?/g)).toHaveLength(1);
  });
});

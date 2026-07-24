import { describe, it, expect } from 'vitest';
import {
  pickWork, validateIntent, FORGE_SETTLE_MS,
  forgeStateChanged, answerClaimsPr, dedupeSessionHistory, FORGE_STALL_TICKS,
  type ForgeTickState,
} from './conductor';

const NOW = 1_000_000_000_000;
const settled = NOW - FORGE_SETTLE_MS - 1000;
const fresh = NOW - 30_000;

describe('conductor pickWork', () => {
  it('prefers a settled forge task over any intent', () => {
    const w = pickWork(
      [{ id: 'f1', status: 'open', updated_at: settled }],
      [{ id: 'i1', priority: 10, last_run_at: null }],
      NOW,
    );
    expect(w).toEqual({ kind: 'forge', id: 'f1' });
  });

  it('skips forge tasks still inside the CI settle window', () => {
    const w = pickWork(
      [{ id: 'f1', status: 'open', updated_at: fresh }],
      [{ id: 'i1', priority: 5, last_run_at: null }],
      NOW,
    );
    expect(w).toEqual({ kind: 'intent', id: 'i1' });
  });

  it('ignores merged/closed forge tasks', () => {
    const w = pickWork(
      [{ id: 'f1', status: 'merged', updated_at: settled }],
      [], NOW,
    );
    expect(w).toBeNull();
  });

  it('sweeps the least-recently-touched forge task first', () => {
    const w = pickWork(
      [
        { id: 'newer', status: 'pr_open', updated_at: settled },
        { id: 'older', status: 'open', updated_at: settled - 60_000 },
      ],
      [], NOW,
    );
    expect(w).toEqual({ kind: 'forge', id: 'older' });
  });

  it('picks intents by priority, then least-recently-run', () => {
    expect(pickWork([], [
      { id: 'low', priority: 3, last_run_at: null },
      { id: 'high', priority: 9, last_run_at: NOW - 1000 },
    ], NOW)).toEqual({ kind: 'intent', id: 'high' });

    expect(pickWork([], [
      { id: 'ran-recently', priority: 5, last_run_at: NOW - 1000 },
      { id: 'never-ran', priority: 5, last_run_at: null },
    ], NOW)).toEqual({ kind: 'intent', id: 'never-ran' });
  });

  it('is idle with nothing to do', () => {
    expect(pickWork([], [], NOW)).toBeNull();
  });

  it('the ship queue jumps the exploration lane: ready intents finalize before active ones run', () => {
    expect(pickWork([], [
      { id: 'exploring', priority: 10, last_run_at: null, status: 'active' },
      { id: 'shippable', priority: 1, last_run_at: NOW - 1000, status: 'ready' },
    ], NOW)).toEqual({ kind: 'intent', id: 'shippable' });
  });

  it('among ready intents, priority then least-recently-run still decides', () => {
    expect(pickWork([], [
      { id: 'r-low', priority: 2, last_run_at: null, status: 'ready' },
      { id: 'r-high', priority: 8, last_run_at: NOW - 1000, status: 'ready' },
    ], NOW)).toEqual({ kind: 'intent', id: 'r-high' });
  });

  it('a settled forge task still outranks the ship queue', () => {
    expect(pickWork(
      [{ id: 'f1', status: 'open', updated_at: settled }],
      [{ id: 'shippable', priority: 9, last_run_at: null, status: 'ready' }],
      NOW,
    )).toEqual({ kind: 'forge', id: 'f1' });
  });
});

describe('intent validation', () => {
  it('requires a title and a real goal', () => {
    expect(validateIntent('', 'a goal long enough to be a real goal')).toMatch(/title/);
    expect(validateIntent('x', 'too short')).toMatch(/too short/);
    expect(validateIntent('x', 'g'.repeat(5000))).toMatch(/too long/);
    expect(validateIntent('Keep CI green', 'Every open forge task reaches a green PR or a documented blocker.')).toBeNull();
  });
});

// ── FIX 2 (2026-07-24 audit): truth gate, stall breaker, history dedup ──────

const OPEN_NO_PR: ForgeTickState = { status: 'open', pr_number: null, commits: 2 };

describe('forgeStateChanged (truth gate)', () => {
  it('an identical row is NOT progress, whatever the narrative said', () => {
    expect(forgeStateChanged(OPEN_NO_PR, { ...OPEN_NO_PR })).toBe(false);
  });
  it('a landed PR, a new commit, or a status flip each count as real change', () => {
    expect(forgeStateChanged(OPEN_NO_PR, { ...OPEN_NO_PR, pr_number: 41 })).toBe(true);
    expect(forgeStateChanged(OPEN_NO_PR, { ...OPEN_NO_PR, commits: 3 })).toBe(true);
    expect(forgeStateChanged(OPEN_NO_PR, { ...OPEN_NO_PR, status: 'merged' })).toBe(true);
  });
});

describe('answerClaimsPr', () => {
  it('catches the exact 18-day phantom narrative', () => {
    expect(answerClaimsPr(
      'I verified CI was green and opened a new [PR] with a detailed and honest body; the task now awaits acceptance.'
    )).toBe(true);
  });
  it('stays quiet for honest non-PR work', () => {
    expect(answerClaimsPr('CI is red; I read the failing log tail and fixed the null guard in trading.ts.')).toBe(false);
    expect(answerClaimsPr('')).toBe(false);
  });
});

describe('dedupeSessionHistory', () => {
  const u = (content: string) => ({ role: 'user', content });
  const a = (content: string) => ({ role: 'assistant', content });

  it('collapses the conductor replay pattern (identical Q/A pairs, hourly)', () => {
    const replay = [u('AUTONOMOUS RUN'), a('I opened a PR.'), u('AUTONOMOUS RUN'), a('I opened a PR.'), u('AUTONOMOUS RUN'), a('I opened a PR.')];
    const out = dedupeSessionHistory(replay);
    // one real pair survives (plus at most the standing re-ask) — the model
    // can no longer be entrained by 18 copies of its own answer.
    expect(out.filter(m => m.role === 'assistant')).toHaveLength(1);
    expect(out.length).toBeLessThanOrEqual(3);
  });

  it('leaves an ordinary conversation untouched', () => {
    const convo = [u('hi'), a('hello'), u('how are you?'), a('well'), u('hi'), a('hello again')];
    expect(dedupeSessionHistory(convo)).toEqual(convo);
  });

  it('drops a repeated assistant turn even when different user turns sit between', () => {
    const msgs = [u('q1'), a('same answer'), u('q2'), a('same answer'), u('q3'), a('fresh answer')];
    const out = dedupeSessionHistory(msgs);
    expect(out.filter(m => m.role === 'assistant').map(m => m.content)).toEqual(['same answer', 'fresh answer']);
  });

  it('stall threshold is a small handful of ticks, not hundreds', () => {
    expect(FORGE_STALL_TICKS).toBeGreaterThanOrEqual(3);
    expect(FORGE_STALL_TICKS).toBeLessThanOrEqual(12);
  });
});

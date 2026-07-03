import { describe, it, expect } from 'vitest';
import { pickWork, validateIntent, FORGE_SETTLE_MS } from './conductor';

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
});

describe('intent validation', () => {
  it('requires a title and a real goal', () => {
    expect(validateIntent('', 'a goal long enough to be a real goal')).toMatch(/title/);
    expect(validateIntent('x', 'too short')).toMatch(/too short/);
    expect(validateIntent('x', 'g'.repeat(5000))).toMatch(/too long/);
    expect(validateIntent('Keep CI green', 'Every open forge task reaches a green PR or a documented blocker.')).toBeNull();
  });
});

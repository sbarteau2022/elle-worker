import { describe, it, expect } from 'vitest';
import { normalizeDispatchResult, runAgentCore, type LocalAgentDeps } from './local-agent';

describe('normalizeDispatchResult', () => {
  it('passes through a well-formed success result from the laptop', () => {
    const r = normalizeDispatchResult({
      ok: true, final: 'tests pass', steps: 3, model: 'qwen3.5:4b',
      transcript: 'GOAL: ...\nstep 1: ...', stopped: 'done',
    });
    expect(r).toEqual({
      ok: true, final: 'tests pass', steps: 3, model: 'qwen3.5:4b',
      transcript: 'GOAL: ...\nstep 1: ...', stopped: 'done',
    });
  });

  it('fills in honest defaults when the job handler omits fields', () => {
    const r = normalizeDispatchResult({ ok: true });
    expect(r.ok).toBe(true);
    expect(r.final).toBe('done (no summary given).');
    expect(r.steps).toBe(0);
    expect(r.model).toBeUndefined();
    expect(r.transcript).toBe('');
    expect(r.stopped).toBe('done');
  });

  it('falls back to the error message as the summary on failure', () => {
    const r = normalizeDispatchResult({ ok: false, error: 'ollama HTTP 500', stopped: 'error' });
    expect(r.ok).toBe(false);
    expect(r.final).toBe('ollama HTTP 500');
    expect(r.stopped).toBe('error');
  });

  it('rejects an unrecognized stopped reason rather than trusting the wire', () => {
    const r = normalizeDispatchResult({ ok: false, final: 'whatever', stopped: 'not_a_real_reason' });
    expect(r.stopped).toBe('error');
  });

  it('treats a bus timeout (no result at all) as an honest error', () => {
    expect(normalizeDispatchResult(null)).toEqual({
      ok: false, final: 'local brain returned no result.', steps: 0, transcript: '', stopped: 'error',
    });
    expect(normalizeDispatchResult(undefined)).toMatchObject({ ok: false, stopped: 'error' });
    expect(normalizeDispatchResult('not an object')).toMatchObject({ ok: false, stopped: 'error' });
  });

  it('clips an oversized transcript', () => {
    const r = normalizeDispatchResult({ ok: true, transcript: 'x'.repeat(20_000) });
    expect(r.transcript.length).toBe(12_000);
  });
});

describe('runAgentCore', () => {
  it('dispatches the goal, step budget, and catalog exactly once and normalizes the reply', async () => {
    const calls: Array<[string, number, string, number]> = [];
    const deps: LocalAgentDeps = {
      dispatch: async (goal, maxSteps, catalog, timeoutMs) => {
        calls.push([goal, maxSteps, catalog, timeoutMs]);
        return { ok: true, final: 'built and shipped it', steps: 7, model: 'qwen3.5:4b', stopped: 'done' };
      },
    };
    const res = await runAgentCore('get the test suite green', 12, 'search_corpus(q) — ...', deps);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('get the test suite green');
    expect(calls[0][1]).toBe(12);
    expect(calls[0][2]).toBe('search_corpus(q) — ...');
    expect(res).toEqual({ ok: true, final: 'built and shipped it', steps: 7, model: 'qwen3.5:4b', transcript: '', stopped: 'done' });
  });

  it('surfaces a dispatch-level failure (e.g. the bus timing the whole job out) cleanly', async () => {
    const deps: LocalAgentDeps = {
      dispatch: async () => ({ ok: false, error: 'sandbox timeout after 600000ms', stopped: 'timeout' }),
    };
    const res = await runAgentCore('investigate X', 12, 'catalog', deps);
    expect(res.ok).toBe(false);
    expect(res.stopped).toBe('timeout');
    expect(res.final).toBe('sandbox timeout after 600000ms');
  });

  it('never throws when the dispatch layer returns garbage', async () => {
    const deps: LocalAgentDeps = { dispatch: async () => 'not-an-object' as unknown };
    const res = await runAgentCore('do something', 12, 'catalog', deps);
    expect(res.ok).toBe(false);
    expect(res.stopped).toBe('error');
  });
});

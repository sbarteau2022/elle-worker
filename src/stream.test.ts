import { describe, it, expect } from 'vitest';
import { sseFrame, sseDoor, memberDonePayload, type WaitsUntil } from './stream';

// A real WaitsUntil: collect the background promise so the test can await it.
function fakeCtx(): WaitsUntil & { settled(): Promise<void> } {
  const held: Promise<unknown>[] = [];
  return {
    waitUntil(p: Promise<unknown>) { held.push(p); },
    async settled() { await Promise.all(held); },
  };
}

describe('sseFrame', () => {
  it('emits spec-shaped frames: event line, JSON data line, blank line', () => {
    expect(sseFrame('step', { n: 1 })).toBe('event: step\ndata: {"n":1}\n\n');
  });

  it('never lets a newline in the payload break framing (JSON escapes it)', () => {
    const f = sseFrame('obs', { text: 'line one\nline two' });
    // exactly one data line — the newline lives inside the JSON string
    expect(f.split('\n').filter(l => l.startsWith('data: '))).toHaveLength(1);
  });
});

describe('memberDonePayload', () => {
  it('is key-for-key the non-streaming /api/elle-conversation shape', () => {
    const p = memberDonePayload({ answer: 'hi', steps: [1], kappa_dynamics: { k: 0.5 } }, 's1');
    expect(Object.keys(p).sort()).toEqual(['content', 'kappa_dynamics', 'response', 'session_id', 'steps']);
    expect(p.content).toBe('hi');
    expect(p.response).toBe('hi');
    expect(p.session_id).toBe('s1');
  });

  it('nulls absent kappa dynamics exactly like the JSON endpoint', () => {
    expect(memberDonePayload({ answer: 'a' }, 's').kappa_dynamics).toBeNull();
  });
});

describe('sseDoor', () => {
  it('streams frames in order, then closes', async () => {
    const ctx = fakeCtx();
    const res = sseDoor(ctx, { 'X-Extra': 'kept' }, async (send) => {
      send('step', { i: 0 });
      send('done', { answer: 'done' });
    });
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(res.headers.get('X-Extra')).toBe('kept');
    const body = await res.text();
    await ctx.settled();
    const events = [...body.matchAll(/event: (\w+)/g)].map(m => m[1]);
    expect(events).toEqual(['step', 'done']);
  });

  it('turns a runner throw into one error frame and still closes the stream', async () => {
    const ctx = fakeCtx();
    const res = sseDoor(ctx, {}, async (send) => {
      send('run_start', {});
      throw new Error('loop fell over');
    });
    const body = await res.text(); // resolves ⇒ the stream closed
    await ctx.settled();
    expect(body).toContain('event: error');
    expect(body).toContain('loop fell over');
  });
});

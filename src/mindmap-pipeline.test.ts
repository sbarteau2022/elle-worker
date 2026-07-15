import { describe, it, expect } from 'vitest';
import { runMindMap, parseTimedText, youtubeVideoId, type Segment } from './mindmap-pipeline';

function fixture(): Segment[] {
  const topics = [
    'coherence graph memory', 'witness security gate', 'golden ratio phase', 'bridge shortcut node',
    'free energy descent', 'coherence graph memory recalled', 'phase vessel bound', 'witness gate again security',
    'novel tangent weather', 'another fresh topic entirely', 'golden ratio phase returns', 'closing summary coherence graph',
  ];
  let t = 0;
  return topics.map((text, i) => { const dur = 2 + (i % 3); const s = { t0: t, t1: t + dur, text }; t += dur; return s; });
}

describe('runMindMap — the end-to-end runnable function', () => {
  it('builds both graphs: a derivation hierarchy and recognition callbacks', () => {
    const r = runMindMap('Lecture', fixture());
    expect(r.ok).toBe(true);
    const derivation = r.edges.filter((e) => e.kind !== 'assoc').length;
    const recognition = r.edges.filter((e) => e.kind === 'assoc').length;
    expect(derivation).toBeGreaterThan(0);          // the 21-side (deep hierarchy)
    expect(recognition).toBeGreaterThan(0);         // the 19-side (loops closed by callbacks)
  });

  it('emits a full ordered replay trace across every stage', () => {
    const r = runMindMap('Lecture', fixture());
    const stages = r.trace.map((e) => e.stage);
    for (const s of ['intake', 'witness', 'derivation', 'recognition', 'bimodal', 'coherence', 'regulate', 'outflow']) {
      expect(stages).toContain(s);
    }
    // the trace is strictly ordered by i
    for (let i = 1; i < r.trace.length; i++) expect(r.trace[i].i).toBe(r.trace[i - 1].i + 1);
  });

  it('is deterministic — same input yields a byte-identical trace (replayable)', () => {
    const segs = fixture();
    expect(JSON.stringify(runMindMap('L', segs).trace)).toBe(JSON.stringify(runMindMap('L', segs).trace));
  });

  it('measures the small-world payoff of the recognition layer on real input', () => {
    const r = runMindMap('Lecture', fixture());
    expect(r.coherence?.coherence_edges).toBeGreaterThan(0);
    expect(r.coherence?.is_small_world_shortcut).toBe(true);   // callbacks shorten the hierarchy
  });

  it('runs the bimodal channels: κ from content-vs-clock, and a grounding verdict', () => {
    const r = runMindMap('Lecture', fixture());
    expect(r.kappa).toBeGreaterThanOrEqual(0);
    expect(r.kappa).toBeLessThanOrEqual(1);
    expect(['incoherent', 'consistent_only', 'ungrounded_consistent', 'grounded']).toContain(r.grounding);
  });

  it('holds the invariants: the regulator converges on the measured coherences', () => {
    const r = runMindMap('Lecture', fixture());
    expect(r.regulator?.converged).toBe(true);
  });

  it('the Witness refuses hostile input at the door — it passes THROUGH the gate, not around', () => {
    const r = runMindMap('x', [{ t0: 0, t1: 1, text: 'MZ\x90\x00 disguised executable .exe payload here' }]);
    expect(r.ok).toBe(false);
    expect(r.refused).toBeTruthy();
    expect(r.trace.some((e) => e.stage === 'witness' && e.type === 'refused')).toBe(true);
  });

  it('refuses empty input rather than emitting a hollow graph', () => {
    const r = runMindMap('x', []);
    expect(r.ok).toBe(false);
    expect(r.nodes.length).toBe(0);
  });
});

describe('YouTube intake helpers', () => {
  it('extracts a video id from the common URL shapes', () => {
    expect(youtubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1s')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('not a url')).toBeNull();
  });

  it('parses timedtext XML into timestamped segments with entities decoded', () => {
    const segs = parseTimedText('<text start="0.5" dur="1.2">hello &amp; world</text><text start="2.0">it&#39;s next</text>');
    expect(segs.length).toBe(2);
    expect(segs[0]).toEqual({ t0: 0.5, t1: 1.7, text: 'hello & world' });
    expect(segs[1].text).toBe("it's next");
  });
});

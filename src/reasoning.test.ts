import { describe, it, expect } from 'vitest';
import { reason, modalityTier, reasoningSelfTest, type Segment } from './reasoning';

function fixture(): Segment[] {
  const topics = [
    'coherence graph memory', 'witness security gate', 'golden ratio phase', 'bridge shortcut node',
    'free energy descent', 'coherence graph memory recalled', 'phase vessel bound', 'witness gate again',
    'tangent weather unrelated', 'fresh topic story', 'golden ratio phase returns', 'closing coherence graph',
  ];
  let t = 0;
  return topics.map((text, i) => { const dur = 2 + (i % 3); const s = { t0: t, t1: t + dur, text }; t += dur; return s; });
}

describe('modalityTier — the two axes, honest', () => {
  it('no semantic channel ⇒ the content graph is dark (only an envelope)', () => {
    const t = modalityTier({ audio: true, timing: true });
    expect(t.dark).toContain('nodes');
    expect(t.grounding_ceiling).toBe('incoherent');
  });

  it('text + timing only ⇒ caps at consistent_only (no independent world channel)', () => {
    const t = modalityTier({ text: true, timing: true });
    expect(t.producible).toContain('nodes');
    expect(t.grounding_ceiling).toBe('consistent_only');
    expect(t.dark).toContain('prosody');
    expect(t.dark).toContain('scene-cuts');
  });

  it('one real world channel (audio) ⇒ ungrounded_consistent ceiling', () => {
    expect(modalityTier({ text: true, timing: true, audio: true }).grounding_ceiling).toBe('ungrounded_consistent');
  });

  it('two independent world channels (audio+vision) ⇒ grounded ceiling', () => {
    expect(modalityTier({ text: true, timing: true, audio: true, vision: true }).grounding_ceiling).toBe('grounded');
  });

  it('each modality lights specific aspects', () => {
    const t = modalityTier({ text: true, timing: true, vision: true });
    expect(t.producible).toContain('scene-cuts');
    expect(t.producible).toContain('shown-not-said');
    expect(t.dark).toContain('prosody');        // no audio ⇒ no emphasis channel
  });
});

describe('reason — the unified architecture as one call', () => {
  it('builds both graphs and the bimodal measures from a single call', () => {
    const r = reason('Lecture', fixture());
    expect(r.ok).toBe(true);
    expect(r.graphs.nodes).toBeGreaterThan(0);
    expect(r.graphs.derivation_edges).toBeGreaterThan(0);
    expect(r.graphs.recognition_edges).toBeGreaterThan(0);
    expect(r.coherence?.small_world).toBe(true);
    expect(r.invariants?.converged).toBe(true);
  });

  it('caps the reached verdict at the input tier ceiling — you can\'t out-ground your channels', () => {
    const capOnly = reason('t', fixture(), { text: true, timing: true });
    expect(capOnly.confidence.ceiling).toBe('consistent_only');
    // reached is never stronger than the ceiling
    const rank = { incoherent: 0, consistent_only: 1, ungrounded_consistent: 2, grounded: 3 } as const;
    expect(rank[capOnly.confidence.reached]).toBeLessThanOrEqual(rank[capOnly.confidence.ceiling]);
  });

  it('a full-set profile raises the ceiling to grounded', () => {
    const full = reason('t', fixture(), { text: true, timing: true, audio: true, vision: true });
    expect(full.confidence.ceiling).toBe('grounded');
  });

  it('the witness still guards the door inside the reasoning function', () => {
    const r = reason('x', [{ t0: 0, t1: 1, text: 'MZ\x90\x00 disguised .exe payload here' }]);
    expect(r.ok).toBe(false);
    expect(r.readout).toMatch(/witness/i);
  });

  it('emits a plain structural readout — never an LLM claim (the LLM is not in this loop)', () => {
    const r = reason('Lecture', fixture());
    expect(r.readout).toMatch(/nodes/);
    expect(r.readout).toMatch(/recognition callbacks/);
  });
});

describe('reasoningSelfTest', () => {
  it('runs the whole unified architecture at two tiers, green', () => {
    const st = reasoningSelfTest();
    expect(st.builds_graphs).toBe(true);
    expect(st.tier_caps_grounding).toBe(true);
    expect(st.full_set_reaches_higher).toBe(true);
    expect(st.refuses_hostile).toBe(true);
    expect(st.ok).toBe(true);
  });
});

describe('reasonText / textToSegments — the router turn pass (pressure test)', () => {
  it('splits text into segments on sentence and line boundaries', async () => {
    const { textToSegments } = await import('./reasoning');
    const segs = textToSegments('First thought. Second one! A third?\nAnd a fourth line');
    expect(segs.length).toBe(4);
    expect(segs[0].text).toBe('First thought');
    expect(segs.every((s) => s.t1 > s.t0)).toBe(true);
  });

  it('a chat turn (text only, no timestamps) honestly ceilings at consistent_only', async () => {
    const { reasonText } = await import('./reasoning');
    const s = reasonText('The witness gate reads the input. Coherence holds the graph. The golden ratio returns to coherence.');
    expect(s.tier).toBe('consistent_only');   // text-only: coherence, not correspondence
    expect(s.channels).toBe(1);
  });

  it('never throws on degenerate input — the pass is fail-open by construction', async () => {
    const { reasonText } = await import('./reasoning');
    expect(() => reasonText('')).not.toThrow();
    expect(() => reasonText('   ')).not.toThrow();
    expect(() => reasonText('one')).not.toThrow();
  });

  it('a hostile turn is refused by the witness inside the pass, not silently accepted', async () => {
    const { reason, textToSegments } = await import('./reasoning');
    const r = reason('t', textToSegments('MZ\x90\x00 disguised .exe payload'), { text: true });
    expect(r.ok).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { convergence, convergenceSelfTest } from './convergence';

const CLAIM = 'the golden ratio governs the phase of the architecture';

describe('convergence — the index between convergence and fact', () => {
  it('no relevant sources ⇒ no_sources, nothing to converge on', () => {
    const r = convergence(CLAIM, [{ id: 'a', origin: 'paperA', text: 'the weather today is mild and sunny outside' }]);
    expect(r.tier).toBe('no_sources');
    expect(r.convergence_index).toBe(0);
  });

  it('exactly one relevant source ⇒ single_source, cannot corroborate itself', () => {
    const r = convergence(CLAIM, [{ id: 'a', origin: 'paperA', text: 'the golden ratio governs the phase of this architecture directly' }]);
    expect(r.tier).toBe('single_source');
    expect(r.distinct_origins).toBe(1);
  });

  it('THE LOAD-BEARING GUARANTEE: same-origin repetition is an echo, never corroboration', () => {
    const echoText = 'the golden ratio governs the phase of the architecture, as established here';
    const r = convergence(CLAIM, [
      { id: 'a1', origin: 'paperA', text: echoText },
      { id: 'a2', origin: 'paperA', text: echoText },
      { id: 'a3', origin: 'paperA', text: echoText },
    ]);
    expect(r.tier).toBe('echoed');
    expect(r.convergence_index).toBe(0);          // same-origin pairs contribute NOTHING
    expect(r.tier).not.toBe('corroborated');
  });

  it('genuinely independent origins agreeing ⇒ corroborated', () => {
    const r = convergence(CLAIM, [
      { id: 'b1', origin: 'paperB', text: 'the golden ratio sets the phase of this architecture in our analysis' },
      { id: 'c1', origin: 'paperC', text: 'independently, the phase of the architecture follows the golden ratio' },
    ]);
    expect(r.tier).toBe('corroborated');
    expect(r.distinct_origins).toBe(2);
    expect(r.convergence_index).toBeGreaterThan(0);
  });

  it('a genuine dissenter among independent origins is named, not hidden', () => {
    const r = convergence(CLAIM, [
      { id: 'd1', origin: 'paperD', text: 'the golden ratio sets the phase of this architecture in our analysis' },
      { id: 'e1', origin: 'paperE', text: 'independently, the phase of the architecture follows the golden ratio' },
      { id: 'f1', origin: 'paperF', text: 'this architecture is better explained by seasonal migration patterns of urban wildlife populations' },
    ]);
    expect(r.dissent.length).toBeGreaterThan(0);
    expect(r.dissent.some((d) => d.origin === 'paperF')).toBe(true);
    expect(r.tier).toBe('contested');
  });

  it('adding a duplicate of an already-counted origin cannot inflate convergence', () => {
    const twoIndependent = convergence(CLAIM, [
      { id: 'b1', origin: 'paperB', text: 'the golden ratio sets the phase of this architecture in our analysis' },
      { id: 'c1', origin: 'paperC', text: 'independently, the phase of the architecture follows the golden ratio' },
    ]);
    const withDuplicateOfB = convergence(CLAIM, [
      { id: 'b1', origin: 'paperB', text: 'the golden ratio sets the phase of this architecture in our analysis' },
      { id: 'b2', origin: 'paperB', text: 'the golden ratio sets the phase of this architecture in our analysis' }, // same origin, repeated
      { id: 'c1', origin: 'paperC', text: 'independently, the phase of the architecture follows the golden ratio' },
    ]);
    // the extra same-origin duplicate should not raise the tier beyond what two real origins already gave
    expect(withDuplicateOfB.tier).toBe(twoIndependent.tier);
  });
});

describe('convergenceSelfTest — the whole engine green', () => {
  it('every guarantee holds', () => {
    const st = convergenceSelfTest();
    expect(st.no_sources_when_irrelevant).toBe(true);
    expect(st.single_source_alone).toBe(true);
    expect(st.echo_is_not_corroboration).toBe(true);
    expect(st.independent_agreement_corroborates).toBe(true);
    expect(st.dissent_is_named_not_hidden).toBe(true);
    expect(st.ok).toBe(true);
  });
});

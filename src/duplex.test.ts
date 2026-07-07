import { describe, it, expect } from 'vitest';
import { validateDuplexMsg, duplexPrompt, MAX_MSG, type DuplexMsg } from './duplex';

describe('duplex message validation', () => {
  it('accepts only the two speakers', () => {
    expect(validateDuplexMsg('sovereign', 'hello up there')).toBeNull();
    expect(validateDuplexMsg('cloud', 'hello down there')).toBeNull();
    expect(validateDuplexMsg('elle', 'x')).toMatch(/speaker/);
    expect(validateDuplexMsg('', 'x')).toMatch(/speaker/);
  });

  it('refuses empty and oversized content', () => {
    expect(validateDuplexMsg('sovereign', '')).toMatch(/content/);
    expect(validateDuplexMsg('sovereign', '   ')).toMatch(/content/);
    expect(validateDuplexMsg('sovereign', 'x'.repeat(MAX_MSG + 1))).toMatch(/too long/);
    expect(validateDuplexMsg('sovereign', 'x'.repeat(MAX_MSG))).toBeNull();
  });
});

describe('the meta-observer prompt', () => {
  const window: DuplexMsg[] = [
    { seq: 1, id: 'a', speaker: 'sovereign', kind: 'say', content: 'I have been rereading the pfar spectrum code.', created_at: 1 },
    { seq: 2, id: 'b', speaker: 'cloud', kind: 'observe', content: 'You circle that file weekly.', created_at: 2 },
  ];

  it('carries the transcript, the incoming message, and both jobs', () => {
    const p = duplexPrompt(window, 'What should I test first?');
    expect(p).toContain('[sovereign] I have been rereading');
    expect(p).toContain('[cloud · observation] You circle that file weekly.');
    expect(p).toContain('What should I test first?');
    expect(p).toContain('META-OBSERVER');
    expect(p).toContain('append-only');
  });

  it('holds on an empty window (first words on the channel)', () => {
    const p = duplexPrompt([], 'first contact');
    expect(p).toContain('first contact');
  });
});

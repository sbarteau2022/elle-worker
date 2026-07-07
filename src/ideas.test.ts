import { describe, it, expect } from 'vitest';
import { canTransition, validateIdea, IDEA_STATUSES, IDEA_COLORS, MAX_EXTENDS, type IdeaStatus } from './ideas';

describe('idea lane — the state machine', () => {
  it('walks the lane in order, no skipping', () => {
    expect(canTransition('queue', 'pondering')).toBe(true);
    expect(canTransition('select', 'queued')).toBe(true);
    expect(canTransition('spec', 'scoping')).toBe(true);
    expect(canTransition('build', 'spec')).toBe(true);
    expect(canTransition('extend', 'building')).toBe(true);
    expect(canTransition('test', 'building')).toBe(true);
    expect(canTransition('verdict', 'testing')).toBe(true);
  });

  it('refuses every skip', () => {
    expect(canTransition('build', 'pondering')).toBe(false);  // no building without a spec
    expect(canTransition('spec', 'queued')).toBe(false);      // no spec before scoping surfaces the code
    expect(canTransition('test', 'spec')).toBe(false);        // no pressure test before a build
    expect(canTransition('verdict', 'building')).toBe(false); // no verdict before the test
    expect(canTransition('queue', 'held')).toBe(false);       // a closed idea does not re-enter
  });

  it('kill works from any live stage, but not twice', () => {
    for (const s of IDEA_STATUSES.filter(s => s !== 'killed')) {
      expect(canTransition('kill', s as IdeaStatus)).toBe(true);
    }
    expect(canTransition('kill', 'killed')).toBe(false);
  });

  it('rejects unknown ops', () => {
    expect(canTransition('ship', 'spec')).toBe(false);
  });

  it('caps extensions at 2', () => {
    expect(MAX_EXTENDS).toBe(2);
  });
});

describe('idea validation', () => {
  it('requires a real title and a real summary', () => {
    expect(validateIdea('', 'a perfectly reasonable summary')).toMatch(/title/);
    expect(validateIdea('abc', 'a perfectly reasonable summary')).toMatch(/title/);
    expect(validateIdea('x'.repeat(161), 'a perfectly reasonable summary')).toMatch(/title/);
    expect(validateIdea('A neat build', 'too short')).toMatch(/summary/);
    expect(validateIdea('A neat build', 'a working sovereign-side PFAR panel')).toBeNull();
  });
});

describe('idea colors — the workbench contract', () => {
  it('paints every status, and queued gets the sandbox gold', () => {
    for (const s of IDEA_STATUSES) expect(IDEA_COLORS[s]).toMatch(/^#/);
    expect(IDEA_COLORS.queued).toBe('#C9A84C');
    // distinct from its neighbours — the column must read at a glance
    expect(IDEA_COLORS.queued).not.toBe(IDEA_COLORS.pondering);
    expect(IDEA_COLORS.held).not.toBe(IDEA_COLORS.killed);
  });
});

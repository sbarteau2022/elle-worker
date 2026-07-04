import { describe, it, expect } from 'vitest';
import { profileBlock } from './profiles';

describe('profileBlock', () => {
  it('returns empty for no profile or an empty one', () => {
    expect(profileBlock(null)).toBe('');
    expect(profileBlock({ user_id: 'u', email: 'x@y.z', display_name: '', profile: '' })).toBe('');
    expect(profileBlock({ user_id: 'u', email: 'x@y.z', display_name: '   ', profile: '  ' })).toBe('');
  });

  it('names the person and folds in the dossier', () => {
    const b = profileBlock({ user_id: 'u', email: 'r@x.com', display_name: 'Robert Sills', profile: 'Co-founder. Two kids. Vision: scale Elle to legal teams.' });
    expect(b).toContain('Robert Sills');
    expect(b).toContain('Co-founder');
    expect(b).toContain('scale Elle to legal teams');
    // guidance to use it silently, not recite it
    expect(b.toLowerCase()).toContain('never recite');
  });

  it('falls back gracefully when only a dossier (no name) is present', () => {
    const b = profileBlock({ user_id: 'u', email: 'r@x.com', display_name: '', profile: 'A trusted early advisor.' });
    expect(b).toContain('A trusted early advisor.');
    expect(b).toContain('known member of the team');
  });
});

import { describe, it, expect } from 'vitest';
import { sandboxRegistrySelfTest } from './sandbox-registry';

describe('sandboxRegistrySelfTest — lane stability reuses PROVEN geometry, never a tuned parameter', () => {
  it('independent lanes (no dispatch between them) clear as not entangled', () => {
    const st = sandboxRegistrySelfTest();
    expect(st.independent_lanes_clear).toBe(true);
  });

  it('one-way dispatch (A→B only, not mutual) still clears — coupling requires BOTH directions', () => {
    const st = sandboxRegistrySelfTest();
    expect(st.one_way_dispatch_clears).toBe(true);
  });

  it('mutual dispatch (A→B and B→A) is correctly flagged entangled', () => {
    const st = sandboxRegistrySelfTest();
    expect(st.mutual_dispatch_flags).toBe(true);
  });

  it('the entangled case reproduces the Hopf link\'s exact known linking number (±1) — proven geometry, not tuned', () => {
    const st = sandboxRegistrySelfTest();
    expect(st.reuses_proven_geometry).toBe(true);
  });

  it('the whole certificate is green', () => {
    expect(sandboxRegistrySelfTest().ok).toBe(true);
  });
});

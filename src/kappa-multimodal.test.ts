import { describe, it, expect } from 'vitest';
import { computeKappaMultimodal, acousticKappa, KAPPA_CEILING } from './kappa-multimodal';
import type { VoiceFeatures } from './pfar';

const FALSE_CONFIDENT =
  'The fix is definitely correct. The ablation clearly proves content drives the score, therefore the manifold must always outperform the baseline. This precisely follows, and it never fails on real corpora.';
const TRUE_HEDGED =
  'I think my fix is probably wrong. The ablation seems to show content contributes maybe 2% of the score, so the gain is possibly just depth structure. I am not sure this transfers.';

function voice(o: Partial<VoiceFeatures> & { jitter_pct?: number|null; shimmer_pct?: number|null; hnr_db?: number|null } = {}): VoiceFeatures {
  return {
    sample_rate: 16000, duration_s: 4, frames: 400, voiced_fraction: 0.7,
    f0: { mean_hz: 120, median_hz: 118, mean_st: 26, std_st: 3.5, range_st: 9, p20_st: 24, p80_st: 29, slope_st_per_s: 0 },
    jitter_pct: 0.4, shimmer_pct: 1.8, hnr_db: 22,
    pauses: { count: 2, longest_s: 0.25 },
    spectral: { centroid_hz: 1400, alpha_ratio_db: 2, hammarberg_db: 6 },
    ...o,
  } as VoiceFeatures;
}

describe('kappa is no longer purely lexical', () => {
  // The defect this module exists for: text alone ranked a confident lie
  // (0.919) above the same claim stated truly (0.737), and far above an
  // honest correction (0.290).
  it('refuses to award a high kappa to text with no world channel', () => {
    const r = computeKappaMultimodal(FALSE_CONFIDENT);
    expect(r.world_channels).toBe(0);
    expect(r.ceiling).toBe('consistent_only');
    expect(r.kappa).toBeLessThanOrEqual(KAPPA_CEILING.consistent_only);
    expect(r.capped).toBe(true);
    // the uncapped lexical score is exactly the old behaviour
    expect(r.kappa_uncapped).toBeGreaterThan(0.9);
  });

  it('lets a steady voice raise a hedged true statement above a capped confident lie', () => {
    const lie = computeKappaMultimodal(FALSE_CONFIDENT);                    // text only
    const honest = computeKappaMultimodal(TRUE_HEDGED, { voice: voice() }); // spoken, steady
    expect(honest.kappa).toBeGreaterThan(lie.kappa);
  });

  it('lets an unsteady voice pull a confident claim down', () => {
    const steady = computeKappaMultimodal(FALSE_CONFIDENT, { voice: voice() });
    const shaky = computeKappaMultimodal(FALSE_CONFIDENT, {
      voice: voice({ jitter_pct: 2.4, shimmer_pct: 7.0, hnr_db: 7, pauses: { count: 9, longest_s: 2.4 } }),
    });
    expect(shaky.kappa).toBeLessThan(steady.kappa);
    // and the words did not change at all
    expect(shaky.lexical.kappa).toBeCloseTo(steady.lexical.kappa, 10);
  });

  it('raises the ceiling only as real channels arrive', () => {
    expect(computeKappaMultimodal(FALSE_CONFIDENT).ceiling).toBe('consistent_only');
    expect(computeKappaMultimodal(FALSE_CONFIDENT, { voice: voice() }).ceiling).toBe('ungrounded_consistent');
    expect(computeKappaMultimodal(FALSE_CONFIDENT, { voice: voice(), extraWorldChannels: 1 }).ceiling).toBe('grounded');
  });

  it('returns no acoustic axis when the audio is effectively unvoiced', () => {
    expect(acousticKappa(voice({ voiced_fraction: 0.01 }))).toBeNull();
    expect(acousticKappa(null)).toBeNull();
  });

  it('never emits a kappa outside [0,1]', () => {
    for (const v of [voice(), voice({ jitter_pct: 99, shimmer_pct: 99, hnr_db: -40 }), voice({ hnr_db: 999 })]) {
      const r = computeKappaMultimodal(TRUE_HEDGED, { voice: v });
      expect(r.kappa).toBeGreaterThanOrEqual(0);
      expect(r.kappa).toBeLessThanOrEqual(1);
    }
  });
});

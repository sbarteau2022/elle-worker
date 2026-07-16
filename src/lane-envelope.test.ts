import { describe, it, expect } from 'vitest';
import { laneEnvelopeSelfTest } from './lane-envelope';

describe('laneEnvelopeSelfTest — COROS sealed under hyperbolic-synced (Rosen bridge) keys, per lane', () => {
  it('seal→open round-trips real dispatch-shaped payloads in lock-step', async () => {
    expect((await laneEnvelopeSelfTest()).roundtrip).toBe(true);
  });

  it('two lanes off the same root walk genuinely distinct secret geodesics', async () => {
    expect((await laneEnvelopeSelfTest()).distinct_geodesics_per_lane).toBe(true);
  });

  it('a wire sealed on one lane\'s geodesic will not open on another lane\'s', async () => {
    expect((await laneEnvelopeSelfTest()).lane_isolation).toBe(true);
  });

  it('resyncs after a run of lost messages without any counter on the wire', async () => {
    expect((await laneEnvelopeSelfTest()).resync_after_loss).toBe(true);
  });

  it('rejects a wrong root secret outright', async () => {
    expect((await laneEnvelopeSelfTest()).wrong_root_rejected).toBe(true);
  });

  it('the whole certificate is green', async () => {
    expect((await laneEnvelopeSelfTest()).ok).toBe(true);
  });
});

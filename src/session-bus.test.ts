import { describe, it, expect } from 'vitest';
import { sessionBusSelfTest } from './session-bus';

describe('sessionBusSelfTest — the event bus that replaces the socket (COROS over hyperbolic-sync, no D1 needed)', () => {
  it('a job enqueued cloud-side, polled, and answered by a sealed submit round-trips the real result', async () => {
    expect((await sessionBusSelfTest()).job_roundtrip).toBe(true);
  });

  it('a wire sealed for one lane does not authenticate under a different lane', async () => {
    expect((await sessionBusSelfTest()).lane_isolation).toBe(true);
  });

  it('a lane reads closed before any poll and open right after one — polling IS the heartbeat now', async () => {
    expect((await sessionBusSelfTest()).heartbeat_tracks_polls).toBe(true);
  });

  it('a job nobody answers times out honestly instead of hanging or fabricating a result', async () => {
    expect((await sessionBusSelfTest()).awaits_time_out_honestly).toBe(true);
  });

  it('the whole certificate is green', async () => {
    expect((await sessionBusSelfTest()).ok).toBe(true);
  });
});

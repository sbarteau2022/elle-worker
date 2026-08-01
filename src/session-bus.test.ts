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

  it('the hybrid v2 handshake, wired into the real engine, round-trips a job end-to-end', async () => {
    expect((await sessionBusSelfTest()).v2_handshake_roundtrip).toBe(true);
  });

  it('a v2 wire is genuinely v2 — the v1 pre-shared channel cannot open it', async () => {
    expect((await sessionBusSelfTest()).v2_is_really_v2).toBe(true);
  });

  it('the ELLE_LANE_PROTOCOL flag gates it: with v2 off, a stored handshake root is ignored and v1 is used', async () => {
    expect((await sessionBusSelfTest()).flag_off_stays_v1).toBe(true);
  });

  it('the whole certificate is green', async () => {
    expect((await sessionBusSelfTest()).ok).toBe(true);
  });
});

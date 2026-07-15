import { describe, it, expect } from 'vitest';
import {
  initGuard, recordFailedOpen, burnChannel, assertNotBurned,
  generateEphemeral, rekey, signalCollapseSelfTest,
} from './signal-collapse';

describe('burn lifecycle', () => {
  it('assertNotBurned is silent before a burn and throws after', async () => {
    const guard = initGuard('c1');
    expect(() => assertNotBurned(guard)).not.toThrow();
    await burnChannel(guard, 'manual_duress');
    expect(() => assertNotBurned(guard)).toThrow(/burned/);
  });

  it('records the reason and timestamp', async () => {
    const guard = initGuard('c2');
    const before = Date.now();
    await burnChannel(guard, 'replay_attempt');
    expect(guard.burnReason).toBe('replay_attempt');
    expect(guard.burnedAt).toBeGreaterThanOrEqual(before);
  });

  it('best-effort scrubs any secret material handed to it', async () => {
    const guard = initGuard('c3');
    const key = new Uint8Array([9, 9, 9, 9]);
    await burnChannel(guard, 'manual_duress', [key]);
    expect(Array.from(key)).toEqual([0, 0, 0, 0]);
  });

  it('a burned channel stays burned — burning again re-stamps rather than un-burning', async () => {
    const guard = initGuard('c4');
    await burnChannel(guard, 'burst_failures');
    await burnChannel(guard, 'manual_duress');
    expect(guard.burned).toBe(true);
    expect(guard.burnReason).toBe('manual_duress'); // no special-casing — the latest burn call wins
  });
});

describe('burst detection (fishing / brute-force evidence)', () => {
  it('does not flag a burst under the threshold', () => {
    const guard = initGuard('burst-a');
    const now = Date.now();
    let flagged = false;
    for (let i = 0; i < 3; i++) if (recordFailedOpen(guard, now + i).burst) flagged = true;
    expect(flagged).toBe(false);
  });
  it('flags a burst once the threshold is crossed within the window', () => {
    const guard = initGuard('burst-b');
    const now = Date.now();
    let flagged = false;
    for (let i = 0; i < 8; i++) if (recordFailedOpen(guard, now + i).burst) flagged = true;
    expect(flagged).toBe(true);
  });
  it('does not flag failures spread outside the window', () => {
    const guard = initGuard('burst-c');
    const now = Date.now();
    let flagged = false;
    for (let i = 0; i < 8; i++) if (recordFailedOpen(guard, now + i * 20_000).burst) flagged = true; // 20s apart
    expect(flagged).toBe(false);
  });
});

describe('ECDH rekey — post-compromise recovery', () => {
  it('two legitimate parties derive the identical new master', async () => {
    const oldMaster = new Uint8Array(32).fill(3);
    const alice = await generateEphemeral();
    const bob = await generateEphemeral();
    const aliceNew = await rekey(oldMaster, alice, bob.publicKeyRaw);
    const bobNew = await rekey(oldMaster, bob, alice.publicKeyRaw);
    expect(Array.from(aliceNew)).toEqual(Array.from(bobNew));
  });

  it('the new master differs from the old one and across runs (fresh ephemerals)', async () => {
    const oldMaster = new Uint8Array(32).fill(3);
    const a1 = await generateEphemeral(), b1 = await generateEphemeral();
    const a2 = await generateEphemeral(), b2 = await generateEphemeral();
    const new1 = await rekey(oldMaster, a1, b1.publicKeyRaw);
    const new2 = await rekey(oldMaster, a2, b2.publicKeyRaw);
    expect(Array.from(new1)).not.toEqual(Array.from(oldMaster));
    expect(Array.from(new1)).not.toEqual(Array.from(new2));
  });

  it('THE core property: an attacker holding the old master alone cannot reproduce the new one', async () => {
    const oldMaster = new Uint8Array(32).fill(7); // "leaked" — the attacker has this
    const alice = await generateEphemeral();
    const bob = await generateEphemeral();
    const legitimateNew = await rekey(oldMaster, alice, bob.publicKeyRaw);

    // The attacker has oldMaster and can see bob's public key on the wire,
    // but has neither alice's nor bob's private key — the only move available
    // is generating their own keypair, which lands on a different shared secret.
    const attacker = await generateEphemeral();
    const attackerGuess = await rekey(oldMaster, attacker, bob.publicKeyRaw);
    expect(Array.from(attackerGuess)).not.toEqual(Array.from(legitimateNew));
  });
});

describe('signalCollapseSelfTest — end-to-end invariant check', () => {
  it('passes every invariant, including the post-compromise-recovery proof', async () => {
    const r = await signalCollapseSelfTest();
    expect(r.burn_blocks_further_use).toBe(true);
    expect(r.burst_detected).toBe(true);
    expect(r.secret_scrubbed).toBe(true);
    expect(r.rekey_parties_agree).toBe(true);
    expect(r.rekey_heals_a_leaked_master).toBe(true);
    expect(r.ok).toBe(true);
  });
});

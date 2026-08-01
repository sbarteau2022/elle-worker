import { describe, it, expect } from 'vitest';
import {
  initGuard, recordFailedOpen, burnChannel, assertNotBurned,
  generateRatchetKeys, rekeyInitiate, rekeyRespond, signalCollapseSelfTest,
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

describe('hybrid PQC rekey — post-compromise recovery', () => {
  it('initiator and responder derive the identical new master', async () => {
    const oldMaster = new Uint8Array(32).fill(3);
    const bob = generateRatchetKeys();
    const { ciphertext, newMaster: aliceNew } = await rekeyInitiate(oldMaster, bob.publicKey);
    const bobNew = await rekeyRespond(oldMaster, bob, ciphertext);
    expect(Array.from(aliceNew)).toEqual(Array.from(bobNew));
  });

  it('the new master differs from the old one and across runs (fresh ephemerals)', async () => {
    const oldMaster = new Uint8Array(32).fill(3);
    const b1 = generateRatchetKeys();
    const b2 = generateRatchetKeys();
    const { newMaster: new1 } = await rekeyInitiate(oldMaster, b1.publicKey);
    const { newMaster: new2 } = await rekeyInitiate(oldMaster, b2.publicKey);
    expect(Array.from(new1)).not.toEqual(Array.from(oldMaster));
    expect(Array.from(new1)).not.toEqual(Array.from(new2));
  });

  it('THE core property: an attacker holding the old master alone cannot reproduce the new one', async () => {
    const oldMaster = new Uint8Array(32).fill(7); // "leaked" — the attacker has this
    const bob = generateRatchetKeys();
    const { ciphertext, newMaster: legitimateNew } = await rekeyInitiate(oldMaster, bob.publicKey);

    // The attacker has oldMaster and can see the ciphertext + bob's public key on
    // the wire, but not bob's ratchet secret key — the only move available is
    // generating their own keypair, which decapsulates to a different secret.
    const attacker = generateRatchetKeys();
    const attackerGuess = await rekeyRespond(oldMaster, attacker, ciphertext);
    expect(Array.from(attackerGuess)).not.toEqual(Array.from(legitimateNew));
  });

  it('the ratchet round is hybrid post-quantum (carries an ML-KEM ciphertext)', async () => {
    const oldMaster = new Uint8Array(32).fill(5);
    const bob = generateRatchetKeys();
    const { ciphertext } = await rekeyInitiate(oldMaster, bob.publicKey);
    expect(ciphertext.mlkem.length).toBeGreaterThan(0); // ML-KEM-768 ciphertext present
    expect(ciphertext.epk.length).toBe(32);             // fresh ephemeral X25519 public key
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
    expect(r.rekey_is_post_quantum).toBe(true);
    expect(r.ok).toBe(true);
  });
});

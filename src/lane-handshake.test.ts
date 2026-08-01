import { describe, it, expect } from 'vitest';
import {
  deriveLaneRoot, laneHandshakeClientKeys, laneHandshakeClientFinish,
  laneHandshakeAccept, laneChannelV2, laneHandshakeSelfTest,
  encodeHello, decodeHelloPub, encodeAccept, decodeAcceptCt,
} from './lane-handshake';
import { laneChannelStart, sealForLane, openFromLane } from './lane-envelope';
import type { PqcPublicKey, PqcCiphertext } from './pqc-hybrid';

const hex = (u: Uint8Array) => Buffer.from(u).toString('hex');

// ── The cross-runtime known-answer vector ─────────────────────────────────────
// deriveLaneRoot is deterministic over its byte inputs (everything random — the
// KEM — happens upstream). This EXACT hex must be reproduced by the laptop port
// (Elle/electron/native/providers/lane-handshake.test.cjs) from the SAME inputs.
// Two runtimes asserting one hardcoded hex is the byte-parity proof the design
// doc requires before anything relies on the combiner.
const KAT_ROOT = '8a9ade83ccae5ba3fbe95446854706d163844c7895d278ec6d599d4aecf2af32';

describe('deriveLaneRoot — canonical cross-runtime vector', () => {
  it('produces the pinned root_lane from the fixed KAT inputs', async () => {
    const preshared = new Uint8Array(32).fill(0x01);
    const ss = new Uint8Array(32).fill(0x02);
    const pk = { profile: 'vetted', mlkem: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]), x25519: Uint8Array.from([9, 10, 11, 12]) } as PqcPublicKey;
    const ct = { profile: 'vetted', mlkem: Uint8Array.from([13, 14, 15, 16]), epk: Uint8Array.from([17, 18, 19, 20]) } as PqcCiphertext;
    const root = await deriveLaneRoot(preshared, ss, 'alpha:to_local', 7, pk, ct);
    expect(hex(root)).toBe(KAT_ROOT);
  });
});

describe('the two-role hybrid handshake', () => {
  it('laptop and worker derive the identical root_lane', async () => {
    const preshared = crypto.getRandomValues(new Uint8Array(32));
    const client = laneHandshakeClientKeys();
    const { ciphertext, rootLane: workerRoot } = await laneHandshakeAccept(preshared, 'beta:to_cloud', 3, client.publicKey);
    const clientRoot = await laneHandshakeClientFinish(preshared, 'beta:to_cloud', 3, client, ciphertext);
    expect(hex(workerRoot)).toBe(hex(clientRoot));
  });

  it('the ACCEPT carries a real ML-KEM ciphertext + a fresh X25519 ephemeral', async () => {
    const preshared = crypto.getRandomValues(new Uint8Array(32));
    const client = laneHandshakeClientKeys();
    const { ciphertext } = await laneHandshakeAccept(preshared, 'l', 1, client.publicKey);
    expect(ciphertext.mlkem.length).toBeGreaterThan(1000); // ML-KEM-768 ciphertext ≈ 1088 bytes
    expect(ciphertext.epk.length).toBe(32);
  });

  it('the derived root drives a working v2 lane channel (seal → open)', async () => {
    const preshared = crypto.getRandomValues(new Uint8Array(32));
    const client = laneHandshakeClientKeys();
    const { ciphertext, rootLane } = await laneHandshakeAccept(preshared, 'alpha:to_local', 9, client.publicKey);
    // the peer independently derives the same root and opens what the other sealed
    const peerRoot = await laneHandshakeClientFinish(preshared, 'alpha:to_local', 9, client, ciphertext);
    const chSend = await laneChannelV2(rootLane);
    const chRecv = await laneChannelV2(peerRoot);
    const job = { kind: 'exec', code: 'print(42)' };
    const sealed = await sealForLane(chSend, laneChannelStart(chSend), job);
    const opened = await openFromLane(chRecv, laneChannelStart(chRecv), sealed.wire, 8);
    expect(opened.payload).toEqual(job);
  });

  it('a different pre-shared secret yields a different root_lane (bound to it)', async () => {
    const client = laneHandshakeClientKeys();
    const p1 = crypto.getRandomValues(new Uint8Array(32));
    const p2 = crypto.getRandomValues(new Uint8Array(32));
    const { ciphertext, rootLane: r1 } = await laneHandshakeAccept(p1, 'l', 1, client.publicKey);
    const r2 = await laneHandshakeClientFinish(p2, 'l', 1, client, ciphertext);
    expect(hex(r1)).not.toBe(hex(r2));
  });

  it('a tampered ACCEPT ciphertext cannot reproduce the root', async () => {
    const preshared = crypto.getRandomValues(new Uint8Array(32));
    const client = laneHandshakeClientKeys();
    const { ciphertext, rootLane } = await laneHandshakeAccept(preshared, 'l', 1, client.publicKey);
    const tampered = { ...ciphertext, mlkem: Uint8Array.from(ciphertext.mlkem) };
    tampered.mlkem[0] ^= 1;
    const guess = await laneHandshakeClientFinish(preshared, 'l', 1, client, tampered);
    expect(hex(guess)).not.toBe(hex(rootLane));
  });
});

describe('wire (de)serialization round-trips the HELLO/ACCEPT bodies', () => {
  it('HELLO public key survives encode → decode', () => {
    const client = laneHandshakeClientKeys();
    const w = encodeHello('alpha:to_local', 5, client.publicKey);
    const pk = decodeHelloPub(w);
    expect(hex(pk.mlkem)).toBe(hex(client.publicKey.mlkem));
    expect(hex(pk.x25519)).toBe(hex(client.publicKey.x25519));
    expect(w.v).toBe(2);
  });
  it('ACCEPT ciphertext survives encode → decode and still finishes', async () => {
    const preshared = crypto.getRandomValues(new Uint8Array(32));
    const client = laneHandshakeClientKeys();
    const { ciphertext, rootLane } = await laneHandshakeAccept(preshared, 'l', 2, client.publicKey);
    const round = decodeAcceptCt(encodeAccept(ciphertext));
    const r = await laneHandshakeClientFinish(preshared, 'l', 2, client, round);
    expect(hex(r)).toBe(hex(rootLane));
  });
});

describe('laneHandshakeSelfTest', () => {
  it('passes every invariant', async () => {
    const r = await laneHandshakeSelfTest();
    expect(r.parties_agree).toBe(true);
    expect(r.root_is_post_quantum).toBe(true);
    expect(r.v2_channel_roundtrips).toBe(true);
    expect(r.tamper_changes_root).toBe(true);
    expect(r.bound_to_preshared).toBe(true);
    expect(r.ok).toBe(true);
  });
});

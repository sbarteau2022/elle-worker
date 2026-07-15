// ============================================================
// SIGNAL COLLAPSE — src/signal-collapse.ts
//
// PLAIN LANGUAGE, UP FRONT, BEFORE THE CODE: "if an attacker breaks the
// noise wall and locates the signal, the signal collapses" has a real
// version and a fake version, and only the real one is built here.
//
// THE FAKE VERSION (not built, and cannot be built): detecting that a
// PURELY PASSIVE listener has intercepted or located a transmission with
// zero interaction with our system. That is undetectable by definition —
// there is no wire for that information to travel back on. Nothing in
// software can trigger on an event it never receives. Any design that
// claims otherwise is not describing a mechanism.
//
// THE REAL VERSION, built here, in two parts:
//
//   1. BURN ON BREACH. Things this system CAN actually observe as evidence
//      of an attacker touching the channel — a forged or replayed frame
//      (the forward-only guard in torus-sync.ts / hyperbolic-sync.ts /
//      hyperbolic-sync-fixed.ts already refuses these; this module counts
//      and acts on the refusals), a burst of failed decode attempts
//      (fishing/brute force), or the security network (security-network.ts,
//      "the Witness") flagging the tied actor as `blocked` from evidence
//      gathered ANYWHERE in the stack — immediately and permanently kill
//      that session. No graceful degradation, no quiet continuation. This
//      is the first place the Witness (which watches the world) and the
//      Corkscrew family (which by design does not) actually talk to each
//      other.
//
//   2. POST-COMPROMISE RECOVERY, i.e. the actual "self-healing" mechanism.
//      helix.ts's forward ratchet only protects OLD messages if a key leaks
//      LATER — it does NOT protect FUTURE messages if the CURRENT key
//      leaks, because the next key is a public, one-way function of the
//      current one: anyone holding today's key computes tomorrow's exactly
//      as well as the legitimate party does. Every doc so far named this
//      gap and called it out of scope. It is now built: a periodic
//      Diffie-Hellman exchange (the same idea behind Signal's Double
//      Ratchet) injects a FRESH secret that comes only from a live exchange
//      neither side has disclosed — so a fully compromised master key heals
//      the moment the next rekey succeeds, even though the attacker still
//      has the old one.
//
// HONEST LIMIT ON THE BURN ITSELF: JavaScript cannot guarantee that
// "zeroing" a buffer actually erases the bytes from memory — the garbage
// collector may already have copied them elsewhere, and the language gives
// no secure-erase primitive. Zeroing here raises the bar (a casual memory
// scrape finds zeros, not the key) — it is not a proof the key is gone, and
// it is not a substitute for the rekey, which is the mechanism that
// actually matters.
// ============================================================

import type { Env } from './index';
import { getPosture, recordThreat } from './security-network';

// ── burn-on-breach ───────────────────────────────────────────────────────
export type BreachReason = 'replay_attempt' | 'burst_failures' | 'witness_blocked' | 'manual_duress';

export interface ChannelGuard {
  channelId: string;
  burned: boolean;
  burnedAt: number | null;
  burnReason: BreachReason | null;
  failureTimestamps: number[]; // rolling window, for burst detection
}

export function initGuard(channelId: string): ChannelGuard {
  return { channelId, burned: false, burnedAt: null, burnReason: null, failureTimestamps: [] };
}

const FAILURE_WINDOW_MS = 60_000;
const FAILURE_BURST_THRESHOLD = 6; // more than this many failed opens inside the window ⇒ burst

// Record one failed decode attempt (a tag failure, or "no in-window position
// authenticated" from any *sync.ts open()). Returns whether THIS attempt
// crosses the burst threshold — the caller decides whether to burn, so the
// policy stays visible at the call site rather than hidden in here.
export function recordFailedOpen(guard: ChannelGuard, now: number): { burst: boolean; count: number } {
  guard.failureTimestamps = guard.failureTimestamps.filter((t) => now - t < FAILURE_WINDOW_MS);
  guard.failureTimestamps.push(now);
  const count = guard.failureTimestamps.length;
  return { burst: count >= FAILURE_BURST_THRESHOLD, count };
}

// Kill the channel: mark it dead, best-effort scrub whatever secret bytes
// the caller hands in, and — if a Witness tie-in is given — record the
// breach so the actor's posture escalates for every OTHER door too, not
// just this one.
export async function burnChannel(
  guard: ChannelGuard, reason: BreachReason, secretMaterial: Uint8Array[] = [],
  witness?: { env: Env; actorKey: string; detail: string },
): Promise<void> {
  for (const buf of secretMaterial) buf.fill(0); // best-effort; see the honest limit in the header
  guard.burned = true;
  guard.burnedAt = Date.now();
  guard.burnReason = reason;
  if (witness) {
    const kind = reason === 'replay_attempt' ? 'sync.replay_attempt' : 'sync.breach_burn';
    await recordThreat(witness.env, { actorKey: witness.actorKey, source: 'sync', kind, detail: witness.detail }).catch(() => {});
  }
}

// Call at the top of any seal/open wrapper — throws (refuses to speak) once burned.
export function assertNotBurned(guard: ChannelGuard): void {
  if (guard.burned) {
    throw new Error(
      `signal-collapse: channel "${guard.channelId}" burned (${guard.burnReason}) at ` +
      `${new Date(guard.burnedAt as number).toISOString()} — refusing to speak until a fresh rekey`,
    );
  }
}

// The Witness/Corkscrew wiring point: something observed ANYWHERE else in
// the stack (a bad login, a flagged upload, a recon pattern tied to the same
// actor) can now reach across and kill a signal-tunnel session, even though
// the tunnel itself saw nothing wrong on its own wire.
export async function checkWitnessPosture(env: Env, guard: ChannelGuard, actorKey: string): Promise<boolean> {
  if (guard.burned) return true;
  const { posture } = await getPosture(env, actorKey).catch(() => ({ posture: 'normal' as const, score: 0 }));
  if (posture === 'blocked') {
    await burnChannel(guard, 'witness_blocked', [], {
      env, actorKey, detail: 'security-network posture reached blocked for this actor',
    });
    return true;
  }
  return false;
}

// ── post-compromise recovery — the DH ratchet step ──────────────────────
// P-256 ECDH: chosen for universal WebCrypto support (every implementation,
// Cloudflare Workers included, has long-standing ECDH/P-256 support) over a
// faster curve that raises an "is this available here" question.
export interface EphemeralKeyPair { privateKey: CryptoKey; publicKeyRaw: Uint8Array }

export async function generateEphemeral(): Promise<EphemeralKeyPair> {
  const pair = (await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'],
  )) as CryptoKeyPair;
  // exportKey's return type is a union (ArrayBuffer | JsonWebKey) because the
  // Cloudflare typings don't discriminate on the format string literal; 'raw'
  // always yields an ArrayBuffer at runtime.
  const raw = (await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer;
  return { privateKey: pair.privateKey, publicKeyRaw: new Uint8Array(raw) };
}

// Combine the OLD master with a FRESH ECDH shared secret into the NEW master.
// Both sides run this with their own ephemeral private key and the peer's
// ephemeral public key; ECDH guarantees they land on the identical shared
// secret without ever transmitting it. Using the DH output as the HKDF SALT
// (rather than concatenating it into the input key material) means the
// extraction step is an HMAC keyed by the fresh secret — so the output is
// unpredictable to anyone who lacks the DH secret, REGARDLESS of whether
// they have the old master. That is the actual post-compromise-recovery
// property: a leaked old master, on its own, buys the attacker nothing here.
export async function rekey(
  oldMaster: Uint8Array, myEphemeral: EphemeralKeyPair, peerPublicKeyRaw: Uint8Array,
): Promise<Uint8Array> {
  const peerKey = await crypto.subtle.importKey('raw', peerPublicKeyRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  // The real Web Crypto API (and the actual workerd runtime) names this field
  // `public` — Cloudflare's workers-types package mistypes it as `$public`
  // (a codegen artifact escaping the reserved word), so this is a narrow,
  // deliberate cast to send the correct runtime shape past an incorrect type.
  const ecdhParams = { name: 'ECDH', public: peerKey } as unknown as SubtleCryptoDeriveKeyAlgorithm;
  const sharedBits = await crypto.subtle.deriveBits(ecdhParams, myEphemeral.privateKey, 256);
  const base = await crypto.subtle.importKey('raw', oldMaster, 'HKDF', false, ['deriveBits']);
  const newMaster = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(sharedBits), info: new TextEncoder().encode('coros-dh-ratchet-v1') },
    base, 256,
  );
  return new Uint8Array(newMaster);
}

// ── self-test — the burn lifecycle, burst detection, and the actual proof
// of post-compromise recovery: two legitimate parties land on the identical
// new master, and an attacker holding the OLD master but neither ephemeral
// private key derives something different. Env-touching paths (the Witness
// tie-in) are exercised live via the admin endpoint, the same convention
// security-network.ts's own recordThreat/getPosture already follow.
export interface SignalCollapseSelfTest {
  ok: boolean;
  burn_blocks_further_use: boolean;
  burst_detected: boolean;
  secret_scrubbed: boolean;
  rekey_parties_agree: boolean;
  rekey_heals_a_leaked_master: boolean; // an attacker with the OLD master alone cannot reproduce the new one
  note: string;
}

export async function signalCollapseSelfTest(): Promise<SignalCollapseSelfTest> {
  // burn lifecycle
  const guard = initGuard('test-channel');
  const secret = new Uint8Array([1, 2, 3, 4]);
  await burnChannel(guard, 'manual_duress', [secret]);
  let burn_blocks_further_use = false;
  try { assertNotBurned(guard); } catch { burn_blocks_further_use = true; }
  const secret_scrubbed = secret.every((b) => b === 0);

  // burst detection
  const g2 = initGuard('burst-channel');
  const now = Date.now();
  let burst_detected = false;
  for (let i = 0; i < FAILURE_BURST_THRESHOLD; i++) {
    const r = recordFailedOpen(g2, now + i);
    if (r.burst) burst_detected = true;
  }

  // post-compromise recovery: Alice and Bob derive the identical new master
  const oldMaster = crypto.getRandomValues(new Uint8Array(32));
  const alice = await generateEphemeral();
  const bob = await generateEphemeral();
  const aliceNew = await rekey(oldMaster, alice, bob.publicKeyRaw);
  const bobNew = await rekey(oldMaster, bob, alice.publicKeyRaw);
  const rekey_parties_agree = aliceNew.every((b, i) => b === bobNew[i]);

  // an attacker who captured `oldMaster` but has neither party's ephemeral
  // private key generates their OWN keypair (the only thing they can do) and
  // gets a DIFFERENT result — proving the leaked master alone is insufficient.
  const attacker = await generateEphemeral();
  const attackerGuess = await rekey(oldMaster, attacker, bob.publicKeyRaw);
  const rekey_heals_a_leaked_master = !attackerGuess.every((b, i) => b === aliceNew[i]);

  const ok = burn_blocks_further_use && burst_detected && secret_scrubbed &&
    rekey_parties_agree && rekey_heals_a_leaked_master;
  return {
    ok, burn_blocks_further_use, burst_detected, secret_scrubbed,
    rekey_parties_agree, rekey_heals_a_leaked_master,
    note: 'Burn is a local lockout + Witness notification, not a retroactive undo — nothing un-intercepts bytes already captured. Rekey is the real self-healing mechanism: a fresh ECDH exchange means a leaked master, by itself, does not compromise the next epoch. A purely passive interceptor who never touches this system remains undetectable by definition — no design changes that.',
  };
}

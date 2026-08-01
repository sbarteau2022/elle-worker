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
import {
  pqcHybridKeygen, pqcHybridEncaps, pqcHybridDecaps,
  type PqcProfile, type PqcPublicKey, type PqcCiphertext,
} from './pqc-hybrid';

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

// ── post-compromise recovery — the HYBRID PQC ratchet step ──────────────────
// This used to be a bare P-256 ECDH ratchet. P-256 is exactly what Shor breaks,
// so a ratchet built on it is the one place a future quantum adversary gets
// retroactive decryption of everything that rode it (the harvest-now-decrypt-
// later exposure the design doc §2.4 flags as the hard prerequisite). The fresh
// secret is now agreed with the hybrid KEM (src/pqc-hybrid.ts): X25519 +
// ML-KEM-768, combined so an attacker must break BOTH legs to learn it. HKDF +
// AES-256-GCM downstream were already quantum-safe and are unchanged — only the
// key-agreement primitive moves.
//
// A KEM is asymmetric (unlike the old symmetric DH), so the round has two roles:
// the RESPONDER publishes a fresh ratchet public key, the INITIATOR encapsulates
// to it (its own fresh ephemeral inside pqcHybridEncaps gives forward secrecy),
// and both fold the agreed hybrid secret into the old master. KEM correctness
// puts them on the identical new master without either transmitting it.
//
// Default profile is 'vetted' (two audited legs). 'experimental' additionally
// mixes the repo's own unreviewed QC-MDPC leg; by the hybrid OR-property that
// can only ever ADD strength, never subtract it.
export interface RatchetKeyPair { publicKey: PqcPublicKey; secretKey: import('./pqc-hybrid').PqcSecretKey }

export function generateRatchetKeys(profile: PqcProfile = 'vetted'): RatchetKeyPair {
  return pqcHybridKeygen(profile);
}

// Fold a fresh hybrid KEM secret into the old master to make the new one. The
// hybrid secret is the HKDF SALT and the old master is the IKM — so extraction
// is an HMAC keyed by the fresh secret, and the output is unpredictable to
// anyone lacking that secret REGARDLESS of whether they hold the old master.
// That is the post-compromise-recovery property (a leaked old master alone buys
// nothing), preserved byte-for-shape from the classical ratchet — now with a
// quantum-safe fresh secret. (Salt=fresh / IKM=old is inverted from the
// Signal/Noise convention but is exactly what yields PCR here; do not "correct"
// it into IKM=fresh, which would drop the property.)
async function foldMaster(hybridSecret: Uint8Array, oldMaster: Uint8Array): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey('raw', oldMaster, 'HKDF', false, ['deriveBits']);
  const newMaster = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: hybridSecret, info: new TextEncoder().encode('coros-pq-ratchet-v1') },
    base, 256,
  );
  return new Uint8Array(newMaster);
}

// INITIATOR: encapsulate to the responder's fresh ratchet public key, fold the
// agreed secret into the old master, and hand back the ciphertext to send.
export async function rekeyInitiate(
  oldMaster: Uint8Array, peerPublicKey: PqcPublicKey,
): Promise<{ ciphertext: PqcCiphertext; newMaster: Uint8Array }> {
  const { ciphertext, sharedSecret } = await pqcHybridEncaps(peerPublicKey);
  return { ciphertext, newMaster: await foldMaster(sharedSecret, oldMaster) };
}

// RESPONDER: decapsulate the initiator's ciphertext with the ratchet secret key,
// fold into the old master. Lands on the identical new master as the initiator.
export async function rekeyRespond(
  oldMaster: Uint8Array, myKeys: RatchetKeyPair, ciphertext: PqcCiphertext,
): Promise<Uint8Array> {
  const sharedSecret = await pqcHybridDecaps(myKeys.secretKey, myKeys.publicKey, ciphertext);
  return foldMaster(sharedSecret, oldMaster);
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
  rekey_is_post_quantum: boolean;       // the ratchet round carries an ML-KEM ciphertext (hybrid, not bare ECDH)
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

  // post-compromise recovery: the responder (Bob) publishes a fresh ratchet
  // public key, the initiator (Alice) encapsulates to it. Both fold the agreed
  // hybrid secret into the old master and land on the identical new master.
  const oldMaster = crypto.getRandomValues(new Uint8Array(32));
  const bob = generateRatchetKeys();
  const { ciphertext, newMaster: aliceNew } = await rekeyInitiate(oldMaster, bob.publicKey);
  const bobNew = await rekeyRespond(oldMaster, bob, ciphertext);
  const rekey_parties_agree = aliceNew.every((b, i) => b === bobNew[i]);

  // an attacker who captured `oldMaster` and the on-wire ciphertext + public key
  // but NOT bob's ratchet secret key cannot decapsulate; their own keypair lands
  // on a different secret (ML-KEM's implicit rejection) ⇒ a different master —
  // proving the leaked master alone is insufficient.
  const attacker = generateRatchetKeys();
  const attackerGuess = await rekeyRespond(oldMaster, attacker, ciphertext);
  const rekey_heals_a_leaked_master = !attackerGuess.every((b, i) => b === aliceNew[i]);

  // the round is genuinely hybrid-PQ: it carries an ML-KEM ciphertext and a
  // fresh ephemeral X25519 key, not a bare P-256 point.
  const rekey_is_post_quantum = ciphertext.mlkem.length > 0 && ciphertext.epk.length > 0;

  const ok = burn_blocks_further_use && burst_detected && secret_scrubbed &&
    rekey_parties_agree && rekey_heals_a_leaked_master && rekey_is_post_quantum;
  return {
    ok, burn_blocks_further_use, burst_detected, secret_scrubbed,
    rekey_parties_agree, rekey_heals_a_leaked_master, rekey_is_post_quantum,
    note: 'Burn is a local lockout + Witness notification, not a retroactive undo — nothing un-intercepts bytes already captured. Rekey is the real self-healing mechanism: a fresh HYBRID (X25519 + ML-KEM-768) key agreement means a leaked master, by itself, does not compromise the next epoch — and a recorded ratchet round cannot be solved by a future quantum computer (the bare-P-256 version this replaces could). A purely passive interceptor who never touches this system remains undetectable by definition — no design changes that.',
  };
}

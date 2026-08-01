// ============================================================
// LANE HANDSHAKE — src/lane-handshake.ts   (PQC Phase 1, worker side)
//
// Replaces "the lane root IS the pre-shared secret" with "the lane root is
// DERIVED from a hybrid key agreement, still bound to the pre-shared secret."
// This is the change the Rosen-bridge design doc (docs/PQC_ROSEN_BRIDGE_DESIGN.md
// §4.1) specifies: it buys forward secrecy and PQ-harvest resistance, and it is
// hybrid from day one so it can never be worse than today's pre-shared baseline.
//
// THE FLOW (a KEM, so it has two roles — the laptop initiates):
//
//   laptop (initiator)                         worker (responder)
//     generate hybrid keypair (ek_c)   --HELLO{pk,lane,epoch}-->
//                                                encaps(pk) → (ct, ss)
//                                       <--ACCEPT{ct}----------
//     decaps(ct) → ss
//     both:  root_lane = HKDF( ikm=ss‖preshared, salt=transcript,
//                              info="elle-lane-root-v2:<lane>:<epoch>" )
//
// The hybrid secret `ss` is pqc-hybrid.ts's own combined output (X25519 +
// ML-KEM-768), so an attacker must break BOTH legs to learn it. Folding in the
// pre-shared root as extra IKM authenticates the handshake during migration and
// guarantees G3 (never below today's security, even if both legs broke). The
// ephemerals (fresh per handshake) give forward secrecy; the transcript binds
// the derived root to the exact keys/ciphertext so legs can't be spliced.
//
// SCOPE — this is the reviewed CRYPTO CORE, proven byte-identical against the
// laptop port (Elle/electron/native/providers/lane-handshake.cjs) by a shared
// known-answer vector (deriveLaneRoot is deterministic). It deliberately does
// NOT wire the live routing yet: session-bus.ts still runs the v1 pre-shared
// path. The design doc sequences it that way on purpose — land the interop
// proof first, cut routing over (epoch state + /handshake route + version
// negotiation) as its own reviewed pass. Nothing here changes a live wire.
// ============================================================

import {
  pqcHybridKeygen, pqcHybridEncaps, pqcHybridDecaps,
  type PqcPublicKey, type PqcSecretKey, type PqcCiphertext,
} from './pqc-hybrid';
import { initHypChannel, type HypChannel } from './hyperbolic-sync';

export const LANE_PROTOCOL_V2 = 2 as const;

const enc = (s: string) => new TextEncoder().encode(s);
function u32be(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, false);
  return b;
}
function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let n = 0; for (const p of parts) n += p.length;
  const out = new Uint8Array(n); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// The transcript that binds root_lane to the exact handshake that produced it.
// Fixed field order + fixed per-field lengths (the ML-KEM / X25519 sizes are
// constant), so the concatenation is unambiguous. MUST match the .cjs mirror.
async function laneTranscript(
  lane: string, epoch: number, pk: PqcPublicKey, ct: PqcCiphertext,
): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', concatBytes(
    enc(`elle-lane-root-v2|${lane}|`), u32be(epoch), pk.mlkem, pk.x25519, ct.mlkem, ct.epk,
  ));
  return new Uint8Array(digest);
}

// The combiner. DETERMINISTIC and pure over its byte inputs — this is the
// function the cross-runtime known-answer vector pins, because everything
// random (the KEM) happens upstream and arrives here as fixed bytes.
export async function deriveLaneRoot(
  preshared: Uint8Array, hybridSecret: Uint8Array,
  lane: string, epoch: number, pk: PqcPublicKey, ct: PqcCiphertext,
): Promise<Uint8Array> {
  const salt = await laneTranscript(lane, epoch, pk, ct);
  const ikm = concatBytes(hybridSecret, preshared); // ss ‖ preshared_root
  const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: enc(`elle-lane-root-v2:${lane}:${epoch}`) },
    base, 256,
  );
  return new Uint8Array(bits);
}

// ── initiator (laptop) helpers — also used by the interop vector on this side ──
export interface LaneClientKeys { publicKey: PqcPublicKey; secretKey: PqcSecretKey }
export function laneHandshakeClientKeys(): LaneClientKeys {
  return pqcHybridKeygen('vetted'); // two audited legs; the laptop mirror matches
}

// initiator finishes: decapsulate the ACCEPT ciphertext, derive root_lane.
export async function laneHandshakeClientFinish(
  preshared: Uint8Array, lane: string, epoch: number,
  clientKeys: LaneClientKeys, ciphertext: PqcCiphertext,
): Promise<Uint8Array> {
  const ss = await pqcHybridDecaps(clientKeys.secretKey, clientKeys.publicKey, ciphertext);
  return deriveLaneRoot(preshared, ss, lane, epoch, clientKeys.publicKey, ciphertext);
}

// ── responder (worker) — the ACCEPT step ──────────────────────────────────────
// Given the laptop's HELLO public key, encapsulate to it and derive root_lane.
// Returns the ciphertext to send back plus this side's root_lane.
export async function laneHandshakeAccept(
  preshared: Uint8Array, lane: string, epoch: number, clientPub: PqcPublicKey,
): Promise<{ ciphertext: PqcCiphertext; rootLane: Uint8Array }> {
  const { ciphertext, sharedSecret } = await pqcHybridEncaps(clientPub);
  const rootLane = await deriveLaneRoot(preshared, sharedSecret, lane, epoch, clientPub, ciphertext);
  return { ciphertext, rootLane };
}

// The v2 lane channel: root_lane straight into the geodesic. Everything
// downstream (hypSeal/hypOpen, the AEAD, session-bus state) is unchanged — we
// only swapped WHERE the root comes from (design §4.1). root_lane is already
// per-lane/per-epoch (the info string carries both), so it does NOT go back
// through lane-envelope's laneMaster — it seeds initHypChannel directly.
export async function laneChannelV2(rootLane: Uint8Array): Promise<HypChannel> {
  return initHypChannel(rootLane);
}

// ── wire (de)serialization — the HELLO / ACCEPT bodies, matched by the mirror ──
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export interface LaneHelloWire { v: number; lane: string; epoch: number; mlkem: string; x25519: string }
export interface LaneAcceptWire { v: number; mlkem: string; epk: string }

export function encodeHello(lane: string, epoch: number, pk: PqcPublicKey): LaneHelloWire {
  return { v: LANE_PROTOCOL_V2, lane, epoch, mlkem: b64(pk.mlkem), x25519: b64(pk.x25519) };
}
export function decodeHelloPub(w: LaneHelloWire): PqcPublicKey {
  return { profile: 'vetted', mlkem: unb64(w.mlkem), x25519: unb64(w.x25519) };
}
export function encodeAccept(ct: PqcCiphertext): LaneAcceptWire {
  return { v: LANE_PROTOCOL_V2, mlkem: b64(ct.mlkem), epk: b64(ct.epk) };
}
export function decodeAcceptCt(w: LaneAcceptWire): PqcCiphertext {
  return { profile: 'vetted', mlkem: unb64(w.mlkem), epk: unb64(w.epk) };
}

// ============================================================
// self-test — the full two-role handshake agrees on one root_lane, that root
// drives a working v2 lane channel, and a tampered ciphertext yields a
// different root (so it can't silently open). Same shape the other crypto
// modules expose; runs from /api/elle-lane-handshake-selftest.
// ============================================================
export interface LaneHandshakeSelfTest {
  ok: boolean;
  parties_agree: boolean;           // laptop finish == worker accept root_lane
  root_is_post_quantum: boolean;    // ACCEPT carries an ML-KEM ciphertext
  v2_channel_roundtrips: boolean;   // the derived root seals/opens a payload
  tamper_changes_root: boolean;     // a flipped ciphertext byte ⇒ different root
  bound_to_preshared: boolean;      // a different pre-shared root ⇒ different root_lane
  note: string;
}

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

export async function laneHandshakeSelfTest(): Promise<LaneHandshakeSelfTest> {
  const preshared = crypto.getRandomValues(new Uint8Array(32));
  const lane = 'alpha:to_local', epoch = 7;

  // laptop generates keys → worker accepts → laptop finishes
  const client = laneHandshakeClientKeys();
  const { ciphertext, rootLane: workerRoot } = await laneHandshakeAccept(preshared, lane, epoch, client.publicKey);
  const clientRoot = await laneHandshakeClientFinish(preshared, lane, epoch, client, ciphertext);
  const parties_agree = same(workerRoot, clientRoot);
  const root_is_post_quantum = ciphertext.mlkem.length > 0 && ciphertext.epk.length === 32;

  // the derived root drives a real v2 lane channel
  let v2_channel_roundtrips = false;
  try {
    const { laneChannelStart, sealForLane, openFromLane } = await import('./lane-envelope');
    const ch = await laneChannelV2(workerRoot);
    const sealed = await sealForLane(ch, laneChannelStart(ch), { kind: 'exec', code: 'print(1)' });
    const opened = await openFromLane(ch, laneChannelStart(ch), sealed.wire, 8);
    v2_channel_roundtrips = (opened.payload as { code?: string }).code === 'print(1)';
  } catch { v2_channel_roundtrips = false; }

  // a tampered ACCEPT ciphertext → ML-KEM implicit rejection → different root
  const tampered: PqcCiphertext = { ...ciphertext, mlkem: Uint8Array.from(ciphertext.mlkem) };
  tampered.mlkem[0] ^= 1;
  const tamperedRoot = await laneHandshakeClientFinish(preshared, lane, epoch, client, tampered);
  const tamper_changes_root = !same(tamperedRoot, clientRoot);

  // binding to the pre-shared secret: a different preshared ⇒ different root_lane
  const otherPre = crypto.getRandomValues(new Uint8Array(32));
  const otherRoot = await laneHandshakeClientFinish(otherPre, lane, epoch, client, ciphertext);
  const bound_to_preshared = !same(otherRoot, clientRoot);

  const ok = parties_agree && root_is_post_quantum && v2_channel_roundtrips &&
    tamper_changes_root && bound_to_preshared;
  return {
    ok, parties_agree, root_is_post_quantum, v2_channel_roundtrips, tamper_changes_root, bound_to_preshared,
    note: 'Hybrid (X25519 + ML-KEM-768) lane-root handshake: both roles derive one root_lane, folded with the pre-shared secret (never worse than today) and bound to the transcript. Forward-secret (fresh ephemerals) and PQ-harvest-resistant. This is the reviewed crypto core, proven byte-identical to the laptop port by a shared known-answer vector; it is NOT yet wired into the live session-bus routing (still v1) — that cutover is a separate pass per the design doc.',
  };
}

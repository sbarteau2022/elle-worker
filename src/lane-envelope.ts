// ============================================================
// LANE ENVELOPE — src/lane-envelope.ts
// "a play on the Rosen bridge instead of a websocket, or use the signal
// sender we built a few turns ago" — both, honestly composed, honestly
// bounded.
//
// The WebSocket carrying sandbox-lane dispatches is NOT replaced. Nothing
// here moves a bit without a channel — the no-communication theorem holds,
// same as hyperbolic-sync.ts's own header says. What this module actually
// composes, for real:
//   • COROS (helix.ts, "the signal sender") — the confidentiality/covertness
//     ENVELOPE: AES-256-GCM sealed, corkscrew-padded, whole-or-nothing.
//   • hyperbolic-sync.ts (the "Rosen bridge") — counter-free KEYSTREAM
//     SYNCHRONIZATION: two ends sharing a master + lane name agree on a
//     secret geodesic and derive the same per-tick key with no counter on
//     the wire, forward-only, resyncing after lost messages.
// Composed: a lane-dispatch payload sealed under the hyperbolic-synced key
// shows an observer uniform noise with no sequence number and no reused key
// — a real covertness/forward-secrecy gain, cleanly separate from the
// routing/transport question (still the WebSocket, still TLS underneath)
// that the Rosen framing never touches.
//
// EACH LANE GETS ITS OWN GEODESIC: laneChannel() runs the lane name through
// HKDF against one root secret before initHypChannel, so lane "alpha" and
// lane "beta" walk different, uncorrelated bridges off a single root — a
// leaked or misrouted wire for one lane authenticates against that lane's
// geodesic only. A test proves cross-lane wires do not open.
//
// HONEST BOUNDARY, STATED PLAINLY: this module seals and opens payloads —
// proven by its own self-test — but it is NOT wired into the live
// laneDispatch() → SandboxAgent DO → laptop path. Doing that for real needs
// BOTH ends of the wire to speak the sealed protocol: the DO's dispatch() in
// sandbox-agent.ts here, AND the laptop client in the Elle repo's
// electron/native/providers/sandbox-agent.cjs — a cross-repo change to a
// live execution path, deliberately left for its own reviewed pass rather
// than folded into this one. What's proven here is that the primitive
// itself is real, not that the live wire is sealed today.
// ============================================================

import {
  initHypChannel, hypStart, hypAdvance, hypSeal, hypOpen,
  type HypChannel, type HypState,
} from './hyperbolic-sync';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = new TextDecoder();

async function laneMaster(rootSecret: Uint8Array, lane: string): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey('raw', rootSecret, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc(`elle-lane-bridge-v1:${lane}`) },
    base, 256,
  );
  return new Uint8Array(bits);
}

// One distinct hyperbolic channel (secret geodesic) per lane, off one root.
export async function laneChannel(rootSecret: Uint8Array, lane: string): Promise<HypChannel> {
  return initHypChannel(await laneMaster(rootSecret, lane));
}

export function laneChannelStart(ch: HypChannel): HypState {
  return hypStart(ch);
}

export async function sealForLane(
  ch: HypChannel, state: HypState, payload: unknown,
): Promise<{ wire: Uint8Array; next: HypState }> {
  return hypSeal(ch, state, enc(JSON.stringify(payload)));
}

export async function openFromLane(
  ch: HypChannel, state: HypState, wire: Uint8Array, window = 32,
): Promise<{ payload: unknown; next: HypState }> {
  const { plaintext, next } = await hypOpen(ch, state, wire, window);
  return { payload: JSON.parse(dec.decode(plaintext)), next };
}

// ============================================================
// self-test — proves the composed primitive works, not that it guards the
// live wire (it doesn't yet — see the header).
// ============================================================
export interface LaneEnvelopeSelfTest {
  ok: boolean;
  roundtrip: boolean;
  distinct_geodesics_per_lane: boolean;
  lane_isolation: boolean;      // lane B's channel cannot open lane A's wire
  resync_after_loss: boolean;
  wrong_root_rejected: boolean;
  note: string;
}

export async function laneEnvelopeSelfTest(): Promise<LaneEnvelopeSelfTest> {
  const root = crypto.getRandomValues(new Uint8Array(32));
  const other = crypto.getRandomValues(new Uint8Array(32));

  const chA = await laneChannel(root, 'alpha');
  const chB = await laneChannel(root, 'beta');

  const distinct_geodesics_per_lane =
    chA.origin.some((v, i) => v !== chB.origin[i]) || chA.phi0 !== chB.phi0;

  // lock-step round-trip on one lane, real dispatch-shaped payloads
  let roundtrip = true;
  {
    let s = laneChannelStart(chA), r = laneChannelStart(chA);
    const jobs = [
      { lane: 'alpha', kind: 'exec', code: 'print(1)' },
      { lane: 'alpha', kind: 'exec', code: 'print(2)' },
    ];
    for (const job of jobs) {
      const sealedOut = await sealForLane(chA, s, job); s = sealedOut.next;
      const opened = await openFromLane(chA, r, sealedOut.wire); r = opened.next;
      if (JSON.stringify(opened.payload) !== JSON.stringify(job)) roundtrip = false;
    }
  }

  // lane isolation: a wire sealed on alpha's geodesic must not open on beta's
  let lane_isolation = false;
  try {
    const sealedOut = await sealForLane(chA, laneChannelStart(chA), { lane: 'alpha' });
    await openFromLane(chB, laneChannelStart(chB), sealedOut.wire, 8);
  } catch { lane_isolation = true; }

  // resync after loss: sender 5 ticks ahead of an idle receiver, same lane
  let resync_after_loss = false;
  try {
    let s5 = laneChannelStart(chA);
    for (let i = 0; i < 5; i++) s5 = hypAdvance(chA, s5);
    const sealedOut = await sealForLane(chA, s5, { probe: true });
    const opened = await openFromLane(chA, laneChannelStart(chA), sealedOut.wire, 8);
    resync_after_loss = (opened.payload as { probe?: boolean }).probe === true;
  } catch { resync_after_loss = false; }

  // wrong root secret ⇒ a different geodesic entirely ⇒ refused
  let wrong_root_rejected = false;
  try {
    const chWrong = await laneChannel(other, 'alpha');
    const sealedOut = await sealForLane(chA, laneChannelStart(chA), { x: 1 });
    await openFromLane(chWrong, laneChannelStart(chWrong), sealedOut.wire, 8);
  } catch { wrong_root_rejected = true; }

  const ok = roundtrip && distinct_geodesics_per_lane && lane_isolation &&
    resync_after_loss && wrong_root_rejected;
  return {
    ok, roundtrip, distinct_geodesics_per_lane, lane_isolation, resync_after_loss, wrong_root_rejected,
    note: 'A lane-dispatch payload sealed under a per-lane hyperbolic-synced COROS envelope: no counter on the wire, forward-only resync after loss, each lane a provably distinct secret geodesic off one root secret, and a wire sealed on one lane\'s geodesic will not open on another\'s. NOT yet wired into the live laneDispatch() → SandboxAgent → laptop path — both the worker-side DO and the laptop client (a separate repo) would need to speak this protocol, left for its own reviewed pass.',
  };
}

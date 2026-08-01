// ============================================================
// SESSION BUS — src/session-bus.ts
//
// "I don't need the socket to pass a tool." Replaces the connect-back
// WebSocket (sandbox-agent.ts's SandboxAgent Durable Object) with a
// stateless event bus: the cloud ENQUEUES a sealed message for a lane, the
// laptop POLLS for it over plain HTTPS, executes, and SUBMITS the sealed
// result back. No long-lived connection, no DO holding a socket open 24/7 —
// just periodic request/response, the same trust shape sovereign-duplex.cjs
// already proved works for chat (a POST on an interval), generalized to
// job dispatch (run_code / run_shell / clone / the local inference lane).
//
// THE ENVELOPE IS THE ROSEN BRIDGE, WIRED IN FOR REAL THIS TIME —
// lane-envelope.ts (COROS sealed under hyperbolic-sync's counter-free
// keystream) was built and self-tested in isolation; this module is its
// live home. One root secret (SANDBOX_AGENT_KEY — the SAME secret that used
// to authenticate the WebSocket) is HKDF'd into a distinct secret geodesic
// per (lane, direction): "alpha:to_local" and "alpha:to_cloud" are two
// uncorrelated channels off one root, so a compromised or misrouted wire
// for one direction of one lane authenticates against nothing else.
//
// DURABLE STATE, HONESTLY NAMED: hyperbolic-sync's per-tick key requires a
// SENDER state and a RECEIVER state that both advance forward-only across
// many stateless requests — there is no in-memory DO to hold that anymore,
// so it is persisted in D1 (elle_session_bus_state), one row per
// (lane, direction, role). The cloud only ever needs two of the four
// possible rows: SENDER for to_local (it emits jobs) and RECEIVER for
// to_cloud (it consumes results/chat). The matching two rows — RECEIVER for
// to_local, SENDER for to_cloud — live on the laptop, persisted locally by
// the Elle repo's client (see electron/native/providers/rosen-bridge.cjs).
//
// WHAT "OPEN" MEANS NOW: there is no socket to be open or closed. Every poll
// call is itself the heartbeat (elle_session_bus_lanes.last_seen); a lane is
// "open" if it has polled inside STALE_MS. Tighter than the old WS's 90s
// stale window because polling is cheap and meant to run every few seconds,
// not every 30s.
//
// STORE IS PLUGGABLE ON PURPOSE — not to abstract over a database this build
// will ever swap, but because this repo has no D1 test harness (every other
// D1-backed module here proves its DECISION logic with a pure self-test and
// leaves the wiring to be checked live post-deploy — see
// sandboxRegistrySelfTest). The same discipline applies here: the real
// orchestration (enqueue → poll → submit → await, state persisted between
// calls) runs against an in-memory BusStore in sessionBusSelfTest(), and
// against real D1 (d1Store) in production. Same code path either way.
//
// HONEST SCOPE: this seals and authenticates the cloud<->laptop hop — the
// one that actually crosses the public internet / NAT. The worker<->browser
// workbench hop is unchanged: admin JWT over TLS, same as everywhere else in
// this app. Nothing here asks the browser to speak COROS.
// ============================================================

import type { Env } from './index';
import { laneChannel, laneChannelStart, sealForLane, openFromLane } from './lane-envelope';
import {
  laneHandshakeAccept, laneChannelV2, decodeHelloPub, encodeAccept,
  laneHandshakeClientKeys, laneHandshakeClientFinish, encodeHello, decodeAcceptCt,
  type LaneHelloWire, type LaneAcceptWire,
} from './lane-handshake';
import type { HypState, HypChannel } from './hyperbolic-sync';

const STALE_MS = 45_000; // no poll within this window ⇒ the lane reads as closed

// ── PQC lane protocol v2 (design doc §4.5 step 3, the live-routing cutover) ──
// The hybrid X25519+ML-KEM lane handshake is the reviewed, byte-parity-proven
// crypto core (lane-handshake.ts). This module is where it goes LIVE: the
// worker is the RESPONDER — the laptop initiates a handshake per (lane,
// direction), the worker derives and persists the resulting root_lane, and once
// a root exists for a channel the poll/submit engine seals that direction under
// laneChannelV2(root_lane) instead of the pre-shared laneChannel(). It is
// strictly additive and FLAG-GATED: with ELLE_LANE_PROTOCOL unset (or != 'v2')
// the worker advertises v1 only, ignores any stored roots, and behaves exactly
// as before — so rollback is a single flag flip. The pre-shared secret still
// authenticates every door (x-sandbox-key) AND is folded into every derived
// root (the combiner), so v2 is never weaker than v1 during migration.
export function laneProtocolV2Enabled(env: Env): boolean {
  return (env.ELLE_LANE_PROTOCOL || '').toLowerCase() === 'v2';
}

function newId(): string { return crypto.randomUUID().replace(/-/g, '').slice(0, 20); }
function rootSecretOf(env: Env): Uint8Array { return new TextEncoder().encode(env.SANDBOX_AGENT_KEY || ''); }

export function sessionBusConfigured(env: Env): boolean { return !!env.SANDBOX_AGENT_KEY; }

function b64(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)); }
function unb64(s: string): Uint8Array { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); }

function encodeState(s: HypState): string {
  return JSON.stringify({ tick: s.tick, point: [s.point[0], s.point[1]] });
}
function decodeState(raw: string): HypState {
  const o = JSON.parse(raw) as { tick: number; point: [number, number] };
  return { tick: o.tick, point: Float64Array.from(o.point) };
}

export type Direction = 'to_local' | 'to_cloud';
export type Role = 'sender' | 'receiver';
export interface BusJob { id: string; kind: string; wire: string }
export interface BusSubmitItem { kind: string; wire: string; replyTo?: string }
export interface BusSubmitResult { ok: boolean; payload?: unknown; error?: string }
export interface BusStatus { open: boolean; meta?: { lastSeen?: number; [k: string]: unknown } }

// ── the storage seam — see the header on why this is pluggable ────────────
export interface BusStore {
  loadState(lane: string, direction: Direction, role: Role): Promise<HypState | null>;
  saveState(lane: string, direction: Direction, role: Role, state: HypState): Promise<void>;
  // v2 handshake: persist the derived root_lane per (channel, epoch), where
  // channel is '<lane>:<direction>'. loadLatestHandshakeRoot returns the newest
  // epoch's root (or null ⇒ that direction is still v1). clearChannelState resets
  // the sender/receiver geodesic state for a (lane, direction) when a new epoch
  // rotates in — the new root means a new geodesic, so old HypState is stale.
  // pruneHandshakeRootsBelow drops strictly-older epochs (forward secrecy: the
  // old root_lane is deleted, so its recorded traffic stays unrecoverable).
  saveHandshakeRoot(channel: string, epoch: number, rootLane: Uint8Array): Promise<void>;
  loadLatestHandshakeRoot(channel: string): Promise<{ epoch: number; rootLane: Uint8Array } | null>;
  clearChannelState(lane: string, direction: Direction): Promise<void>;
  pruneHandshakeRootsBelow(channel: string, epoch: number): Promise<void>;
  insertRow(row: {
    id: string; lane: string; direction: Direction; kind: string;
    replyTo?: string; wire: string; plaintext: string; status: 'pending' | 'done';
  }): Promise<void>;
  markDispatched(ids: string[]): Promise<void>;
  markDone(id: string): Promise<void>;
  pendingToLocal(lane: string, limit: number): Promise<BusJob[]>;
  resultPlaintextFor(replyTo: string): Promise<string | null>;
  touchLane(lane: string, meta: Record<string, unknown>): Promise<{ last_seen: number } | void>;
  laneHeartbeat(lane: string): Promise<{ last_seen: number; meta: Record<string, unknown> } | null>;
}

let schemaReady = false;
async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaReady) return;
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS elle_session_bus (
         id TEXT PRIMARY KEY,
         lane TEXT NOT NULL,
         direction TEXT NOT NULL CHECK (direction IN ('to_local','to_cloud')),
         kind TEXT NOT NULL,
         reply_to TEXT,
         wire TEXT NOT NULL,
         plaintext TEXT,
         status TEXT NOT NULL DEFAULT 'pending',
         created_at INTEGER NOT NULL
       )`
    ),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_bus_lane_dir_status ON elle_session_bus (lane, direction, status, created_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_bus_reply_to ON elle_session_bus (reply_to)`),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS elle_session_bus_state (
         lane TEXT NOT NULL,
         direction TEXT NOT NULL CHECK (direction IN ('to_local','to_cloud')),
         role TEXT NOT NULL CHECK (role IN ('sender','receiver')),
         state TEXT NOT NULL,
         PRIMARY KEY (lane, direction, role)
       )`
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS elle_session_bus_lanes (
         lane TEXT PRIMARY KEY,
         last_seen INTEGER NOT NULL,
         meta TEXT NOT NULL DEFAULT '{}'
       )`
    ),
    // v2 handshake roots: one row per (channel='<lane>:<direction>', epoch),
    // holding the base64 root_lane the hybrid handshake agreed. The active epoch
    // for a channel is simply MAX(epoch) present here — a fresh handshake bumps
    // it, and pruneHandshakeRootsBelow deletes the superseded rows for FS.
    db.prepare(
      `CREATE TABLE IF NOT EXISTS elle_session_bus_handshake (
         channel TEXT NOT NULL,
         epoch INTEGER NOT NULL,
         root_lane TEXT NOT NULL,
         created_at INTEGER NOT NULL,
         PRIMARY KEY (channel, epoch)
       )`
    ),
  ]);
  schemaReady = true;
}

function d1Store(env: Env): BusStore {
  const db = env.DB;
  return {
    async loadState(lane, direction, role) {
      await ensureSchema(db);
      const row = await db.prepare(
        `SELECT state FROM elle_session_bus_state WHERE lane = ? AND direction = ? AND role = ?`,
      ).bind(lane, direction, role).first() as { state: string } | null;
      return row ? decodeState(row.state) : null;
    },
    async saveState(lane, direction, role, state) {
      await ensureSchema(db);
      await db.prepare(
        `INSERT INTO elle_session_bus_state (lane, direction, role, state) VALUES (?,?,?,?)
         ON CONFLICT (lane, direction, role) DO UPDATE SET state = excluded.state`,
      ).bind(lane, direction, role, encodeState(state)).run();
    },
    async saveHandshakeRoot(channel, epoch, rootLane) {
      await ensureSchema(db);
      await db.prepare(
        `INSERT INTO elle_session_bus_handshake (channel, epoch, root_lane, created_at) VALUES (?,?,?,?)
         ON CONFLICT (channel, epoch) DO UPDATE SET root_lane = excluded.root_lane, created_at = excluded.created_at`,
      ).bind(channel, epoch, b64(rootLane), Date.now()).run();
    },
    async loadLatestHandshakeRoot(channel) {
      await ensureSchema(db);
      const row = await db.prepare(
        `SELECT epoch, root_lane FROM elle_session_bus_handshake WHERE channel = ? ORDER BY epoch DESC LIMIT 1`,
      ).bind(channel).first() as { epoch: number; root_lane: string } | null;
      return row ? { epoch: row.epoch, rootLane: unb64(row.root_lane) } : null;
    },
    async clearChannelState(lane, direction) {
      await ensureSchema(db);
      await db.prepare(
        `DELETE FROM elle_session_bus_state WHERE lane = ? AND direction = ?`,
      ).bind(lane, direction).run();
    },
    async pruneHandshakeRootsBelow(channel, epoch) {
      await ensureSchema(db);
      await db.prepare(
        `DELETE FROM elle_session_bus_handshake WHERE channel = ? AND epoch < ?`,
      ).bind(channel, epoch).run();
    },
    async insertRow(row) {
      await ensureSchema(db);
      await db.prepare(
        `INSERT INTO elle_session_bus (id, lane, direction, kind, reply_to, wire, plaintext, status, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).bind(row.id, row.lane, row.direction, row.kind, row.replyTo ?? null, row.wire, row.plaintext, row.status, Date.now()).run();
    },
    async markDispatched(ids) {
      if (!ids.length) return;
      await ensureSchema(db);
      await db.prepare(
        `UPDATE elle_session_bus SET status = 'dispatched' WHERE id IN (${ids.map(() => '?').join(',')})`,
      ).bind(...ids).run();
    },
    async markDone(id) {
      await ensureSchema(db);
      await db.prepare(`UPDATE elle_session_bus SET status = 'done' WHERE id = ?`).bind(id).run();
    },
    async pendingToLocal(lane, limit) {
      await ensureSchema(db);
      return ((await db.prepare(
        `SELECT id, kind, wire FROM elle_session_bus
         WHERE lane = ? AND direction = 'to_local' AND status = 'pending'
         ORDER BY created_at ASC LIMIT ?`,
      ).bind(lane, limit).all()).results || []) as unknown as BusJob[];
    },
    async resultPlaintextFor(replyTo) {
      await ensureSchema(db);
      const row = await db.prepare(
        `SELECT plaintext FROM elle_session_bus WHERE reply_to = ? ORDER BY created_at DESC LIMIT 1`,
      ).bind(replyTo).first() as { plaintext: string } | null;
      return row ? row.plaintext : null;
    },
    async touchLane(lane, meta) {
      await ensureSchema(db);
      await db.prepare(
        `INSERT INTO elle_session_bus_lanes (lane, last_seen, meta) VALUES (?,?,?)
         ON CONFLICT (lane) DO UPDATE SET last_seen = excluded.last_seen, meta = excluded.meta`,
      ).bind(lane, Date.now(), JSON.stringify(meta)).run();
    },
    async laneHeartbeat(lane) {
      await ensureSchema(db);
      const row = await db.prepare(
        `SELECT last_seen, meta FROM elle_session_bus_lanes WHERE lane = ?`,
      ).bind(lane).first() as { last_seen: number; meta: string } | null;
      if (!row) return null;
      let meta: Record<string, unknown> = {};
      try { meta = JSON.parse(row.meta || '{}'); } catch { /* ignore */ }
      return { last_seen: row.last_seen, meta };
    },
  };
}

// ── the store-agnostic engine — same logic for D1 and the self-test's
// in-memory store; only the persistence layer differs ─────────────────────

// One place decides WHERE a lane/direction's geodesic root comes from. With v2
// armed AND a handshake root on file for '<lane>:<direction>', seal under the
// forward-secret laneChannelV2(root_lane); otherwise fall back to the v1
// pre-shared laneChannel(). Per-direction, so a lane can be mid-migration (one
// direction handshaken, the other still v1) without either side desyncing —
// each direction is an independent sender/receiver pair with its own root.
async function resolveChannel(
  store: BusStore, root: Uint8Array, lane: string, direction: Direction, v2Enabled: boolean,
): Promise<HypChannel> {
  if (v2Enabled) {
    const hs = await store.loadLatestHandshakeRoot(`${lane}:${direction}`);
    if (hs) return laneChannelV2(hs.rootLane);
  }
  return laneChannel(root, `${lane}:${direction}`);
}

async function engineEnqueueToLocal(
  store: BusStore, root: Uint8Array, lane: string, kind: string, payload: unknown, replyTo?: string, v2Enabled = false,
): Promise<string> {
  const ch = await resolveChannel(store, root, lane, 'to_local', v2Enabled);
  const state = (await store.loadState(lane, 'to_local', 'sender')) || laneChannelStart(ch);
  const { wire, next } = await sealForLane(ch, state, payload);
  await store.saveState(lane, 'to_local', 'sender', next);
  const id = newId();
  await store.insertRow({ id, lane, direction: 'to_local', kind, replyTo, wire: b64(wire), plaintext: JSON.stringify(payload), status: 'pending' });
  return id;
}

async function enginePoll(store: BusStore, lane: string, opts: { limit?: number; meta?: Record<string, unknown> }): Promise<BusJob[]> {
  await store.touchLane(lane, opts.meta || {});
  const rows = await store.pendingToLocal(lane, Math.min(Math.max(opts.limit || 10, 1), 50));
  if (rows.length) await store.markDispatched(rows.map((r) => r.id));
  return rows;
}

async function engineSubmit(store: BusStore, root: Uint8Array, lane: string, items: BusSubmitItem[], v2Enabled = false): Promise<BusSubmitResult[]> {
  const ch = await resolveChannel(store, root, lane, 'to_cloud', v2Enabled);
  const out: BusSubmitResult[] = [];
  for (const item of items) {
    try {
      const state = (await store.loadState(lane, 'to_cloud', 'receiver')) || laneChannelStart(ch);
      const { payload, next } = await openFromLane(ch, state, unb64(item.wire), 32);
      await store.saveState(lane, 'to_cloud', 'receiver', next);
      const id = newId();
      await store.insertRow({ id, lane, direction: 'to_cloud', kind: item.kind, replyTo: item.replyTo, wire: item.wire, plaintext: JSON.stringify(payload), status: 'done' });
      if (item.replyTo) await store.markDone(item.replyTo);
      out.push({ ok: true, payload });
    } catch (e) {
      out.push({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

async function engineAwaitResult<T>(store: BusStore, jobId: string, timeoutMs: number, pollMs: number): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const plaintext = await store.resultPlaintextFor(jobId);
    if (plaintext != null) { try { return JSON.parse(plaintext) as T; } catch { return plaintext as unknown as T; } }
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

async function enginePathOpen(store: BusStore, lane: string): Promise<BusStatus> {
  const hb = await store.laneHeartbeat(lane);
  if (!hb) return { open: false };
  return { open: Date.now() - hb.last_seen < STALE_MS, meta: { ...hb.meta, lastSeen: hb.last_seen } };
}

// ── v2 handshake (the worker is the RESPONDER) + version negotiation ────────
const DIRECTIONS: Direction[] = ['to_local', 'to_cloud'];
// A handshake channel id is '<lane>:<direction>'. Recover the pair (the lane
// name itself may contain colons, so we match the direction suffix, not split).
function splitChannel(channel: string): { lane: string; direction: Direction } {
  for (const d of DIRECTIONS) {
    if (channel.endsWith(`:${d}`)) return { lane: channel.slice(0, channel.length - d.length - 1), direction: d };
  }
  throw new Error(`handshake channel must end in :to_local or :to_cloud, got "${channel}"`);
}

export interface BusProtocolInfo { supported: number[]; v2: boolean; epoch: number }

// What the poll advertises so the laptop knows whether to (re)handshake. v2 is
// "active" for a lane only when BOTH directions have a root on file; the epoch
// reported is the older of the two (the lane is fully v2 from that epoch on).
async function engineProtocolInfo(store: BusStore, v2Enabled: boolean, lane: string): Promise<BusProtocolInfo> {
  if (!v2Enabled) return { supported: [1], v2: false, epoch: 0 };
  const [local, cloud] = await Promise.all([
    store.loadLatestHandshakeRoot(`${lane}:to_local`),
    store.loadLatestHandshakeRoot(`${lane}:to_cloud`),
  ]);
  const v2 = !!(local && cloud);
  const epoch = local && cloud ? Math.min(local.epoch, cloud.epoch) : 0;
  return { supported: [1, 2], v2, epoch };
}

// Answer one or more HELLOs. Each is a self-contained KEM: encapsulate to the
// laptop's public key, derive+persist root_lane, hand back the ACCEPT ciphertext.
// Epoch is monotonic per channel — a HELLO must carry an epoch strictly newer
// than the active one, so a replayed/stale HELLO can't silently reset a live
// channel's forward-only state.
async function engineHandshake(
  store: BusStore, preshared: Uint8Array, hellos: LaneHelloWire[],
): Promise<LaneAcceptWire[]> {
  const accepts: LaneAcceptWire[] = [];
  for (const hello of hellos) {
    const channel = String(hello.lane || '');
    const epoch = Number(hello.epoch);
    if (!Number.isInteger(epoch) || epoch < 0) throw new Error(`handshake epoch must be a non-negative integer, got ${hello.epoch}`);
    const { lane, direction } = splitChannel(channel); // validates the suffix
    const latest = await store.loadLatestHandshakeRoot(channel);
    if (latest && epoch <= latest.epoch) {
      throw new Error(`handshake epoch ${epoch} for "${channel}" is not newer than the active epoch ${latest.epoch}`);
    }
    const clientPub = decodeHelloPub(hello);
    const { ciphertext, rootLane } = await laneHandshakeAccept(preshared, channel, epoch, clientPub);
    await store.saveHandshakeRoot(channel, epoch, rootLane);
    // a new epoch is a new geodesic ⇒ the old forward-only HypState is stale;
    // reset so both ends restart from laneChannelStart under the fresh root.
    await store.clearChannelState(lane, direction);
    // forward secrecy: superseded roots for this channel are deleted.
    await store.pruneHandshakeRootsBelow(channel, epoch);
    accepts.push(encodeAccept(ciphertext));
  }
  return accepts;
}

// ── public API — env-based, unchanged shape for the rest of the worker ────
export async function busPathOpen(env: Env, lane = 'primary'): Promise<BusStatus> {
  if (!sessionBusConfigured(env)) return { open: false };
  return enginePathOpen(d1Store(env), lane);
}
export async function busEnqueueToLocal(env: Env, lane: string, kind: string, payload: unknown, replyTo?: string): Promise<string> {
  return engineEnqueueToLocal(d1Store(env), rootSecretOf(env), lane, kind, payload, replyTo, laneProtocolV2Enabled(env));
}
export async function busPoll(env: Env, lane: string, opts: { limit?: number; meta?: Record<string, unknown> } = {}): Promise<BusJob[]> {
  return enginePoll(d1Store(env), lane, opts);
}
export async function busSubmit(env: Env, lane: string, items: BusSubmitItem[]): Promise<BusSubmitResult[]> {
  return engineSubmit(d1Store(env), rootSecretOf(env), lane, items, laneProtocolV2Enabled(env));
}
export async function busAwaitResult<T = unknown>(env: Env, jobId: string, timeoutMs = 120_000, pollMs = 400): Promise<T | null> {
  return engineAwaitResult<T>(d1Store(env), jobId, timeoutMs, pollMs);
}
// Version negotiation the poll returns; the laptop reads it to decide whether to
// (re)handshake. Cheap enough to compute on every poll.
export async function busProtocolInfo(env: Env, lane: string): Promise<BusProtocolInfo> {
  return engineProtocolInfo(d1Store(env), laneProtocolV2Enabled(env), lane);
}
// The responder half of the hybrid lane handshake. Only reachable when v2 is
// armed (the route gates on laneProtocolV2Enabled); returns one ACCEPT per HELLO.
export async function busHandshake(env: Env, hellos: LaneHelloWire[]): Promise<LaneAcceptWire[]> {
  return engineHandshake(d1Store(env), rootSecretOf(env), hellos);
}

// ============================================================
// self-test — the real orchestration (enqueue → poll → submit → await,
// state persisted between calls) against an in-memory store, no D1 needed.
// Same engine functions production runs; only the storage swaps.
// ============================================================
function memoryStore(): BusStore {
  const states = new Map<string, HypState>();
  const handshakes = new Map<string, { epoch: number; rootLane: Uint8Array }>(); // 'channel:epoch' → root
  const rows: Array<{ id: string; lane: string; direction: Direction; kind: string; replyTo?: string; wire: string; plaintext: string; status: string; created_at: number }> = [];
  const lanes = new Map<string, { last_seen: number; meta: Record<string, unknown> }>();
  const key = (lane: string, direction: Direction, role: Role) => `${lane} ${direction} ${role}`;
  let seq = 0;
  return {
    async loadState(lane, direction, role) { return states.get(key(lane, direction, role)) || null; },
    async saveState(lane, direction, role, state) { states.set(key(lane, direction, role), state); },
    async saveHandshakeRoot(channel, epoch, rootLane) { handshakes.set(`${channel}:${epoch}`, { epoch, rootLane }); },
    async loadLatestHandshakeRoot(channel) {
      let best: { epoch: number; rootLane: Uint8Array } | null = null;
      for (const [k, v] of handshakes) {
        if (!k.startsWith(`${channel}:`)) continue;
        if (!best || v.epoch > best.epoch) best = v;
      }
      return best;
    },
    async clearChannelState(lane, direction) {
      for (const role of ['sender', 'receiver'] as Role[]) states.delete(key(lane, direction, role));
    },
    async pruneHandshakeRootsBelow(channel, epoch) {
      for (const [k, v] of handshakes) if (k.startsWith(`${channel}:`) && v.epoch < epoch) handshakes.delete(k);
    },
    async insertRow(row) { rows.push({ ...row, created_at: seq++ }); },
    async markDispatched(ids) { for (const r of rows) if (ids.includes(r.id)) r.status = 'dispatched'; },
    async markDone(id) { for (const r of rows) if (r.id === id) r.status = 'done'; },
    async pendingToLocal(lane, limit) {
      return rows.filter((r) => r.lane === lane && r.direction === 'to_local' && r.status === 'pending')
        .sort((a, b) => a.created_at - b.created_at).slice(0, limit)
        .map((r) => ({ id: r.id, kind: r.kind, wire: r.wire }));
    },
    async resultPlaintextFor(replyTo) {
      const hit = rows.filter((r) => r.replyTo === replyTo).sort((a, b) => b.created_at - a.created_at)[0];
      return hit ? hit.plaintext : null;
    },
    async touchLane(lane, meta) { lanes.set(lane, { last_seen: Date.now(), meta }); },
    async laneHeartbeat(lane) { return lanes.get(lane) || null; },
  };
}

export interface SessionBusSelfTest {
  ok: boolean;
  job_roundtrip: boolean;         // enqueue -> poll -> submit(result) -> await returns the real payload
  lane_isolation: boolean;        // a wire sealed for lane alpha does not open under lane beta's store state
  heartbeat_tracks_polls: boolean;// pathOpen reads open only after a poll touched the lane, closed before
  awaits_time_out_honestly: boolean; // a job with no submitted result times out, doesn't hang or fake a value
  v2_handshake_roundtrip: boolean;// a hybrid handshake per direction, then the SAME engine seals v2 end-to-end
  v2_is_really_v2: boolean;       // the v1 pre-shared channel cannot open the v2 wire (not a silent fallback)
  flag_off_stays_v1: boolean;     // with the flag off, a stored handshake root is ignored and v1 is used
  note: string;
}

export async function sessionBusSelfTest(): Promise<SessionBusSelfTest> {
  const root = crypto.getRandomValues(new Uint8Array(32));
  const store = memoryStore();

  // pathOpen before any poll: closed (no heartbeat yet)
  const closedBefore = !(await enginePathOpen(store, 'alpha')).open;
  await enginePoll(store, 'alpha', {});
  const openAfter = (await enginePathOpen(store, 'alpha')).open;
  const heartbeat_tracks_polls = closedBefore && openAfter;

  // real job round-trip: cloud enqueues an exec job, "local" polls it, opens
  // it is implicit in submit (submit is what proves the wire was genuine —
  // here we simulate the local side just echoing the job back as a result).
  let job_roundtrip = false;
  {
    const jobId = await engineEnqueueToLocal(store, root, 'alpha', 'exec', { code: 'print(1)' });
    const pending = await enginePoll(store, 'alpha', {});
    const gotJob = pending.some((j) => j.id === jobId);
    // "local" seals its result the same way engineSubmit expects: a fresh
    // wire on the lane's to_cloud channel. We seal it here exactly as the
    // real laptop client would (same lane-envelope primitive), not fake it.
    const chLocalSide = await laneChannel(root, 'alpha:to_cloud');
    const localState = laneChannelStart(chLocalSide); // the laptop's own to_cloud sender starts fresh, same as the cloud's receiver
    const { wire } = await sealForLane(chLocalSide, localState, { exit: 0, stdout: '1\n' });
    const submitOut = await engineSubmit(store, root, 'alpha', [{ kind: 'result', wire: b64(wire), replyTo: jobId }]);
    const result = await engineAwaitResult<{ exit: number; stdout: string }>(store, jobId, 2_000, 50);
    job_roundtrip = gotJob && submitOut[0]?.ok === true && result?.exit === 0 && result?.stdout === '1\n';
  }

  // lane isolation: a wire sealed on lane alpha's to_cloud geodesic must not
  // authenticate against lane beta's receiver state.
  let lane_isolation = false;
  {
    const chAlpha = await laneChannel(root, 'alpha:to_cloud');
    const { wire } = await sealForLane(chAlpha, laneChannelStart(chAlpha), { probe: true });
    const out = await engineSubmit(store, root, 'beta', [{ kind: 'chat', wire: b64(wire) }]);
    lane_isolation = out[0]?.ok === false;
  }

  // a job nobody ever answers times out honestly — no hang, no fabricated result
  let awaits_time_out_honestly = false;
  {
    const jobId = await engineEnqueueToLocal(store, root, 'alpha', 'exec', { code: 'sleep forever' });
    const result = await engineAwaitResult(store, jobId, 150, 40);
    awaits_time_out_honestly = result === null;
  }

  // ── v2 live routing: the hybrid handshake wired into the real engine ──────
  // The laptop initiates a handshake per (lane, direction); the worker responder
  // derives + persists root_lane; then the SAME enqueue/poll/submit/await path
  // seals under laneChannelV2(root_lane). Proven end-to-end AND proven to be
  // genuinely v2 (the v1 pre-shared channel can't open the wire).
  let v2_handshake_roundtrip = false;
  let v2_is_really_v2 = false;
  {
    const lane = 'gamma', epoch = 1;
    // laptop keypairs, one per direction (each direction is its own handshake)
    const kLocal = laneHandshakeClientKeys();
    const kCloud = laneHandshakeClientKeys();
    const accepts = await engineHandshake(store, root, [
      encodeHello(`${lane}:to_local`, epoch, kLocal.publicKey),
      encodeHello(`${lane}:to_cloud`, epoch, kCloud.publicKey),
    ]);
    // laptop finishes → the same roots the worker just stored
    const rootLocal = await laneHandshakeClientFinish(root, `${lane}:to_local`, epoch, kLocal, decodeAcceptCt(accepts[0]));
    const rootCloud = await laneHandshakeClientFinish(root, `${lane}:to_cloud`, epoch, kCloud, decodeAcceptCt(accepts[1]));

    // cloud enqueues under v2 (flag on) — sealed with rootLocal, not the paste
    const jobId = await engineEnqueueToLocal(store, root, lane, 'exec', { code: 'print(9)' }, undefined, true);
    const jobRow = (await enginePoll(store, lane, {})).find((j) => j.id === jobId)!;

    // the laptop opens it with the agreed v2 root → proves the round-trip
    const chRecv = await laneChannelV2(rootLocal);
    const opened = await openFromLane(chRecv, laneChannelStart(chRecv), unb64(jobRow.wire), 8);
    const gotJob = (opened.payload as { code?: string }).code === 'print(9)';

    // the v1 pre-shared channel must NOT open it — else it wasn't really v2
    try {
      const chV1 = await laneChannel(root, `${lane}:to_local`);
      await openFromLane(chV1, laneChannelStart(chV1), unb64(jobRow.wire), 8);
      v2_is_really_v2 = false;
    } catch { v2_is_really_v2 = true; }

    // laptop seals a result under v2 rootCloud; the worker opens it via v2 submit
    const chSend = await laneChannelV2(rootCloud);
    const { wire } = await sealForLane(chSend, laneChannelStart(chSend), { exit: 0, stdout: '9\n' });
    const submitOut = await engineSubmit(store, root, lane, [{ kind: 'result', wire: b64(wire), replyTo: jobId }], true);
    const result = await engineAwaitResult<{ exit: number; stdout: string }>(store, jobId, 2_000, 50);

    v2_handshake_roundtrip = accepts.length === 2 && gotJob &&
      submitOut[0]?.ok === true && result?.exit === 0 && result?.stdout === '9\n';
  }

  // the flag is the switch: a stored handshake root on a fresh lane is IGNORED
  // when v2 is off, and traffic seals under the v1 pre-shared geodesic.
  let flag_off_stays_v1 = false;
  {
    const lane = 'delta', epoch = 1;
    const kLocal = laneHandshakeClientKeys();
    await engineHandshake(store, root, [encodeHello(`${lane}:to_local`, epoch, kLocal.publicKey)]);
    // enqueue with v2Enabled=false → must use v1 even though a root exists
    const jobId = await engineEnqueueToLocal(store, root, lane, 'exec', { code: 'v1' }, undefined, false);
    const jobRow = (await enginePoll(store, lane, {})).find((j) => j.id === jobId)!;
    try {
      const chV1 = await laneChannel(root, `${lane}:to_local`);
      const opened = await openFromLane(chV1, laneChannelStart(chV1), unb64(jobRow.wire), 8);
      flag_off_stays_v1 = (opened.payload as { code?: string }).code === 'v1';
    } catch { flag_off_stays_v1 = false; }
  }

  const ok = job_roundtrip && lane_isolation && heartbeat_tracks_polls && awaits_time_out_honestly &&
    v2_handshake_roundtrip && v2_is_really_v2 && flag_off_stays_v1;
  return {
    ok, job_roundtrip, lane_isolation, heartbeat_tracks_polls, awaits_time_out_honestly,
    v2_handshake_roundtrip, v2_is_really_v2, flag_off_stays_v1,
    note: 'The full enqueue -> poll -> submit -> await orchestration, run against an in-memory store (this repo has no D1 test harness — every D1-backed module here proves its decision logic this way, per sandboxRegistrySelfTest). Real lane-envelope sealing throughout, not simulated: the "local" side seals with the same sealForLane primitive the real laptop client uses. The v2 invariants run the hybrid handshake through the SAME engine production uses — a per-direction handshake seeds forward-secret geodesics, the wire is genuinely v2 (v1 cannot open it), and the ELLE_LANE_PROTOCOL flag gates it (off ⇒ a stored root is ignored, v1 is used).',
  };
}

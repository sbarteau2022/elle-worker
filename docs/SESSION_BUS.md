# Session Bus — the socket is gone

**"I don't need the socket to pass a tool. It's causing too many keys and it's
not wired correctly." The WebSocket (`sandbox-agent.ts`'s `SandboxAgent`
Durable Object) is deleted. `run_code`/`run_shell`/`sandbox_clone`/the local
inference lane now ride a stateless event bus: the cloud enqueues a sealed
job, the laptop polls for it over plain HTTPS, executes, and submits the
sealed result back. One root secret, not several.**

Code: `src/session-bus.ts` · tests (5) · self-test
`GET /api/elle-session-bus-selftest` (admin) · doors: `POST
/api/sandbox-bus/poll`, `POST /api/sandbox-bus/submit` (shared-secret,
laptop-authenticated) · consumes `src/lane-envelope.ts` (COROS sealed under
hyperbolic-sync) · replaces `src/sandbox-agent.ts` (removed) · wrangler
migration `v4` (`deleted_classes = ["SandboxAgent"]`) · 2026

---

## What was actually wrong with the socket

Not a security flaw in the WebSocket itself — TLS + a shared secret at
connect time was fine. The real complaints, named directly: a Durable Object
had to be provisioned, migrated, and kept alive just to hold one open
connection; the DO's own auth (`?key=`) and the plain `x-sandbox-key` header
`duplex.ts` used were the *same* secret wearing two different shapes; and
every new "lane" idea (`sandbox-registry.ts`) had to be justified against a
DO namespace that was never built to be multiplied. None of that required a
socket to fix — it required not having one.

## The shape: enqueue, poll, submit, await

```
cloud:  busEnqueueToLocal(env, lane, kind, payload)  → seals it, writes a
        'pending' row, returns a job id
local:  POST /api/sandbox-bus/poll {lane}            → pending rows for that
        lane flip to 'dispatched', wire bytes handed back (still sealed —
        the poll response never leaks plaintext to the wire)
local:  executes the job for real, seals the result
local:  POST /api/sandbox-bus/submit {lane, items}    → cloud OPENS each wire
        (this is the real authentication step — a forged or replayed item
        simply fails to decrypt), stores the plaintext, marks the original
        job 'done'
cloud:  busAwaitResult(env, jobId, timeoutMs)          → polls its own D1 row
        for up to timeoutMs, same synchronous feel `run_code` always had,
        no connection held open to get it
```

Every poll call is also the heartbeat (`elle_session_bus_lanes.last_seen`) —
there is no "connection" to be open or closed anymore, so `busPathOpen()`
now means "has this lane checked in inside `STALE_MS` (45s)," tighter than
the old socket's 90s stale window because a poll is cheap and meant to run
every few seconds, not every 30.

## The envelope is the Rosen bridge, not a new one

`lane-envelope.ts` (COROS sealed under hyperbolic-sync's counter-free
keystream) was built and proven in isolation first (`LANE_ENVELOPE.md`).
This module is its production home, unchanged: `laneChannel(root,
'${lane}:${direction}')` derives a genuinely distinct secret geodesic per
**(lane, direction)** pair off one root secret (`SANDBOX_AGENT_KEY` — the
same secret that used to authenticate the socket, now doing one job instead
of two). `alpha:to_local` and `alpha:to_cloud` are two uncorrelated bridges;
a wire sealed for one can't authenticate against the other, proven directly
in this module's own self-test (`lane_isolation`).

## Durable state, honestly named

Hyperbolic-sync's per-tick key needs a **sender** state and a **receiver**
state that both advance forward-only across many stateless requests. There
is no in-memory Durable Object to hold that anymore, so it's persisted in
`elle_session_bus_state` — one row per `(lane, direction, role)`. The cloud
only ever needs two of the four possible rows:

- **sender** for `to_local` (it emits jobs),
- **receiver** for `to_cloud` (it consumes results).

The matching two rows — **receiver** for `to_local`, **sender** for
`to_cloud` — live on the laptop, persisted locally by the Elle repo's client
(`electron/native/providers/rosen-bridge.cjs`). Neither side needs the
other's state; only the shared root secret and the lane name.

## No D1 test harness here — same discipline as the rest of this build

This repo has no `@cloudflare/vitest-pool-workers`-style D1 test harness;
every D1-backed module here proves its *decision logic* with a pure
self-test and leaves the wiring itself to be checked live post-deploy (see
`sandboxRegistrySelfTest`, which "simulates... without touching D1"). This
module follows the same pattern one level further: a `BusStore` interface
abstracts the four storage operations (state load/save, row insert/query,
lane heartbeat), with `d1Store()` the real D1-backed implementation
production uses and an in-memory implementation used *only* by
`sessionBusSelfTest()`. Same engine code runs both — the self-test isn't a
simulation of the logic, it's the actual logic with a different storage
backend.

**Five checks, each isolating one real property:**

- `job_roundtrip` — a job enqueued cloud-side, polled, and answered with a
  genuinely sealed result (the self-test's "local" side calls the exact same
  `sealForLane` primitive the real laptop client uses — not a stand-in)
  round-trips the real payload through `busAwaitResult`.
- `lane_isolation` — a wire sealed for lane alpha is submitted under lane
  beta; it does not authenticate.
- `heartbeat_tracks_polls` — a lane reads closed before any poll and open
  immediately after one.
- `awaits_time_out_honestly` — a job nobody ever answers times out and
  returns `null`, not a hang and not a fabricated result.

Verified live outside the test suite too: raw `tsx` execution reproduced
`ok: true` with all four sub-checks green.

## What's still ahead — stated plainly

Two things this pass deliberately did **not** do, each left for its own
pass:

1. **The laptop side.** This module is the cloud half. The matching
   `rosen-bridge.cjs` port in the `Elle` repo (Node's `crypto.webcrypto`,
   byte-for-byte compatible with `helix.ts` + `hyperbolic-sync.ts`) and the
   poller that replaces `sandbox-agent.cjs`'s WebSocket client are a
   separate, coordinated change — a protocol swap has to ship on both ends
   at once or the laptop simply stops connecting (which is the correct
   failure mode, not a silent one: `busPathOpen` reads closed, tools report
   "not open," nothing hangs).
2. **Folding the duplex channel onto this same bus.** `duplex.ts`'s
   `elle_duplex_ledger` and its `/api/duplex` transport are untouched —
   `sovereign-duplex.cjs` still posts plaintext over the shared-secret
   header. Routing that chat, too, through the sealed bus (so there is
   genuinely **one** mechanism, not two) is next, sequenced deliberately
   rather than interleaved with this pass.

## The boundary, unchanged

This seals and authenticates the cloud<->laptop hop — the one that actually
crosses the public internet / NAT. The worker<->browser workbench hop is
untouched: admin JWT over TLS, same as everywhere else in this app. Nothing
here asks the browser to speak COROS, and nothing here claims the Rosen
bridge moves a bit without the HTTPS request underneath it.

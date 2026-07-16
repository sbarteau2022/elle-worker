# Lane Envelope — a play on the Rosen bridge, now the live envelope over the bus

**"I'm curious about a play on the Rosen bridge instead of a websocket, or use
the signal sender we built a few turns ago" — the honest answer composes both
and replaces neither the crypto's own math nor the need for SOME channel. What
it did replace, in a later pass (`SESSION_BUS.md`): the WebSocket itself, in
favor of a stateless poll. This module is that poll's envelope, live in
production, not a proven-in-isolation primitive anymore.**

Code: `src/lane-envelope.ts` · tests (6) · self-test
`GET /api/elle-lane-envelope-selftest` · builds on `src/helix.ts` (COROS) and
`src/hyperbolic-sync.ts` (hyperbolic-geodesic sync) · consumed by
`src/session-bus.ts` · 2026

---

## Two different questions, kept separate

"Rosen bridge instead of a websocket" mixes two layers that this build has
been careful to keep apart everywhere else:

- **Transport** — how bytes actually move between the worker and the
  laptop. Originally the WebSocket held by the `SandboxAgent` Durable
  Object; now a stateless HTTPS poll (`session-bus.ts` — see
  `SESSION_BUS.md`), over TLS either way. Nothing in this module moves a bit
  without SOME channel — the no-communication theorem holds, as
  `hyperbolic-sync.ts`'s own header already states plainly — but which
  channel carries the sealed bytes changed in a later pass, and this module
  didn't need to change at all when it did.
- **Envelope** — what those bytes look like before they're sent, and how the
  keys that seal them are agreed on. This IS a real place to build, and this
  module builds it, unchanged underneath the transport swap.

The "signal sender" (`helix.ts`, COROS) supplies confidentiality and
covertness: AES-256-GCM, corkscrew-padded, whole-or-nothing. The "Rosen
bridge" (`hyperbolic-sync.ts`) supplies something COROS's plain ratchet
doesn't: a way for two ends to agree on a key for a given message **without a
counter riding the wire** — they walk a shared secret geodesic in the
Poincaré disk and derive the same per-tick key, forward-only, with a bounded
resync window if messages are lost. `lane-envelope.ts` composes the two for
the specific shape a sandbox-lane dispatch needs: one JSON payload in, one
sealed wire out, keyed per lane.

## One geodesic per lane, off one root

`laneChannel(rootSecret, lane)` runs the lane name through HKDF against a
single root secret before `initHypChannel()`, so lane `"alpha"` and lane
`"beta"` walk genuinely different, uncorrelated bridges even though both
derive from the same root. This matters for a registry that's meant to hold
"as many lanes as she can manage": a wire sealed for one lane must not
authenticate against another's channel. The self-test proves this directly —
`lane_isolation` seals a payload on lane alpha's geodesic and confirms lane
beta's channel throws trying to open it, not that it happens to decode
wrong.

## What the self-test actually proves

Six checks, each isolating one real property, none of them a tuned
parameter:

- `roundtrip` — real dispatch-shaped payloads (`{lane, kind, code}`) seal and
  open correctly in lock-step, sender and receiver walking the same channel.
- `distinct_geodesics_per_lane` — two lanes off the same root land on
  different origin points or headings; the per-lane derivation actually does
  something.
- `lane_isolation` — a wire sealed on lane alpha's geodesic throws when a
  lane-beta channel tries to open it.
- `resync_after_loss` — a sender five ticks ahead of an idle receiver (five
  dropped messages) still authenticates within `hyperbolic-sync`'s bounded
  forward-only search window.
- `wrong_root_rejected` — a channel built from a different root secret
  cannot open a wire sealed under the real one.

Every one of these reuses `hyperbolic-sync.ts`'s already-proven primitives
(Möbius addition, geodesic stepping, the AEAD-gated forward-only search) —
this module doesn't reimplement any of that; it only adds the per-lane HKDF
derivation and the JSON payload framing a dispatch call needs.

## Now live — the socket is gone, this envelope is what's left underneath

This was first proven in isolation, then wired into `session-bus.ts` as the
production envelope for every cloud<->laptop job (`run_code`/`run_shell`/
`sandbox_clone`/the local inference lane) once the WebSocket itself came out.
`laneChannel(root, '${lane}:${direction}')` is called with a *compound* lane
string now — direction folded into the HKDF info — so `alpha:to_local` and
`alpha:to_cloud` are two more genuinely distinct geodesics off the same root,
the same isolation property this module's self-test already proved, reused
rather than re-derived. See `SESSION_BUS.md` for the durable per-tick state
(there is no DO to hold it in memory anymore, so it lives in D1) and the
matching laptop-side port.

## The boundary, unchanged

Confidentiality is still AES-256-GCM (COROS, `helix.ts`) — if the hyperbolic
geodesic were somehow guessed, the payload is exactly as safe as the AEAD
makes it. The geodesic sync adds covertness (no counter, no reused key,
forward-only) on top, the same relationship `hyperbolic-sync.ts` already
documents for itself. And the "Rosen bridge" framing names a real thing —
geodesic synchronization in curved space — not a wormhole, not
faster-than-light signaling, not a substitute for a real channel and the TLS
underneath it — it's just that the real channel is a poll now, not a socket.

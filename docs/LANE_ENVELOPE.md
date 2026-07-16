# Lane Envelope — a play on the Rosen bridge, honestly separated from the WebSocket

**"I'm curious about a play on the Rosen bridge instead of a websocket, or use
the signal sender we built a few turns ago" — the honest answer composes
both and replaces neither. The WebSocket in `connect-sandbox.ts` stays; what's
built here is a real, tested envelope that could ride on top of it.**

Code: `src/lane-envelope.ts` · tests (6) · self-test
`GET /api/elle-lane-envelope-selftest` · builds on `src/helix.ts` (COROS) and
`src/hyperbolic-sync.ts` (hyperbolic-geodesic sync) · 2026

---

## Two different questions, kept separate

"Rosen bridge instead of a websocket" mixes two layers that this build has
been careful to keep apart everywhere else:

- **Transport** — how bytes actually move between the worker and the
  laptop. That is, and stays, the WebSocket held by the `SandboxAgent`
  Durable Object (`connect-sandbox.ts`), over TLS. Nothing in this module
  moves a bit without that channel — the no-communication theorem holds, as
  `hyperbolic-sync.ts`'s own header already states plainly.
- **Envelope** — what those bytes look like before they're sent, and how the
  keys that seal them are agreed on. This IS a real place to build, and this
  module builds it.

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

## Not yet done — stated plainly

This seals and opens payloads in isolation, proven against itself. It is
**not** wired into the live path: `laneDispatch()` in `sandbox-registry.ts`
still calls `dispatchToLane()`, which still sends plain JSON over the
WebSocket to the `SandboxAgent` Durable Object, which still forwards it
verbatim to whatever laptop client is connected. Making the live dispatch
path actually sealed would require **both** ends to speak this protocol:

- the DO's `dispatch()` in `sandbox-agent.ts` (this repo) would need to
  accept a sealed job type and forward the wire bytes as-is instead of
  parsing `mode`/`code` directly, and
- the laptop client in the `Elle` repo's
  `electron/native/providers/sandbox-agent.cjs` would need matching
  `openFromLane()` logic to unwrap a job before executing it.

That is a cross-repo change to a live code-execution path — exactly the kind
of change this build has held back from making without a dedicated pass and
explicit scope confirmation, the same discipline applied to the router-tool
integration and the public preview endpoint earlier in this build. What's
proven here is that the primitive itself is real and correct; whether to
wire it onto the live wire is a separate decision.

## The boundary, unchanged

Confidentiality is still AES-256-GCM (COROS, `helix.ts`) — if the hyperbolic
geodesic were somehow guessed, the payload is exactly as safe as the AEAD
makes it. The geodesic sync adds covertness (no counter, no reused key,
forward-only) on top, the same relationship `hyperbolic-sync.ts` already
documents for itself. And the "Rosen bridge" framing names a real thing —
geodesic synchronization in curved space — not a wormhole, not
faster-than-light signaling, not a substitute for the socket and the TLS
underneath it.

# Torus-Oscillator Sync — the counter-free rung above COROS

**COROS carries a counter so the receiver never has to guess. This layer
throws the counter away: both ends free-run the same golden winding on a
torus and re-lock by inference, gated by the auth tag. Nothing on the wire
reveals order or count. It is the flat-space spine the hyperbolic-geodesic
("Einstein-Rosen") variant swaps its geometry into.**

Code: `src/torus-sync.ts` · tests `src/torus-sync.test.ts` (12) · self-test
`GET /api/elle-torus-selftest` · builds on `src/helix.ts` (COROS) · 2026

---

## Why remove the counter

COROS (`docs/SECURITY_ARCHITECTURE.md`, Part II) is counter-anchored — the
nonce fixes "where on the corkscrew" the sender is, so decode never drifts.
Robust, but a monotonic counter is a *tell*: message ordering, count, and
cadence leak even under whitening. This layer removes it. Two endpoints hold
the same **secret** torus state and advance it in lock-step; the receiver
recovers "which tick" by a bounded search, not by reading a field. On the wire
there is nothing but a plain COROS frame — same size, same uniform noise.

## The construction

```
winding      α  = generalized golden ratio (Roberts' R_D); φ⁻¹ when D=1
origin       θ₀ = HKDF(master, "…origin…")          ← SECRET starting point
phase        θ_n = frac(θ₀ + n·α)                    ← geometry only, never the secret
key at tick  k_n = HKDF(master, "…key…" ‖ u32(n) ‖ quantize(θ_n))
seal         wire_n = COROS.seal(k_n, pt, {exact})   ← no counter prefix
```

- **α — generalized golden ratio.** `g` solves `x^{D+1} = x + 1`; `α_i = g^{-i}`.
  For D=1, `g = φ`. This is the low-discrepancy vector in D-space — independent
  φ-per-axis would correlate; this does not. The corkscrew, generalized.
- **θ₀ secret.** The origin is derived from the master, so an observer who
  knows α still cannot compute θ_n. The geometry itself is keyed.
- **Phase indexes, master secures.** The phase chooses *which* key; the master
  makes it strong. Same rule as COROS — φ never provides secrecy. The tick
  index is folded into the key too, so distinct ticks never collide to one key,
  and so the hyperbolic variant can change how θ advances and have it genuinely
  change the key stream, with the search loop below unchanged.

## open — bounded, forward-only, AEAD-gated phase-search

```
receiver holds tick estimate r, window W:
  for k in 0 … W-1:  try COROS.open( k_{r+k}, wire )   ← the auth tag is the gate
  first k that authenticates → deliver, set r := r+k+1
  none → drop (lost beyond W, tamper, or stale)
```

- **Forward-only** (never `< r`): replay- and rewind-resistant — a past-tick
  frame is never re-opened.
- **AEAD-gated**: a wrong phase guess fails the tag — no oracle, no partial
  decode, indistinguishable from noise without the master.
- **Constant-work**: every candidate in the window is attempted (no early-out),
  so a resync doesn't leak through receiver compute-timing.

## Robustness

| condition | outcome |
|---|---|
| consecutive loss `< W` | auto-relocks on the next frame |
| reorder within `W` | fine |
| loss / reorder `> W` | refused — needs re-acquisition (beacon / re-handshake) |
| wall-clock cadence | **not** hidden by sync alone — pair with COROS constant-rate framing |

## Honest limits

- `W` trades robustness against per-frame cost (W trial-decrypts) and the
  replay-window width.
- Trial-decryption is a timing side channel; mitigated by constant-work, not
  eliminated in JS.
- Sync hides *order and count*, not *cadence*; full traffic-flow confidentiality
  still needs the constant-rate framing regulator on top.
- Master-key agreement between the two ends is unsolved and out of scope — the
  perennial hard part.
- Custom crypto. The tests prove round-trip and the guards; they do **not**
  prove security against a determined adversary. Cryptographer review required
  before it guards anything real.

## The next rung — the Einstein-Rosen / hyperbolic variant

The phase here lives on a **flat** torus. The next step swaps that geometry for
Elle's existing **hyperbolic container** (the Poincaré ball,
`docs/HYPERBOLIC_GRAPH_MAPPING.md`): the two endpoints become points in
hyperbolic space, the "bridge" is the interior **geodesic** between them (a
shorter, surface-invisible chord), and the sync clock advances along hyperbolic
**arc-length** — a curvature-warped cadence that reads as irregular to a
flat-space observer but is regular in hyperbolic time. Honest scope: this is
routing-and-coordinate geometry, not spacetime — it sends nothing faster than
light and moves no bit without a channel (the no-communication theorem stands).
Its value is efficient, covert synchronization geometry. This module is the
tested spine it builds on: the search loop, the AEAD gate, and the forward-only
guard are identical; only how θ advances changes.

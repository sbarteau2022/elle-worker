# Design doc — Post-quantum crypto for the Rosen bridge

**Status:** draft for review · **Author:** audit pass · **Scope:** `elle-worker` lane-envelope / hyperbolic-sync / session-bus + `Elle` `rosen-bridge.cjs`

---

## 1. TL;DR / recommendation

The Rosen bridge (the sealed cloud↔laptop job channel) is built entirely from
**symmetric** primitives — HKDF-SHA256 + AES-256-GCM keyed off one pre-shared
root (`SANDBOX_AGENT_KEY`). **It has no quantum-vulnerable primitive**, so it
needs *nothing* for quantum resistance. AES-256 stays ~128-bit under Grover:
safe.

What the protocol actually lacks is **classical**: no forward secrecy (root
leak ⇒ every past wire decrypts) and no origin authentication (both ends share
the root ⇒ neither can prove the other authored a message).

Therefore the recommended change is **not** "add PQC to the sealer." It's:

> Introduce a **hybrid (classical + ML-KEM) handshake** that establishes each
> lane's root by key agreement instead of a hand-copied shared secret. This
> buys **forward secrecy** and **removes manual key distribution** today, and
> makes those properties **quantum-safe** for free — because once you're doing
> a KEM handshake, doing it post-quantum costs nothing extra.

PQC here is the *future-proofing you get for free* on a change worth making for
classical reasons. If we would not do the handshake for forward secrecy alone,
we should not do it for PQC alone either.

**Proposed phases:** (0) decision to proceed → (1) hybrid X25519+ML-KEM lane
handshake behind a version flag, both runtimes → (2) optional ML-DSA origin
signatures → (3) cutover + retire pasted `SANDBOX_AGENT_KEY`.

**Hard prerequisite (see §2.4):** the same hybrid combiner MUST be dropped into
`signal-collapse.ts`'s `rekey()` before that P-256 ECDH ratchet is ever wired to
a live path — it is the repo's only Shor-vulnerable primitive, and shipping it
bare would be the first genuine harvest-now-decrypt-later exposure.

---

## 2. Current protocol (as built)

Three composed layers, ported byte-for-byte to the laptop (`rosen-bridge.cjs`):

| Layer | File | Role |
|---|---|---|
| COROS `seal`/`open` | `helix.ts` | AES-256-GCM AEAD; fresh 16-byte nonce `N` per message, `HKDF(master, salt=N)` → AES key **and** IV **and** whitening key |
| hyperbolic-sync | `hyperbolic-sync.ts` | counter-free per-tick key: both ends walk a deterministic bounded geodesic in the Poincaré disk; `HKDF(master, tick ‖ quantized-position)` → per-tick master; receiver AEAD-searches a forward-only 32-tick window |
| lane-envelope | `lane-envelope.ts` | `HKDF(root, info="elle-lane-bridge-v1:<lane>")` → per-lane master; per-direction (`to_local`/`to_cloud`) sender/receiver state |
| transport + state | `session-bus.ts` | stateless HTTPS poll/submit; sender/receiver `HypState` persisted in D1 (`elle_session_bus_state`) cloud-side, `<workRoot>/.bus-state/` laptop-side |

**Root of trust:** `SANDBOX_AGENT_KEY` (worker secret) ≡ `ELLE_SANDBOX_KEY`
(laptop env), pre-shared out of band. Everything is HKDF-derived from it.

### 2.1 What's genuinely good (keep)
- **No (key, IV) reuse.** Per-message random `N` derives key+IV together — two
  seals at the same tick still differ. Correct.
- **AEAD is the authenticator.** Only a root-holder can produce a valid GCM tag.
- **Constant-work open.** `hypOpen` runs all `window` decrypts (no early exit on
  match), so match-position doesn't leak through timing.
- **Per-lane / per-direction isolation** via distinct HKDF info strings, with a
  test proving cross-lane wires don't open.
- **Honest headers.** The code repeatedly states geometry adds covertness, never
  secrecy. This doc keeps that discipline.

### 2.2 Limitations this design addresses
- **L1 — No forward secrecy.** Per-tick keys are a deterministic function of the
  root. `SANDBOX_AGENT_KEY` leak ⇒ retroactive decryption of all captured
  traffic. "Forward-only" is a *replay* guard, not FS.
- **L2 — No origin authentication.** Shared root ⇒ a compromised laptop key can
  forge "cloud→laptop" messages and vice-versa. No non-repudiation.
- **L3 — Manual key distribution.** Every device that joins needs the one long-
  lived secret pasted in. No enrollment, no rotation, no revocation short of
  rotating the secret everywhere.
- *(Out of scope but noted — see §7)* L4 cross-runtime determinism, L5 receiver-
  state rollback/race, L6 plaintext poll metadata. These are availability /
  hygiene issues independent of PQC.

### 2.3 Quantum exposure, explicitly
| Primitive | Quantum attack | Status |
|---|---|---|
| AES-256-GCM | Grover → ~2¹²⁸ work | **Safe** |
| HKDF-SHA256 | Grover on SHA-256 preimage | **Safe** at 256-bit |
| pre-shared root | none (no public-key step) | **Safe** |
| **`signal-collapse` ECDH ratchet (P-256)** | **Shor** — polynomial-time break | **VULNERABLE** — but not on a live path today (see §2.4) |

For the *sealed lane traffic*, there is **nothing to harvest-now-decrypt-later**
today, *because the lane root is pre-shared — there is no key-exchange on that
path to record*. (Transport TLS to the Worker is already hybrid-PQC on
Cloudflare's edge, separately.) The moment Phase 1 introduces a lane handshake,
we introduce a harvestable exchange — which is exactly why that handshake must
be **hybrid PQC from day one**, not classical-then-upgrade.

### 2.4 The latent handshake: `signal-collapse.ts` (correction)

An audit of every `crypto.subtle` call site (Rosen-bridge structural pass) turned
up the **one asymmetric primitive in the repo**, and it changes the "no key
exchange exists" claim above into "no key exchange exists *on a live path yet*":

- `signal-collapse.ts` implements a **Signal-style DH ratchet** — ephemeral
  **ECDH over P-256** combined into the COROS master via HKDF (`rekey()`), giving
  genuine post-compromise recovery. It is correct classical crypto.
- **P-256 is exactly what Shor breaks.** So if/when this ratchet is wired into a
  live path, it — not the pre-shared Rosen bridge — becomes **the repo's first
  real harvest-now-decrypt-later exposure**, and the true home of the PQC upgrade.
- **Current status:** only reachable from `/api/elle-signal-collapse-selftest`
  (a self-test), never a data path. So there is no live exposure *today*, and
  this is a latent finding, not an incident.
- **Implication for this design:** the hybrid combiner in §4.1 is written for a
  *lane* handshake, but its shape is identical to what `rekey()` needs. When the
  ratchet goes live, replace its P-256 `deriveBits` with the **same hybrid
  X25519 + ML-KEM-768 → HKDF** combiner (`ss_dh ‖ ss_kem ‖ old_master`), reusing
  one implementation for both. Do **not** ship the P-256 ratchet on a live path
  without this — a bare ECDH ratchet is the one place a future quantum adversary
  gets retroactive decryption of everything that rode it.
- **Nit (unrelated to PQC):** `rekey()` feeds the DH secret as the HKDF *salt*
  and the old master as IKM — inverted from the Signal/Noise convention. It
  achieves post-compromise recovery, but add a one-line comment so a future
  reader doesn't "correct" it into a weaker shape.

---

## 3. Threat model for the change

Actors and assumptions unchanged from today: the laptop is the operator's own
machine, the worker is trusted, TLS underlies every hop. New goals:

- **G1 (forward secrecy):** compromise of long-term key material must not
  decrypt previously recorded lane traffic.
- **G2 (PQ-harvest resistance):** an adversary recording the handshake now must
  not be able to derive the lane root with a future quantum computer.
- **G3 (no worse than today):** a flaw in the *younger* PQC implementation must
  never reduce security below the current classical baseline. ⇒ **hybrid, always.**
- **G4 (optional, origin auth):** the laptop can verify a job was authored by
  the cloud without holding a key that could forge one. (Phase 2.)

Non-goals: changing the transport (still a stateless poll), changing the AEAD
(AES-256-GCM stays), defeating traffic analysis of the poll envelope (§7 L6).

---

## 4. Proposed design

### 4.1 Phase 1 — hybrid lane-root establishment (the core change)

Replace "the lane root **is** the pre-shared secret" with "the lane root is
**derived from a hybrid key agreement**, authenticated by the pre-shared secret
during migration."

**Handshake (per lane, per epoch), initiated by the laptop on first contact:**

```
laptop                                   worker
  |  generate ephemeral:                   |
  |    x25519 (esk_c, epk_c)               |
  |    ml_kem768 (dk_c, ek_c)              |
  |-- HELLO {epk_c, ek_c, lane, epoch} --->|   (sealed under the CURRENT
  |                                        |    pre-shared root during migration,
  |                                        |    so the handshake itself is authenticated)
  |                                        |  generate ephemeral x25519 (esk_s, epk_s)
  |                                        |  (ss_kem, kem_ct) = ml_kem768.encaps(ek_c)
  |<- ACCEPT {epk_s, kem_ct} --------------|
  |  ss_dh  = x25519(esk_c, epk_s)         |  ss_dh = x25519(esk_s, epk_c)
  |  ss_kem = ml_kem768.decaps(dk_c, ct)   |
  v                                        v
  root_lane = HKDF-SHA256(
      ikm  = ss_dh ‖ ss_kem ‖ preshared_root,   // hybrid combiner
      salt = transcript_hash(HELLO ‖ ACCEPT),
      info = "elle-lane-root-v2:<lane>:<epoch>",
      L    = 32)
```

Then everything downstream is **unchanged**: `initHypChannel(root_lane)`,
`hypSeal`/`hypOpen`, the geodesic, the AEAD. We are only swapping *where
`root_lane` comes from* — from "pasted secret" to "hybrid-agreed secret,
still bound to the pasted secret via the combiner."

**Why the combiner includes `preshared_root`:** during migration it
authenticates the handshake (an attacker without the pre-shared secret can't
complete it) and guarantees G3 — even if *both* X25519 and ML-KEM were broken,
security degrades to today's pre-shared-key baseline, never below. Post-
migration (Phase 3) the pre-shared term can be dropped or rotated to a pure
enrollment secret.

**Forward secrecy (G1):** ephemeral X25519 + ephemeral ML-KEM keys are discarded
after deriving `root_lane`; rotate epoch on a schedule (e.g. per session / daily
/ per N ticks). Old `root_lane` deleted ⇒ recorded traffic for prior epochs is
unrecoverable even if the pre-shared secret later leaks.

**PQ-harvest resistance (G2):** `ss_kem` comes from ML-KEM-768; a recorded
handshake can't be solved by a quantum adversary.

### 4.2 Phase 2 — optional origin signatures (ML-DSA)

If G4 is wanted: the worker holds an **ML-DSA-65** signing key, publishes the
public key to the laptop at enrollment, and signs a compact header
(`lane ‖ epoch ‖ tick ‖ SHA-256(payload)`) per job (or per epoch, batched). The
laptop verifies but cannot forge. This is the only place an **asymmetric** PQC
primitive is genuinely required, and it's strictly additive — skip it if the
"operator's own machine" trust model makes non-repudiation moot.

### 4.3 Library & runtime fit

One library across all three runtimes: **`@noble/post-quantum`** (audited,
zero-dependency pure-JS/TS; ML-KEM-768 + ML-DSA-65 + SLH-DSA). Rationale:

- **Worker (V8 isolate):** WebCrypto has no ML-KEM/ML-DSA; native/liboqs
  bindings can't load in workerd. Pure-JS is the only option and noble is
  isolate-safe.
- **Electron / Node:** same package (could later swap to OpenSSL 3.5+ PQC, but
  keeping one impl preserves the "byte-for-byte port" property the bridge
  depends on).
- **Mobile (Expo/RN):** pure-JS is the only portable choice; same package.
- X25519 stays on WebCrypto where available, else `@noble/curves` for parity.

Keeping **one** implementation on both ends matters more here than usual: the
whole bridge relies on identical outputs across runtimes.

### 4.4 Where it slots in

| Concern | New/edited |
|---|---|
| handshake messages + combiner | new `lane-handshake.ts` (worker) + `lane-handshake.cjs` (laptop), mirrored like the existing port |
| root source | `laneChannel()` gains a `root` param already; feed it `root_lane` instead of `laneMaster(preshared)` |
| epoch + ephemeral/handshake state | extend `elle_session_bus_state` with an `epoch` + a `handshake` row; laptop `.bus-state/` gains the peer keys |
| routes | `/api/sandbox-bus/handshake` (sealed under preshared root during migration) alongside poll/submit |
| version negotiation | `info` strings bump `v1`→`v2`; poll advertises supported versions |

### 4.5 Migration / rollout
1. Ship the handshake **flag-gated** (`ELLE_LANE_PROTOCOL=v2`), default off.
   v1 pasted-root path stays the default and untouched.
2. Land the **cross-runtime interop test** first (extend
   `rosen-bridge.test.cjs` / the session-bus self-test): a v2 handshake on the
   worker side must open on the laptop side and vice-versa, proving byte parity
   of the noble outputs and the combiner before anything relies on it.
3. Enable v2 on the operator's own device; run both in parallel; confirm.
4. Phase 3: make v2 default, drop the pre-shared term from the combiner to a
   rotation-only enrollment secret, retire the "paste `SANDBOX_AGENT_KEY`" step.

Rollback is trivial while flag-gated: flip back to v1, the pasted root still works.

---

## 5. What we are explicitly NOT doing
- **Not** replacing AES-256-GCM (quantum-safe; replacing it buys nothing).
- **Not** touching the hyperbolic geodesic keystream (orthogonal to key
  agreement; it keeps its covertness role).
- **Not** adding PQC to the JWT / service-key / auth paths — those are HMAC-
  SHA256 symmetric and already quantum-safe (see the audit).
- **Not** claiming PQC fixes a quantum gap in the bridge — there isn't one. The
  win is forward secrecy + enrollment; PQC just keeps that win future-proof.

---

## 6. Costs & risks
- **Handshake latency/size:** ML-KEM-768 keys/ciphertext are ~1–2 KB; one
  handshake per epoch, amortized over many jobs. Negligible for a poll-based bus.
- **New state + new failure mode:** an epoch/handshake mismatch is a new way for
  a lane to "go idle." Mitigate with the interop test, clear diagnostics
  (distinguish "handshake failed" from "no in-window position"), and the v1
  fallback.
- **Determinism (L4) interaction:** the handshake output feeds the *same*
  float64 geodesic. It does not worsen L4, but Phase 1 is the natural moment to
  also move the quantized walk to fixed-point if we ever expect a non-V8 end.
- **Library trust:** noble is audited but young for PQC; the hybrid combiner
  (G3) is precisely what caps this risk at "no worse than today."

---

## 7. Adjacent findings (from reading the protocol — not PQC, worth tickets)
- **L4 — cross-runtime determinism.** Keys depend on `tanh`/`atanh`/`cos`/`sin`
  quantized to 16 bits/dim. Same-V8 today is fine; a future Bun/Deno/native end,
  or a point on a quantization boundary, diverges into a confusing
  "no in-window position authenticated" (availability, not security). Fixed-
  point hyperbolic math would remove the caveat.
- **L5 — receiver-state rollback/race.** Replay protection = persisted receiver
  state advancing forward-only. A D1 restore or deleted `.bus-state/` re-opens
  the window; load→open→save is a read-modify-write with no transaction, so two
  concurrent same-lane submits can race. Consider a monotonic tick floor +
  a conditional/transactional state update.
- **L6 — plaintext poll metadata.** Lane names and `{host, platform, root}` ride
  the poll request in cleartext (TLS only), next to the plaintext
  `x-sandbox-key`. The geodesic's covertness covers job *bodies* only; state
  that explicitly, or seal the metadata too if covertness of the envelope matters.

---

## 8. Decision requested
Proceed to Phase 1 (hybrid X25519+ML-KEM lane handshake, flag-gated, with the
interop test landed first)? Include Phase 2 (ML-DSA origin auth), or defer it
given the single-operator trust model?

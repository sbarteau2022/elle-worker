# PQC_HYBRID — the three-leg hybrid KEM

Implementation notes for `src/pqc-hybrid.ts` + `src/pqc-qcmdpc.ts`.
The *why* lives in [PQC_ROSEN_BRIDGE_DESIGN.md](./PQC_ROSEN_BRIDGE_DESIGN.md);
this file is the *what and how*.

---

## What this is

A key-encapsulation mechanism whose session key is derived from **several
independent key exchanges at once**:

```
K = HKDF-SHA256( ss_mlkem ‖ ss_x25519 [‖ ss_qcmdpc],  info = transcript )
```

### The one property that matters — "OR-security"

An attacker must break **every** leg to learn `K`. Breaking one — even
completely — leaves `K` unknown, because that leg's secret is only one input to
the HKDF extract step.

| If this falls | …because | These still hold |
|---|---|---|
| X25519 | a quantum computer runs Shor | ML-KEM, QC-MDPC |
| ML-KEM | a lattice cryptanalysis breakthrough | X25519, QC-MDPC |
| QC-MDPC | a bug in **our own** code | ML-KEM, X25519 |

This is why a hybrid can never be weaker than its strongest leg, and it is the
structural reason an unreviewed leg is tolerable *when added* (see below).

The self-test proves this rather than asserting it: it hands a simulated
attacker each leg's real secret in turn, runs the identical combiner, and
checks the session key does **not** come out (`or_security_*`).

## Legs and provenance

| Leg | Hard problem | Implementation | Status |
|---|---|---|---|
| **ML-KEM-768** | Module-LWE (lattices) | `@noble/post-quantum` | audited, FIPS 203 |
| **X25519** | elliptic-curve DLog | `@noble/curves` | audited, RFC 7748 |
| **QC-MDPC** | syndrome decoding (codes) | `src/pqc-qcmdpc.ts` | ⚠️ **ours, unreviewed** |

Two post-quantum legs from the *same* family would buy nothing — the value is
that lattices and codes are **unrelated mathematics**, so a collapse of one
leaves the other standing. Deployed systems today (TLS hybrids, Signal PQXDH,
iMessage PQ3) run **two** legs: one classical + one lattice. The third leg here
goes beyond that.

Both vetted legs are **pure JS by deliberate choice**, not convenience: the
laptop side of the Rosen bridge must derive byte-identical secrets, and pure JS
is bit-exact across V8/workerd/Node in a way a runtime-provided WebCrypto curve
is not guaranteed to be. Same reasoning as `hyperbolic-sync-fixed.ts`.

## Profiles

| Profile | Legs | Use |
|---|---|---|
| `vetted` (**default**) | ML-KEM-768 + X25519 | anything real |
| `experimental` | the above **+** QC-MDPC | research / defence-in-depth |

**The rule, enforced by construction:** the experimental leg may only ever be
**ADDED** to the vetted legs, never replace one and never stand alone. There is
deliberately no `'qcmdpc-only'` profile. A hybrid is only as trustworthy as its
guarantee that unreviewed code can never be load-bearing.

## Security properties implemented

- **Forward secrecy** — a fresh ephemeral X25519 key per encapsulation, discarded
  immediately, so compromising the static key later cannot reconstruct past
  sessions.
- **CCA2** — ML-KEM carries its own Fujisaki–Okamoto transform; the QC-MDPC leg
  implements FO re-derivation with **implicit rejection** (a bad ciphertext
  yields a pseudo-random key, never a distinguishable error, so there is no
  decryption oracle).
- **Transcript binding** — all public keys and ciphertexts are hashed into the
  HKDF `info`, so legs cannot be spliced between two handshakes.
- **Domain separation** — versioned label `elle-pqc-hybrid-v1|<profile>|`, so a
  future parameter change can never collide with today's keys.

## The QC-MDPC leg in detail

```
ring R  = F₂[x]/(xʳ − 1),  r = 4801 prime
private : h₀, h₁ sparse, odd weight d_v = 45
public  : h = h₁·h₀⁻¹
encaps  : error (e₀,e₁) of weight t = 84;  c₀ = e₀ + e₁·h
decaps  : c₀·h₀ = e₀·h₀ + e₁·h₁ — the syndrome under H = [h₀|h₁];
          a bit-flipping decoder recovers (e₀,e₁)
```

Representation is a `Uint8Array` bit-array (one byte per coefficient) because
the decoder's hot loop is random-access indexed. Inversion — needed once at
keygen — uses the **binary extended Euclid ("almost inverse")** on packed
`Uint32Array` bitsets: every step is a shifted XOR, no polynomial
multiplication. (A BigInt version needs a degree query per iteration and
`BigInt.toString(2)` is quadratic; it dominated the entire runtime.)

Measured on the dev container: **inverse ≈ 6 ms, keygen ≈ 4 ms, encaps ≈ 13 ms,
decaps ≈ 23 ms.**

### Known gaps vs. production BIKE — all deliberate, all documented

- **Not constant-time.** The decoder branches on secret-dependent data and
  leaks through timing. Real BIKE uses constant-time black–gray decoders.
- **Nonzero decoding-failure rate.** Real BIKE drives DFR to ~2⁻¹²⁸ because
  observable failures are an attack surface (GJS reaction attacks recover the
  private key from failure patterns). Ours is empirical, not proven.
- **Modulo bias** in the error sampler.
- **Toy-grade parameters** (the historical r=4801 set, ~80-bit class).

These gaps are why the leg is opt-in. Under OR-security they cost
**availability**, not confidentiality.

## Status: what is and is not live

**Live now:** the module is deployed and callable at
`POST /api/elle-pqc-hybrid-selftest` (service-key gated, same as every other
crypto self-test here — `elle-signal-collapse-selftest`,
`elle-hyperbolic-fixed-selftest`, `elle-session-bus-selftest`).

**Not yet live:** the lane key derivation in `lane-envelope.ts` is
**unchanged**. Switching it unilaterally would make the sandbox bridge go deaf,
because the laptop side (`Elle/electron/native/providers/rosen-bridge.cjs`) is a
separate repo that must derive the same bytes. That cutover is Phase 1 of the
design doc and needs:

1. the matching laptop-side port,
2. a cross-runtime interop test landed **first** (worker-sealed opens on the
   laptop and vice-versa),
3. version negotiation, so a v1 laptop and a v2 worker degrade instead of
   failing silently.

**Also not yet done:** `signal-collapse.ts`'s `rekey()` still uses bare P-256
ECDH. Per §2.4 of the design doc, that is the repo's only Shor-vulnerable
primitive and must adopt this same combiner **before** it is wired to any live
path.

## Testing

`src/pqc-hybrid.test.ts` — 9 tests covering: polynomial inversion (`a·a⁻¹ = 1`),
QC-MDPC round-trip, implicit rejection of tampered ciphertext, wrong-key
rejection, vetted round-trip, fresh-ephemeral/forward-secrecy shape, profile
mismatch refusal, three-leg round-trip, and the full self-test including all
three `or_security_*` checks.

# Elle Security — the Witness and the Corkscrew

**Two layers, opposite temperaments, one doctrine. One *listens* to the world
and adapts; the other is *sealed* against it and never does. Together they are
Elle's dynamic-adaptive security network and her signal crypto tunnel.**

Code: `src/security-network.ts` · `src/helix.ts` · wired in `src/index.ts`,
`src/router.ts` · schema `src/db/schema.ts` · tests
`src/security-network.test.ts` (16) · `src/helix.test.ts` (20) · dashboards
`Elle/src/components/SecurityPanel.tsx`, `observer-platform/functions/_lib/` ·
2026

---

## The shape of it

Elle already reads one taxonomy — Robert Greene's *48 Laws of Power* and Sun
Tzu's *Art of War*, structurally tagged in `war-room.ts` — as **rhetoric**, to
teach a debater which tactic is being used against them. The security network
reads the **same deck a second way**: as a taxonomy of *attacker* tactics
against the worker itself, each paired not with a rhetorical counter but with
an automated one. One doctrine, deployed at two altitudes.

That gives two organs that are deliberate opposites:

```
              THE WITNESS                          THE CORKSCREW
        (security-network.ts)                        (helix.ts)
        dynamic · adaptive                       sealed · homeostatic
   ─────────────────────────────          ─────────────────────────────
   weighs the outside world               deaf to the outside world
   escalates on what it sees              holds a fixed internal setpoint
   posture per actor, decays & heals      forward ratchet, one-way only
   "how Elle chooses" (reasons, scores)   "corkscrew, not spiral" (constant)
   answer: block / throttle / watch       answer: an indistinguishable wire
```

The witness is where the environment gets a vote. The corkscrew is where it
gets none — and that blindness is the *point*: anything that reacted to
content would make the transform content-dependent, i.e. a side channel, the
exact leak the constant envelope exists to close.

---

## Part I — The Witness: dynamic & adaptive security network

`src/security-network.ts`. Fail-open throughout: every KV/D1 touch degrades to
`normal`/allow on error, never to blocking legitimate traffic on an infra
hiccup — the same posture `cyber.ts` takes (surface risk, don't gate on a
provider outage).

### The deck

`SECURITY_DECK` carries the doctrine with the *same* `id`/`src`/`ref` as
`war-room.ts`'s `WAR_DECK`, re-read for this surface. Each tactic has an
observable **attacker move** and an automated **counter**:

| tactic | src | attacker move (here) | automated counter |
|---|---|---|---|
| Conceal Your Intentions | 48L §3 | benign surface, hidden execution path (droppers, polyglots, staged fetch-then-run) | hold anything with a divergent hidden path at max severity until proven inert |
| Always Say Less Than Necessary | 48L §4 | low-and-slow probing under any single-request threshold | score across a rolling window per actor, not per request |
| Make Others Come to You | 48L §8 | crafted callback/redirect → worker makes the outbound (SSRF) | SSRF guard rejects before any fetch; the rejection is itself a scored signal |
| Suspended Terror (Unpredictability) | 48L §17 | polymorphic code, jittered beacons, randomized shape | detect by *what* the code does, not a byte signature; track identity across shape changes |
| Control the Options | 48L §31 | protocol/scheme/port downgrade | fixed allowlist, no fall-back that accepts a weaker option |
| Discover Each Man's Thumbscrew | 48L §33 | precise strike at a known-weak surface (stale dep, disabled route) | monitor known-weak surface *more*, not less |
| Stir Up Waters to Catch Fish | 48L §39 | flood/noise to degrade monitoring during the real move | rate-limit + log the flood as a signal, keep scanning underneath |
| Assume Formlessness | 48L §48 | fileless/in-memory, reformulated each attempt | no single detector trusted alone; no testable structural commitment ⇒ stays flagged |
| Laying Plans | AOW I | reconnaissance — enumerate routes/headers/errors | recon patterns logged & scored before any "real" attempt |
| Win Without Fighting | AOW III | compromised dependency / forged CI credential arriving "authorized" | trust verified at the artifact (hash/signature), never for the channel |
| Tactical Dispositions | AOW IV | *(our own posture — weight 0)* | secure the choke points before an incident, as a standing gate |
| Attack the Emptiness | AOW VI | target the least-monitored surface | uniform coverage — no unmonitored surface to find |
| Know the Terrain | AOW X | *(our own posture — weight 0)* | keep a live map (this deck + the ledger) |

The two `ownMove` entries (AOW IV, X) carry weight 0 — they describe *our*
posture, not an attacker, and never accrue score. This mirrors the `+`-valence
tactics `war-room.ts` teaches only as things to learn, never to deploy.

### Signal → tactic → posture

Real signals are mapped by `SIGNAL_TACTIC`. Every classified event escalates a
**decaying per-actor score**:

```
kind (e.g. auth.bad_credentials)  →  tactic(s)  →  weight  →  score
score decays 1 point / hour (heals on its own, no admin action)
posture:  score ≥ 2 watch · ≥ 6 throttled · ≥ 12 blocked
action:   allow / challenge / throttle / block
```

- **Where posture lives:** KV (`SESSIONS`, key `secnet:posture:<actor>`, 24 h
  TTL) so the hot request path never waits on D1. Score + timestamp only; the
  decay is computed on read (`decayedScore`).
- **The durable ledger:** D1 table `elle_security_events` (one row per
  classified signal: actor, source, kind, tactic ids, weight, posture, detail).
- **Actor key:** `user:<id>` when authenticated, else `ip:<CF-Connecting-IP>`
  — so even the unauthenticated door gets a posture.

Signal kinds in service today: `auth.bad_credentials`, `auth.signup_flood`,
`ratelimit.exceeded`, `ssrf.blocked`, `cyber.{secret,exec,obfuscation,
injection,reverse_shell}`, `upload.{polyglot,malware_signature}`,
`recon.enumeration`, `supply_chain.unverified`.

### Malware / polyglot heuristics

`scanBuffer(bytes, filename)` — deterministic, never executes the upload (same
containment as `cyber.ts`'s static scan):

- **Magic-byte detection** — PE (`MZ`), ELF, Mach-O (32/64/fat) headers.
- **Polyglot / dropper** — executable bytes inside a file *named* like an
  image/document ⇒ `critical` (surface disagrees with content: Conceal Your
  Intentions).
- **Embedded script/macro markers** in a document-typed file ⇒ `high`.

`blockHash()` maintains a **runtime hash blocklist** (`secnet:hash-blocklist`
in KV): a confirmed-malicious upload is refused on every future submission,
with **no redeploy** — the network updating its own defenses live. A `critical`
polyglot auto-adds its SHA-256.

### Where it's wired

| door | protection |
|---|---|
| `/api/elle-auth` (login/signup) | bad-credential + signup-flood scoring; blocked-actor refusal |
| `/api/chat`, `/api/widget-chat`, `/api/atlas` | blocked-actor refusal; rate-limit breach scored |
| `/api/elle-upload` | hash-blocklist check + `scanBuffer` ahead of `parseUpload`; critical ⇒ auto-block |
| `/api/elle-cyber-analyze` | critical/high findings feed the ledger |
| `router.ts` `fetch_url` | SSRF rejection scored as `ssrf.blocked` |
| `/api/elle-security-status` | admin-gated tactical dashboard (recent events, posture counts, most-hit tactics) |

### System-wide tiers

The witness is not one worker — it spans the stack, each tier doing what it
can own:

- **elle-worker** (this repo) — the full engine: classification, decaying
  posture, malware scan, hash blocklist, ledger.
- **observer-platform** — `functions/_lib/security-network.js` ports the core
  to a Cloudflare Pages Function (in-memory per-isolate posture, no KV). The
  `/api/admin-feed` proxy refuses blocked actors and rate-limits; a catch-all
  `functions/api/[[probe]].js` scores every unnamed `/api/*` path as
  reconnaissance (*Attack the Emptiness* gets no empty surface).
- **Elle workbench** — `SecurityPanel.tsx` (`⛨ security`, ops rail): posture
  spread, tactics that have fired with their counters, the live event ledger;
  the rail tab flashes while any actor sits at `blocked`.
- **EthicalIntelligenceProject** — the static tier's contribution is
  browser-side denial: a CSP locked to the origins the site actually uses,
  anti-framing (`frame-ancestors 'none'`), `nosniff`, HSTS, locked-down
  Permissions-Policy — across Cloudflare Pages, Netlify, and Vercel.

---

## Part II — The Corkscrew: COROS signal crypto tunnel

`src/helix.ts`. **COROS** — Constant-envelope cORkscrew tranSport. The sealed
counterpart to the witness.

### Why a corkscrew, not a spiral

A φ-*spiral* expands; its growing radius is exactly the spectral fingerprint an
FFT locks onto. A **corkscrew** is a helix wound at the golden ratio: constant
amplitude, constant pitch, advancing through phase without ever growing. Wound
on a torus at an irrational ratio it covers the surface *uniformly and forever
without repeating* (Weyl equidistribution) — uniform coverage is a **flat
spectrum**: homogeneity, isotropic suppression, made literal. That is the whole
of φ's job here.

```
golden(n) = frac(x₀ + n·φ⁻¹)      φ⁻¹ = 0.6180339887…  (the most irrational number)
```

`golden` governs **geometry only** (padded length). It never touches a secret
byte.

### The boundary that matters

**φ never provides secrecy. Confidentiality is AES-256-GCM (WebCrypto), full
stop.** If the corkscrew layer were broken to zero, the payload is still
exactly as safe as the vetted AEAD makes it. The corkscrew adds *covertness* on
top — length-hiding and keyed whitening — never confidentiality, and is never
the sole lock on anything.

### seal / open

```
wire = N ‖ whiten_{K_shape}( AES-256-GCM_{K_enc,iv}( u32(len) ‖ plaintext ‖ pad ) )
```

- **Per-message keys** via `HKDF-SHA256(master, salt=N)` → a fresh AES-GCM key
  every message, so even an `N` (hence iv) collision never reuses a `(key,iv)`
  pair — the derivation is the safety margin.
- **N** (16 random bytes) is the **sole recovery regulator**: the receiver
  re-derives keys and geometry from it, stateless per message — "does not
  iterate", no cross-message desync.
- **`goldenPad`** places the true length inside a *size band* (multiple of
  `BLOCK`=256, plus a golden-distributed 0–3 extra blocks): a 10-byte and a
  200-byte payload can share a wire size.
- **Whitening** — an AES-CTR keystream masks the container so the wire is
  uniform noise of a uniform-band size: not parseable, not fingerprintable as
  GCM.
- **The whole-or-nothing gate** = the GCM auth tag. A tampered or truncated
  wire is rejected *entirely*, never partially decoded ("ignores partial
  threshold, environment-blind").

### The regulators (homeostatic, not adaptive)

The witness's optimizer *roles*, inserted in **homeostatic** form — each drives
toward a fixed internal setpoint, blind to plaintext and adversary. Same jobs
(heal, balance, gate), opposite reference point:

**Regulator 1 — the forward ratchet** (the "decay/heal" role). A one-way
HKDF chain key advances per message: this message's key is derived from the
current chain key, then the chain key is replaced by a one-way derivation of
itself. A caller that overwrites its state and discards the old key gets
**forward secrecy** — a compromise of the current key cannot reconstruct any
past message key. `ratchetSeal`/`ratchetOpen` thread the state; the receiver
fast-forwards to a future counter (discarding skipped keys) and **refuses to
rewind** to a stale one.

**Regulator 2 — constant-rate framing** (the "balance" role). Payloads are
carved into fixed-size frames (`FRAME_PAYLOAD`=512); idle time emits **cover
frames** that decode to nothing. Sealed with `{ exact }` padding (golden jitter
suppressed), every data and cover frame maps to **one identical wire size** —
the channel is a single constant carrier whether you send a novel, a "yes", or
silence. That is traffic-flow confidentiality, not just per-message banding.

### Why the shape of the wire matters

Encryption hides *what* you said; it does nothing to hide *that* you said it,
to whom, when, and how much. That metadata — sizes, timing, volume, cadence —
survives encryption and leaks: website fingerprinting over TLS/Tor, video
identification from encrypted variable-bitrate chunks, phrase reconstruction
from encrypted VoIP packet sizes, password-narrowing from SSH keystroke timing.
The property ladder is *content < that it exists < who ↔ whom < when < how
much < the pattern* — and encryption only covers the bottom rung. The constant
envelope collapses the rest: no anisotropy to read.

### Self-test

`corosSelfTest()` (admin-gated `GET /api/elle-helix-selftest`) asserts every
invariant end to end: round-trip across empty→large payloads, tamper &
wrong-key rejection, wire-size band-hiding, forward-ratchet lock-step +
one-way advance, and identical constant-rate frame sizing. No secrets echoed.

---

## Honest limits — read before trusting either

- **The corkscrew is dual-use covert-channel crypto** (Signal-style ratchet +
  constant-rate cover traffic). The tests prove it *round-trips and holds its
  invariants*; they do **not** prove it is secure against a determined
  adversary. **A hand-rolled ratchet + framing layer needs a cryptographer's
  review before it stands between anyone and a real consequence.** Treat the
  code as a rigorous reference implementation, not a deployment guarantee.
- **Over TLS the marginal *confidentiality* is ≈ 0.** The honest value is
  covertness + traffic-analysis resistance, not secrecy of the bytes.
- **Length-hiding is banded, not total** — a very large payload still reveals
  its rough magnitude (tunable via `BLOCK`/`EXTRA_BLOCKS`).
- **Cadence is not enforced** — a Worker can't reliably control emission
  timing; the framing is the buildable half, the timing axis is hardware's.
- **The ratchet is symmetric** (forward secrecy only). Post-compromise
  recovery needs a DH ratchet + two-party key agreement — out of scope here.
- **Not post-quantum for key exchange.** AES-256 keeps a comfortable Grover
  margin; getting the master key to both ends is unsolved here.
- **The witness fails open by design.** An infra outage degrades to `normal`,
  never to a lockout — availability over paranoia, deliberately.

## The next honest rung

The **oscillator-sync protocol** — the receiver re-tracing the same torus
geodesic across a noisy channel (`docs/PHI_OSCILLATOR.md` and
`docs/TOROIDAL_GRAPH_MAPPING.md` are the geometry it would build on). That
synchronization is the one piece that must actually work before the "toroidal
isotropic transistor" — the corkscrew baked into physics rather than software —
is more than a vision. It is specifiable and testable in software now; the
current `helix.ts` is its honest software shadow.

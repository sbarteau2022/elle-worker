# Making the Signal Collapse — and Making the Math Trustworthy

**Two things, explained plainly. First: the math behind the hyperbolic sync
now works identically on any computer, not just "the same computer twice."
Second: what "the signal collapses if the wall breaks" can honestly mean —
one real mechanism that stops a caught attacker cold, and one real mechanism
that heals a stolen key, plus a clear line drawn around what no software can
ever do.**

Code: `src/fixed-math.ts` · `src/hyperbolic-sync-fixed.ts` ·
`src/signal-collapse.ts` · tests: 12 + 14 + 11 = 37 new · builds on
`src/hyperbolic-sync.ts`, `src/helix.ts`, `src/security-network.ts` · 2026

---

## Part I — Making the math trustworthy (the fixed-point core)

### The problem, in one sentence

The hyperbolic sync (`hyperbolic-sync.ts`) computes a moving point using
ordinary decimal math — `Math.tanh`, `Math.atanh`, `Math.sqrt`. Two computers
running the exact same JavaScript can, by the rules of the language itself,
come up with an answer that differs in the very last decimal digit for those
specific functions. One digit off in the position means a completely
different secret key gets derived from it. The two sides go silently deaf —
not an error message, just two computers that can no longer hear each other,
and neither one would know why.

### The fix, in one sentence

Do all the math with whole numbers only — no decimal point ever appears —
using a 1959 technique called CORDIC, built originally for airplane
navigation computers that didn't have a "multiply" circuit at all. It
computes sine, cosine, tanh, and square root using nothing but addition,
subtraction, and shifting digits over (which is just "multiply or divide by
2, instantly"). Whole-number addition, subtraction, and bit-shifting ARE
guaranteed identical on every computer, by the actual specification of the
JavaScript language — not by convention, by rule. So a walk built entirely
out of those three operations can never disagree with itself across
machines.

### Three real bugs this caught before anything shipped

Writing new integer math from scratch is exactly the kind of place a subtle
mistake hides, so every function was checked against the ordinary decimal
version before being trusted:

1. **The very first draft would have shipped the exact bug it was built to
   remove.** The whole point of this file is: never call a decimal
   trig/tanh function at the moment two computers need to agree. The first
   version of the code built its internal lookup tables by calling
   `Math.atan` and `Math.atanh` *the instant the program starts up* — which
   quietly puts the "different computers might disagree" problem right back
   in, just one step earlier than before. Caught by re-reading what the file
   was actually promising versus what it was actually doing, before a single
   test was even run against it. The fix: those tables are now computed once,
   by hand, ahead of time, and typed into the file as fixed numbers that
   never change and are never recalculated by any computer at any point —
   every copy of the file carries the identical numbers, permanently.
2. **A gain constant was upside down.** CORDIC's spinning process stretches
   the numbers a little on every step; you have to divide that stretch back
   out at the end with a correction constant. The correction constant for the
   hyperbolic (tanh-family) version was accidentally written as the *stretch
   itself* rather than *one divided by the stretch* — so `cosh(0)`, which
   must equal exactly 1, was coming out as 0.69. Caught by testing against
   `Math.cosh` directly, not by reading the formula and trusting it.
3. **A direction rule was backwards.** One of the two CORDIC modes (the one
   that computes `atanh`) has a rule for which way to turn at each step, and
   the code had that rule flipped — every answer came out with the wrong
   sign and the wrong size. Also caught by testing against `Math.atanh`, not
   by inspection.

All three are fixed, and now every function is checked against its ordinary
decimal counterpart across a real range of values, every time the tests run.

### The two honest boundaries this format has

- **It can't hold numbers of magnitude 2 or larger.** The format has a
  built-in ceiling just under 2.0. That's not a limitation in practice — a
  point wandering inside the hyperbolic disk never gets anywhere close to
  that — but it means this module isn't a drop-in general-purpose calculator;
  it's built for exactly the range this walk needs.
- **The tanh/atanh functions only converge for modest step sizes** (roughly
  up to 1.0), the same kind of range limit ordinary sine/cosine have (they
  only work directly for angles up to 90°, and everything past that needs a
  little extra bookkeeping first — done here too, for turning a full circle
  into sine/cosine). The actual step size the walk uses is 0.5, comfortably
  inside the limit.

### The new module: `hyperbolic-sync-fixed.ts`

A second version of the hyperbolic-geodesic sync, byte-for-byte the same
shape as the original (`hyperbolic-sync.ts`) — same idea of a channel, a
walking position, sealing a message, opening one — but every number in it is
one of these whole-number CORDIC values instead of a decimal. Every one of
its building blocks (the point-combining operation, the distance formula, the
walking step) was numerically checked against the original decimal version
and agrees with it to five decimal places. **Use this version whenever the
two ends of a conversation might not be running the identical program build.
Use the original when they provably are** — it's simpler, and same-build
determinism was already fine.

---

## Part II — What "the signal collapses" can honestly mean

### The line that has to be drawn first

There are two very different claims hiding inside "if an attacker breaks the
noise wall and locates the signal, it collapses":

- **"The signal notices when someone actively messes with it."** Real, and
  built below.
- **"The signal notices when someone silently listens without touching
  anything."** Not real, and can't be built by anyone, in any language, on
  any system. A purely passive listener never sends our system any
  information at all — there's no wire for the warning to travel back on.
  Software can only react to things it receives. If a promise sounds like
  "we'll know the moment someone merely overhears," it's describing a wish,
  not a mechanism, and it was important to say that plainly instead of
  quietly building something that only looks like it does that.

### What's real: two mechanisms, doing two different jobs

**1. Burn on breach — stops a caught attacker cold, right now.**
`signal-collapse.ts` watches for things this system genuinely *can* see:
someone sending a forged or already-used message (the existing "never go
backwards" rule already refuses these — this module now counts how often
that happens), a flood of failed attempts to guess a valid message (fishing
or brute force), or the security network — the "Witness" built earlier —
flagging the same actor as `blocked` from evidence gathered anywhere else in
the whole system (a bad password attempt, a suspicious upload, a scan
pattern). The instant any of those trips, the channel is marked **burned**:
it will not encode or decode one more message, no matter what, until a
completely fresh key exchange happens. No quiet continuing, no second
chances on the same line. And it tells the Witness about it, so that actor's
suspicious mark now follows them to every other door in the system too — the
first time the two systems actually talk to each other. Whatever secret
bytes the caller can still reach get overwritten with zeros as a matter of
housekeeping — worth doing, but honestly: JavaScript has no way to *guarantee*
a number is truly erased from memory, so this raises the bar for a casual
look, it does not promise anything ironclad.

**2. Real key-healing — the piece every earlier document flagged as
missing.** Here's the gap that was always there: the existing "one-way
ratchet" (each message's key comes from the previous one, and you can't run
that backwards) protects *old* messages if a key gets stolen *later* — but it
does nothing for *future* messages if *today's* key gets stolen, because the
next key is just a public, repeatable calculation from today's — anyone
holding today's key can compute tomorrow's exactly as easily as the real
recipient can. This is now fixed with the same idea Signal's app uses:
every so often, both sides do a brief, live math handshake (Diffie-Hellman)
where each contributes a fresh random value the other one needed to see to
compute the shared result. The new key depends on that live, fresh exchange —
not only on the old key. So even if an attacker is holding yesterday's key in
their hand, right now, they get nothing extra from it once the next handshake
happens: they don't have the fresh random value either side contributed, so
they can't reconstruct the new key even though they have the old one. **That
is the actual mechanism behind "the signal heals itself"** — not a metaphor,
a specific handshake with a proven property, tested directly: two sides
running it land on the identical new key, and a simulated attacker holding
the old key but neither side's private handshake value provably lands on a
different one.

### What this doesn't do, said plainly one more time

- It cannot un-happen an interception that already succeeded. If someone
  already has a specific message's exact key, that message was always
  readable to them; math cannot erase the past. What the healing mechanism
  guarantees is about the *next* key, not the one already spent.
- It cannot detect a listener who never interacts with the system. Said once
  in the header, said again here because it is the single most important
  thing not to oversell.

### Where the two pieces sit relative to everything built before

```
security-network.ts     the Witness         — adaptive, watches the world, escalates
helix.ts (COROS)         the Corkscrew       — sealed transport, AES-256-GCM + φ covertness
torus-sync.ts            the flat spine      — counter-free sync, no cross-platform risk (no decimals used)
hyperbolic-sync.ts       the Bridge          — curvature-warped sync, same-build only
hyperbolic-sync-fixed.ts the Bridge, sealed  — the SAME bridge, safe across any build (this doc, Part I)
signal-collapse.ts       the Alarm + the Cure — burn on real evidence, heal a stolen key (this doc, Part II)
```

The Alarm and the Cure are written as a general-purpose layer any of the sync
channels above can adopt — they don't yet sit in front of live user traffic
in this codebase (nothing here carries real end-user messages through COROS
yet), so wiring `assertNotBurned` / `recordFailedOpen` / `checkWitnessPosture`
around a real caller's seal/open calls, and scheduling the ECDH `rekey` on a
real cadence, is the integration step for whoever is first to carry live
traffic through one of these tunnels.

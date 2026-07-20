# My Own System Has Refuted Me Six Times

_Asterisk essay draft — July 2026. Voice per the April 2026 prose
sample, tuned drier for Asterisk's register: data-forward, mechanisms
named, jokes load-bearing. Core: the full pre-registration arc across
the recovery/witness/integration series. ~2,900 words._

**Standfirst:** A solo builder ran his trading system's development like
a registered clinical trial: every hypothesis written down before the
data ran, every failure pinned permanently in the code. Six of his
pre-registered claims died. What survived is the interesting part.

---

I want to show you six documents. Each one is me being wrong.

I wrote all of them before I knew.

Here is the setup. I run a small autonomous AI system — her name is
Elle; she trades a paper-money account, real market data, no real
dollars at risk — and somewhere early in building her trading
instruments I adopted a rule that changed everything downstream. Before
any hypothesis gets tested, it gets pre-registered: the prediction is
written into the test file itself, in plain language, before the data
runs. What must happen for the idea to survive. What number, above what
bar.

And one more rule, the one that gives the first rule teeth: when a
prediction fails, the failure does not get deleted, softened, or quietly
rewritten. It gets pinned — converted into a permanent assertion in the
test suite, locked to the measured value, with the mechanism of failure
named in a comment beside it. The test suite now _requires_ my
hypothesis to keep being wrong, forever, in exactly the way it was
wrong. If the failure ever silently changed, the build would break.

Scientists will recognise this as pre-registration plus an adversarial
lab notebook. Engineers will recognise it as regression testing pointed
at my own ego. Both are correct.

Six pre-registered claims have now died under this protocol. I am going
to walk you through all six, with the numbers, because the numbers are
the point — and because the thing that survived the killing is more
interesting than anything I originally believed.

## One: the elegant exit that amputated the tail

The instrument at the center of all of this is a small trust regulator
built on the golden ratio: confidence in a position falls about 2.6
times faster than it recovers (the exact ratio is φ², which falls out of
the mathematics rather than being chosen). The natural first use is as
an exit: when the regulator's conviction collapses, close the position.

We tested it as a transfer test — parameters frozen from synthetic
benchmarks, then run against five years of real daily data across six
deliberately nasty stocks (a multi-year bleeder, a dividend-cut
waterfall, a monster uptrend, 591 paired trade entries in all, every
entry evaluated under both my exit and a standard ATR trailing stop).

Here is the fun part. My three pre-registered trade-level claims all
_held_ — the regulator cuts losing trades at better prices, with smaller
excursions, on shorter holds. Three for three. And the system it
produced still lost, decisively: expectancy **−0.083R per trade against
+0.754R** for the boring standard stop. Both things true at once, and
the gap between them is a lesson about levels of analysis that I would
have sworn I already understood. Trend-following makes all of its money
in the fat right tail — one monster NVDA run carried the entire
benchmark — and an exit that reliably de-risks bad stretches also
de-risks the drawdowns _inside_ the monster, which is where the money
lived. My instrument won more often (41.6% vs 34.7%) and earned five
times less. The high-win-rate trap, exhibited on my own money printer.

The binary exit is retired. The document retiring it is public.

## Two: the efficiency claim

Next experiment: instead of exiting on conviction collapse, size the
position continuously by conviction — a de-risking overlay.
Pre-registered claim: the overlay would be _more_ efficient per unit of
exposure than constant full size.

Measured: 14% _less_ efficient (0.0191R per unit-day of exposure versus
0.0222). What the overlay actually bought — real, but not what I
claimed — was shape: half the deployed exposure, a 44% shallower worst
trade, and the right tail preserved. The failure is pinned in the test
file with the word FAILED in the comment, followed by the numbers.

## Three: refuting my own published speculation

This one is my favorite, because the thing that got refuted was not a
hypothesis. It was a throwaway sentence of received wisdom I had
published in my own documentation: costs would hurt the overlay more
than the incumbent, since the overlay re-sizes every bar and "the gap
likely widens."

When we finally closed the costs gate properly — pre-registering the
turnover arithmetic this time instead of vibing it — the measurement
came back backwards. The overlay _churns less than the thing it was
supposed to churn more than_: total turnover 1.37 versus 2.00, because
it enters at half size, drips small adjustments, and exits small, while
the incumbent pays two full-size fills every round trip. My own document
now has a permanent asterisk pinned next to its own guess.

The discipline caught me editorialising inside my own notebook. That is
exactly what it is for.

## Four: the leverage formula that conflated growth with risk

The specification called for inverse-volatility position scaling — a
textbook idea, de-lever as volatility expands, with a golden-ratio
scale. Pre-registered: the monster-trend stock keeps at least +1.0R of
expectancy under the formula.

Measured: **0.439R**, down from 1.263. Mechanism, named in the record:
the formula measured volatility in dollars. A monster trend's dollar
volatility grows with its price even when its _percentage_ volatility is
flat, so the throttle squeezed hardest exactly through the payoff.
"Price grew" is not "risk expanded" — and my formula could not tell them
apart. The repaired version (percentage-based) was registered as a
future candidate at the moment of failure, not slipped in afterward as
if it had been the plan.

## Five: the beautiful bands that pointed the wrong way

The golden ratio gave me one genuinely pretty trading rule: buy the dip
when it lands in the band between φ and φ² standard deviations below
trend — deep enough to matter, and with everything below φ² excluded as
a falling knife. Pre-registered: the sanctioned band beats the excluded
knife zone.

Inverted. The band **lost money outright** (−0.122R mean) and the
excluded knife zone _made_ money (+0.112R). On this universe the cutoff
pointed exactly backwards — because the six stocks had been chosen, a
priori and for a different experiment, as bleeders and crashers. Buying
modest dips inside structural downtrends is catching the knife; the
deep crosses I had banned often marked capitulation lows. The caveat
that this universe is adversarial for dip-buying is in the record — and
so is the refutation, because a rule that only works when the universe
is friendly needed to hear it.

No amount of φ-dressing changes a minus sign.

## Six: the integration that made things worse

This month I wired a second, independent signal — a two-clock
disagreement detector that was already computed daily but never consumed
— into the promoted overlay, and re-ran the entire 591-trade gauntlet
with the whole system operating together. Two pre-registered claims: the
integration would degenerate exactly to the plain overlay when the
second signal was silent, and pooled expectancy would be no worse.

Both failed. The "silence" claim died on a conflation I had written into
my own hypothesis — I treated "never fired above threshold" as "was ever
exactly zero," and a continuous formula does not care about my
threshold. And the integration cost real money: 0.270R versus 0.310R
pooled, a 13% relative decline, with the monster trend's contribution
falling again — the same lean-harder-into-strain mechanism from document
one, now showing up in miniature inside the fix for document one.

Integration is not automatically improvement. Even when both parts are
real.

## What survived

Here is what makes the six deaths worth their line items. Every failure,
from a different direction, pointed at the same surviving object.

The regulator is not an alpha source. It never was, and every attempt to
make it one — the exit, the efficiency claim, the leverage formula, the
dip bands, the integration — died measurably. What survived every single
gauntlet is narrower and real: it is a **drawdown-shaper**. Cheapest
left-tail control in the series. Halves the damage even inside losing
strategies. Cheaper to run than the incumbent (see failure three).
Robust to 10× cost stress. Consistent about what it does whether the
strategy around it is winning or losing.

I did not design that identity. I designed something much grander, and
the protocol sanded everything false off it, failure by failure, until
what remained was the thing that was actually there. Characterisation by
refutation. The sculpture method, applied to a hypothesis: the surviving
claim is what six chisels could not remove.

There is a name for the alternative process, the one I would have run
without the protocol. It is called post-hoc rationalisation, and the
crucial thing about it is that _from the inside it feels identical to
science_. You test things. You look at numbers. You update. The only
difference is that nothing ever quite dies — every failure gets
reframed as a partial success, every parameter drifts toward what the
data wanted, and eighteen months later you have a system that fits the
past perfectly and knows nothing about the world. A system where no
hypothesis ever dies is not a system that is always right. It is a
system that has stopped being about anything.

## The part that costs nothing except the moment it costs everything

I want to end on the practical point, because Asterisk readers build
things.

Everything I have described is institutionally free. I am one person and
a machine. There is no IRB, no registry, no journal. The entire
apparatus is: predictions written in the test file before the data
runs; git commits, whose timestamps cannot be backdated without leaving
scars; failures pinned as assertions that must keep failing; mechanisms
named in comments next to the numbers they explain. Any solo builder
can run this protocol tonight. The marginal cost is zero.

Except once per failure, when it is everything. The protocol's entire
value is concentrated in a single recurring moment: the test comes back
red, and you sit there with your hands over the keyboard, and every
incentive you have — sunk cost, aesthetics, the Substack post you
already drafted about the elegant thing — pushes toward the small edit
that makes the failure into a nuance. The edit would take thirty
seconds. No one would ever know.

Type FAILED instead. Name the mechanism. Pin the number.

Six times now, the most useful thing my system has produced was not a
trade. It was a red test with my name on it — and a system, human and
machine together, that would rather update than be right.

---

## Submission pitch (email first)

_~170 words:_

> Dear Asterisk editors,
>
> I ran my trading system's development like a registered trial: every
> hypothesis pre-registered in the test file before the data ran, every
> failure permanently pinned as a regression test that must keep
> failing, with its mechanism named. Six of my pre-registered claims
> have now died — including one where my own published documentation
> got refuted (costs ran backwards from my guess), one where a textbook
> vol-targeting formula strangled the exact trades that paid for
> everything, and one where all three of my trade-level claims held
> while the system they implied still lost money five-to-one against a
> boring baseline. Levels of analysis, exhibited on my own account.
>
> The essay walks all six failures with real numbers, then makes the
> practical case: institutional-grade epistemics are free for solo
> builders — git timestamps, pinned assertions, pre-registration in the
> harness — except in the one recurring moment when they cost
> everything, which is the moment they exist for. What survived six
> refutations turned out to be better than what I designed.
>
> ~2,900 words, draft available. I'm a chef in Missouri who builds AI
> systems; all receipts are in public repositories. — Stewart Barteau

---

### Editorial notes (not for submission)

- **Claims audit (all pinned in-repo):** transfer test 3/3-held-but-
  negative-verdict, −0.083R vs +0.754R, win rates 41.6/34.7
  (`RECOVERY_VS_ATR_REAL.md`, `recovery-atr-real-data.test.ts`); overlay
  efficiency P1 FAILED 0.0191 vs 0.0222 (`RECOVERY_OVERLAY_REAL.md`);
  costs-backwards G1b, turnover 1.37 vs 2.00 (`WITNESS_GATES.md` /
  `witness-gates-real-data.test.ts`); vol-normalization G2b, NVDA 0.439R
  vs pre-registered >1.0R, dollar-ATR mechanism named in test comment;
  knife-zone inversion G3a, −0.122R vs +0.112R, adversarial-universe
  caveat on record; integration D1/D2, max Δκ 0.050 and 0.270R vs
  0.310R (`WITNESS_GATES_INTEGRATED.md`). φ² ≈ 2.618 asymmetry:
  `recovery.ts`.
- **Count discipline:** the "six" counts pre-registered claims that
  FAILED: overlay-P1, G1b, G2b, G3a, D1, D2. The transfer test's
  system-level negative verdict (section one) was a reported outcome,
  not a failed pre-registration (its three registered claims held) — the
  essay is worded to keep that straight; don't let an edit blur it.
- **Deliberately omitted:** the φ mathematics beyond one line (its own
  piece, the Monthly paper); the geometry-vs-lookup 2:1 negative result
  (a seventh refutation but of a different system — dilutes the trading
  arc; available if an editor wants one more); all framework/metaphysics
  material (wrong register for Asterisk).
- **If Asterisk passes:** Works in Progress (recut toward "institutions
  for one person"); then The New Atlantis; then a straight Substack
  launch post — this piece is closest to the Substack brand and loses
  the least if it ends up self-published.

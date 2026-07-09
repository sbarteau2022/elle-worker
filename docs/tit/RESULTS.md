# Reference Results

Clean run of `tit.py` v1.1. All four predictions are genuine measurements.
Python 3, no dependencies, ~2 s runtime. Every number below should reproduce.

```
======================================================================
  TOROIDAL ISOTROPIC TRANSFORMER — BENCHMARK v1.1
  phi          = 1.618033988749895
  phi mod 1    = 0.618033988749895
  phi^-2       = 0.381966011250105   (max of the inf-functional)
  1/sqrt(5)    = 0.447213595499958   (Hurwitz liminf constant)
======================================================================

PREDICTION 1 — phi uniquely maximises delta_inf(w) = inf_n n||nw||
  (dense scan over (0,1); any discrepancy-avoiding system lands here)
  argmax over 60000 points:  w = 0.381967  (folded 0.381967)
  delta_inf(argmax)        =  0.381967
  phi^-2 = 2 - phi         =  0.381966
  named comparators:
      delta_inf(phi-1   =0.61803) = 0.381966
      delta_inf(sqrt2-1 =0.41421) = 0.343146
      delta_inf(e-2     =0.71828) = 0.110398
      delta_inf(pi-3    =0.14159) = 0.003406
      delta_inf(1/3     =0.33333) = 0.000000
  PREDICTION 1: CONFIRMED  (value is phi^-2, NOT 1/sqrt5 — see the liminf below)

======================================================================
  HURWITZ liminf — a DIFFERENT quantity from the inf above
  liminf_n n||n phi|| = 1/sqrt(5), reached along the Fibonacci n
======================================================================

     n = F_k      n||n phi||
          34      0.44729099
          55      0.44718403
          89      0.44722489
         144      0.44720928
         233      0.44721524
         377      0.44721297
         610      0.44721384
         987      0.44721350
        1597      0.44721363
        2584      0.44721358

  -> 0.44721358   (1/sqrt5 = 0.44721360)
  The inf-functional (P1) is dominated by n=1 and equals phi^-2.
  The liminf (here) is an asymptotic tail property and equals 1/sqrt5.
  They are different numbers about the same phi. Both are reported.

======================================================================
  STERN-BROCOT SEARCH — proof as algorithm (starts at 1/2, no phi)
======================================================================

  step             p/q             omega        error
     0  2/3           0.666666666667    4.863e-02
     3  8/13          0.615384615385    2.649e-03
     6  34/55          0.618181818182    1.478e-04
     9  144/233         0.618025751073    8.238e-06
    12  610/987         0.618034447822    4.591e-07
    15  2584/4181        0.618033963167    2.558e-08
    18  10946/17711       0.618033990176    1.426e-09
    21  46368/75025       0.618033988670    7.945e-11
    24  196418/317811      0.618033988754    4.428e-12
    24  196418/317811      0.618033988754    4.428e-12  <- converged
  Every mediant is a ratio of consecutive Fibonacci numbers.

======================================================================
  PREDICTION 2 — star discrepancy at Fibonacci N
  N*D*_N -> 1 (optimal 1/N scaling); ratio D*_{F_k}/D*_{F_{k+1}} -> phi
======================================================================

       N          D*_N     N*D*_N   D*/D*_next
     144    0.00692288    0.99689     1.616132
     233    0.00428361    0.99808     1.616838
     377    0.00264937    0.99881     1.617303
     610    0.00163814    0.99927     1.617579
     987    0.00101271    0.99955     1.617754
    1597    0.00062600    0.99972     1.617861
    2584    0.00038693    0.99983     1.617927
    4181    0.00023915    0.99989     1.617968
    6765    0.00014781    0.99993

  mean N*D*_N            = 0.999108   (-> 1.0)
  mean D*_{F_k}/D*_{F_{k+1}} = 1.617420   (phi = 1.618034)
  PREDICTION 2: CONFIRMED

======================================================================
  PREDICTION 3 — three-gap property, adjacent gap ratios = phi
======================================================================

  N = 1000 (non-Fibonacci)   distinct gap lengths: 3
     small: 0.00045310
    medium: 0.00073314
     large: 0.00118624
  large/medium = 1.61803456   medium/small = 1.61803250   (phi=1.61803399)
  large = medium + small ? True
  Fibonacci degeneracy: N=987 gives 2 gaps, ratio 1.618035 (still phi)
  PREDICTION 3: CONFIRMED

======================================================================
  PREDICTION 4 — phi-winding is the most uniform orbit at matched N
  N*D*_N, lower = more uniform. phi must beat every alternative.
======================================================================

             omega      N*D*_N
    phi-1  (noble)      0.9995
     sqrt2-1 (irr)      1.3076
      e-2    (irr)      1.5735
      pi-3   (irr)     11.4140
      3/5    (rat)    197.8000
  PREDICTION 4: CONFIRMED  (phi's N*D* = 0.9995 is the minimum)

======================================================================
  RESULT: 4/4 predictions confirmed
  Each is a genuine measurement. phi is forced, not assumed.
  inf-functional maximum   = phi^-2  = 0.381966011250
  Hurwitz liminf constant  = 1/sqrt5 = 0.447213595500
======================================================================

Results saved -> /home/user/elle-worker/docs/tit/results.json
```

---

## Reading the two constants (the correction that mattered)

The original harness printed `δ(φ) = 1/√5 = 0.447` as the "theoretical maximum"
while the code actually computed a value of `0.382`, and a footnote tried to
reconcile them with `1/√5 · φ⁻¹`, which equals **0.276**, not 0.382. That was an
arithmetic error over a genuine subtlety. The subtlety, stated correctly:

- **`delta_inf(ω) = inf_{n≥1} n‖nω‖`** — the *finite-n infimum* the code computes.
  For φ it is dominated by the `n=1` term and equals **φ⁻² = 2 − φ = 0.381966…**
  (note `2 − φ = 1/(φ+1) = φ⁻²`). φ and its modular (noble) equivalents uniquely
  maximize this — confirmed by dense optimization in P1, not a hand-picked slate.

- **`1/√5 = 0.447214…`** — the Hurwitz **liminf** (Lagrange) constant. It is the
  limit of `n‖nφ‖` along the *Fibonacci subsequence* of `n`, an asymptotic tail
  property, demonstrated on its own terms in the bridge section.

Both are true statements about φ. They are different quantities. The v1.1 harness
reports each where it belongs and never conflates them.

## What each prediction now establishes

| Prediction | Claim | Why it is a real test |
|---|---|---|
| **P1** | φ (noble class) uniquely maximizes `delta_inf`, value φ⁻² | Dense scan over 60 000 points, not 10 hand-picked ω |
| **Bridge** | `liminf n‖nφ‖ = 1/√5` | Computed along Fibonacci n; separate from P1's inf |
| **P2** | `N·D*_N → 1`; consecutive `D*` ratios → φ | Measured discrepancy; drops the wrong `D* = 1/F_{k+1}` |
| **P3** | ≤3 gaps, adjacent ratios = φ, `large = medium + small` | Steinhaus theorem verified; Fibonacci-N 2-gap degeneracy noted |
| **P4** | φ-winding minimizes `N·D*` vs other irrationals and rationals | Comparative measurement; replaces the circular "variance = 0" |

The earlier P4 ("every step = φ mod 1, variance = 0") was a tautology: the orbit is
a constant displacement by construction, so its step variance is machine zero and
tests nothing. The v1.1 P4 measures that φ actually beats √2−1, e−2, π−3, and a
rational at matched N — which it does (`N·D*`: 0.9995 vs 1.31, 1.57, 11.41, 197.8).

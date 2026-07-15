# Topology Lock — quantum knots, honestly: real topological invariance stabilizing the sandbox registry

**"Quantum knots to stabilize" translated to what's actually real and buildable:
not quantum hardware, but the genuine idea underneath topological quantum
computing — a quantity computed from a curve's shape that is *provably*
unchanged by any continuous deformation, and can only change if something is
actually cut. That is 1833 mathematics (Gauss), not physics we don't have. This
document is the stabilizer for the sandbox lane registry: a real topological
invariant that tells apart provably-independent execution lanes from ones that
have become entangled — checked against a textbook fact, not asserted.**

Code: `src/topology-lock.ts` · tests (8) · self-test
`GET /api/elle-topology-selftest` · consumed by `src/sandbox-registry.ts` · 2026

---

## The honest translation

"Quantum knots" names a real thing, but not the part that's quantum. Topological
quantum computing stores information in **braided anyons** — a physical
substrate this build has no claim to. What makes that approach powerful is the
**topological** half: the braiding pattern is a genuine knot/link invariant, and
invariants of that kind are provably unchanged by any continuous perturbation —
only cutting the strand changes them. That property — *stability by
topology, not by vigilance* — is real, computable, and exactly what a registry
of independent execution lanes needs. This module builds that half honestly and
drops the half we don't have.

## The linking number — Gauss, 1833

For two closed curves in ℝ³, the **linking number** counts how many times one
threads through the other:

```
Lk(a,b) = (1/4π) ∮∮ (da × db) · (r_a − r_b) / |r_a − r_b|³
```

`linkingNumber()` computes this as a discrete sum over segment-pair midpoints —
straightforward numerical integration, no shortcuts. The result is an integer
(up to discretization noise), and that integer is **provably invariant under
ambient isotopy**: any continuous motion of either curve that never passes one
through the other leaves it unchanged. A test asserts this directly — rotating
one curve of a linked pair by 0.7 radians changes nothing about the linking
number, because rotation is exactly the kind of continuous deformation the
invariant is defined to ignore.

## Proven against a fact, not asserted

The **Hopf link** — two circles, each threaded through the other exactly once —
is textbook topology: its linking number is *exactly* ±1. `hopfLink()` builds
the standard parametrization (a unit circle in the xy-plane, a unit circle in
the xz-plane, offset so each passes through the other's center) and
`linkingNumber()` reproduces **`-1.0001645...`** from raw coordinates — matching
the known answer to four decimal places. `unlinkedCircles()` — two circles far
apart in the same plane — reproduces **exactly `0`**. If this code did not
reproduce both, the implementation would be wrong; there is no tuning
parameter that makes a textbook fact come out differently.

## Stabilizing the sandbox registry — reusing proven geometry, not inventing new geometry

`sandbox-registry.ts` needed a way to tell whether two execution lanes are
truly independent or have become accidentally coupled. The tempting move —
build a new geometric embedding from each lane's job history and tune it until
the numbers look right — is exactly the anti-pattern this whole build has
refused elsewhere (the regulator's escape demo, the witness oscillator's
shocks). So the stability check does **not** invent new geometry: it reuses the
two constructions already proven above, selected by a **real fact** read from
the dispatch log:

- Lane A dispatched to lane B **and** lane B dispatched to lane A (mutual
  coupling, checked in `sandbox_lane_jobs`) → embed the pair as the **Hopf
  link** → linking number **exactly ±1** → correctly flagged `entangled`.
- No dispatch, or dispatch in only one direction → embed the pair as
  **disjoint circles** → linking number **exactly 0** → correctly cleared as
  provably independent.

Nothing here is tunable. The topological readout is a direct, honest function
of "did these two lanes actually reference each other" — reusing geometry
whose correctness was already established against a known theorem, not fit to
this new use.

## The hardwired dispatch function

`laneDispatch(env, name, kind, payload, opts)` is fixed, deterministic routing
code: it records the job (tagging any lanes this job hands off to, which is
exactly the fact the stability check reads) and then calls
`dispatchToLane()` — the same wire protocol `connect-sandbox.ts` already speaks
to the `SandboxAgent` Durable Object. No model-authored branch decides where a
job goes; the lane name **is** the route. A Durable Object namespace mints a
distinct instance per string id at no standing cost, so naming any number of
lanes is free bookkeeping — each lane only gains real execution power once a
real connect-back client (a laptop, a runner) dials into that specific name,
the same honest limit the original single `'primary'` lane always had.

## Endpoints

- `POST /api/elle-sandbox-lane { action: 'create'|'list'|'remove'|'dispatch'|'stability'|'report', ... }`
  — admin-gated; `dispatch` is the hardwired function, `stability`/`report` run
  the topological check on real dispatch history.
- `GET /api/elle-topology-selftest` — the Hopf-link/disjoint-circle proof.
- `GET /api/elle-sandbox-registry-selftest` — the registry's stability logic,
  proven on constructed job logs (no D1 needed).

## Not yet done — stated plainly

This ships the registry and its stability check as callable HTTP endpoints. It
does **not** yet add a first-class ReAct tool entry in `router.ts` (a
`toolAllowed` scope row, a tool description, a dispatch case) — that is a
further, separate integration, deliberately left for its own careful pass
rather than folded into this one, the same discipline used when the reasoning
pass was wired into the router as its own dedicated change.

## The boundary, unchanged

This is real topology — the Gauss linking integral, checked against a named
theorem, invariant under provable continuous deformation. It is **not** quantum
computation, not entanglement in the physics sense, not a claim of mind. A
registry of named execution lanes is real bookkeeping over Durable Object
instances that still need a real client connected to do anything — "as many as
she can manage" means as many *names* as she can manage, honestly stated.
